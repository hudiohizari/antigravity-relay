import {
  app,
  Tray,
  Menu,
  MenuItemConstructorOptions,
  BrowserWindow,
  nativeImage,
  NativeImage,
} from "electron";
import fs from "node:fs";
import { SystemTrayState } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { ProcessController } from "../process/process-controller";
import { QuotaMonitor } from "../quota/quota-monitor";
import { SwitchFlow } from "../switcher/switch-flow";
import { RelayServer } from "../relay/relay-server";
import { SettingsStore } from "../settings/settings-store";

export const DEFAULT_TRAY_ICON_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR42mNk+M9QzwAFjAwM/xkYGBgZGf+TrgEZjEaD0Wggj4aB0UBhNBp4owEAzrAIF9i5c8AAAAAASUVORK5CYII=";

export interface TrayManagerOptions {
  accountStore: AccountStore;
  processController: ProcessController;
  quotaMonitor?: QuotaMonitor;
  switchFlow?: SwitchFlow;
  relayServer?: RelayServer;
  settingsStore?: SettingsStore;
  getMainWindow: () => BrowserWindow | null;
  iconPath?: string;
  isQuitting?: () => boolean;
  onQuit?: () => void | Promise<void>;
}

export class TrayManager {
  private readonly options: TrayManagerOptions;
  private tray: Tray | null = null;
  private isQuittingFlag = false;
  private closeToTrayEnabled = true;
  private unsubscribers: Array<() => void> = [];

  constructor(options: TrayManagerOptions) {
    this.options = options;
  }

  public getTray(): Tray | null {
    return this.tray;
  }

  public isTrayCreated(): boolean {
    return this.tray !== null;
  }

  public setQuitting(quitting: boolean): void {
    this.isQuittingFlag = quitting;
  }

  public isQuitting(): boolean {
    return this.options.isQuitting
      ? this.options.isQuitting()
      : this.isQuittingFlag;
  }

  public setCloseToTrayEnabled(enabled: boolean): void {
    this.closeToTrayEnabled = enabled;
  }

  public async init(): Promise<void> {
    if (this.options.settingsStore) {
      try {
        const settings = await this.options.settingsStore.get();
        this.closeToTrayEnabled = settings.minimizeToTrayOnClose;
      } catch {
        this.closeToTrayEnabled = true;
      }

      const unsubSettings = this.options.settingsStore.onSettingsUpdated(
        (settings) => {
          this.closeToTrayEnabled = settings.minimizeToTrayOnClose;
          this.updateMenu().catch(() => {});
        },
      );
      this.unsubscribers.push(unsubSettings);
    }

    const unsubProcess = this.options.processController.onStatusUpdated(() => {
      this.updateMenu().catch(() => {});
    });
    this.unsubscribers.push(unsubProcess);

    if (this.options.switchFlow) {
      const unsubSwitch = this.options.switchFlow.onSwitchEvent(() => {
        this.updateMenu().catch(() => {});
      });
      this.unsubscribers.push(unsubSwitch);
    }

    if (this.options.quotaMonitor) {
      const unsubQuota = this.options.quotaMonitor.onQuotaUpdated(() => {
        this.updateMenu().catch(() => {});
      });
      this.unsubscribers.push(unsubQuota);
    }

    if (this.options.relayServer) {
      const unsubRelay = this.options.relayServer.onStatusUpdated(() => {
        this.updateMenu().catch(() => {});
      });
      this.unsubscribers.push(unsubRelay);
    }

    this.createTray();
    await this.updateMenu();
  }

  private resolveIcon(): NativeImage {
    if (this.options.iconPath && fs.existsSync(this.options.iconPath)) {
      return nativeImage.createFromPath(this.options.iconPath);
    }
    const img = nativeImage.createFromDataURL(DEFAULT_TRAY_ICON_BASE64);
    if (
      process.platform === "darwin" &&
      typeof img.setTemplateImage === "function"
    ) {
      img.setTemplateImage(true);
    }
    return img;
  }

