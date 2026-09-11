import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock("@/modules/cloud-account/persistence/cloudHandler", () => ({
  CloudAccountRepo: {
    getAccounts: vi.fn(),
    setAccountStatus: vi.fn(),
  },
}));

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getSetting: vi.fn(),
      getActiveAccountIdForTarget: vi.fn(),
      isUnifiedMode: vi.fn(() => true),
      setUnifiedMode: vi.fn(),
      getOperationalState: vi.fn(),
    },
  }),
);

vi.mock("@/modules/cloud-account/ipc/handler", () => ({
  switchCloudAccount: vi.fn(),
}));

vi.mock("electron", () => ({
  Notification: class {
    show = vi.fn();
  },
}));

vi.mock("@/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("AutoSwitchService Concurrency Mutex & Singleflight Lifecycle", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");
    AutoSwitchService.resetCircuitBreakerForTesting();

    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(true);
    vi.mocked(CloudAccountSettingsStore.isUnifiedMode).mockReturnValue(true);
  });

  it("deduplicates concurrent triggerRateLimitSwitch calls with singleflight mutex", async () => {
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { switchCloudAccount } =
      await import("@/modules/cloud-account/ipc/handler");

    const defaultToken = {
      access_token: "tok1",
      refresh_token: "ref1",
      expires_in: 3600,
      expiry_timestamp: 9999999999,
      token_type: "Bearer",
    };

    const currentAccount: CloudAccount = {
      id: "acc-current",
      email: "current@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      is_active: true,
      created_at: 1000,
      last_used: 1000,
      quota: {
        models: {
          "gemini-pro": { percentage: 0, resetTime: "2026-09-12T00:00:00Z" },
        },
      },
    };

    const healthyAccount: CloudAccount = {
      id: "acc-healthy",
      email: "healthy@example.com",
      provider: "google",
      token: { ...defaultToken, access_token: "tok2" },
      status: "active",
      is_active: false,
      created_at: 1000,
      last_used: 1000,
      quota: {
        models: {
          "gemini-pro": { percentage: 95, resetTime: "2026-09-12T00:00:00Z" },
        },
      },
    };

    let accountsState = [currentAccount, healthyAccount];
    vi.mocked(CloudAccountRepo.getAccounts).mockImplementation(
      async () => accountsState,
    );
    vi.mocked(
      CloudAccountSettingsStore.getActiveAccountIdForTarget,
    ).mockReturnValue("acc-current");

    // Add simulated delay to switchCloudAccount to test in-flight overlap
    vi.mocked(switchCloudAccount).mockImplementation(
      async (accountId, _target) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        // After switch completes, update active account state
        accountsState = [
          { ...currentAccount, status: "rate_limited", is_active: false },
          { ...healthyAccount, status: "active", is_active: true },
        ];
        vi.mocked(
          CloudAccountSettingsStore.getActiveAccountIdForTarget,
        ).mockReturnValue("acc-healthy");
        return {
          overall: "success",
          accountId,
          succeededTargets: ["app", "ide", "cli"],
          failedTargets: [],
          switchedAt: Date.now(),
        };
      },
    );

    // Fire dual concurrent switches simulating dual 429 floods
    const [result1, result2] = await Promise.all([
      AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429 Resource Exhausted"),
        source: "relay",
      }),
      AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429 Resource Exhausted"),
        source: "relay",
      }),
    ]);

    // Only one rotation was executed
    expect(switchCloudAccount).toHaveBeenCalledTimes(1);
    expect(switchCloudAccount).toHaveBeenCalledWith("acc-healthy", "all", {
      source: "auto_switch",
      reason: "rate_limit",
    });

    // Both callers receive successful resolution
    expect(result1.switched).toBe(true);
    expect(result1.nextAccount?.id).toBe("acc-healthy");
    expect(result2.switched).toBe(true);
    expect(result2.nextAccount?.id).toBe("acc-healthy");
  });

  it("releases singleflight mutex in try...finally block upon error and allows subsequent switches", async () => {
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { switchCloudAccount } =
      await import("@/modules/cloud-account/ipc/handler");

    const defaultToken = {
      access_token: "tok",
      refresh_token: "ref",
      expires_in: 3600,
      expiry_timestamp: 9999999999,
      token_type: "Bearer",
    };

    const currentAccount: CloudAccount = {
      id: "acc-fail",
      email: "fail@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      is_active: true,
      created_at: 1000,
      last_used: 1000,
      quota: {
        models: {
          "gemini-pro": { percentage: 0, resetTime: "2026-09-12T00:00:00Z" },
        },
      },
    };

    const healthyAccount: CloudAccount = {
      id: "acc-healthy-2",
      email: "healthy2@example.com",
      provider: "google",
      token: { ...defaultToken, access_token: "tok2" },
      status: "active",
      is_active: false,
      created_at: 1000,
      last_used: 1000,
      quota: {
        models: {
          "gemini-pro": { percentage: 90, resetTime: "2026-09-12T00:00:00Z" },
        },
      },
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      currentAccount,
      healthyAccount,
    ]);
    vi.mocked(
      CloudAccountSettingsStore.getActiveAccountIdForTarget,
    ).mockReturnValue("acc-fail");

    // First call fails
    vi.mocked(switchCloudAccount).mockRejectedValueOnce(
      new Error("Disk write locked"),
    );

    await expect(
      AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429"),
        source: "relay",
      }),
    ).rejects.toThrow("Disk write locked");

    // Mutex should be released; second call should be able to acquire lock
    vi.mocked(switchCloudAccount).mockResolvedValueOnce({
      overall: "success",
      accountId: "acc-healthy-2",
      succeededTargets: ["app"],
      failedTargets: [],
      switchedAt: Date.now(),
    });

    const secondResult = await AutoSwitchService.triggerRateLimitSwitch({
      error: new Error("HTTP 429"),
      source: "relay",
    });

    expect(secondResult.switched).toBe(true);
    expect(secondResult.nextAccount?.id).toBe("acc-healthy-2");
    expect(switchCloudAccount).toHaveBeenCalledTimes(2);
  });

  it("aborts mutation cleanly and emits all_accounts_exhausted when findBestAccount returns null", async () => {
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { switchCloudAccount } =
      await import("@/modules/cloud-account/ipc/handler");
    const { cloudAccountEvents } =
      await import("@/modules/cloud-account/services/cloud-account-events");

    const defaultToken = {
      access_token: "tok",
      refresh_token: "ref",
      expires_in: 3600,
      expiry_timestamp: 9999999999,
      token_type: "Bearer",
    };

    const exhaustedAccount: CloudAccount = {
      id: "acc-only",
      email: "only@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      is_active: true,
      created_at: 1000,
      last_used: 1000,
      quota: {
        models: {
          "gemini-pro": { percentage: 0, resetTime: "2026-09-12T00:00:00Z" },
        },
      },
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      exhaustedAccount,
    ]);
    vi.mocked(
      CloudAccountSettingsStore.getActiveAccountIdForTarget,
    ).mockReturnValue("acc-only");

    const exhaustedSpy = vi.fn();
    cloudAccountEvents.on("all_accounts_exhausted", exhaustedSpy);

    const result = await AutoSwitchService.triggerRateLimitSwitch({
      error: new Error("HTTP 429: Resource Exhausted"),
      source: "relay",
    });

    expect(result.switched).toBe(false);
    expect(result.noAccountLeft).toBe(true);
    expect(result.reason).toBe("all_accounts_exhausted");
    expect(switchCloudAccount).not.toHaveBeenCalled();
    expect(exhaustedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("exhausted"),
        source: "relay",
      }),
    );

    cloudAccountEvents.off("all_accounts_exhausted", exhaustedSpy);
  });
});
