import { describe, it, expect } from "vitest";
import { evaluateDivergedState } from "@/modules/cloud-account/utils/divergedState";
import type { CloudAccount } from "@/modules/cloud-account/types";
import type { TargetOperationalState } from "@/modules/cloud-account/persistence/cloud-account-settings-store";

function createMockAccount(partial: Partial<CloudAccount>): CloudAccount {
  return {
    id: "acc-default",
    provider: "google",
    email: "default@company.com",
    token: {
      access_token: "token",
      refresh_token: "refresh",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    created_at: Date.now(),
    last_used: Date.now(),
    status: "active",
    ...partial,
  };
}

describe("evaluateDivergedState", () => {
  it("evaluates as unified when operationalState.isPhysicallyUnified is true", () => {
    const accounts: CloudAccount[] = [
      createMockAccount({ id: "acc-1", email: "unified@company.com", status: "active" }),
    ];
    const operationalState: TargetOperationalState = {
      isUnifiedMode: true,
      isPhysicallyUnified: true,
      activeAccountId: "acc-1",
      targetAccounts: { app: "acc-1", ide: "acc-1", cli: "acc-1", classic: "acc-1", agy: "acc-1" },
      installedTargets: ["app", "cli"],
      divergedTargets: [],
    };

    const evaluation = evaluateDivergedState(accounts, operationalState);
    expect(evaluation.isDiverged).toBe(false);
    expect(evaluation.splitTargetsCount).toBe(0);
    expect(evaluation.divergedTargets).toHaveLength(2);
    expect(evaluation.resolvedCandidateEmail).toBe("unified@company.com");
  });

  it("evaluates as diverged when operationalState.isPhysicallyUnified is false", () => {
    const accounts: CloudAccount[] = [
      createMockAccount({ id: "acc-1", email: "app@company.com", status: "active" }),
      createMockAccount({ id: "acc-2", email: "cli@company.com", status: "rate_limited" }),
    ];
    const operationalState: TargetOperationalState = {
      isUnifiedMode: true,
      isPhysicallyUnified: false,
      activeAccountId: "acc-1",
      targetAccounts: { app: "acc-1", ide: "", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
      installedTargets: ["app", "cli"],
      divergedTargets: ["cli"],
    };

    const evaluation = evaluateDivergedState(accounts, operationalState);
    expect(evaluation.isDiverged).toBe(true);
    expect(evaluation.splitTargetsCount).toBe(2);
    expect(evaluation.divergedTargets).toHaveLength(2);
    expect(evaluation.divergedTargets[0]).toEqual({
      target: "app",
      targetLabel: "App",
      accountEmail: "app@company.com",
      isRateLimited: false,
    });
    expect(evaluation.divergedTargets[1]).toEqual({
      target: "cli",
      targetLabel: "CLI",
      accountEmail: "cli@company.com",
      isRateLimited: true,
    });
    expect(evaluation.resolvedCandidateEmail).toBe("app@company.com");
  });

  describe("Master Resolution Rule", () => {
    it("selects App healthy account first (Priority 1)", () => {
      const accounts: CloudAccount[] = [
        createMockAccount({ id: "acc-1", email: "app@company.com", status: "active" }),
        createMockAccount({ id: "acc-2", email: "cli@company.com", status: "active" }),
      ];
      const operationalState: TargetOperationalState = {
        isUnifiedMode: true,
        isPhysicallyUnified: false,
        activeAccountId: "acc-1",
        targetAccounts: { app: "acc-1", ide: "", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
        installedTargets: ["app", "cli"],
        divergedTargets: ["cli"],
      };

      const result = evaluateDivergedState(accounts, operationalState);
      expect(result.resolvedCandidateEmail).toBe("app@company.com");
    });

    it("selects CLI healthy account when App account is rate-limited (Priority 2)", () => {
      const accounts: CloudAccount[] = [
        createMockAccount({ id: "acc-1", email: "app@company.com", status: "rate_limited" }),
        createMockAccount({ id: "acc-2", email: "cli@company.com", status: "active" }),
      ];
      const operationalState: TargetOperationalState = {
        isUnifiedMode: true,
        isPhysicallyUnified: false,
        activeAccountId: "acc-1",
        targetAccounts: { app: "acc-1", ide: "", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
        installedTargets: ["app", "cli"],
        divergedTargets: ["cli"],
      };

      const result = evaluateDivergedState(accounts, operationalState);
      expect(result.resolvedCandidateEmail).toBe("cli@company.com");
    });

    it("selects IDE healthy account when App and CLI are rate-limited (Priority 3)", () => {
      const accounts: CloudAccount[] = [
        createMockAccount({ id: "acc-1", email: "app@company.com", status: "rate_limited" }),
        createMockAccount({ id: "acc-2", email: "cli@company.com", status: "rate_limited" }),
        createMockAccount({ id: "acc-3", email: "ide@company.com", status: "active" }),
      ];
      const operationalState: TargetOperationalState = {
        isUnifiedMode: true,
        isPhysicallyUnified: false,
        activeAccountId: "acc-1",
        targetAccounts: { app: "acc-1", ide: "acc-3", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
        installedTargets: ["app", "ide", "cli"],
        divergedTargets: ["ide", "cli"],
      };

      const result = evaluateDivergedState(accounts, operationalState);
      expect(result.resolvedCandidateEmail).toBe("ide@company.com");
    });

    it("falls back to candidate with highest quota when active targets are exhausted (Priority 4)", () => {
      const accounts: CloudAccount[] = [
        createMockAccount({ id: "acc-1", email: "app@company.com", status: "rate_limited" }),
        createMockAccount({ id: "acc-2", email: "cli@company.com", status: "rate_limited" }),
        createMockAccount({
          id: "acc-candidate-low",
          email: "low@company.com",
          status: "active",
          quota: {
            models: { "gemini-2.5-flash": { percentage: 20, resetTime: "" } },
          },
        }),
        createMockAccount({
          id: "acc-candidate-high",
          email: "high@company.com",
          status: "active",
          quota: {
            models: { "gemini-2.5-flash": { percentage: 95, resetTime: "" } },
          },
        }),
      ];
      const operationalState: TargetOperationalState = {
        isUnifiedMode: true,
        isPhysicallyUnified: false,
        activeAccountId: "acc-1",
        targetAccounts: { app: "acc-1", ide: "", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
        installedTargets: ["app", "cli"],
        divergedTargets: ["cli"],
      };

      const result = evaluateDivergedState(accounts, operationalState);
      expect(result.resolvedCandidateEmail).toBe("high@company.com");
    });

    it("returns null when all pooled accounts are rate-limited or exhausted (Fallback Failure)", () => {
      const accounts: CloudAccount[] = [
        createMockAccount({ id: "acc-1", email: "app@company.com", status: "rate_limited" }),
        createMockAccount({ id: "acc-2", email: "cli@company.com", status: "rate_limited" }),
      ];
      const operationalState: TargetOperationalState = {
        isUnifiedMode: true,
        isPhysicallyUnified: false,
        activeAccountId: "acc-1",
        targetAccounts: { app: "acc-1", ide: "", cli: "acc-2", classic: "acc-1", agy: "acc-2" },
        installedTargets: ["app", "cli"],
        divergedTargets: ["cli"],
      };

      const result = evaluateDivergedState(accounts, operationalState);
      expect(result.resolvedCandidateEmail).toBeNull();
    });
  });

  it("handles fallback evaluation when operationalState is undefined", () => {
    const accounts: CloudAccount[] = [
      createMockAccount({ id: "acc-1", email: "app@company.com", is_active_app: true, status: "active" }),
      createMockAccount({ id: "acc-2", email: "cli@company.com", is_active_cli: true, status: "active" }),
    ];

    const result = evaluateDivergedState(accounts, undefined);
    expect(result.isDiverged).toBe(true);
    expect(result.splitTargetsCount).toBe(2);
    expect(result.resolvedCandidateEmail).toBe("app@company.com");
  });

  it("filters out uninstalled targets cleanly", () => {
    const accounts: CloudAccount[] = [
      createMockAccount({ id: "acc-1", email: "app@company.com", status: "active" }),
    ];
    const operationalState: TargetOperationalState = {
      isUnifiedMode: true,
      isPhysicallyUnified: true,
      activeAccountId: "acc-1",
      targetAccounts: { app: "acc-1", ide: "uninstalled-ide", cli: "uninstalled-cli", classic: "acc-1", agy: "" },
      installedTargets: ["app"], // only app is installed
      divergedTargets: [],
    };

    const result = evaluateDivergedState(accounts, operationalState);
    expect(result.isDiverged).toBe(false);
    expect(result.divergedTargets).toHaveLength(1);
    expect(result.divergedTargets[0].target).toBe("app");
  });
});
