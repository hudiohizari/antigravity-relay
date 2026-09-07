import { AccountStore } from "../account-store/account-store";
import { GoogleQuotaApiClient } from "./google-api";
import { RateLimitTracker } from "../switcher/rate-limit-tracker";
import { QuotaData, QuotaPollResult } from "./types";

export interface QuotaMonitorOptions {
  accountStore: AccountStore;
  apiClient?: GoogleQuotaApiClient;
  rateLimitTracker?: RateLimitTracker;
  pollIntervalMs?: number;
}

export class QuotaMonitor {
  private readonly accountStore: AccountStore;
  private readonly apiClient: GoogleQuotaApiClient;
  private readonly rateLimitTracker?: RateLimitTracker;
  private pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isCurrentlyPolling = false;

  private quotaUpdatedListeners: Set<
    (payload: { accountId: string; quota: QuotaData }) => void
  > = new Set();
  private rateLimitListeners: Set<
    (payload: { accountId: string; result: QuotaPollResult }) => void
  > = new Set();

  constructor(options: QuotaMonitorOptions) {
    this.accountStore = options.accountStore;
    this.apiClient = options.apiClient || new GoogleQuotaApiClient();
    this.rateLimitTracker = options.rateLimitTracker;
    this.pollIntervalMs = options.pollIntervalMs ?? 300000; // 5 minutes default
  }

  public getInterval(): number {
    return this.pollIntervalMs;
  }

  public setInterval(intervalMs: number): void {
    if (intervalMs <= 0) {
      throw new Error("Poll interval must be greater than zero");
    }
    this.pollIntervalMs = intervalMs;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  public isPolling(): boolean {
    return this.timer !== null;
  }

  public start(): void {
    this.stop();
    this.timer = setInterval(async () => {
      try {
        await this.pollAll();
      } catch {
        // Suppress scheduled poller top-level errors
      }
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public onQuotaUpdated(
    callback: (payload: { accountId: string; quota: QuotaData }) => void,
  ): () => void {
    this.quotaUpdatedListeners.add(callback);
    return () => {
      this.quotaUpdatedListeners.delete(callback);
    };
  }

  public onRateLimitDetected(
    callback: (payload: { accountId: string; result: QuotaPollResult }) => void,
  ): () => void {
    this.rateLimitListeners.add(callback);
    return () => {
      this.rateLimitListeners.delete(callback);
    };
  }

  private notifyQuotaUpdated(accountId: string, quota: QuotaData): void {
    for (const listener of this.quotaUpdatedListeners) {
      try {
        listener({ accountId, quota });
      } catch {
        // Suppress listener error
      }
    }
  }

  private notifyRateLimit(accountId: string, result: QuotaPollResult): void {
    for (const listener of this.rateLimitListeners) {
      try {
        listener({ accountId, result });
      } catch {
        // Suppress listener error
      }
    }
  }

  public async pollAccount(accountId: string): Promise<QuotaPollResult> {
    const account = await this.accountStore.get(accountId);
    if (!account) {
      return {
        accountId,
        success: false,
        error: `Account ${accountId} not found`,
        timestamp: Date.now(),
      };
    }

    const result = await this.apiClient.fetchQuota(account, account.quota);

    if (result.isRateLimited) {
      if (this.rateLimitTracker) {
        this.rateLimitTracker.recordRateLimit(accountId, "http_429", 429);
      }
      await this.accountStore.updateStatus(accountId, "rate_limited");
      this.notifyRateLimit(accountId, result);
      return result;
    }

    if (result.statusCode === 401 || result.statusCode === 403) {
      await this.accountStore.updateStatus(accountId, "expired");
      return result;
    }

    if (result.success && result.quota) {
      await this.accountStore.updateQuota(accountId, result.quota);

      // Check if account status can be restored to active if cooldown has elapsed
      if (account.status === "rate_limited") {
        const isLimited = this.rateLimitTracker
          ? this.rateLimitTracker.isAccountLimited(accountId)
          : false;
        if (!isLimited) {
          await this.accountStore.updateStatus(accountId, "active");
        }
      }

      this.notifyQuotaUpdated(accountId, result.quota);
    }

    return result;
  }

  public async pollAll(): Promise<QuotaPollResult[]> {
    if (this.isCurrentlyPolling) {
      return [];
    }

    this.isCurrentlyPolling = true;
    try {
      const accounts = await this.accountStore.getAll();
      const results: QuotaPollResult[] = [];

      for (const account of accounts) {
        try {
          const res = await this.pollAccount(account.id);
          results.push(res);
        } catch (err) {
          results.push({
            accountId: account.id,
            success: false,
            error: (err as Error).message,
            timestamp: Date.now(),
          });
        }
      }

      return results;
    } finally {
      this.isCurrentlyPolling = false;
    }
  }
}
