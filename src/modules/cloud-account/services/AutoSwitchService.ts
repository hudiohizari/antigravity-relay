import { Notification } from "electron";
import { z } from "zod";
import { CloudAccountRepo } from "@/modules/cloud-account/persistence/cloudHandler";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import {
  AutoSwitchModelsConfigSchema,
  type AutoSwitchModelConfig,
  type CloudAccount,
} from "@/modules/cloud-account/types";
import { switchCloudAccount } from "@/modules/cloud-account/ipc/handler";
import { cloudAccountEvents } from "./cloud-account-events";
import { logger } from "@/shared/logging/logger";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { isWeeklyQuotaBucket } from "@/modules/cloud-account/utils/quota-groups";
import {
  isRateLimitError,
  extractErrorMessage,
} from "@/modules/cloud-account/utils/account-status";

interface AccountSelectionScore {
  priorityScore: number | null;
  bottleneck5h: number;
  average5h: number;
  fallbackScore: number;
}

export interface RateLimitSwitchOptions {
  accountId?: string;
  error?: unknown;
  reason?: string;
  appTarget?: AntigravityAppTarget;
  source?: "monitor" | "relay" | "app";
}

export interface RateLimitSwitchResult {
  switched: boolean;
  nextAccount?: CloudAccount;
  noAccountLeft?: boolean;
  ignored?: boolean;
  reason?: string;
}

const BooleanSettingSchema = z.boolean();

export class AutoSwitchService {
  private static switchTimestamps: number[] = [];
  private static lastExhaustionNotificationTime = 0;
  private static readonly CIRCUIT_BREAKER_WINDOW_MS = 30 * 1000; // 30 seconds
  private static readonly EXHAUSTION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  static resetCircuitBreakerForTesting(): void {
    this.switchTimestamps = [];
    this.lastExhaustionNotificationTime = 0;
  }

  private static isCircuitBreakerTripped(totalAccounts: number): boolean {
    const now = Date.now();
    this.switchTimestamps = this.switchTimestamps.filter(
      (t) => now - t < this.CIRCUIT_BREAKER_WINDOW_MS,
    );
    const limit = Math.max(1, Math.min(totalAccounts, 5));
    return this.switchTimestamps.length >= limit;
  }

  private static recordSwitch(): void {
    this.switchTimestamps.push(Date.now());
  }

  private static notifyExhaustion(customBody?: string): void {
    const now = Date.now();
    if (
      now - this.lastExhaustionNotificationTime <
      this.EXHAUSTION_COOLDOWN_MS
    ) {
      logger.info(
        "AutoSwitch: Suppressing pool exhaustion notification (5-minute cooldown active)",
      );
      return;
    }
    this.lastExhaustionNotificationTime = now;

    try {
      new Notification({
        title: "Antigravity Relay: All Accounts Rate-Limited",
        body:
          customBody ??
          "All Google Antigravity accounts are rate-limited or depleted. Please wait for quota reset or add another account.",
      }).show();
    } catch (err) {
      logger.error(
        "Failed to show rate-limit exhaustion desktop notification",
        err,
      );
    }
  }

