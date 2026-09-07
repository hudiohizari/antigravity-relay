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
  RELAY_GET_STATUS = "relay:get-status",
  RELAY_START = "relay:start",
  RELAY_STOP = "relay:stop",
  RELAY_STATUS_UPDATED = "relay:status-updated",
  RELAY_GET_SESSIONS = "relay:get-sessions",
  RELAY_REVOKE_SESSION = "relay:revoke-session",
  TUNNEL_GET_STATUS = "tunnel:get-status",
  TUNNEL_START = "tunnel:start",
  TUNNEL_STOP = "tunnel:stop",
  TUNNEL_STATUS_UPDATED = "tunnel:status-updated",
  TUNNEL_GET_URL = "tunnel:get-url",
  SESSIONS_GET_ACTIVE = "sessions:get-active",
  SESSIONS_REVOKE = "sessions:revoke",
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

// Relay Server Configurations & Status
export interface RelayConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  maxBufferedCommands: number;
  bufferTtlMs: number;
  heartbeatIntervalMs: number;
  staticDir?: string;
}

export type RelayServerConfig = RelayConfig;

export type UpstreamBridgeState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface UpstreamBridgeStatus {
  state: UpstreamBridgeState;
  targetHost: string;
  targetPort: number;
  lastHeartbeatAt?: number;
  reconnectAttempts: number;
  bufferedCommandCount: number;
  flushedCommandCount: number;
  lastError?: string;
}

export type UpstreamStatus = UpstreamBridgeStatus;

export interface RelayServerStatus {
  isRunning: boolean;
  port: number;
  host: string;
  activeSessions: number;
  isBuffering: boolean;
  upstream: UpstreamBridgeStatus;
  startedAt?: number;
}

// Remote Session Management
export type SessionSocketState = "connected" | "disconnected" | "buffered";

export interface Session {
  sessionId: string;
  token: string;
  clientIp: string;
  userAgent: string;
  connectedAt: number;
  lastActiveAt: number;
  authenticated: boolean;
  socketState: SessionSocketState;
}

export type RelaySession = Session;

export type CommandStatus = "queued" | "forwarded" | "expired" | "rejected";

export interface BufferedMessage {
  id: string;
  sessionId: string;
  commandType: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  expiresAt: number;
  status: CommandStatus;
}

export type BufferedCommand = BufferedMessage;

// Cloudflare Tunnel Subprocess Management
export type TunnelState =
  "stopped" | "starting" | "connected" | "reconnecting" | "error";

export interface TunnelConfig {
  binaryPath?: string;
  targetPort: number;
  namedTunnelToken?: string;
  customDomain?: string;
  autoRestart: boolean;
  maxRetries: number;
  retryBackoffMs: number;
}

export interface TunnelStatus {
  state: TunnelState;
  publicUrl: string | null;
  pid: number | null;
  startedAt: number | null;
  reconnectAttempts: number;
  lastError?: string;
  protocol?: string;
}

// Remote Command & Event Protocol
export type RemoteCommandType =
  "PROMPT" | "APPROVE_ACTION" | "REJECT_ACTION" | "INTERRUPT" | "PING";

export interface RemoteCommand {
  id: string;
  type: RemoteCommandType | string;
  payload: Record<string, unknown>;
  token?: string;
  timestamp?: number;
}

export type RemoteEventType =
  | "AGENT_STATE"
  | "AGENT_OUTPUT"
  | "ACTION_PROPOSAL"
  | "BUFFERING_ALERT"
  | "SWAP_RESUMED"
  | "SESSION_REVOKED"
  | "BUFFERED_ACK"
  | "ERROR";

export interface RemoteEvent {
  type: RemoteEventType | string;
  payload: Record<string, unknown>;
  timestamp: number;
}