  public createTray(): Tray {
    if (this.tray) {
      return this.tray;
    }

    const icon = this.resolveIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip("Antigravity Relay");
    this.tray.on("click", () => {
      this.showWindow();
    });

    return this.tray;
  }

  public async buildMenu(): Promise<Menu> {
    const serviceStatus = await this.options.processController.getStatus();
    const activeAccount = await this.options.accountStore.getActive();
    const accounts = await this.options.accountStore.getAll();

    const running = serviceStatus.runningCount;
    const total = serviceStatus.totalCount;
    const activeEmail = activeAccount ? activeAccount.email : null;

    const template: MenuItemConstructorOptions[] = [
      {
        label: "Antigravity Relay v1.0.0",
        enabled: false,
      },
      { type: "separator" },
      {
        label: `● Services: ${running}/${total} running`,
        enabled: false,
      },
      {
        label: activeEmail
          ? `👤 Active: ${activeEmail}`
          : "👤 No Active Account",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Switch Active Account",
        submenu:
          accounts.length === 0
            ? [{ label: "No accounts configured", enabled: false }]
            : accounts.map((acc) => ({
                label: acc.email,
                type: "checkbox" as const,
                checked: acc.id === activeAccount?.id,
                click: async () => {
                  if (acc.id === activeAccount?.id) return;
                  if (this.options.switchFlow) {
                    await this.options.switchFlow.executeSwitch(
                      acc.id,
                      "manual_request",
                    );
                  } else {
                    await this.options.accountStore.setActive(acc.id);
                  }
                  await this.updateMenu();
                },
              })),
      },
      {
        label: "Check Quota",
        click: async () => {
          if (this.options.quotaMonitor) {
            await this.options.quotaMonitor.pollAll();
          }
        },
      },
      {
        label: "Open Dashboard",
        click: () => {
          this.showWindow();
        },
      },
      { type: "separator" },
      {
        label: "Quit Antigravity Relay",
        click: async () => {
          await this.handleQuit();
        },
      },
    ];

    return Menu.buildFromTemplate(template);
  }

  public async updateMenu(): Promise<void> {
    if (!this.tray) {
      return;
    }
    const menu = await this.buildMenu();
    this.tray.setContextMenu(menu);
  }

  public showWindow(): void {
    const win = this.options.getMainWindow();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
    }
  }

  public minimizeToTray(): void {
    const win = this.options.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }

  public setupCloseInterception(
    mainWindow: BrowserWindow,
    shouldCloseToTray?: () => boolean,
  ): void {
    mainWindow.on("close", (event) => {
      const quitting = this.isQuitting();
      if (quitting) {
        return;
      }

      const closeToTray = shouldCloseToTray
        ? shouldCloseToTray()
        : this.closeToTrayEnabled;

      if (closeToTray) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  }

  public async handleQuit(): Promise<void> {
    this.isQuittingFlag = true;
    if (this.options.onQuit) {
      try {
        await this.options.onQuit();
      } catch {
        // Suppress onQuit errors during teardown
      }
    }
    app.quit();
  }

  public async getState(): Promise<SystemTrayState> {
    const active = await this.options.accountStore.getActive();
    const services = await this.options.processController.getStatus();
    const isBuffering = this.options.relayServer
      ? this.options.relayServer.getStatus().isBuffering
      : false;

    return {
      isVisible: this.tray !== null,
      activeAccountEmail: active?.email ?? null,
      serviceRunningCount: services.runningCount,
      totalServiceCount: services.totalCount,
      isBuffering,
      lastUpdated: Date.now(),
    };
  }

  public destroy(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore unsubscriber errors
      }
    }
    this.unsubscribers = [];

    if (this.tray) {
      try {
        this.tray.destroy();
      } catch {
        // Ignore destruction errors
      }
      this.tray = null;
    }
  }
}