  /**
   * Sorts candidate accounts prioritizing 5h rolling window quota:
   * 1. bottleneck5h DESC
   * 2. average5h DESC
   * 3. priorityScore DESC (if configured)
   * 4. fallbackScore DESC
   * 5. last_used ASC (least recently used first)
   * 6. email ASC (deterministic tie-breaker)
   */
  static sortCandidates(
    candidates: CloudAccount[],
    config: Record<string, AutoSwitchModelConfig> = {},
  ): CloudAccount[] {
    return [...candidates].sort((a, b) => {
      const scoreA = this.calculateAccountScore(a, config);
      const scoreB = this.calculateAccountScore(b, config);

      // 1. Primary: highest remaining 5h limit (bottleneck)
      if (scoreA.bottleneck5h !== scoreB.bottleneck5h) {
        return scoreB.bottleneck5h - scoreA.bottleneck5h;
      }

      // 2. Secondary: highest 5h average
      if (scoreA.average5h !== scoreB.average5h) {
        return scoreB.average5h - scoreA.average5h;
      }

      // 3. Model priorityScore (if configured)
      if (scoreA.priorityScore !== null || scoreB.priorityScore !== null) {
        if (scoreA.priorityScore === null) return 1;
        if (scoreB.priorityScore === null) return -1;
        if (scoreA.priorityScore !== scoreB.priorityScore) {
          return scoreB.priorityScore - scoreA.priorityScore;
        }
      }

      // 4. Fallback model score
      if (scoreA.fallbackScore !== scoreB.fallbackScore) {
        return scoreB.fallbackScore - scoreA.fallbackScore;
      }

      // 5. Least recently used ASC
      const lastUsedA = a.last_used ?? 0;
      const lastUsedB = b.last_used ?? 0;
      if (lastUsedA !== lastUsedB) {
        return lastUsedA - lastUsedB;
      }

      // 6. Email ASC (deterministic tie-breaker)
      return a.email.localeCompare(b.email);
    });
  }

  /**
   * Calculates the 5-hour rolling window quota score for an account.
   * Extracts non-weekly buckets from quota_groups, using the bottleneck minimum
   * across groups as the primary score. Falls back to enabled models percentage.
   */
  static getAccount5hQuotaScore(account: CloudAccount): {
    bottleneck5h: number;
    average5h: number;
    has5hBuckets: boolean;
  } {
    if (!account.quota) {
      return { bottleneck5h: 0, average5h: 0, has5hBuckets: false };
    }

    const groups = account.quota.quota_groups || [];
    const fiveHourBuckets: number[] = [];

    for (const group of groups) {
      for (const bucket of group.buckets) {
        if (!isWeeklyQuotaBucket(bucket)) {
          fiveHourBuckets.push(Math.round(bucket.remaining_fraction * 100));
        }
      }
    }

    if (fiveHourBuckets.length > 0) {
      const bottleneck5h = Math.min(...fiveHourBuckets);
      const average5h =
        fiveHourBuckets.reduce((sum, val) => sum + val, 0) /
        fiveHourBuckets.length;
      return { bottleneck5h, average5h, has5hBuckets: true };
    }

    if (account.quota.models && Object.keys(account.quota.models).length > 0) {
      const percentages = Object.values(account.quota.models).map(
        (m) => m.percentage,
      );
      const bottleneck5h = Math.min(...percentages);
      const average5h =
        percentages.reduce((sum, val) => sum + val, 0) / percentages.length;
      return { bottleneck5h, average5h, has5hBuckets: false };
    }

    return { bottleneck5h: 0, average5h: 0, has5hBuckets: false };
  }

  /**
   * Finds the best cloud account to switch to.
   * Criteria:
   * 1. Not the current account.
   * 2. Status is 'active' (not rate_limited or expired).
   * 3. Has quota >= 5% in the best available model of every enabled quota group.
   * 4. Ranked by highest remaining 5h limit (bottleneck), then average 5h, then fallback.
   */
  static async findBestAccount(
    currentAccountId: string,
  ): Promise<CloudAccount | null> {
    const accounts = await CloudAccountRepo.getAccounts();
    const config =
      CloudAccountSettingsStore.getSetting(
        "auto_switch_models",
        {},
        AutoSwitchModelsConfigSchema,
      ) || {};

    // Filter potential candidates
    const candidates = accounts.filter((acc) => {
      if (acc.id === currentAccountId) return false;
      if (acc.status !== "active") return false; // Rate limited or expired accounts are skipped
      if (!acc.quota) return false; // No quota data means risky

      return !this.isAccountDepleted(acc);
    });

    if (candidates.length === 0) return null;

    return this.sortCandidates(candidates, config)[0];
  }

