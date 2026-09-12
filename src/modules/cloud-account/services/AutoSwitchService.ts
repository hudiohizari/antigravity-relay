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
import { runWithSwitchGuard } from "@/modules/antigravity-runtime/switch/switchGuard";
import { cloudAccountEvents } from "./cloud-account-events";
import { logger } from "@/shared/logging/logger";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { isWeeklyQuotaBucket } from "@/modules/cloud-account/utils/quota-groups";
import {
  isRateLimitError,
  extractErrorMessage,
} from "@/modules/cloud-account/utils/account-status";
import { detectActiveTurn } from "@/modules/chat-resume/activeTurnDetector";
import { chatResumeEvents } from "@/modules/chat-resume/telemetry";

export function resolveQuotaGroupId(modelId: string): string {
  const normalized = modelId.replace(/^models\//i, "").toLowerCase();
  if (normalized.includes("image")) {
    return normalized.includes("flash")
      ? "gemini-3.1-flash-image"
      : "gemini-3-pro-image";
  }
  if (normalized.includes("flash")) {
    return "gemini-3-flash";
  }
  if (normalized.includes("pro")) {
    return "gemini-3-pro-high";
  }
  if (
    normalized.includes("claude") ||
    normalized.includes("opus") ||
    normalized.includes("sonnet") ||
    normalized.includes("haiku")
  ) {
    return "claude";
  }
  return normalized;
}

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
  appTarget?: AntigravityAppTarget | "all";
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
  private static inFlightAutoSwitchPromise: Promise<RateLimitSwitchResult> | null =
    null;
  private static switchTimestamps: number[] = [];
  private static lastExhaustionNotificationTime = 0;
  private static readonly CIRCUIT_BREAKER_WINDOW_MS = 30 * 1000; // 30 seconds
  private static readonly EXHAUSTION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  static resetCircuitBreakerForTesting(): void {
    this.switchTimestamps = [];
    this.lastExhaustionNotificationTime = 0;
    this.inFlightAutoSwitchPromise = null;
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
    activeModel?: string,
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

      return !this.isAccountDepleted(acc, activeModel);
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

  private static async isCurrentActiveAccountHealthy(
    appTarget?: AntigravityAppTarget | "all",
  ): Promise<boolean> {
    try {
      const isUnified = CloudAccountSettingsStore.isUnifiedMode();
      const target = isUnified || appTarget === "all" ? undefined : appTarget;
      const activeAccountId =
        CloudAccountSettingsStore.getActiveAccountIdForTarget(target);
      if (!activeAccountId) return false;

      const accounts = await CloudAccountRepo.getAccounts();
      const activeAccount = accounts.find((a) => a.id === activeAccountId);
      if (!activeAccount) return false;

      return (
        activeAccount.status === "active" &&
        !this.isAccountDepleted(activeAccount)
      );
    } catch {
      return false;
    }
  }

  /**
   * Immediately switches account upon encountering a rate-limit error (HTTP 429 / resource_exhausted).
   * Non-rate-limit errors (401, 5xx, invalid_grant, timeouts) are explicitly ignored.
   */
  static async triggerRateLimitSwitch(
    options: RateLimitSwitchOptions = {},
  ): Promise<RateLimitSwitchResult> {
    const { error, reason, appTarget, source = "app" } = options;

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

    // 3. Singleflight promise mutex: await in-flight switch if active
    if (this.inFlightAutoSwitchPromise) {
      logger.info(
        `AutoSwitch (${source}): In-flight switch already active; awaiting resolution...`,
      );
      const inFlightResult = await this.inFlightAutoSwitchPromise;

      // Post-resolution check: if active account is already healthy, return without re-rotating
      const isHealthy = await this.isCurrentActiveAccountHealthy(appTarget);
      if (isHealthy) {
        logger.info(
          `AutoSwitch (${source}): Post-resolution check: active account is healthy. Skipping redundant switch.`,
        );
        return inFlightResult;
      }
    }

    // 4. Acquire singleflight mutex with guaranteed try...finally release
    this.inFlightAutoSwitchPromise = (async () => {
      try {
        return await this.executeRateLimitSwitch(options);
      } finally {
        this.inFlightAutoSwitchPromise = null;
      }
    })();

    return await this.inFlightAutoSwitchPromise;
  }

  private static async executeRateLimitSwitch(
    options: RateLimitSwitchOptions,
  ): Promise<RateLimitSwitchResult> {
    const { accountId, error, reason, appTarget, source = "app" } = options;

    const isUnified = CloudAccountSettingsStore.isUnifiedMode();
    const effectiveTarget: AntigravityAppTarget | "all" | undefined = isUnified
      ? "all"
      : appTarget;

    return await runWithSwitchGuard("cloud-account-switch", async () => {
      // Resolve target account
      const accounts = await CloudAccountRepo.getAccounts();
      const lookupTarget =
        effectiveTarget === "all" ? undefined : effectiveTarget;
      const activeAccountId =
        accountId ??
        CloudAccountSettingsStore.getActiveAccountIdForTarget(lookupTarget);
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

      // Mark current account as rate_limited in DB
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

      // Find candidate with highest 5h limit
      const nextAccount = await this.findBestAccount(currentAccount.id);

      if (!nextAccount) {
        logger.warn(
          `AutoSwitch (${source}): All accounts rate-limited or depleted. No candidate available. Aborting mutation.`,
        );
        cloudAccountEvents.emit("all_accounts_exhausted", {
          reason: "All cloud accounts are rate-limited or exhausted",
          source,
          timestamp: Date.now(),
        });
        this.notifyExhaustion();
        return {
          switched: false,
          noAccountLeft: true,
          reason: "all_accounts_exhausted",
        };
      }

      const quota5h = this.getAccount5hQuotaScore(nextAccount);
      const quotaPct = Math.round(quota5h.bottleneck5h);
      logger.info(
        `AutoSwitch (${source}): Switching to ${nextAccount.email} (Highest 5h Quota: ${quotaPct}%, target=${effectiveTarget})...`,
      );

      try {
        await switchCloudAccount(nextAccount.id, effectiveTarget, {
          source: "auto_switch",
          reason: "rate_limit",
        });
        this.recordSwitch();

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
    });
  }

  /**
   * Triggered by Monitor Service or UI.
   * Checks if we need to switch from the current account.
   */
  static async checkAndSwitchIfNeeded(
    appTarget?: AntigravityAppTarget | "all" | undefined,
  ): Promise<boolean> {
    const enabled = CloudAccountSettingsStore.getSetting(
      "auto_switch_enabled",
      false,
      BooleanSettingSchema,
    );
    if (!enabled) return false;

    const isUnified = CloudAccountSettingsStore.isUnifiedMode();
    const effectiveTarget = appTarget ?? (isUnified ? "all" : undefined);
    const lookupTarget =
      effectiveTarget === "all" ? undefined : effectiveTarget;

    // Get current active account for the target
    const accounts = await CloudAccountRepo.getAccounts();
    const activeAccountId =
      CloudAccountSettingsStore.getActiveAccountIdForTarget(lookupTarget);
    const targetAccount = activeAccountId
      ? accounts.find((account) => account.id === activeAccountId)
      : undefined;

    if (activeAccountId && !targetAccount) {
      logger.warn(
        `AutoSwitch: Active account ${activeAccountId} for target ${lookupTarget ?? "default"} no longer exists; falling back to the global active account.`,
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
        appTarget: effectiveTarget,
        source: "monitor",
      });
      return result.switched;
    }

    // Check if there is an active turn currently executing
    const detectionTarget =
      effectiveTarget === "all" ? undefined : effectiveTarget;
    const activeTurn = await detectActiveTurn(detectionTarget);
    const activeModel = activeTurn?.promptPayload?.requestedModel;

    // Check if current is depleted, scoped to the active model
    const isDepleted = this.isAccountDepleted(currentAccount, activeModel);

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

      // Turn Draining: if an active turn is running, wait for it to complete or 60s timeout
      if (activeTurn && !activeTurn.isInterrupted) {
        chatResumeEvents.recordTurnDrainingInitiated({
          appTarget: detectionTarget ?? "app",
          activeModel: activeModel ?? "unknown",
          currentQuota: this.getAccountModelQuota(currentAccount, activeModel),
          timeoutMs: 60000,
        });
        logger.info(
          "AutoSwitch: Active turn detected during background poll low-quota. Initiating turn draining for up to 60s...",
        );

        const drainStart = Date.now();
        const DRAIN_TIMEOUT_MS = 60_000;
        const POLL_INTERVAL_MS = 1_000;
        let turnDrained = false;

        while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          // Check if hard rate limit occurred mid-drain
          const refreshedCurrent = await CloudAccountRepo.getAccount(
            currentAccount.id,
          );
          if (refreshedCurrent?.status === "rate_limited") {
            logger.warn(
              "AutoSwitch: Current account encountered hard rate limit mid-drain; aborting draining loop immediately.",
            );
            break;
          }

          const stillActive = await detectActiveTurn(detectionTarget);
          if (!stillActive || stillActive.isInterrupted) {
            turnDrained = true;
            break;
          }
        }

        if (turnDrained) {
          const drainDurationMs = Date.now() - drainStart;
          chatResumeEvents.recordTurnDrained({
            appTarget: detectionTarget ?? "app",
            drainDurationMs,
            completedStatus: 3,
          });
          logger.info(
            `AutoSwitch: Turn draining completed cleanly in ${drainDurationMs}ms. Proceeding with clean account switch.`,
          );
        } else {
          logger.warn(
            "AutoSwitch: Turn draining reached 60s timeout or rate limit; proceeding with switch.",
          );
        }
      }

      logger.info(
        `AutoSwitch: Current account ${currentAccount.email} is depleted for ${activeModel ?? "active model"}. Finding candidate...`,
      );

      const nextAccount = await this.findBestAccount(
        currentAccount.id,
        activeModel,
      );
      if (nextAccount) {
        const quota5h = this.getAccount5hQuotaScore(nextAccount);
        const quotaPct = Math.round(quota5h.bottleneck5h);
        logger.info(
          `AutoSwitch: Switching to ${nextAccount.email} (Highest 5h: ${quotaPct}%)...`,
        );

        await switchCloudAccount(nextAccount.id, effectiveTarget, {
          source: "auto_switch",
          reason: "quota_exhausted",
        });
        this.recordSwitch();

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

  static getAccountModelQuota(account: CloudAccount, modelId?: string): number {
    if (!account.quota) return 0;
    if (!modelId) {
      return this.getAccount5hQuotaScore(account).bottleneck5h;
    }
    const targetGroup = resolveQuotaGroupId(modelId);
    if (account.quota.models) {
      const matches = Object.entries(account.quota.models).filter(
        ([id]) => resolveQuotaGroupId(id) === targetGroup,
      );
      if (matches.length > 0) {
        return Math.max(...matches.map(([, m]) => m.percentage));
      }
    }
    return this.getAccount5hQuotaScore(account).bottleneck5h;
  }

  static isAccountDepleted(
    account: CloudAccount,
    activeModel?: string,
  ): boolean {
    if (!account.quota) return false;
    const THRESHOLD = 5;

    // When scoped to an active model, evaluate quota exclusively for that model's quota group
    if (activeModel) {
      const targetGroupId = resolveQuotaGroupId(activeModel);
      let activeQuotaPct = 100;
      let matchedModel = false;

      if (account.quota.models) {
        const matchingModels = Object.entries(account.quota.models).filter(
          ([modelId]) => resolveQuotaGroupId(modelId) === targetGroupId,
        );

        if (matchingModels.length > 0) {
          matchedModel = true;
          activeQuotaPct = Math.max(
            ...matchingModels.map(([, m]) => m.percentage),
          );
        }
      }

      if (account.quota.quota_groups && account.quota.quota_groups.length > 0) {
        for (const group of account.quota.quota_groups) {
          const groupText = [group.display_name, group.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (
            groupText.includes(targetGroupId) ||
            groupText.includes(activeModel.toLowerCase())
          ) {
            const lowestBucket = group.buckets.reduce(
              (min, b) => Math.min(min, b.remaining_fraction * 100),
              100,
            );
            activeQuotaPct = matchedModel
              ? Math.min(activeQuotaPct, lowestBucket)
              : lowestBucket;
            matchedModel = true;
          }
        }
      }

      const isDepleted = matchedModel ? activeQuotaPct < THRESHOLD : false;
      chatResumeEvents.recordAccountDepletedModelScoped({
        accountId: account.id,
        activeModel,
        quotaPercentage: activeQuotaPct,
        isDepleted,
      });

      return isDepleted;
    }

    const config =
      CloudAccountSettingsStore.getSetting(
        "auto_switch_models",
        {},
        AutoSwitchModelsConfigSchema,
      ) || {};

    const enabledModels = Object.entries(account.quota.models || {}).filter(
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
      const quotaGroupId = resolveQuotaGroupId(modelId);
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
