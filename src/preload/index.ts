import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import {
  IpcChannels,
  GoogleAccount,
  TokenData,
  ServiceTarget,
  DualServiceStatus,
  OAuthResult,
  ServiceActionResult,
  QuotaPollResult,
  AutoSwitchConfig,
  SwitchResult,
  RateLimitState,
  SnapshotMetadata,
  RelayServerStatus,
  Session,
  TunnelStatus,
  TunnelConfig,
  AppSettings,
  SystemTrayState,
  NotificationPayload,
  NotificationPreferences,
} from "../shared/types";

export interface ElectronAPI {
  getAccounts: () => Promise<GoogleAccount[]>;
  initiateOAuth: () => Promise<OAuthResult>;
  deleteAccount: (id: string) => Promise<{ success: boolean; error?: string }>;
  refreshToken: (
    id: string,
  ) => Promise<{ success: boolean; token?: TokenData; error?: string }>;
  setActiveAccount: (
    id: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getServiceStatus: () => Promise<DualServiceStatus>;
  startService: (target: ServiceTarget) => Promise<ServiceActionResult>;
  stopService: (target: ServiceTarget) => Promise<ServiceActionResult>;
  onServiceStatusUpdated: (
    callback: (status: DualServiceStatus) => void,
  ) => () => void;

  // Quota Monitoring
  pollAllQuotas: () => Promise<{
    success: boolean;
    data?: QuotaPollResult[];
    error?: string;
  }>;
  pollAccountQuota: (
    accountId: string,
  ) => Promise<{ success: boolean; data?: QuotaPollResult; error?: string }>;
  onQuotaUpdated: (callback: (data: unknown) => void) => () => void;

  // Switcher
  getAutoSwitchConfig: () => Promise<{
    success: boolean;
    data?: AutoSwitchConfig;
    error?: string;
  }>;
  setAutoSwitchConfig: (
    config: Partial<AutoSwitchConfig>,
  ) => Promise<{ success: boolean; data?: AutoSwitchConfig; error?: string }>;
  manualSwitchAccount: (
    accountId: string,
  ) => Promise<{ success: boolean; data?: SwitchResult; error?: string }>;
  onSwitcherEvent: (callback: (event: unknown) => void) => () => void;

  // Rate Limiting
  getRateLimitStates: () => Promise<{
    success: boolean;
    data?: Record<string, RateLimitState>;
    error?: string;
  }>;
  clearRateLimit: (
    accountId: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Snapshots
  listSnapshots: () => Promise<{
    success: boolean;
    data?: SnapshotMetadata[];
    error?: string;
  }>;
  createSnapshot: (params: {
    name: string;
    description?: string;
  }) => Promise<{ success: boolean; data?: SnapshotMetadata; error?: string }>;
  restoreSnapshot: (
    id: string,
  ) => Promise<{ success: boolean; accountCount?: number; error?: string }>;
  deleteSnapshot: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Relay Server
  getRelayStatus: () => Promise<RelayServerStatus>;
  startRelay: (config?: {
    port?: number;
    host?: string;
  }) => Promise<{ success: boolean; data?: RelayServerStatus; error?: string }>;
  stopRelay: () => Promise<{ success: boolean; error?: string }>;
  getRelaySessions: () => Promise<Session[]>;
  revokeRelaySession: (
    sessionId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onRelayStatusUpdated: (
    callback: (status: RelayServerStatus) => void,
  ) => () => void;

  // Cloudflare Tunnel
  getTunnelStatus: () => Promise<TunnelStatus>;
  startTunnel: (
    config?: Partial<TunnelConfig>,
  ) => Promise<{ success: boolean; data?: TunnelStatus; error?: string }>;
  stopTunnel: () => Promise<{ success: boolean; error?: string }>;
  getTunnelUrl: () => Promise<{ publicUrl: string | null }>;
  onTunnelStatusUpdated: (
    callback: (status: TunnelStatus) => void,
  ) => () => void;

  // Settings
  getSettings: () => Promise<{
    success: boolean;
    data?: AppSettings;
    error?: string;
  }>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<{
    success: boolean;
    data?: AppSettings;
    error?: string;
  }>;
  resetSettings: () => Promise<{
    success: boolean;
    data?: AppSettings;
    error?: string;
  }>;
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => () => void;

  // System Tray
  getTrayState: () => Promise<{
    success: boolean;
    data?: SystemTrayState;
    error?: string;
  }>;
  updateTrayMenu: () => Promise<{ success: boolean; error?: string }>;
  showWindow: () => Promise<{ success: boolean; error?: string }>;
  minimizeToTray: () => Promise<{ success: boolean; error?: string }>;

  // Native Notifications
  sendNotification: (
    payload: NotificationPayload,
  ) => Promise<{ success: boolean; error?: string }>;
  getNotificationPreferences: () => Promise<{
    success: boolean;
    data?: NotificationPreferences;
    error?: string;
  }>;
  updateNotificationPreferences: (
    prefs: Partial<NotificationPreferences>,
  ) => Promise<{
    success: boolean;
    data?: NotificationPreferences;
    error?: string;
  }>;
}

const electronAPI: ElectronAPI = {
  getAccounts: () => ipcRenderer.invoke(IpcChannels.ACCOUNTS_GET_ALL),
  initiateOAuth: () => ipcRenderer.invoke(IpcChannels.ACCOUNTS_INITIATE_OAUTH),
  deleteAccount: (id: string) =>
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_DELETE, { id }),
  refreshToken: (id: string) =>
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_REFRESH_TOKEN, { id }),
  setActiveAccount: (id: string) =>
    ipcRenderer.invoke(IpcChannels.ACCOUNTS_SET_ACTIVE, { id }),
  getServiceStatus: () => ipcRenderer.invoke(IpcChannels.SERVICES_GET_STATUS),
  startService: (target: ServiceTarget) =>
    ipcRenderer.invoke(IpcChannels.SERVICES_START, { target }),
  stopService: (target: ServiceTarget) =>
    ipcRenderer.invoke(IpcChannels.SERVICES_STOP, { target }),
  onServiceStatusUpdated: (callback: (status: DualServiceStatus) => void) => {
    const subscription = (
      _event: IpcRendererEvent,
      status: DualServiceStatus,
    ) => {
      callback(status);
    };
    ipcRenderer.on(IpcChannels.SERVICES_STATUS_UPDATED, subscription);
    return () => {
      ipcRenderer.removeListener(
        IpcChannels.SERVICES_STATUS_UPDATED,
        subscription,
      );
    };
  },

  // Quota Monitoring
  pollAllQuotas: () => ipcRenderer.invoke(IpcChannels.QUOTA_POLL_ALL),
  pollAccountQuota: (accountId: string) =>
    ipcRenderer.invoke(IpcChannels.QUOTA_POLL_ACCOUNT, { accountId }),
  onQuotaUpdated: (callback: (data: unknown) => void) => {
    const subscription = (_event: IpcRendererEvent, data: unknown) => {
      callback(data);
    };
    ipcRenderer.on(IpcChannels.QUOTA_UPDATED, subscription);
    return () => {
      ipcRenderer.removeListener(IpcChannels.QUOTA_UPDATED, subscription);
    };
  },

  // Switcher
  getAutoSwitchConfig: () =>
    ipcRenderer.invoke(IpcChannels.SWITCHER_GET_CONFIG),
  setAutoSwitchConfig: (config: Partial<AutoSwitchConfig>) =>
    ipcRenderer.invoke(IpcChannels.SWITCHER_SET_CONFIG, config),
  manualSwitchAccount: (accountId: string) =>
    ipcRenderer.invoke(IpcChannels.SWITCHER_MANUAL_TRIGGER, { accountId }),
  onSwitcherEvent: (callback: (event: unknown) => void) => {
    const subscription = (_event: IpcRendererEvent, event: unknown) => {
      callback(event);
    };
    ipcRenderer.on(IpcChannels.SWITCHER_EVENT, subscription);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SWITCHER_EVENT, subscription);
    };
  },

  // Rate Limiting
  getRateLimitStates: () =>
    ipcRenderer.invoke(IpcChannels.RATE_LIMIT_GET_STATES),
  clearRateLimit: (accountId: string) =>
    ipcRenderer.invoke(IpcChannels.RATE_LIMIT_CLEAR, { id: accountId }),

  // Snapshots
  listSnapshots: () => ipcRenderer.invoke(IpcChannels.SNAPSHOTS_LIST),
  createSnapshot: (params: { name: string; description?: string }) =>
    ipcRenderer.invoke(IpcChannels.SNAPSHOTS_CREATE, params),
  restoreSnapshot: (id: string) =>
    ipcRenderer.invoke(IpcChannels.SNAPSHOTS_RESTORE, { id }),
  deleteSnapshot: (id: string) =>
    ipcRenderer.invoke(IpcChannels.SNAPSHOTS_DELETE, { id }),

  // Relay Server
  getRelayStatus: () => ipcRenderer.invoke(IpcChannels.RELAY_GET_STATUS),
  startRelay: (config?: { port?: number; host?: string }) =>
    ipcRenderer.invoke(IpcChannels.RELAY_START, config),
  stopRelay: () => ipcRenderer.invoke(IpcChannels.RELAY_STOP),
  getRelaySessions: () => ipcRenderer.invoke(IpcChannels.RELAY_GET_SESSIONS),
  revokeRelaySession: (sessionId: string) =>
    ipcRenderer.invoke(IpcChannels.RELAY_REVOKE_SESSION, { sessionId }),
  onRelayStatusUpdated: (callback: (status: RelayServerStatus) => void) => {
    const subscription = (
      _event: IpcRendererEvent,
      status: RelayServerStatus,
    ) => {
      callback(status);
    };
    ipcRenderer.on(IpcChannels.RELAY_STATUS_UPDATED, subscription);
    return () => {
      ipcRenderer.removeListener(
        IpcChannels.RELAY_STATUS_UPDATED,
        subscription,
      );
    };
  },

  // Cloudflare Tunnel
  getTunnelStatus: () => ipcRenderer.invoke(IpcChannels.TUNNEL_GET_STATUS),
  startTunnel: (config?: Partial<TunnelConfig>) =>
    ipcRenderer.invoke(IpcChannels.TUNNEL_START, config ? { config } : {}),
  stopTunnel: () => ipcRenderer.invoke(IpcChannels.TUNNEL_STOP),
  getTunnelUrl: () => ipcRenderer.invoke(IpcChannels.TUNNEL_GET_URL),
  onTunnelStatusUpdated: (callback: (status: TunnelStatus) => void) => {
    const subscription = (_event: IpcRendererEvent, status: TunnelStatus) => {
      callback(status);
    };
    ipcRenderer.on(IpcChannels.TUNNEL_STATUS_UPDATED, subscription);
    return () => {
      ipcRenderer.removeListener(
        IpcChannels.TUNNEL_STATUS_UPDATED,
        subscription,
      );
    };
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, settings),
  resetSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_RESET),
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => {
    const subscription = (_event: IpcRendererEvent, settings: AppSettings) => {
      callback(settings);
    };
    ipcRenderer.on(IpcChannels.SETTINGS_UPDATED, subscription);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SETTINGS_UPDATED, subscription);
    };
  },

  // System Tray
  getTrayState: () => ipcRenderer.invoke(IpcChannels.TRAY_GET_STATE),
  updateTrayMenu: () => ipcRenderer.invoke(IpcChannels.TRAY_UPDATE_MENU),
  showWindow: () => ipcRenderer.invoke(IpcChannels.TRAY_SHOW_WINDOW),
  minimizeToTray: () => ipcRenderer.invoke(IpcChannels.TRAY_MINIMIZE_TO_TRAY),

  // Native Notifications
  sendNotification: (payload: NotificationPayload) =>
    ipcRenderer.invoke(IpcChannels.NOTIFICATIONS_SEND, payload),
  getNotificationPreferences: () =>
    ipcRenderer.invoke(IpcChannels.NOTIFICATIONS_GET_PREFERENCES),
  updateNotificationPreferences: (prefs: Partial<NotificationPreferences>) =>
    ipcRenderer.invoke(IpcChannels.NOTIFICATIONS_UPDATE_PREFERENCES, prefs),
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
