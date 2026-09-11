import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccount } from "@/modules/cloud-account/types";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

const mocks = vi.hoisted(() => {
  const accounts: CloudAccount[] = [];
  const settings: Record<string, unknown> = {};

  return {
    accounts,
    settings,
    getAccount: vi.fn(
      async (id: string) => mocks.accounts.find((a) => a.id === id) ?? null,
    ),
    getAccounts: vi.fn(async () => mocks.accounts),
    updateToken: vi.fn(async () => {}),
    updateLastUsed: vi.fn(),
    syncActiveFlags: vi.fn(),
    setActive: vi.fn(),
    setAccountStatus: vi.fn(),
    refreshAccessToken: vi.fn(async () => ({
      access_token: "new-access-token",
      expires_in: 3600,
    })),
    executeSwitchFlow: vi.fn(async (_options?: any) => ({ restarted: true })),
    isAntigravityTargetInstalled: vi.fn(
      (_target: AntigravityAppTarget) => true,
    ),
    getSetting: vi.fn(
      (key: string, defaultValue: unknown) =>
        mocks.settings[key] ?? defaultValue,
    ),
    setSetting: vi.fn((key: string, value: unknown) => {
      mocks.settings[key] = value;
    }),
    getActiveAccountIdForTarget: vi.fn((target: AntigravityAppTarget) => {
      return (mocks.settings[`active_cloud_account.${target}`] as string) || "";
    }),
    setActiveForTarget: vi.fn(
      (target: AntigravityAppTarget | undefined, id: string) => {
        mocks.settings[`active_cloud_account.${target || "app"}`] = id;
      },
    ),
    isUnifiedMode: vi.fn(() => true),
    setUnifiedMode: vi.fn((enabled: boolean) => {
      mocks.settings["unified_mode"] = enabled;
    }),
  };
});

vi.mock("@/modules/cloud-account/persistence/cloudHandler", () => ({
  CloudAccountRepo: {
    getAccount: mocks.getAccount,
    getAccounts: mocks.getAccounts,
    updateToken: mocks.updateToken,
    updateLastUsed: mocks.updateLastUsed,
    syncActiveFlags: mocks.syncActiveFlags,
    setActive: mocks.setActive,
    setAccountStatus: mocks.setAccountStatus,
  },
}));

vi.mock(
  "@/modules/cloud-account/services/CloudAccountRefreshService",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/modules/cloud-account/services/CloudAccountRefreshService")
      >();
    return {
      ...actual,
      CloudAccountRefreshService: {
        ...actual.CloudAccountRefreshService,
        refreshAccessToken: mocks.refreshAccessToken,
      },
    };
  },
);

vi.mock("@/modules/antigravity-runtime/switch/switchFlow", () => ({
  executeSwitchFlow: mocks.executeSwitchFlow,
}));

vi.mock("@/shared/platform/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/platform/paths")>();
  return {
    ...actual,
    isAntigravityTargetInstalled: mocks.isAntigravityTargetInstalled,
  };
});

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getSetting: mocks.getSetting,
      setSetting: mocks.setSetting,
      getActiveAccountIdForTarget: mocks.getActiveAccountIdForTarget,
      setActiveForTarget: mocks.setActiveForTarget,
      isUnifiedMode: mocks.isUnifiedMode,
      setUnifiedMode: mocks.setUnifiedMode,
    },
  }),
);

vi.mock("@/modules/identity-profile/ipc/handler", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/identity-profile/ipc/handler")
    >();
  return {
    ...actual,
    getAccountBoundProfile: vi.fn(async () => null),
    applyDeviceProfile: vi.fn(),
    ensureGlobalOriginalFromCurrentStorage: vi.fn(),
  };
});

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-device-binding-store",
  () => ({
    CloudAccountDeviceBindingStore: {
      getDeviceBinding: vi.fn(() => null),
      setDeviceBinding: vi.fn(),
      deleteDeviceBinding: vi.fn(),
    },
  }),
);

vi.mock("@/modules/account/credential-store-injection", () => ({
  CredentialStoreInjectionAdapter: {
    shouldInjectTokenIntoCredentialStore: vi.fn(() => false),
    injectToken: vi.fn(),
    injectCloudTokenWithStorageStrategy: vi.fn(),
    readTokenFromCredentialStore: vi.fn(() => null),
    hasTokenInCredentialStore: vi.fn(() => false),
  },
}));

