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
    deleteSetting: vi.fn((key: string) => {
      delete mocks.settings[key];
    }),
    getActiveAccountIdForTarget: vi.fn((target: AntigravityAppTarget) => {
      return (mocks.settings[`active_cloud_account.${target}`] as string) || "";
    }),
    setActiveForTarget: vi.fn(
      (target: AntigravityAppTarget | undefined, id: string) => {
        mocks.settings[`active_cloud_account.${target || "classic"}`] = id;
      },
    ),
    clearActiveForTarget: vi.fn((target: AntigravityAppTarget | undefined) => {
      delete mocks.settings[`active_cloud_account.${target || "classic"}`];
    }),
    evictAllMissingTargets: vi.fn(),
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
    setAccountStatus: vi.fn(),
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
      deleteSetting: mocks.deleteSetting,
      getActiveAccountIdForTarget: mocks.getActiveAccountIdForTarget,
      setActiveForTarget: mocks.setActiveForTarget,
      clearActiveForTarget: mocks.clearActiveForTarget,
      evictAllMissingTargets: mocks.evictAllMissingTargets,
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
    readTokenFromCredentialStore: vi.fn(() => null),
    hasTokenInCredentialStore: vi.fn(() => false),
  },
}));

vi.mock("@/modules/account/sqlite-token-injection", () => ({
  SQLiteTokenInjectionAdapter: {
    injectTokenIntoTargetDb: vi.fn(),
    hasTokenInTargetDb: vi.fn(() => true),
  },
}));

vi.mock("@/modules/antigravity-runtime/binary-patch/cliTokenStorage", () => ({
  writeAgyCliToken: vi.fn(),
}));

describe("Multi-Target Cloud Account Switch & Option B Partial Failure", () => {
  let switchCloudAccount: typeof import("@/modules/cloud-account/ipc/handler").switchCloudAccount;

  const createMockAccount = (
    overrides?: Partial<CloudAccount>,
  ): CloudAccount => ({
    id: "acc-1",
    provider: "google",
    email: "test@example.com",
    token: {
      access_token: "valid-token",
      refresh_token: "valid-refresh",
      expires_in: 3600,
      expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      token_type: "Bearer",
    },
    created_at: 1000,
    last_used: 1000,
    status: "active",
    is_active: true,
    ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.accounts = [createMockAccount()];
    for (const key of Object.keys(mocks.settings)) {
      delete mocks.settings[key];
    }
    mocks.isAntigravityTargetInstalled.mockReturnValue(true);
    mocks.executeSwitchFlow.mockResolvedValue({ restarted: true });

    const handler = await import("@/modules/cloud-account/ipc/handler");
    switchCloudAccount = handler.switchCloudAccount;
  });

  it("switches all installed targets successfully with overall 'success'", async () => {
    const result = await switchCloudAccount("acc-1", "all");

    expect(result.overall).toBe("success");
    expect(result.accountId).toBe("acc-1");
    expect(result.succeededTargets).toEqual(["classic", "ide", "agy"]);
    expect(result.failedTargets).toEqual([]);
    expect(result.results?.classic?.success).toBe(true);
    expect(result.results?.ide?.success).toBe(true);
    expect(result.results?.agy?.success).toBe(true);
    expect(mocks.syncActiveFlags).toHaveBeenCalled();
  });

  it("handles Option B partial failure: commits successful targets and retains failed ones", async () => {
    mocks.executeSwitchFlow.mockImplementation(async (options: any) => {
      if (options.appTarget === "ide") {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return { restarted: true };
    });

    const result = await switchCloudAccount("acc-1", "all");

    expect(result.overall).toBe("partial");
    expect(result.accountId).toBe("acc-1");
    expect(result.succeededTargets).toEqual(["classic", "agy"]);
    expect(result.failedTargets).toEqual([
      { target: "ide", error: "SQLITE_BUSY: database is locked" },
    ]);
    expect(result.results?.classic?.success).toBe(true);
    expect(result.results?.ide?.success).toBe(false);
    expect(result.results?.ide?.error).toContain("SQLITE_BUSY");
    expect(result.results?.agy?.success).toBe(true);

    // Active flags must still be synced so successful targets remain active
    expect(mocks.syncActiveFlags).toHaveBeenCalled();
  });

  it("returns overall 'failed' when all installed targets fail in batch switch", async () => {
    mocks.executeSwitchFlow.mockRejectedValue(new Error("Global disk error"));

    const result = await switchCloudAccount("acc-1", "all");

    expect(result.overall).toBe("failed");
    expect(result.succeededTargets).toEqual([]);
    expect(result.failedTargets.length).toBe(3);
    expect(result.results?.classic?.success).toBe(false);
    expect(result.results?.ide?.success).toBe(false);
    expect(result.results?.agy?.success).toBe(false);
  });

  it("throws TARGET_NOT_INSTALLED error when switching a specific target that is not installed", async () => {
    mocks.isAntigravityTargetInstalled.mockReturnValue(false);

    await expect(switchCloudAccount("acc-1", "ide")).rejects.toThrow(
      /TARGET_NOT_INSTALLED/,
    );
  });

  it("switches a single installed target successfully", async () => {
    mocks.isAntigravityTargetInstalled.mockReturnValue(true);

    const result = await switchCloudAccount("acc-1", "classic");

    expect(result.overall).toBe("success");
    expect(result.succeededTargets).toEqual(["classic"]);
    expect(result.failedTargets).toEqual([]);
    expect(mocks.syncActiveFlags).toHaveBeenCalled();
  });

  it("evicts missing target settings on listCloudAccounts and maps is_active_agy", async () => {
    const { listCloudAccounts } =
      await import("@/modules/cloud-account/ipc/handler");
    mocks.getActiveAccountIdForTarget.mockImplementation(
      (target: AntigravityAppTarget) => {
        if (target === "agy") return "acc-1";
        return "";
      },
    );

    const accounts = await listCloudAccounts();

    expect(mocks.evictAllMissingTargets).toHaveBeenCalled();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].is_active_agy).toBe(true);
  });
});
