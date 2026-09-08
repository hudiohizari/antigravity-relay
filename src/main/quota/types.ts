export const QUOTA_SCHEMA_VERSION = 1;

export interface ModelQuota {
  modelId?: string;
  displayName?: string;
  percentage: number;
  resetTime: string;
  remainingQueries?: number;
  totalQueries?: number;
}

export interface QuotaData {
  models: Record<string, ModelQuota>;
  subscription_tier?: string;
  is_forbidden?: boolean;
  last_polled_at?: number;
  poll_error?: string;
  source?: "api" | "cached" | "mock_offline";
}

export interface QuotaPollResult {
  accountId: string;
  success: boolean;
  quota?: QuotaData;
  error?: string;
  statusCode?: number;
  isRateLimited?: boolean;
  timestamp: number;
}
