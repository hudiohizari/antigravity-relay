import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudAccountRepo } from "@/modules/cloud-account/persistence/cloudHandler";
import {
  clearValidationHealthAfterSuccessfulProbe,
  CloudAccountHealthService,
} from "@/modules/cloud-account/services/CloudAccountHealthService";
import type { CloudAccount } from "@/modules/cloud-account/types";

vi.mock("@/modules/cloud-account/persistence/cloudHandler", () => ({
  CloudAccountRepo: {
    getAccount: vi.fn(),
    updateHealth: vi.fn(),
  },
}));

function createAccount(): CloudAccount {
  return {
    id: "acc-1",
    provider: "google",
    email: "user@example.com",
    token: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      expiry_timestamp: 4102444800,
      token_type: "Bearer",
    },
    health: {
      validation: {
        status: "requires_action",
        reason: "VALIDATION_REQUIRED",
        detected_at_ms: 1,
        next_probe_at_ms: 2,
        verification_url: "https://accounts.google.com/verify",
      },
    },
    created_at: 1,
    last_used: 1,
  };
}

describe("clearValidationHealthAfterSuccessfulProbe", () => {
  let persistedAccount: CloudAccount;

  beforeEach(() => {
    vi.clearAllMocks();
    CloudAccountHealthService.resetStateForTesting();
    persistedAccount = createAccount();
    vi.mocked(CloudAccountRepo.getAccount).mockImplementation(async () =>
      structuredClone(persistedAccount),
    );
    vi.mocked(CloudAccountRepo.updateHealth).mockImplementation(
      async (_accountId, health) => {
        persistedAccount.health = health;
      },
    );
  });

  it("clears validation health after successful probe", async () => {
    const account = createAccount();

    await clearValidationHealthAfterSuccessfulProbe(account);

    expect(CloudAccountRepo.updateHealth).toHaveBeenCalledWith(
      "acc-1",
      undefined,
    );
    expect(account.health).toBeUndefined();
  });

  it("restores health when afterCommit fails and rollbackOnAfterCommitFailure is true", async () => {
    const originalHealth = persistedAccount.health;

    await expect(
      CloudAccountHealthService.mutateHealth("acc-1", () => undefined, {
        afterCommit: async () => {
          throw new Error("afterCommit failed");
        },
        rollbackOnAfterCommitFailure: true,
      }),
    ).rejects.toThrow("afterCommit failed");

    expect(CloudAccountRepo.updateHealth).toHaveBeenNthCalledWith(
      1,
      "acc-1",
      undefined,
    );
    expect(CloudAccountRepo.updateHealth).toHaveBeenNthCalledWith(
      2,
      "acc-1",
      originalHealth,
    );
    expect(persistedAccount.health).toEqual(originalHealth);
  });

  it("serializes overlapping validation and OAuth health mutations", async () => {
    persistedAccount.health = undefined;
    let releaseFirstUpdate: (() => void) | undefined;
    const firstUpdateBlocked = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let firstUpdateEntered: (() => void) | undefined;
    const firstUpdateStarted = new Promise<void>((resolve) => {
      firstUpdateEntered = resolve;
    });
    let updateCount = 0;
    vi.mocked(CloudAccountRepo.updateHealth).mockImplementation(
      async (_accountId, health) => {
        updateCount += 1;
        if (updateCount === 1) {
          firstUpdateEntered?.();
          await firstUpdateBlocked;
        }
        persistedAccount.health = health;
      },
    );

    const validationMutation = CloudAccountHealthService.mutateHealth(
      "acc-1",
      (health) => ({
        ...health,
        validation: {
          status: "requires_action",
          reason: "VALIDATION_REQUIRED",
          detected_at_ms: 10,
          next_probe_at_ms: 20,
        },
      }),
    );
    await firstUpdateStarted;
    const oauthMutation = CloudAccountHealthService.mutateHealth(
      "acc-1",
      (health) => ({
        ...health,
        oauth: {
          refresh_blocked: true,
          invalid_grant_count: 2,
          reason: "invalid_grant",
        },
      }),
    );

    expect(CloudAccountRepo.getAccount).toHaveBeenCalledTimes(1);
    releaseFirstUpdate?.();
    await Promise.all([validationMutation, oauthMutation]);

    expect(persistedAccount.health).toEqual({
      validation: {
        status: "requires_action",
        reason: "VALIDATION_REQUIRED",
        detected_at_ms: 10,
        next_probe_at_ms: 20,
      },
      oauth: {
        refresh_blocked: true,
        invalid_grant_count: 2,
        reason: "invalid_grant",
      },
    });
  });

  it("does not roll health back over a newer queued OAuth transition", async () => {
    const clearValidationWithFailingCommit =
      CloudAccountHealthService.mutateHealth(
        "acc-1",
        (health) => (health?.validation ? undefined : health),
        {
          afterCommit: async () => {
            throw new Error("commit failed");
          },
          rollbackOnAfterCommitFailure: true,
        },
      );
    const addOAuthBlock = CloudAccountHealthService.mutateHealth(
      "acc-1",
      (health) => ({
        ...health,
        oauth: {
          refresh_blocked: true,
          invalid_grant_count: 2,
          reason: "invalid_grant",
        },
      }),
    );

    await expect(clearValidationWithFailingCommit).rejects.toThrow(
      "commit failed",
    );
    await addOAuthBlock;

    expect(persistedAccount.health).toEqual({
      validation: expect.objectContaining({ reason: "VALIDATION_REQUIRED" }),
      oauth: {
        refresh_blocked: true,
        invalid_grant_count: 2,
        reason: "invalid_grant",
      },
    });
  });
});
