import { ipcRenderer, contextBridge, type IpcRendererEvent } from "electron";
import type { RendererPerformanceSnapshot } from "./modules/app-shell/performance-recorder/types";
import type {
  CloudAccountSwitchReason,
  CloudAccountSwitchSource,
} from "./modules/cloud-account/services/cloud-account-events";
import type { ChatResumptionStatusPayload } from "./modules/chat-resume/types";
import { IPC_CHANNELS } from "./shared/constants";

window.addEventListener("message", (event) => {
  if (event.data === IPC_CHANNELS.START_ORPC_SERVER) {
    const [serverPort] = event.ports;

    ipcRenderer.postMessage(IPC_CHANNELS.START_ORPC_SERVER, null, [serverPort]);
  }
});

const electronBridge = {
  onGoogleAuthCode: (callback: (code: string) => void) => {
    const handler = (_event: IpcRendererEvent, code: string) => callback(code);
    ipcRenderer.on("GOOGLE_AUTH_CODE", handler);
    return () => ipcRenderer.off("GOOGLE_AUTH_CODE", handler);
  },
  changeLanguage: (lang: string) => {
    ipcRenderer.send(IPC_CHANNELS.CHANGE_LANGUAGE, lang);
  },
  onManualUpdateAvailable: (callback: (update: ManualUpdateInfo) => void) => {
    const handler = (_event: IpcRendererEvent, update: ManualUpdateInfo) =>
      callback(update);
    ipcRenderer.on(IPC_CHANNELS.MANUAL_UPDATE_AVAILABLE, handler);
    ipcRenderer.send(IPC_CHANNELS.MANUAL_UPDATE_RENDERER_READY);
    return () => ipcRenderer.off(IPC_CHANNELS.MANUAL_UPDATE_AVAILABLE, handler);
  },
  onAccountSwitched: (
    callback: (
      payload:
        | string
        | {
            accountId: string;
            target?: "app" | "classic" | "ide" | "agy" | "cli" | "all";
            source?: CloudAccountSwitchSource;
            reason?: CloudAccountSwitchReason;
          },
    ) => void,
  ) => {
    const handler = (
      _event: IpcRendererEvent,
      payload:
        | string
        | {
            accountId: string;
            target?: "app" | "classic" | "ide" | "agy" | "cli" | "all";
            source?: CloudAccountSwitchSource;
            reason?: CloudAccountSwitchReason;
          },
    ) => callback(payload);
    ipcRenderer.on("tray://account-switched", handler);
    ipcRenderer.on("account-switched", handler);
    return () => {
      ipcRenderer.off("tray://account-switched", handler);
      ipcRenderer.off("account-switched", handler);
    };
  },
  onAccountsUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("tray://accounts-updated", handler);
    ipcRenderer.on("tray://refresh-current", handler);
    ipcRenderer.on("accounts-updated", handler);
    return () => {
      ipcRenderer.off("tray://accounts-updated", handler);
      ipcRenderer.off("tray://refresh-current", handler);
      ipcRenderer.off("accounts-updated", handler);
    };
  },
  onChatResumptionStatus: (
    callback: (payload: ChatResumptionStatusPayload) => void,
  ) => {
    const handler = (
      _event: IpcRendererEvent,
      payload: ChatResumptionStatusPayload,
    ) => callback(payload);
    ipcRenderer.on("chat-session:resumption-status", handler);
    return () => ipcRenderer.off("chat-session:resumption-status", handler);
  },
  checkForUpdates: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.CHECK_FOR_UPDATES);
  },
  downloadUpdate: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_UPDATE);
  },
  installUpdate: () => {
    return ipcRenderer.invoke(IPC_CHANNELS.INSTALL_UPDATE);
  },
  dismissManualUpdate: (version: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.DISMISS_MANUAL_UPDATE, version);
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url);
  },
  ...(import.meta.env.ANTIGRAVITY_ENABLE_PERFORMANCE_RECORDER === "1"
    ? {
        startPerformanceRecording: (label: string) => {
          return ipcRenderer.invoke(
            IPC_CHANNELS.START_PERFORMANCE_RECORDING,
            label,
          );
        },
        stopPerformanceRecording: (snapshot: RendererPerformanceSnapshot) => {
          return ipcRenderer.invoke(
            IPC_CHANNELS.STOP_PERFORMANCE_RECORDING,
            snapshot,
          );
        },
      }
    : {}),
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronBridge);
} else {
  window.electron = electronBridge;
}
