import { app, BrowserWindow } from "electron";
import path from "node:path";
import { AccountStore } from "./account-store/account-store";
import { ProcessController } from "./process/process-controller";
import { registerIpcHandlers } from "./ipc/handlers";
import { OAuthConfig } from "./oauth/oauth-server";
import { RateLimitTracker } from "./switcher/rate-limit-tracker";
import { QuotaMonitor } from "./quota/quota-monitor";
import { SwitchFlow } from "./switcher/switch-flow";
import { AutoSwitchService } from "./switcher/auto-switch.service";
import { SnapshotStore } from "./snapshots/snapshot-store";
import { RelayServer } from "./relay/relay-server";
import { TunnelManager } from "./tunnel/tunnel-manager";
import { SettingsStore } from "./settings/settings-store";
import { TrayManager } from "./tray/tray";
import { NativeNotifier } from "./notifications/notifier";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let processController: ProcessController | null = null;
let quotaMonitor: QuotaMonitor | null = null;
let relayServer: RelayServer | null = null;
let tunnelManager: TunnelManager | null = null;
let settingsStore: SettingsStore | null = null;
let trayManager: TrayManager | null = null;
let notifier: NativeNotifier | null = null;
let isQuitting = false;

async function performGracefulShutdown(): Promise<void> {
  isQuitting = true;
  if (processController) {
    processController.stopHeartbeat();
    try {
      await Promise.allSettled([
        processController.stopService("antigravity_daemon"),
        processController.stopService("antigravity_ide"),
      ]);
    } catch {
      // Suppress shutdown errors
    }
  }
  if (quotaMonitor) {
    quotaMonitor.stop();
  }
  if (relayServer) {
    try {
      await relayServer.stop();
    } catch {
      // Suppress shutdown errors
    }
  }
  if (tunnelManager) {
    try {
      await tunnelManager.stop();
    } catch {
      // Suppress shutdown errors
    }
  }
  if (trayManager) {
    trayManager.destroy();
  }
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 600,
    title: "Antigravity Relay",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (trayManager) {
    trayManager.setupCloseInterception(mainWindow);
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

app.whenReady().then(async () => {
  const storePath = path.join(app.getPath("userData"), "accounts.enc.json");
  const accountStore = new AccountStore({ storePath });

  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  settingsStore = new SettingsStore({ storePath: settingsPath });
  const appSettings = await settingsStore.get();

  processController = new ProcessController();
  processController.startHeartbeat(5000);

  const rateLimitTracker = new RateLimitTracker();
  quotaMonitor = new QuotaMonitor({
    accountStore,
    rateLimitTracker,
  });
  quotaMonitor.start();

  const switchFlow = new SwitchFlow({
    accountStore,
    processController,
  });

  const autoSwitchService = new AutoSwitchService({
    accountStore,
    rateLimitTracker,
    switchFlow,
  });

  const snapshotsDir = path.join(app.getPath("userData"), "snapshots");
  const snapshotStore = new SnapshotStore({
    snapshotsDir,
    accountStore,
    autoSwitchService,
  });

  const oauthConfig: OAuthConfig = {
    clientId:
      appSettings.oauth.clientId ||
      process.env.GOOGLE_CLIENT_ID ||
      "antigravity-relay.apps.googleusercontent.com",
    clientSecret:
      appSettings.oauth.clientSecret || process.env.GOOGLE_CLIENT_SECRET,
  };

  relayServer = new RelayServer({
    config: {
      port: appSettings.network.relayPort || 4040,
      host: appSettings.network.relayHost || "127.0.0.1",
    },
  });
  tunnelManager = new TunnelManager();

  notifier = new NativeNotifier({
    settingsStore,
    getMainWindow: () => mainWindow,
  });

  trayManager = new TrayManager({
    accountStore,
    processController,
    quotaMonitor,
    switchFlow,
    relayServer,
    settingsStore,
    getMainWindow: () => mainWindow,
    isQuitting: () => isQuitting,
    onQuit: async () => {
      await performGracefulShutdown();
    },
  });
  await trayManager.init();

  registerIpcHandlers({
    accountStore,
    processController,
    oauthConfig,
    quotaMonitor,
    rateLimitTracker,
    switchFlow,
    autoSwitchService,
    snapshotStore,
    relayServer,
    tunnelManager,
    settingsStore,
    trayManager,
    notifier,
    getMainWindow: () => mainWindow,
  });

  createWindow();

  app.on("activate", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  performGracefulShutdown().catch(() => {});
});
