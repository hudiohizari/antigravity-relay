export enum IpcChannels {
  ACCOUNTS_GET_ALL = "accounts:get-all",
  ACCOUNTS_INITIATE_OAUTH = "accounts:initiate-oauth",
  ACCOUNTS_DELETE = "accounts:delete",
  ACCOUNTS_REFRESH_TOKEN = "accounts:refresh-token",
  ACCOUNTS_SET_ACTIVE = "accounts:set-active",
  SERVICES_GET_STATUS = "services:get-status",
  SERVICES_START = "services:start",
  SERVICES_STOP = "services:stop",
  SERVICES_STATUS_UPDATED = "services:status-updated",
  QUOTA_POLL_ALL = "quota:poll-all",
  QUOTA_POLL_ACCOUNT = "quota:poll-account",
  QUOTA_UPDATED = "quota:updated",
  SWITCHER_GET_CONFIG = "switcher:get-config",
  SWITCHER_SET_CONFIG = "switcher:set-config",
  SWITCHER_MANUAL_TRIGGER = "switcher:manual-trigger",
  SWITCHER_EVENT = "switcher:event",
  RATE_LIMIT_GET_STATES = "rate-limit:get-states",
  RATE_LIMIT_CLEAR = "rate-limit:clear",
  SNAPSHOTS_LIST = "snapshots:list",
  SNAPSHOTS_CREATE = "snapshots:create",
  SNAPSHOTS_RESTORE = "snapshots:restore",
  SNAPSHOTS_DELETE = "snapshots:delete",
}

export type AccountStatus = "active" | "rate_limited" | "expired" | "disabled";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expiry_timestamp: number;
  token_type: string;
  scope?: string;
  id_token?: string;
  project_id?: string;
}

export interface ModelQuota {
  modelId?: string;
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

export interface DeviceProfile {
  machine_id: string;
  os_platform: string;
  os_release: string;
  client_version?: string;
}

export interface GoogleAccount {
  id: string;
  email: string;
  avatarUrl?: string;
  status: AccountStatus;
  tokens: TokenData;
  quota?: QuotaData;
  deviceProfile?: DeviceProfile;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AccountStoreData {
  version: number;
  activeAccountId: string | null;
  accounts: Record<string, GoogleAccount>;
  lastSwappedAt?: number;
}

export interface EncryptedStoreEnvelope {
  version: 1;
  cipher: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  salt: string;
  updatedAt: number;
}

export type ServiceTarget = "antigravity_daemon" | "antigravity_ide";

export type ServiceState =
  "running" | "stopped" | "starting" | "stopping" | "error";

export interface ServiceProcessInfo {
  target: ServiceTarget;
  displayName: string;
  binaryName: string;
  state: ServiceState;
  pids: number[];
  mainPid: number | null;
  uptimeSeconds: number;
  lastCheckedAt: number;
  commandPath?: string;
  errorMessage?: string;
}

export interface DualServiceStatus {
  services: Record<ServiceTarget, ServiceProcessInfo>;
  runningCount: number;
  totalCount: number;
  lastUpdated: number;
}

export interface IpcResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OAuthResult {
  success: boolean;
  account?: GoogleAccount;
  error?: string;
}

export interface ServiceActionResult {
  success: boolean;
  process?: ServiceProcessInfo;
  error?: string;
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

export interface SnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  accountCount: number;
  activeAccountEmail?: string;
  sizeBytes?: number;
}

export interface AccountSnapshot {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  accountCount: number;
  activeAccountId: string | null;
  accounts: Record<string, GoogleAccount>;
  autoSwitchConfig?: AutoSwitchConfig;
}

export interface SnapshotStoreData {
  version: 1;
  snapshots: Record<string, AccountSnapshot>;
  lastRestoredSnapshotId?: string;
  updatedAt: number;
}
