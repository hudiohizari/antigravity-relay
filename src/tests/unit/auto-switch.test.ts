import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudAccount,
  CloudQuotaData,
} from "@/modules/cloud-account/types";

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
    },
  }),
);

vi.mock("@/modules/cloud-account/ipc/handler", () => ({
  switchCloudAccount: vi.fn(),
}));

vi.mock("@/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createAccount(
  id: string,
  quota: CloudQuotaData,
  options: Partial<CloudAccount> = {},
): CloudAccount {
  return {
    id,
    provider: "google",
    email: `${id}@example.com`,
    token: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      expiry_timestamp: 1700000000,
      token_type: "Bearer",
    },
    quota,
    created_at: 1700000000,
    last_used: 1700000000,
    status: "active",
    ...options,
  };
}

function quotaWithClaudeGroup(
  modelPercentage: number,
  groupFraction: number,
): CloudQuotaData {
  return {
    models: {
      "claude-sonnet-4-5": {
        percentage: modelPercentage,
        resetTime: "",
      },
    },
    quota_groups: [
      {
        display_name: "Claude and GPT models",
        buckets: [
          {
            bucket_id: "3p-5h",
            window: "5h",
            remaining_fraction: groupFraction,
            reset_time: "",
          },
        ],
      },
    ],
  };
}

