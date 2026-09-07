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

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let processController: ProcessController | null = null;
let quotaMonitor: QuotaMonitor | null = null;

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

app.whenReady().then(() => {
  const storePath = path.join(app.getPath("userData"), "accounts.enc.json");
  const accountStore = new AccountStore({ storePath });

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
      process.env.GOOGLE_CLIENT_ID ||
      "antigravity-relay.apps.googleusercontent.com",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };

  registerIpcHandlers({
    accountStore,
    processController,
    oauthConfig,
    quotaMonitor,
    rateLimitTracker,
    switchFlow,
    autoSwitchService,
    snapshotStore,
    getMainWindow: () => mainWindow,
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
  if (processController) {
    processController.stopHeartbeat();
  }
  if (quotaMonitor) {
    quotaMonitor.stop();
  }
});
