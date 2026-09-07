import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import {
  IpcChannels,
  GoogleAccount,
  TokenData,
  ServiceTarget,
  DualServiceStatus,
  OAuthResult,
  ServiceActionResult,
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
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
