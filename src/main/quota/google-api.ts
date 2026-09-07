import { GoogleAccount } from "../../shared/types";
import { QuotaData, QuotaPollResult, ModelQuota } from "./types";

export interface GoogleQuotaApiClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  mockOffline?: boolean;
  defaultModels?: string[];
}

export const DEFAULT_QUOTA_MODELS = [
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

export class GoogleQuotaApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly mockOffline: boolean;
  private readonly defaultModels: string[];

  constructor(options: GoogleQuotaApiClientOptions = {}) {
    this.baseUrl =
      options.baseUrl || "https://generativelanguage.googleapis.com";
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.mockOffline = options.mockOffline ?? false;
    this.defaultModels = options.defaultModels || DEFAULT_QUOTA_MODELS;
  }

  public createMockQuota(options?: {
    percentage?: number;
    models?: string[];
  }): QuotaData {
    const modelsList = options?.models || this.defaultModels;
    const percentage = options?.percentage ?? 100;
    const now = Date.now();
    const oneHourLater = new Date(now + 3600000).toISOString();

    const models: Record<string, ModelQuota> = {};
    for (const modelId of modelsList) {
      models[modelId] = {
        modelId,
        percentage,
        resetTime: oneHourLater,
        remainingQueries: Math.round((percentage / 100) * 1000),
        totalQueries: 1000,
      };
    }

    return {
      models,
      subscription_tier: "free",
      is_forbidden: false,
      last_polled_at: now,
      source: "mock_offline",
    };
  }

  public async fetchQuota(
    account: GoogleAccount,
    cachedQuota?: QuotaData,
  ): Promise<QuotaPollResult> {
    const now = Date.now();

    if (!account.tokens || !account.tokens.access_token) {
      return {
        accountId: account.id,
        success: false,
        statusCode: 401,
        error: "Missing access token for account",
        timestamp: now,
      };
    }

    if (this.mockOffline) {
      return {
        accountId: account.id,
        success: true,
        quota: this.createMockQuota(),
        timestamp: now,
      };
    }

    const requestUrl = `${this.baseUrl}/v1beta/models`;

    try {
      const response = await this.fetchFn(requestUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${account.tokens.access_token}`,
          Accept: "application/json",
        },
      });

      // 1. Rate limited (HTTP 429)
      if (response.status === 429) {
        return {
          accountId: account.id,
          success: false,
          statusCode: 429,
          isRateLimited: true,
          error: "Rate limit exceeded (HTTP 429)",
          timestamp: now,
        };
      }

      // 2. Authentication failures (401 or 403)
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text().catch(() => "");
        const isInvalidGrant =
          errorText.includes("invalid_grant") ||
          errorText.includes("TOKEN_EXPIRED") ||
          response.status === 401;

        return {
          accountId: account.id,
          success: false,
          statusCode: response.status,
          error: isInvalidGrant
            ? "Authentication expired or revoked (invalid_grant)"
            : `Access forbidden (${response.status})`,
          timestamp: now,
        };
      }

      // 3. Server errors (5xx)
      if (response.status >= 500) {
        if (cachedQuota) {
          return {
            accountId: account.id,
            success: true,
            quota: {
              ...cachedQuota,
              source: "cached",
              poll_error: `Server error (${response.status})`,
              last_polled_at: now,
            },
            statusCode: response.status,
            error: `Server error (${response.status})`,
            timestamp: now,
          };
        }

        return {
          accountId: account.id,
          success: false,
          statusCode: response.status,
          error: `Google API server error (${response.status})`,
          timestamp: now,
        };
      }

      // 4. Successful response (2xx)
      const remainingHeader = response.headers.get("x-ratelimit-remaining");
      const limitHeader = response.headers.get("x-ratelimit-limit");
      const resetHeader = response.headers.get("x-ratelimit-reset");

      let calculatedPercentage = 100;
      let remainingQueries: number | undefined;
      let totalQueries: number | undefined;

      if (remainingHeader && limitHeader) {
        const remaining = parseInt(remainingHeader, 10);
        const limit = parseInt(limitHeader, 10);
        if (!isNaN(remaining) && !isNaN(limit) && limit > 0) {
          calculatedPercentage = Math.max(
            0,
            Math.min(100, Math.round((remaining / limit) * 100)),
          );
          remainingQueries = remaining;
          totalQueries = limit;
        }
      }

      const resetTime = resetHeader
        ? new Date(Date.now() + parseInt(resetHeader, 10) * 1000).toISOString()
        : new Date(Date.now() + 3600000).toISOString();

      const models: Record<string, ModelQuota> = {};
      for (const modelId of this.defaultModels) {
        models[modelId] = {
          modelId,
          percentage: calculatedPercentage,
          resetTime,
          remainingQueries,
          totalQueries,
        };
      }

      return {
        accountId: account.id,
        success: true,
        statusCode: response.status,
        quota: {
          models,
          subscription_tier: "free",
          is_forbidden: false,
          last_polled_at: now,
          source: "api",
        },
        timestamp: now,
      };
    } catch (networkError) {
      const errMessage =
        (networkError as Error).message || "Network unreachable";

      if (cachedQuota) {
        return {
          accountId: account.id,
          success: true,
          quota: {
            ...cachedQuota,
            source: "cached",
            poll_error: errMessage,
            last_polled_at: now,
          },
          error: errMessage,
          timestamp: now,
        };
      }

      return {
        accountId: account.id,
        success: false,
        error: `Network request failed: ${errMessage}`,
        timestamp: now,
      };
    }
  }
}
