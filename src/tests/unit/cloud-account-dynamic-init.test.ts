import { describe, expect, it, vi, beforeEach } from "vitest";
import { CloudAccountRepo } from "@/modules/cloud-account/persistence/cloudHandler";
import { getCloudDb } from "@/modules/cloud-account/persistence/cloud-account-db";
import * as security from "@/shared/security/security";
import { AppError } from "@/shared/errors/appError";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock("@/modules/cloud-account/persistence/cloud-account-db");
vi.mock("@/shared/security/security");

describe("CloudAccountRepo Dynamic Master Key Initialization & Recovery", () => {
  const mockAccountRow = {
    id: "acc-1",
    provider: "google",
    email: "test@example.com",
    tokenJson: "encrypted_token_1",
    quotaJson: null,
    healthJson: null,
    deviceProfileJson: null,
    deviceHistoryJson: null,
    createdAt: 1000,
    lastUsed: 2000,
    status: "active",
    statusReason: null,
    isActive: 1,
    proxyUrl: null,
  };

  const validToken = {
    access_token: "mock_token",
    refresh_token: "mock_refresh",
    expires_in: 3600,
    expiry_timestamp: 4102444800,
    token_type: "Bearer",
  };

  const validQuota = {
    models: {},
  };

  const validHealth = {
    oauth: {
      refresh_blocked: false,
    },
  };

  const sampleAccount: CloudAccount = {
    id: "acc-new",
    provider: "google",
    email: "new@example.com",
    token: validToken,
    quota: validQuota,
    health: validHealth,
    created_at: 1000,
    last_used: 1000,
    status: "active",
    is_active: true,
  };

  let mockOrm: any;

  beforeEach(() => {
    vi.resetAllMocks();
    CloudAccountRepo.resetInitializationForTesting();

    mockOrm = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          all: vi.fn(() => [mockAccountRow]),
          where: vi.fn(() => ({
            all: vi.fn(() => [mockAccountRow]),
          })),
          orderBy: vi.fn(() => ({
            all: vi.fn(() => [mockAccountRow]),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            run: vi.fn(() => ({ changes: 1 })),
          })),
        })),
      })),
      transaction: vi.fn((cb: (tx: any) => void) => {
        cb({
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              run: vi.fn(() => ({ changes: 1 })),
              where: vi.fn(() => ({
                run: vi.fn(() => ({ changes: 1 })),
              })),
            })),
          })),
          insert: vi.fn(() => ({
            values: vi.fn(() => ({
              onConflictDoUpdate: vi.fn(() => ({
                run: vi.fn(),
              })),
            })),
          })),
        });
      }),
    };

    vi.mocked(getCloudDb).mockReturnValue({
      raw: { close: vi.fn() } as any,
      orm: mockOrm as any,
    });
  });

  it("attempts dynamic init on getAccounts() when cold start failed, recovering after Keychain unlock", async () => {
    let keychainUnlocked = false;

    vi.mocked(security.isMasterKeyInitialized).mockImplementation(
      () => keychainUnlocked,
    );
    vi.mocked(security.initializeMasterKey).mockImplementation(async () => {
      if (!keychainUnlocked) {
        throw new AppError(
          "MASTER_KEY_UNAVAILABLE",
          "Keychain locked or denied",
          {
            messageKey: "error.masterKeyUnavailable",
            metadata: {
              hint: "HINT_KEYCHAIN_DENIED",
              reason: "PROVIDER_UNAVAILABLE",
              storedAccountCount: 1,
            },
          },
        );
      }
      return { state: "secure", masterKeySource: "safeStorage" };
    });
    vi.mocked(security.decryptWithMigration).mockImplementation(async () => ({
      value: JSON.stringify(validToken),
    }));

    // First attempt (cold start failed, Keychain locked): Clicking Retry or listing fails
    await expect(CloudAccountRepo.getAccounts()).rejects.toThrow(
      "Keychain locked or denied",
    );
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(1);

    // User unlocks Keychain / allows permission in Keychain Access
    keychainUnlocked = true;

    // Second attempt (User clicked "Retry" in UI): Recovers dynamically without app restart!
    const recoveredAccounts = await CloudAccountRepo.getAccounts();
    expect(recoveredAccounts).toHaveLength(1);
    expect(recoveredAccounts[0].email).toBe("test@example.com");
    expect(recoveredAccounts[0].token.access_token).toBe("mock_token");
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(2);

    // Third attempt (Already initialized): Fast-path, does not call initializeMasterKey again
    const cachedAccounts = await CloudAccountRepo.getAccounts();
    expect(cachedAccounts).toHaveLength(1);
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent initialization requests into a single in-flight promise", async () => {
    let isInitDone = false;
    vi.mocked(security.isMasterKeyInitialized).mockImplementation(
      () => isInitDone,
    );
    vi.mocked(security.initializeMasterKey).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      isInitDone = true;
      return { state: "secure", masterKeySource: "safeStorage" };
    });
    vi.mocked(security.decryptWithMigration).mockImplementation(async () => ({
      value: JSON.stringify(validToken),
    }));

    // Trigger 3 concurrent calls (e.g. UI query + tray + background monitor)
    const [res1, res2, res3] = await Promise.all([
      CloudAccountRepo.getAccounts(),
      CloudAccountRepo.getAccounts(),
      CloudAccountRepo.getAccounts(),
    ]);

    expect(res1).toHaveLength(1);
    expect(res2).toHaveLength(1);
    expect(res3).toHaveLength(1);
    // Verified: Only 1 initializeMasterKey call happened, not 3!
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(1);
  });

  it("ensures master key initialization across getAccount, addAccount, updateToken, updateQuota, updateHealth", async () => {
    vi.mocked(security.isMasterKeyInitialized).mockReturnValue(false);
    vi.mocked(security.initializeMasterKey).mockResolvedValue({
      state: "secure",
      masterKeySource: "safeStorage",
    });
    vi.mocked(security.encrypt).mockResolvedValue("encrypted_mock_value");
    vi.mocked(security.decryptWithMigration).mockImplementation(
      async (val: string) => {
        if (val === "encrypted_token_1") {
          return { value: JSON.stringify(validToken) };
        }
        if (val === "encrypted_quota_1") {
          return { value: JSON.stringify(validQuota) };
        }
        if (val === "encrypted_health_1") {
          return { value: JSON.stringify(validHealth) };
        }
        return { value: val };
      },
    );

    // Test getAccount
    CloudAccountRepo.resetInitializationForTesting();
    const account = await CloudAccountRepo.getAccount("acc-1");
    expect(account).toBeDefined();
    expect(account?.id).toBe("acc-1");
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(1);

    // Test addAccount
    CloudAccountRepo.resetInitializationForTesting();
    await CloudAccountRepo.addAccount(sampleAccount);
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(2);

    // Test updateToken
    CloudAccountRepo.resetInitializationForTesting();
    await CloudAccountRepo.updateToken("acc-1", validToken);
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(3);

    // Test updateQuota
    CloudAccountRepo.resetInitializationForTesting();
    await CloudAccountRepo.updateQuota("acc-1", validQuota);
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(4);

    // Test updateHealth
    CloudAccountRepo.resetInitializationForTesting();
    await CloudAccountRepo.updateHealth("acc-1", validHealth);
    expect(security.initializeMasterKey).toHaveBeenCalledTimes(5);
  });
});
