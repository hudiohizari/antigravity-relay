import { AccountStore } from "../account-store/account-store";
import { GoogleAccount } from "../../shared/types";
import { RateLimitTracker } from "./rate-limit-tracker";
import { SwitchFlow } from "./switch-flow";
import {
  AccountScore,
  AutoSwitchConfig,
  DEFAULT_AUTO_SWITCH_CONFIG,
  SwitchReason,
  SwitchResult,
} from "./types";

export interface AutoSwitchServiceOptions {
  accountStore: AccountStore;
  rateLimitTracker: RateLimitTracker;
  switchFlow?: SwitchFlow;
  initialConfig?: Partial<AutoSwitchConfig>;
}

export interface BestAccountResult {
  candidate: GoogleAccount | null;
  score: AccountScore | null;
  reason?: string;
  rankedScores: AccountScore[];
}

export class AutoSwitchService {
  private readonly accountStore: AccountStore;
  private readonly rateLimitTracker: RateLimitTracker;
  private readonly switchFlow?: SwitchFlow;
  private config: AutoSwitchConfig;
  private poolExhaustedListeners: Set<
    (info: { reason: string; timestamp: number }) => void
  > = new Set();

  constructor(options: AutoSwitchServiceOptions) {
    this.accountStore = options.accountStore;
    this.rateLimitTracker = options.rateLimitTracker;
    this.switchFlow = options.switchFlow;
    this.config = {
      ...DEFAULT_AUTO_SWITCH_CONFIG,
      ...options.initialConfig,
    };
  }

  public getConfig(): AutoSwitchConfig {
    return { ...this.config };
  }

  public setConfig(updates: Partial<AutoSwitchConfig>): AutoSwitchConfig {
    if (
      updates.minQuotaThresholdPercent !== undefined &&
      (updates.minQuotaThresholdPercent < 0 ||
        updates.minQuotaThresholdPercent > 100)
    ) {
      throw new Error("minQuotaThresholdPercent must be between 0 and 100");
    }

    if (updates.pollIntervalMs !== undefined && updates.pollIntervalMs <= 0) {
      throw new Error("pollIntervalMs must be greater than zero");
    }

    if (
      updates.rateLimitCooldownMs !== undefined &&
      updates.rateLimitCooldownMs <= 0
    ) {
      throw new Error("rateLimitCooldownMs must be greater than zero");
    }

    this.config = {
      ...this.config,
      ...updates,
    };

    if (updates.rateLimitCooldownMs !== undefined) {
      this.rateLimitTracker.setCooldownDuration(updates.rateLimitCooldownMs);
    }

    return this.getConfig();
  }

  public onPoolExhausted(
    callback: (info: { reason: string; timestamp: number }) => void,
  ): () => void {
    this.poolExhaustedListeners.add(callback);
    return () => {
      this.poolExhaustedListeners.delete(callback);
    };
  }

  private notifyPoolExhausted(reason: string): void {
    const info = { reason, timestamp: Date.now() };
    for (const listener of this.poolExhaustedListeners) {
      try {
        listener(info);
      } catch {
        // Suppress listener error
      }
    }
  }

