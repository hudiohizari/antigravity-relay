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
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