describe("AutoSwitchService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips accounts whose Claude/GPT grouped quota bucket is depleted", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", quotaWithClaudeGroup(1, 0.01)),
      createAccount("model-high-group-low", quotaWithClaudeGroup(90, 0.02)),
      createAccount(
        "model-medium-group-healthy",
        quotaWithClaudeGroup(45, 0.8),
      ),
    ]);

    await expect(
      AutoSwitchService.findBestAccount("current"),
    ).resolves.toMatchObject({
      id: "model-medium-group-healthy",
    });
  });

  it("respects enabled model configuration when checking depletion", async () => {
    // eslint-disable-next-line unused-imports/no-unused-vars
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const config = {
      "claude-sonnet-4-5": { enabled: false, priority: false },
      "gemini-pro": { enabled: true, priority: false },
    };
    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(config);

    const testAccount = createAccount("test-acc", {
      models: {
        "claude-sonnet-4-5": { percentage: 2, resetTime: "" },
        "gemini-pro": { percentage: 90, resetTime: "" },
      },
    });

    // Depleted should be false because claude-sonnet-4-5 is disabled!
    expect(AutoSwitchService.isAccountDepleted(testAccount)).toBe(false);
  });

  it("applies unprefixed model settings to prefixed quota model identifiers", async () => {
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue({
      "claude-sonnet-4-5": { enabled: false, priority: false },
      "gemini-pro": { enabled: true, priority: false },
    });

    const testAccount = createAccount("prefixed-models", {
      models: {
        "models/claude-sonnet-4-5": { percentage: 1, resetTime: "" },
        "models/gemini-pro": { percentage: 90, resetTime: "" },
      },
    });

    expect(AutoSwitchService.isAccountDepleted(testAccount)).toBe(false);
  });

  it("uses unprefixed priority settings when quota identifiers are prefixed", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue({
      "claude-sonnet-4-5": { enabled: true, priority: true },
      "gemini-pro": { enabled: true, priority: false },
    });

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", {
        models: {
          "models/claude-sonnet-4-5": { percentage: 50, resetTime: "" },
          "models/gemini-pro": { percentage: 90, resetTime: "" },
        },
      }),
      createAccount("priority-high", {
        models: {
          "models/claude-sonnet-4-5": { percentage: 80, resetTime: "" },
          "models/gemini-pro": { percentage: 10, resetTime: "" },
        },
      }),
      createAccount("priority-low", {
        models: {
          "models/claude-sonnet-4-5": { percentage: 60, resetTime: "" },
          "models/gemini-pro": { percentage: 95, resetTime: "" },
        },
      }),
    ]);

    await expect(
      AutoSwitchService.findBestAccount("current"),
    ).resolves.toMatchObject({
      id: "priority-high",
    });
  });

  it("uses the best quota in an alias group and keeps the threshold comparison strict", async () => {
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const accountWithHealthySibling = createAccount("healthy-sibling", {
      models: {
        "gemini-3.1-pro-low": { percentage: 0, resetTime: "" },
        "gemini-3.1-pro-high": { percentage: 80, resetTime: "" },
        "gemini-3.1-flash-image": { percentage: 5, resetTime: "" },
      },
    });
    const accountWithDepletedGroup = createAccount("depleted-group", {
      models: {
        "gemini-3.1-pro-low": { percentage: 0, resetTime: "" },
        "gemini-3.1-pro-high": { percentage: 4, resetTime: "" },
      },
    });

    expect({
      healthySibling: AutoSwitchService.isAccountDepleted(
        accountWithHealthySibling,
      ),
      depletedGroup: AutoSwitchService.isAccountDepleted(
        accountWithDepletedGroup,
      ),
    }).toEqual({
      healthySibling: false,
      depletedGroup: true,
    });
  });

  it("matches depleted quota groups for models-prefixed identifiers", async () => {
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const prefixedModelAccount = createAccount("prefixed-model", {
      models: {
        "models/gemini-flash": { percentage: 90, resetTime: "" },
      },
      quota_groups: [
        {
          display_name: "Gemini models",
          buckets: [
            {
              bucket_id: "gemini-group",
              window: "5h",
              remaining_fraction: 0.01,
              reset_time: "",
            },
          ],
        },
      ],
    });

    expect(AutoSwitchService.isAccountDepleted(prefixedModelAccount)).toBe(
      true,
    );
  });

  it("prioritizes priority models during best account selection", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    const config = {
      "claude-sonnet-4-5": { enabled: true, priority: true },
      "gemini-pro": { enabled: true, priority: false },
    };
    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(config);

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", {
        models: {
          "claude-sonnet-4-5": { percentage: 50, resetTime: "" },
          "gemini-pro": { percentage: 90, resetTime: "" },
        },
      }),
      // Acc A has lower overall average (45% vs 75%) but HIGHER priority model percentage (80% vs 60%)
      createAccount("acc-a", {
        models: {
          "claude-sonnet-4-5": { percentage: 80, resetTime: "" },
          "gemini-pro": { percentage: 10, resetTime: "" },
        },
      }),
      createAccount("acc-b", {
        models: {
          "claude-sonnet-4-5": { percentage: 60, resetTime: "" },
          "gemini-pro": { percentage: 90, resetTime: "" },
        },
      }),
    ]);

    await expect(
      AutoSwitchService.findBestAccount("current"),
    ).resolves.toMatchObject({
      id: "acc-a",
    });
  });

  it("prefers an account that exposes a configured priority model over a higher fallback score", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue({
      "claude-sonnet-4-5": { enabled: true, priority: true },
      "gemini-pro": { enabled: true, priority: false },
    });

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", {
        models: {
          "claude-sonnet-4-5": { percentage: 50, resetTime: "" },
        },
      }),
      createAccount("priority-present", {
        models: {
          "claude-sonnet-4-5": { percentage: 60, resetTime: "" },
          "gemini-pro": { percentage: 10, resetTime: "" },
        },
      }),
      createAccount("priority-missing", {
        models: {
          "gemini-pro": { percentage: 100, resetTime: "" },
        },
      }),
    ]);

    await expect(
      AutoSwitchService.findBestAccount("current"),
    ).resolves.toMatchObject({
      id: "priority-present",
    });
  });

  it("selects the account with the highest 5h quota remaining among active candidates", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue({});

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", quotaWithClaudeGroup(10, 0.05)),
      createAccount("acc-40pct-5h", quotaWithClaudeGroup(40, 0.4)),
      createAccount("acc-85pct-5h", quotaWithClaudeGroup(85, 0.85)),
      createAccount("acc-60pct-5h", quotaWithClaudeGroup(60, 0.6)),
      createAccount("acc-rate-limited", quotaWithClaudeGroup(95, 0.95), {
        status: "rate_limited",
      }),
      createAccount("acc-expired", quotaWithClaudeGroup(99, 0.99), {
        status: "expired",
      }),
    ]);

    const best = await AutoSwitchService.findBestAccount("current");
    expect(best?.id).toBe("acc-85pct-5h");
  });

  it("prefers an account with balanced multi-group 5h quota over an account with one depleted group", async () => {
    const { CloudAccountRepo } =
      await import("@/modules/cloud-account/persistence/cloudHandler");
    const { CloudAccountSettingsStore } =
      await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
    const { AutoSwitchService } =
      await import("@/modules/cloud-account/services/AutoSwitchService");

    vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue({});

    const quotaSkewed: CloudQuotaData = {
      models: {
        "gemini-pro": { percentage: 90, resetTime: "" },
        "claude-3-5": { percentage: 10, resetTime: "" },
      },
      quota_groups: [
        {
          display_name: "Gemini models",
          buckets: [
            {
              bucket_id: "gemini-5h",
              window: "5h",
              remaining_fraction: 0.9,
              reset_time: "",
            },
          ],
        },
        {
          display_name: "Claude models",
          buckets: [
            {
              bucket_id: "claude-5h",
              window: "5h",
              remaining_fraction: 0.1,
              reset_time: "",
            },
          ],
        },
      ],
    };

    const quotaBalanced: CloudQuotaData = {
      models: {
        "gemini-pro": { percentage: 70, resetTime: "" },
        "claude-3-5": { percentage: 70, resetTime: "" },
      },
      quota_groups: [
        {
          display_name: "Gemini models",
          buckets: [
            {
              bucket_id: "gemini-5h",
              window: "5h",
              remaining_fraction: 0.7,
              reset_time: "",
            },
          ],
        },
        {
          display_name: "Claude models",
          buckets: [
            {
              bucket_id: "claude-5h",
              window: "5h",
              remaining_fraction: 0.7,
              reset_time: "",
            },
          ],
        },
      ],
    };

    vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
      createAccount("current", quotaWithClaudeGroup(10, 0.05)),
      createAccount("skewed-acc", quotaSkewed),
      createAccount("balanced-acc", quotaBalanced),
    ]);

    const best = await AutoSwitchService.findBestAccount("current");
    expect(best?.id).toBe("balanced-acc");
  });

  describe("isRateLimitError utility", () => {
    it("correctly identifies rate limit errors vs other errors", async () => {
      const { isRateLimitError } =
        await import("@/modules/cloud-account/utils/account-status");

      expect(isRateLimitError(new Error("HTTP 429: Too Many Requests"))).toBe(
        true,
      );
      expect(isRateLimitError({ status: 429 })).toBe(true);
      expect(isRateLimitError({ statusCode: 429 })).toBe(true);
      expect(isRateLimitError({ httpStatus: 429 })).toBe(true);
      expect(
        isRateLimitError(
          new Error("Resource has been exhausted (e.g. check quota)"),
        ),
      ).toBe(true);
      expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
      expect(isRateLimitError(new Error("risk control triggered"))).toBe(true);

      // Non-rate-limit errors MUST return false
      expect(isRateLimitError(new Error("HTTP 401: Unauthorized"))).toBe(false);
      expect(isRateLimitError(new Error('{"error":"invalid_grant"}'))).toBe(
        false,
      );
      expect(
        isRateLimitError(new Error("HTTP 500: Internal Server Error")),
      ).toBe(false);
      expect(isRateLimitError(new Error("HTTP 503: Service Unavailable"))).toBe(
        false,
      );
      expect(
        isRateLimitError(new Error("ETIMEDOUT: Connection timed out")),
      ).toBe(false);
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });
  });

  describe("triggerRateLimitSwitch", () => {
    it("ignores non-rate-limit errors and does NOT trigger switch", async () => {
      const { CloudAccountSettingsStore } =
        await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
      const { switchCloudAccount } =
        await import("@/modules/cloud-account/ipc/handler");
      const { AutoSwitchService } =
        await import("@/modules/cloud-account/services/AutoSwitchService");

      vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(true);

      const result = await AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 401: Unauthorized invalid_grant"),
        reason: "invalid_grant",
      });

      expect(result).toEqual({ switched: false, ignored: true });
      expect(switchCloudAccount).not.toHaveBeenCalled();
    });

    it("respects auto_switch_enabled setting when disabled", async () => {
      const { CloudAccountSettingsStore } =
        await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
      const { switchCloudAccount } =
        await import("@/modules/cloud-account/ipc/handler");
      const { AutoSwitchService } =
        await import("@/modules/cloud-account/services/AutoSwitchService");

      vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(false);

      const result = await AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429: Too many requests"),
      });

      expect(result).toEqual({
        switched: false,
        ignored: true,
        reason: "disabled",
      });
      expect(switchCloudAccount).not.toHaveBeenCalled();
    });

    it("immediately marks current account rate_limited and switches to highest 5h candidate", async () => {
      const { CloudAccountRepo } =
        await import("@/modules/cloud-account/persistence/cloudHandler");
      const { CloudAccountSettingsStore } =
        await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
      const { switchCloudAccount } =
        await import("@/modules/cloud-account/ipc/handler");
      const { AutoSwitchService } =
        await import("@/modules/cloud-account/services/AutoSwitchService");

      vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(true);
      vi.mocked(
        CloudAccountSettingsStore.getActiveAccountIdForTarget,
      ).mockReturnValue("active-acc");

      const current = createAccount(
        "active-acc",
        quotaWithClaudeGroup(10, 0.02),
        {
          is_active: true,
        },
      );
      const candidate1 = createAccount(
        "cand-50",
        quotaWithClaudeGroup(50, 0.5),
      );
      const candidate2 = createAccount(
        "cand-80",
        quotaWithClaudeGroup(80, 0.8),
      );

      vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([
        current,
        candidate1,
        candidate2,
      ]);

      const result = await AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429: resource_exhausted"),
        source: "relay",
      });

      expect(CloudAccountRepo.setAccountStatus).toHaveBeenCalledWith(
        "active-acc",
        "rate_limited",
        expect.stringContaining("429"),
      );
      expect(switchCloudAccount).toHaveBeenCalledWith("cand-80", undefined);
      expect(result.switched).toBe(true);
      expect(result.nextAccount?.id).toBe("cand-80");
    });

    it("handles exhaustion gracefully when no healthy accounts remain", async () => {
      const { CloudAccountRepo } =
        await import("@/modules/cloud-account/persistence/cloudHandler");
      const { CloudAccountSettingsStore } =
        await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
      const { switchCloudAccount } =
        await import("@/modules/cloud-account/ipc/handler");
      const { AutoSwitchService } =
        await import("@/modules/cloud-account/services/AutoSwitchService");

      vi.mocked(CloudAccountSettingsStore.getSetting).mockReturnValue(true);
      vi.mocked(
        CloudAccountSettingsStore.getActiveAccountIdForTarget,
      ).mockReturnValue("only-acc");

      const current = createAccount("only-acc", quotaWithClaudeGroup(5, 0.01), {
        is_active: true,
      });

      vi.mocked(CloudAccountRepo.getAccounts).mockResolvedValue([current]);

      const result = await AutoSwitchService.triggerRateLimitSwitch({
        error: new Error("HTTP 429: Rate limit reached"),
        source: "relay",
      });

      expect(result).toEqual({ switched: false, noAccountLeft: true });
      expect(switchCloudAccount).not.toHaveBeenCalled();
    });
  });
});