vi.mock("@/modules/cloud-account/services/AutoSwitchService", () => ({
  AutoSwitchService: {
    isAccountDepleted: vi.fn(() => false),
    findBestAccount: vi.fn(),
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

const defaultToken = {
  access_token: "tok",
  refresh_token: "ref",
  expires_in: 3600,
  expiry_timestamp: 9999999999,
  token_type: "Bearer",
};

describe("resyncAllEnvironments Master Resolution Rule Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.length = 0;
    for (const key of Object.keys(mocks.settings)) {
      delete mocks.settings[key];
    }
  });

  it("Branch 1: resolves to healthy App active account (Priority 1)", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const appAccount: CloudAccount = {
      id: "acc-app",
      email: "app@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(appAccount);
    mocks.settings["active_cloud_account.app"] = "acc-app";
    vi.mocked(AutoSwitchService.isAccountDepleted).mockReturnValue(false);

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(true);
    expect(result.accountId).toBe("acc-app");
    expect(result.resolutionBranch).toBe("app_healthy");
    expect(mocks.setUnifiedMode).toHaveBeenCalledWith(true);
  });

  it("Branch 2: resolves to healthy CLI active account when App account is rate-limited (Priority 2)", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const appAccount: CloudAccount = {
      id: "acc-app",
      email: "app@example.com",
      provider: "google",
      token: defaultToken,
      status: "rate_limited",
      created_at: 1000,
      last_used: 1000,
    };

    const cliAccount: CloudAccount = {
      id: "acc-cli",
      email: "cli@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(appAccount, cliAccount);
    mocks.settings["active_cloud_account.app"] = "acc-app";
    mocks.settings["active_cloud_account.cli"] = "acc-cli";
    vi.mocked(AutoSwitchService.isAccountDepleted).mockReturnValue(false);

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(true);
    expect(result.accountId).toBe("acc-cli");
    expect(result.resolutionBranch).toBe("cli_healthy");
    expect(mocks.setUnifiedMode).toHaveBeenCalledWith(true);
  });

  it("Branch 3: resolves to healthy IDE active account when App & CLI are depleted (Priority 3)", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const appAccount: CloudAccount = {
      id: "acc-app",
      email: "app@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    const ideAccount: CloudAccount = {
      id: "acc-ide",
      email: "ide@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(appAccount, ideAccount);
    mocks.settings["active_cloud_account.app"] = "acc-app";
    mocks.settings["active_cloud_account.ide"] = "acc-ide";

    // App account is depleted, IDE account is healthy
    vi.mocked(AutoSwitchService.isAccountDepleted).mockImplementation(
      (acc) => acc.id === "acc-app",
    );

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(true);
    expect(result.accountId).toBe("acc-ide");
    expect(result.resolutionBranch).toBe("ide_healthy");
    expect(mocks.setUnifiedMode).toHaveBeenCalledWith(true);
  });

  it("Branch 4: falls back to best 5h quota candidate when all active targets are depleted (Priority 4)", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const appAccount: CloudAccount = {
      id: "acc-depleted",
      email: "depleted@example.com",
      provider: "google",
      token: defaultToken,
      status: "rate_limited",
      created_at: 1000,
      last_used: 1000,
    };

    const bestCandidate: CloudAccount = {
      id: "acc-best-quota",
      email: "best@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(appAccount, bestCandidate);
    mocks.settings["active_cloud_account.app"] = "acc-depleted";
    vi.mocked(AutoSwitchService.findBestAccount).mockResolvedValue(
      bestCandidate,
    );

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(true);
    expect(result.accountId).toBe("acc-best-quota");
    expect(result.resolutionBranch).toBe("best_quota_fallback");
    expect(mocks.setUnifiedMode).toHaveBeenCalledWith(true);
  });

  it("Fallback Failure: aborts cleanly and emits all_accounts_exhausted when findBestAccount returns null", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");
    const { cloudAccountEvents } =
      await import("@/modules/cloud-account/services/cloud-account-events");

    const appAccount: CloudAccount = {
      id: "acc-dead",
      email: "dead@example.com",
      provider: "google",
      token: defaultToken,
      status: "rate_limited",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(appAccount);
    mocks.settings["active_cloud_account.app"] = "acc-dead";
    vi.mocked(AutoSwitchService.findBestAccount).mockResolvedValue(null);

    const exhaustedSpy = vi.fn();
    cloudAccountEvents.on("all_accounts_exhausted", exhaustedSpy);

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(false);
    expect(result.overall).toBe("failed");
    expect(result.resolutionBranch).toBe("exhausted");
    expect(result.reason).toBe("all_accounts_exhausted");
    expect(exhaustedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "All cloud accounts are rate-limited or exhausted",
        source: "resync",
      }),
    );

    cloudAccountEvents.off("all_accounts_exhausted", exhaustedSpy);
  });

  it("Explicit AccountId: respects explicitly requested accountId", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");

    const explicitAccount: CloudAccount = {
      id: "acc-explicit",
      email: "explicit@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(explicitAccount);

    const result = await resyncAllEnvironments("acc-explicit");

    expect(result.success).toBe(true);
    expect(result.accountId).toBe("acc-explicit");
    expect(result.resolutionBranch).toBe("explicit");
    expect(mocks.setUnifiedMode).toHaveBeenCalledWith(true);
  });

  it("throws when explicit accountId does not exist", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");

    await expect(resyncAllEnvironments("nonexistent-acc")).rejects.toThrow(
      "Account not found: nonexistent-acc",
    );
  });

  it("handles partial switch failure gracefully without rollback", async () => {
    const { resyncAllEnvironments } =
      await import("@/modules/cloud-account/ipc/handler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const account: CloudAccount = {
      id: "acc-app",
      email: "app@example.com",
      provider: "google",
      token: defaultToken,
      status: "active",
      created_at: 1000,
      last_used: 1000,
    };

    mocks.accounts.push(account);
    mocks.settings["active_cloud_account.app"] = "acc-app";
    vi.mocked(AutoSwitchService.isAccountDepleted).mockReturnValue(false);

    // Simulate partial failure: app succeeds, but cli fails
    mocks.executeSwitchFlow.mockImplementation(async (options: any) => {
      if (options.appTarget === "cli") {
        throw new Error("EACCES: permission denied");
      }
      return { restarted: true };
    });

    const result = await resyncAllEnvironments();

    expect(result.success).toBe(true);
    expect(result.overall).toBe("partial");
    expect(result.succeededTargets).toContain("app");
    expect(result.failedTargets.some((f) => f.target === "cli")).toBe(true);
  });
});