  private static getModelConfig(
    config: Record<string, AutoSwitchModelConfig>,
    modelId: string,
  ) {
    const normalizedModelId = modelId.replace(/^models\//i, "");
    return config[modelId] ?? config[normalizedModelId];
  }

  private static calculateAccountScore(
    account: CloudAccount,
    config: Record<string, AutoSwitchModelConfig>,
  ): AccountSelectionScore {
    const quota5h = this.getAccount5hQuotaScore(account);

    if (!account.quota?.models) {
      return {
        priorityScore: null,
        bottleneck5h: quota5h.bottleneck5h,
        average5h: quota5h.average5h,
        fallbackScore: 0,
      };
    }

    const entries = Object.entries(account.quota.models);

    // 1. Get priority models that are enabled and exist in this account
    const priorityEntries = entries.filter(([modelId]) => {
      const modelConfig = this.getModelConfig(config, modelId);
      return modelConfig?.enabled && modelConfig?.priority;
    });
    const priorityScore =
      priorityEntries.length > 0
        ? priorityEntries.reduce(
            (acc, [, model]) => acc + model.percentage,
            0,
          ) / priorityEntries.length
        : null;

    // 2. Fall back to all enabled models when no candidate exposes a priority model
    const enabledEntries = entries.filter(([modelId]) => {
      const modelConfig = this.getModelConfig(config, modelId);
      return modelConfig ? modelConfig.enabled : true;
    });
    const fallbackScore =
      enabledEntries.length > 0
        ? enabledEntries.reduce((acc, [, model]) => acc + model.percentage, 0) /
          enabledEntries.length
        : 0;

    return {
      priorityScore,
      bottleneck5h: quota5h.bottleneck5h,
      average5h: quota5h.average5h,
      fallbackScore,
    };
  }

  /**
   * Immediately switches account upon encountering a rate-limit error (HTTP 429 / resource_exhausted).
   * Non-rate-limit errors (401, 5xx, invalid_grant, timeouts) are explicitly ignored.
   */
  static async triggerRateLimitSwitch(
    options: RateLimitSwitchOptions = {},
  ): Promise<RateLimitSwitchResult> {
    const { accountId, error, reason, appTarget, source = "app" } = options;

    // 1. Strict rate limit verification: ignore other errors
    const errorCandidate = error ?? reason;
    if (errorCandidate && !isRateLimitError(errorCandidate)) {
      logger.info(
        `AutoSwitch (${source}): Ignored non-rate-limit error: ${extractErrorMessage(errorCandidate)}`,
      );
      return { switched: false, ignored: true };
    }

    // 2. Check if auto-switch is enabled
    const enabled = CloudAccountSettingsStore.getSetting(
      "auto_switch_enabled",
      false,
      BooleanSettingSchema,
    );
    if (!enabled) {
      logger.info(
        `AutoSwitch (${source}): Auto-switch is disabled in settings.`,
      );
      return { switched: false, ignored: true, reason: "disabled" };
    }

    // 3. Resolve target account
    const accounts = await CloudAccountRepo.getAccounts();
    const activeAccountId =
      accountId ??
      CloudAccountSettingsStore.getActiveAccountIdForTarget(appTarget);
    const targetAccount = activeAccountId
      ? accounts.find((account) => account.id === activeAccountId)
      : undefined;
    const currentAccount =
      targetAccount ?? accounts.find((account) => account.is_active);

    if (!currentAccount) {
      logger.warn(
        `AutoSwitch (${source}): No active account found to switch from.`,
      );
      return { switched: false, ignored: true, reason: "no_active_account" };
    }

    // 4. Mark current account as rate_limited in DB
    const rateLimitReason =
      reason ||
      (error ? extractErrorMessage(error) : "Rate limit exceeded (HTTP 429)");
    logger.warn(
      `AutoSwitch (${source}): Account ${currentAccount.email} rate-limited: ${rateLimitReason}. Initiating immediate switch...`,
    );
    await CloudAccountRepo.setAccountStatus(
      currentAccount.id,
      "rate_limited",
      rateLimitReason,
    );

    // Circuit breaker check
    if (this.isCircuitBreakerTripped(accounts.length)) {
      logger.warn(
        `AutoSwitch (${source}): Switch loop circuit breaker tripped (${this.switchTimestamps.length} switches in 30s). Halting automated switching.`,
      );
      this.notifyExhaustion(
        "Auto-switch loop detected: rapid switching halted. Please check account quotas manually.",
      );
      return {
        switched: false,
        noAccountLeft: true,
        reason: "circuit_breaker_tripped",
      };
    }

    // 5. Find candidate with highest 5h limit
    const nextAccount = await this.findBestAccount(currentAccount.id);

    if (nextAccount) {
      const quota5h = this.getAccount5hQuotaScore(nextAccount);
      const quotaPct = Math.round(quota5h.bottleneck5h);
      logger.info(
        `AutoSwitch (${source}): Switching to ${nextAccount.email} (Highest 5h Quota: ${quotaPct}%)...`,
      );

      try {
        await switchCloudAccount(nextAccount.id, appTarget);
        this.recordSwitch();
        cloudAccountEvents.emit("account:switched", {
          accountId: nextAccount.id,
          target: appTarget,
          account: nextAccount,
        });

        try {
          new Notification({
            title: "Antigravity Relay: Auto-Switch",
            body: `Switched account to ${nextAccount.email} (5h Quota: ${quotaPct}%) due to rate limit.`,
          }).show();
        } catch (err) {
          logger.error("Failed to show auto-switch desktop notification", err);
        }

        return { switched: true, nextAccount };
      } catch (switchError) {
        logger.error(
          `AutoSwitch (${source}): Failed to execute switch to ${nextAccount.email}`,
          switchError,
        );
        throw switchError;
      }
    }

    // 6. No accounts left with capacity
    logger.warn(
      `AutoSwitch (${source}): All accounts rate-limited or depleted. No candidate available.`,
    );

    this.notifyExhaustion();

    return { switched: false, noAccountLeft: true };
  }

  /**
   * Triggered by Monitor Service or UI.
   * Checks if we need to switch from the current account.
   */
  static async checkAndSwitchIfNeeded(
    appTarget?: AntigravityAppTarget | undefined,
  ): Promise<boolean> {
    const enabled = CloudAccountSettingsStore.getSetting(
      "auto_switch_enabled",
      false,
      BooleanSettingSchema,
    );
    if (!enabled) return false;

    // Get current active account for the target
    const accounts = await CloudAccountRepo.getAccounts();
    const activeAccountId =
      CloudAccountSettingsStore.getActiveAccountIdForTarget(appTarget);
    const targetAccount = activeAccountId
      ? accounts.find((account) => account.id === activeAccountId)
      : undefined;

    if (activeAccountId && !targetAccount) {
      logger.warn(
        `AutoSwitch: Active account ${activeAccountId} for target ${appTarget ?? "default"} no longer exists; falling back to the global active account.`,
      );
    }

    const currentAccount =
      targetAccount ?? accounts.find((account) => account.is_active);

    if (!currentAccount) return false;

    // If current is rate limited, route to triggerRateLimitSwitch immediately
    if (currentAccount.status === "rate_limited") {
      const result = await this.triggerRateLimitSwitch({
        accountId: currentAccount.id,
        reason: currentAccount.status_reason || "Rate limit detected",
        appTarget,
        source: "monitor",
      });
      return result.switched;
    }

    // Check if current is depleted
    const isDepleted = this.isAccountDepleted(currentAccount);

    if (isDepleted) {
      if (this.isCircuitBreakerTripped(accounts.length)) {
        logger.warn(
          `AutoSwitch: Switch loop circuit breaker tripped (${this.switchTimestamps.length} switches in 30s). Halting automated switching.`,
        );
        this.notifyExhaustion(
          "Auto-switch loop detected: rapid switching halted. Please check account quotas manually.",
        );
        return false;
      }

      logger.info(
        `AutoSwitch: Current account ${currentAccount.email} is depleted. Finding highest 5h candidate...`,
      );

      const nextAccount = await this.findBestAccount(currentAccount.id);
      if (nextAccount) {
        const quota5h = this.getAccount5hQuotaScore(nextAccount);
        const quotaPct = Math.round(quota5h.bottleneck5h);
        logger.info(
          `AutoSwitch: Switching to ${nextAccount.email} (Highest 5h: ${quotaPct}%)...`,
        );

        await switchCloudAccount(nextAccount.id, appTarget);
        this.recordSwitch();
        cloudAccountEvents.emit("account:switched", {
          accountId: nextAccount.id,
          target: appTarget,
          account: nextAccount,
        });

        try {
          new Notification({
            title: "Antigravity Relay: Auto-Switch",
            body: `Switched account to ${nextAccount.email} (5h Quota: ${quotaPct}%) due to quota limit. Reopen IDE and type "continue" if needed!`,
          }).show();
        } catch (err) {
          logger.error("Failed to show auto-switch desktop notification", err);
        }

        return true;
      } else {
        logger.warn("AutoSwitch: No healthy accounts available to switch to.");
        this.notifyExhaustion();
      }
    }

    return false;
  }

  static isAccountDepleted(account: CloudAccount): boolean {
    if (!account.quota) return false;
    const THRESHOLD = 5;

    const config =
      CloudAccountSettingsStore.getSetting(
        "auto_switch_models",
        {},
        AutoSwitchModelsConfigSchema,
      ) || {};

    const enabledModels = Object.entries(account.quota.models).filter(
      ([modelId]) => {
        const modelConfig = this.getModelConfig(config, modelId);
        return modelConfig ? modelConfig.enabled : true;
      },
    );

    if (enabledModels.length === 0) {
      return false; // No enabled models, so not depleted
    }

    const maxPercentageByQuotaGroup = new Map<string, number>();
    for (const [modelId, model] of enabledModels) {
      const normalizedModelId = modelId.replace(/^models\//i, "").toLowerCase();
      let quotaGroupId = normalizedModelId;

      if (normalizedModelId.includes("image")) {
        quotaGroupId = normalizedModelId.includes("flash")
          ? "gemini-3.1-flash-image"
          : "gemini-3-pro-image";
      } else if (normalizedModelId.includes("flash")) {
        quotaGroupId = "gemini-3-flash";
      } else if (normalizedModelId.includes("pro")) {
        quotaGroupId = "gemini-3-pro-high";
      } else if (
        normalizedModelId.includes("claude") ||
        normalizedModelId.includes("opus") ||
        normalizedModelId.includes("sonnet") ||
        normalizedModelId.includes("haiku")
      ) {
        quotaGroupId = "claude";
      }

      const currentMaximum = maxPercentageByQuotaGroup.get(quotaGroupId) ?? -1;
      if (model.percentage > currentMaximum) {
        maxPercentageByQuotaGroup.set(quotaGroupId, model.percentage);
      }
    }

    const anyQuotaGroupDepleted = [...maxPercentageByQuotaGroup.values()].some(
      (percentage) => percentage < THRESHOLD,
    );
    if (anyQuotaGroupDepleted) {
      return true;
    }

    // Check quota groups
    const depletedGroups = (account.quota.quota_groups || []).filter((g) => {
      const lowestBucket = g.buckets.reduce(
        (min, b) => Math.min(min, b.remaining_fraction * 100),
        100,
      );
      return lowestBucket < THRESHOLD;
    });

    if (depletedGroups.length > 0) {
      const anyAffected = depletedGroups.some((group) => {
        const groupText = [group.display_name, group.description]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return enabledModels.some(([modelId]) => {
          const normalizedModelId = modelId
            .replace(/^models\//i, "")
            .toLowerCase();
          const modelPart = normalizedModelId.split("-")[0]; // 'claude' or 'gemini' etc.
          return (
            groupText.includes(modelPart) ||
            groupText.includes(normalizedModelId)
          );
        });
      });
      if (anyAffected) {
        return true;
      }
    }

    return false;
  }
}