  public async findBestAccount(
    overrideCandidates?: GoogleAccount[],
  ): Promise<BestAccountResult> {
    const allAccounts =
      overrideCandidates ?? (await this.accountStore.getAll());
    const activeAccount = await this.accountStore.getActive();
    const activeAccountId = activeAccount?.id ?? null;

    // 1. Filter out active, disabled, expired, and rate-limited accounts
    const eligibleAccounts = allAccounts.filter((account) => {
      if (account.id === activeAccountId) return false;
      if (account.status === "disabled") return false;
      if (account.status === "expired") return false;
      if (account.status === "rate_limited") return false;
      if (this.rateLimitTracker.isAccountLimited(account.id)) return false;
      return true;
    });

    if (eligibleAccounts.length === 0) {
      return {
        candidate: null,
        score: null,
        reason: "NO_ELIGIBLE_ACCOUNTS",
        rankedScores: [],
      };
    }

    // Determine min and max lastUsedAt among eligible candidates for LRU normalization
    const timestamps = eligibleAccounts
      .map((a) => a.lastUsedAt || 0)
      .filter((t) => t > 0);

    const minLastUsed =
      timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
    const maxLastUsed =
      timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

    // 2. Compute deterministic scores
    const evaluated: Array<{
      account: GoogleAccount;
      scoreData: AccountScore;
    }> = [];

    for (const account of eligibleAccounts) {
      const quotaAverage = this.computeQuotaAverage(account);

      let recencyScore = 100;
      const lastUsed = account.lastUsedAt || 0;
      if (lastUsed > 0 && maxLastUsed > minLastUsed) {
        recencyScore =
          ((maxLastUsed - lastUsed) / (maxLastUsed - minLastUsed)) * 100;
      } else if (lastUsed > 0) {
        recencyScore = 50;
      }

      // Score formula: (quotaAverage * 0.8 + recencyScore * 0.2) mapped to 0..1000
      const totalScore = Math.round(
        (quotaAverage * 0.8 + recencyScore * 0.2) * 10,
      );

      const scoreData: AccountScore = {
        accountId: account.id,
        email: account.email,
        score: totalScore,
        quotaAverage,
        isRateLimited: false,
        isActive: false,
        lastUsedAt: lastUsed,
        selectionRank: 0,
      };

      evaluated.push({ account, scoreData });
    }

    // 3. Filter out accounts strictly below minQuotaThresholdPercent
    const qualified = evaluated.filter(
      (item) =>
        item.scoreData.quotaAverage >= this.config.minQuotaThresholdPercent,
    );

    if (qualified.length === 0) {
      const rankedAll = evaluated
        .sort((a, b) => b.scoreData.score - a.scoreData.score)
        .map((item, index) => ({
          ...item.scoreData,
          selectionRank: index + 1,
        }));

      return {
        candidate: null,
        score: null,
        reason: "ALL_BELOW_THRESHOLD",
        rankedScores: rankedAll,
      };
    }

    // 4. Sort qualified candidates:
    // Highest score -> oldest lastUsedAt -> alphabetical ID
    qualified.sort((a, b) => {
      if (b.scoreData.score !== a.scoreData.score) {
        return b.scoreData.score - a.scoreData.score;
      }
      if (a.scoreData.lastUsedAt !== b.scoreData.lastUsedAt) {
        return a.scoreData.lastUsedAt - b.scoreData.lastUsedAt;
      }
      return a.account.id.localeCompare(b.account.id);
    });

    const rankedScores: AccountScore[] = qualified.map((item, index) => ({
      ...item.scoreData,
      selectionRank: index + 1,
    }));

    const winner = qualified[0];
    winner.scoreData.selectionRank = 1;

    return {
      candidate: winner.account,
      score: rankedScores[0],
      rankedScores,
    };
  }

  private computeQuotaAverage(account: GoogleAccount): number {
    if (!account.quota || !account.quota.models) {
      // If quota has not been polled yet, assume full quota
      return 100;
    }

    const models = account.quota.models;
    const preferred = this.config.preferredModels;

    const matchedPercentages: number[] = [];
    for (const pref of preferred) {
      if (models[pref] !== undefined) {
        matchedPercentages.push(models[pref].percentage);
      }
    }

    if (matchedPercentages.length > 0) {
      const sum = matchedPercentages.reduce((acc, val) => acc + val, 0);
      return Math.round(sum / matchedPercentages.length);
    }

    // If none of preferred models matched, average all available models
    const allPercentages = Object.values(models).map((m) => m.percentage);
    if (allPercentages.length > 0) {
      const sum = allPercentages.reduce((acc, val) => acc + val, 0);
      return Math.round(sum / allPercentages.length);
    }

    return 100;
  }

  public async evaluateAndSwitch(
    reason: SwitchReason,
  ): Promise<SwitchResult | null> {
    if (!this.config.enabled) {
      return null;
    }

    const { candidate, reason: noCandidateReason } =
      await this.findBestAccount();

    if (!candidate) {
      this.notifyPoolExhausted(
        noCandidateReason || "No healthy candidate account available in pool",
      );
      return null;
    }

    if (!this.switchFlow) {
      throw new Error(
        "SwitchFlow coordinator not configured in AutoSwitchService",
      );
    }

    return this.switchFlow.executeSwitch(candidate.id, reason);
  }
}
