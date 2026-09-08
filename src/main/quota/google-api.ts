import { GoogleAccount } from "../../shared/types";
import { QuotaData, QuotaPollResult, ModelQuota } from "./types";

export interface GoogleQuotaApiClientOptions {
  baseUrl?: string;
  endpoints?: string[];
  fetchFn?: typeof fetch;
  mockOffline?: boolean;
  defaultModels?: string[];
  fallbackDelayMs?: number;
}

export const DEFAULT_QUOTA_ENDPOINTS = [
  "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
  "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
] as const;

export const DEFAULT_QUOTA_MODELS = [
  "gemini-1.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

export const FAMILY_DISPLAY_NAMES: Record<string, string> = {
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-flash-lite": "Gemini Flash Lite",
  "gemini-pro-image": "Gemini Pro Image",
  "gemini-flash-image": "Gemini Flash Image",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-5": "Claude Opus 4.5",
  "gpt-oss-120b": "GPT OSS 120B",
};

export function normalizeModelId(modelId: string): string {
  return modelId
    .replace(/^models\//i, "")
    .trim()
    .toLowerCase();
}

export function getQuotaModelFamilyId(modelId: string): string {
  const normalized = normalizeModelId(modelId);

  if (normalized.includes("image")) {
    if (normalized.startsWith("gemini-") && normalized.includes("flash")) {
      return "gemini-flash-image";
    }
    if (normalized.startsWith("gemini-")) {
      return "gemini-pro-image";
    }
  }

  if (
    normalized === "gemini-3.1-flash-lite" ||
    normalized === "gemini-2.5-flash-lite" ||
    normalized === "gemini-2.5-flash" ||
    normalized === "gemini-2.5-flash-thinking"
  ) {
    return "gemini-flash-lite";
  }

  if (
    normalized.startsWith("gemini-3.1-pro") ||
    normalized === "gemini-pro" ||
    normalized.startsWith("gemini-pro-agent")
  ) {
    return "gemini-3.1-pro";
  }

  if (
    normalized.startsWith("gemini-3.5-flash") ||
    normalized === "gemini-3-flash" ||
    normalized.startsWith("gemini-3-flash-agent")
  ) {
    return "gemini-3.5-flash";
  }

  const claudeFamily = normalized.match(/^claude-(sonnet|opus|haiku)-(\d+)-(\d+)/);
  if (claudeFamily) {
    return `claude-${claudeFamily[1]}-${claudeFamily[2]}-${claudeFamily[3]}`;
  }

  if (normalized.startsWith("gpt-oss-120b")) {
    return "gpt-oss-120b";
  }

  return normalized;
}

export function chooseEarliestResetTime(current: string, candidate: string): string {
  if (!current) {
    return candidate;
  }
  if (!candidate) {
    return current;
  }

  const currentTimestamp = new Date(current).getTime();
  const candidateTimestamp = new Date(candidate).getTime();
  const currentIsValid = !Number.isNaN(currentTimestamp);
  const candidateIsValid = !Number.isNaN(candidateTimestamp);

  if (currentIsValid && candidateIsValid) {
    return candidateTimestamp < currentTimestamp ? candidate : current;
  }
  if (candidateIsValid) {
    return candidate;
  }
  return current;
}

export function aggregateQuotaModelFamilies(
  models: Record<string, ModelQuota>,
): Record<string, ModelQuota> {
  const aggregated: Record<string, ModelQuota> = {};

  for (const [modelId, info] of Object.entries(models)) {
    const normalizedModelId = normalizeModelId(modelId);
    const familyId = getQuotaModelFamilyId(normalizedModelId);
    const displayName = FAMILY_DISPLAY_NAMES[familyId];
    const current = aggregated[familyId];

    if (!current) {
      aggregated[familyId] =
        familyId === normalizedModelId && !displayName
          ? info
          : {
              ...info,
              modelId: familyId,
              displayName: displayName ?? info.displayName,
            };
      continue;
    }

    aggregated[familyId] = {
      ...current,
      modelId: familyId,
      percentage: Math.min(current.percentage, info.percentage),
      resetTime: chooseEarliestResetTime(current.resetTime, info.resetTime),
      displayName: displayName ?? current.displayName ?? info.displayName,
    };
  }

  return aggregated;
}

export class GoogleQuotaApiClient {
  private readonly endpoints: string[];
  private readonly fetchFn: typeof fetch;
  private readonly mockOffline: boolean;
  private readonly defaultModels: string[];
  private readonly fallbackDelayMs: number;

  constructor(options: GoogleQuotaApiClientOptions = {}) {
    if (options.endpoints && options.endpoints.length > 0) {
      this.endpoints = [...options.endpoints];
    } else if (
      options.baseUrl &&
      !options.baseUrl.includes("generativelanguage.googleapis.com")
    ) {
      this.endpoints = options.baseUrl.endsWith(":fetchAvailableModels")
        ? [options.baseUrl]
        : [`${options.baseUrl}/v1internal:fetchAvailableModels`];
    } else {
      this.endpoints = [...DEFAULT_QUOTA_ENDPOINTS];
    }

    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.mockOffline = options.mockOffline ?? false;
    this.defaultModels = options.defaultModels || DEFAULT_QUOTA_MODELS;
    this.fallbackDelayMs = options.fallbackDelayMs ?? 0;
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
        displayName: FAMILY_DISPLAY_NAMES[modelId] || undefined,
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

  public async loadProjectContext(
    accessToken: string,
  ): Promise<string | undefined> {
    try {
      const response = await this.fetchFn(
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "User-Agent": "antigravity/1.0.0",
          },
          body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
        },
      );
      if (response.ok) {
        const data = (await response.json()) as any;
        return data?.cloudaicompanionProject;
      }
    } catch {
      // Ignored if unavailable
    }
    return undefined;
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

    let lastErrorStatus: number | undefined;
    let lastErrorMessage: string | undefined;

    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[i];
      const hasNextEndpoint = i + 1 < this.endpoints.length;
      let payload: Record<string, unknown> = account.tokens.project_id
        ? { project: account.tokens.project_id }
        : {};
      let retriedWithoutProject = false;

      while (true) {
        try {
          const response = await this.fetchFn(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${account.tokens.access_token}`,
              "Content-Type": "application/json",
              "User-Agent": "antigravity/1.0.0",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          });

          // 1. Rate limited (HTTP 429)
          if (response.status === 429) {
            if (hasNextEndpoint) {
              lastErrorStatus = 429;
              lastErrorMessage = "Rate limit exceeded (HTTP 429)";
              if (this.fallbackDelayMs > 0) {
                await new Promise((r) => setTimeout(r, this.fallbackDelayMs));
              }
              break;
            }
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
          if (response.status === 403) {
            if ("project" in payload && !retriedWithoutProject) {
              payload = {};
              retriedWithoutProject = true;
              continue;
            }

            const errorText = await response.text().catch(() => "");
            const isInvalidGrant =
              errorText.includes("invalid_grant") ||
              errorText.includes("TOKEN_EXPIRED");

            return {
              accountId: account.id,
              success: false,
              statusCode: 403,
              error: isInvalidGrant
                ? "Authentication expired or revoked (invalid_grant)"
                : "Access forbidden (403)",
              timestamp: now,
            };
          }

          if (response.status === 401) {
            return {
              accountId: account.id,
              success: false,
              statusCode: 401,
              error: "Authentication expired or revoked (invalid_grant)",
              timestamp: now,
            };
          }

          // 3. Server errors (5xx)
          if (response.status >= 500) {
            if (hasNextEndpoint) {
              lastErrorStatus = response.status;
              lastErrorMessage = `Server error (${response.status})`;
              if (this.fallbackDelayMs > 0) {
                await new Promise((r) => setTimeout(r, this.fallbackDelayMs));
              }
              break;
            }

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
          let responseData: any = {};
          try {
            responseData = await response.json();
          } catch {
            responseData = {};
          }

          const remainingHeader = response.headers?.get?.("x-ratelimit-remaining");
          const limitHeader = response.headers?.get?.("x-ratelimit-limit");
          const resetHeader = response.headers?.get?.("x-ratelimit-reset");

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

          const defaultResetTime = resetHeader
            ? new Date(Date.now() + parseInt(resetHeader, 10) * 1000).toISOString()
            : new Date(Date.now() + 3600000).toISOString();

          const rawModels = responseData?.models;
          let parsedModels: Record<string, ModelQuota> = {};

          if (
            rawModels &&
            typeof rawModels === "object" &&
            !Array.isArray(rawModels) &&
            Object.keys(rawModels).length > 0
          ) {
            for (const [modelName, modelInfoRaw] of Object.entries(rawModels)) {
              const info = modelInfoRaw as any;
              if (!info || typeof info !== "object") continue;

              if (info.quotaInfo) {
                const fraction = info.quotaInfo.remainingFraction ?? 0;
                const percentage = Math.max(
                  0,
                  Math.min(100, Math.floor(fraction * 100)),
                );
                const resetTime = info.quotaInfo.resetTime || defaultResetTime;
                const displayName = info.displayName || modelName;

                parsedModels[modelName] = {
                  modelId: modelName,
                  displayName,
                  percentage,
                  resetTime,
                };
              }
            }

            if (Object.keys(parsedModels).length > 0) {
              parsedModels = aggregateQuotaModelFamilies(parsedModels);
            }
          }

          // Backward compatibility fallback
          if (Object.keys(parsedModels).length === 0) {
            for (const modelId of this.defaultModels) {
              parsedModels[modelId] = {
                modelId,
                displayName: FAMILY_DISPLAY_NAMES[modelId] || undefined,
                percentage: calculatedPercentage,
                resetTime: defaultResetTime,
                remainingQueries,
                totalQueries,
              };
            }
          }

          return {
            accountId: account.id,
            success: true,
            statusCode: response.status,
            quota: {
              models: parsedModels,
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

          if (hasNextEndpoint) {
            lastErrorMessage = errMessage;
            if (this.fallbackDelayMs > 0) {
              await new Promise((r) => setTimeout(r, this.fallbackDelayMs));
            }
            break;
          }

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

    if (lastErrorStatus === 429) {
      return {
        accountId: account.id,
        success: false,
        statusCode: 429,
        isRateLimited: true,
        error: "Rate limit exceeded (HTTP 429)",
        timestamp: now,
      };
    }

    if (cachedQuota) {
      return {
        accountId: account.id,
        success: true,
        quota: {
          ...cachedQuota,
          source: "cached",
          poll_error: lastErrorMessage || "All quota endpoints failed",
          last_polled_at: now,
        },
        error: lastErrorMessage || "All quota endpoints failed",
        timestamp: now,
      };
    }

    return {
      accountId: account.id,
      success: false,
      statusCode: lastErrorStatus,
      error: lastErrorMessage || "All quota endpoints failed",
      timestamp: now,
    };
  }
}
