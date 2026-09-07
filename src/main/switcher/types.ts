import { ServiceTarget } from "../../shared/types";

export type RateLimitReason =
  "http_429" | "resource_exhausted" | "quota_depleted" | "manual_flag";

export interface RateLimitState {
  accountId: string;
  isRateLimited: boolean;
  limitedAt?: number;
  cooldownUntil?: number;
  reason?: RateLimitReason;
  retryCount: number;
  lastErrorStatus?: number;
}

export interface AutoSwitchConfig {
  enabled: boolean;
  minQuotaThresholdPercent: number;
  pollIntervalMs: number;
  rateLimitCooldownMs: number;
  autoRelaunchProcesses: boolean;
  preferredModels: string[];
}

export const DEFAULT_AUTO_SWITCH_CONFIG: AutoSwitchConfig = {
  enabled: true,
  minQuotaThresholdPercent: 10,
  pollIntervalMs: 300000, // 5 minutes
  rateLimitCooldownMs: 900000, // 15 minutes
  autoRelaunchProcesses: true,
  preferredModels: ["gemini-1.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"],
};

export interface AccountScore {
  accountId: string;
  email: string;
  score: number;
  quotaAverage: number;
  isRateLimited: boolean;
  isActive: boolean;
  lastUsedAt: number;
  selectionRank: number;
}

export type SwitchReason =
  | "rate_limited_429"
  | "quota_depleted"
  | "manual_request"
  | "scheduled_rotation";

export interface SwitchResult {
  success: boolean;
  previousAccountId: string | null;
  newAccountId: string;
  newAccountEmail: string;
  reason: SwitchReason;
  restartedProcesses: ServiceTarget[];
  durationMs: number;
  timestamp: number;
  error?: string;
}
