import type { CloudAccount } from "@/modules/cloud-account/types";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import type { TargetOperationalState } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import { getAccountSortValue } from "@/modules/cloud-account/utils/quota-display";

export type DivergedTarget = "app" | "ide" | "cli";

export interface DivergedTargetInfo {
  target: DivergedTarget;
  targetLabel: string;
  accountEmail: string;
  isRateLimited: boolean;
}

export interface DivergedStateEvaluation {
  isDiverged: boolean;
  splitTargetsCount: number;
  divergedTargets: DivergedTargetInfo[];
  resolvedCandidateEmail: string | null;
}

export function evaluateDivergedState(
  accounts?: CloudAccount[],
  operationalState?: TargetOperationalState,
): DivergedStateEvaluation {
  const accountList = accounts ?? [];
  const divergedTargets: DivergedTargetInfo[] = [];

  const canonicalTargets: DivergedTarget[] = ["app", "ide", "cli"];
  const targetLabelMap: Record<DivergedTarget, string> = {
    app: "App",
    ide: "IDE",
    cli: "CLI",
  };

  const activeAccountsByTarget = new Map<DivergedTarget, CloudAccount>();

  if (operationalState) {
    const installedSet = new Set<string>(operationalState.installedTargets);

    for (const target of canonicalTargets) {
      const isInstalled =
        installedSet.has(target) ||
        (target === "app" && installedSet.has("classic")) ||
        (target === "cli" && installedSet.has("agy"));

      if (!isInstalled) continue;

      const accountId =
        operationalState.targetAccounts[target] ||
        (target === "app" ? operationalState.targetAccounts.classic : "") ||
        (target === "cli" ? operationalState.targetAccounts.agy : "") ||
        "";

      if (!accountId) continue;

      const matchedAccount = accountList.find((a) => a.id === accountId);
      if (matchedAccount) {
        activeAccountsByTarget.set(target, matchedAccount);
      }

      const isRateLimited = matchedAccount
        ? matchedAccount.status === "rate_limited" ||
          matchedAccount.status === "expired"
        : false;

      divergedTargets.push({
        target,
        targetLabel: targetLabelMap[target],
        accountEmail: matchedAccount?.email ?? accountId,
        isRateLimited,
      });
    }
  } else {
    for (const acc of accountList) {
      if (acc.is_active_app || acc.is_active_classic) {
        activeAccountsByTarget.set("app", acc);
        divergedTargets.push({
          target: "app",
          targetLabel: "App",
          accountEmail: acc.email,
          isRateLimited:
            acc.status === "rate_limited" || acc.status === "expired",
        });
      }
      if (acc.is_active_ide) {
        activeAccountsByTarget.set("ide", acc);
        divergedTargets.push({
          target: "ide",
          targetLabel: "IDE",
          accountEmail: acc.email,
          isRateLimited:
            acc.status === "rate_limited" || acc.status === "expired",
        });
      }
      if (acc.is_active_cli || acc.is_active_agy) {
        activeAccountsByTarget.set("cli", acc);
        divergedTargets.push({
          target: "cli",
          targetLabel: "CLI",
          accountEmail: acc.email,
          isRateLimited:
            acc.status === "rate_limited" || acc.status === "expired",
        });
      }
    }
  }

  const isDiverged = operationalState
    ? !operationalState.isPhysicallyUnified
    : new Set(Array.from(activeAccountsByTarget.values()).map((a) => a.id))
        .size > 1;

  const splitTargetsCount = isDiverged ? divergedTargets.length : 0;

  let resolvedCandidateEmail: string | null = null;
  const appAccount = activeAccountsByTarget.get("app");
  const cliAccount = activeAccountsByTarget.get("cli");
  const ideAccount = activeAccountsByTarget.get("ide");

  if (appAccount && appAccount.status === "active") {
    resolvedCandidateEmail = appAccount.email;
  } else if (cliAccount && cliAccount.status === "active") {
    resolvedCandidateEmail = cliAccount.email;
  } else if (ideAccount && ideAccount.status === "active") {
    resolvedCandidateEmail = ideAccount.email;
  } else {
    const healthyCandidates = accountList
      .filter((a) => a.status === "active")
      .sort(
        (a, b) =>
          getAccountSortValue(b, "quota-overall") -
          getAccountSortValue(a, "quota-overall"),
      );

    if (healthyCandidates.length > 0) {
      resolvedCandidateEmail = healthyCandidates[0].email;
    }
  }

  return {
    isDiverged,
    splitTargetsCount,
    divergedTargets,
    resolvedCandidateEmail,
  };
}
