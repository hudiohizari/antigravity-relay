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
  percentage: number;
  resetTime: string;
  remainingQueries?: number;
}

export interface QuotaData {
  models: Record<string, ModelQuota>;
  subscription_tier?: string;
  is_forbidden?: boolean;
  last_polled_at?: number;
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
