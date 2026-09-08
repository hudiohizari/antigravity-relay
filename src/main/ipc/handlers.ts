import { ipcMain, BrowserWindow, shell } from "electron";
import path from "node:path";
import { z } from "zod";
import { IpcChannels, GoogleAccount, ServiceTarget } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { OAuthLoopbackServer, OAuthConfig } from "../oauth/oauth-server";
import { refreshTokenIfNeeded } from "../oauth/token-refresh";
import { ProcessController } from "../process/process-controller";
import { QuotaMonitor } from "../quota/quota-monitor";
import { RateLimitTracker } from "../switcher/rate-limit-tracker";
import { AutoSwitchService } from "../switcher/auto-switch.service";
import { SwitchFlow } from "../switcher/switch-flow";
import { SnapshotStore } from "../snapshots/snapshot-store";
import { RelayServer } from "../relay/relay-server";
import { TunnelManager } from "../tunnel/tunnel-manager";
import { SettingsStore } from "../settings/settings-store";
import {
  PartialAppSettingsSchema,
  NotificationPreferencesSchema,
} from "../settings/types";
import { TrayManager } from "../tray/tray";
import {
  NativeNotifier,
  NotificationPayloadSchema,
} from "../notifications/notifier";

const AccountIdPayloadSchema = z.object({
  id: z.string().min(1, "Account identifier is required"),
});

const ServiceTargetPayloadSchema = z.object({
  target: z.enum(["antigravity_daemon", "antigravity_ide"]),
});

const QuotaPollAccountPayloadSchema = z.object({
  accountId: z.string().min(1, "Account identifier is required"),
});

const SwitcherSetConfigPayloadSchema = z.object({
  enabled: z.boolean().optional(),
  minQuotaThresholdPercent: z.number().min(0).max(100).optional(),
  pollIntervalMs: z.number().positive().optional(),
  rateLimitCooldownMs: z.number().positive().optional(),
  autoRelaunchProcesses: z.boolean().optional(),
  preferredModels: z.array(z.string()).optional(),
});

const SwitcherManualTriggerPayloadSchema = z.object({
  accountId: z.string().min(1, "Account identifier is required"),
});

const CreateSnapshotPayloadSchema = z.object({
  name: z.string().min(1, "Snapshot name is required"),
  description: z.string().optional(),
});

const SnapshotIdPayloadSchema = z.object({
  id: z.string().min(1, "Snapshot ID is required"),
});

const RelayStartPayloadSchema = z
  .object({
    port: z.number().int().min(1).max(65535).optional(),
    host: z.string().optional(),
  })
  .optional();

const SessionIdPayloadSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
});

const TunnelStartPayloadSchema = z
  .object({
    config: z.record(z.unknown()).optional(),
  })
  .optional();

export interface RegisterIpcHandlersDependencies {
  accountStore: AccountStore;
  processController: ProcessController;
  oauthConfig: OAuthConfig;
  quotaMonitor?: QuotaMonitor;
  rateLimitTracker?: RateLimitTracker;
  autoSwitchService?: AutoSwitchService;
  switchFlow?: SwitchFlow;
  snapshotStore?: SnapshotStore;
  relayServer?: RelayServer;
  tunnelManager?: TunnelManager;
  settingsStore?: SettingsStore;
  trayManager?: TrayManager;
  notifier?: NativeNotifier;
  getMainWindow?: () => BrowserWindow | null;
}

export function registerIpcHandlers(
  deps: RegisterIpcHandlersDependencies,
): void {
  const { accountStore, processController, oauthConfig } = deps;
  const rateLimitTracker = deps.rateLimitTracker || new RateLimitTracker();
  const quotaMonitor =
    deps.quotaMonitor || new QuotaMonitor({ accountStore, rateLimitTracker });
  const switchFlow =
    deps.switchFlow || new SwitchFlow({ accountStore, processController });
  const autoSwitchService =
    deps.autoSwitchService ||
    new AutoSwitchService({ accountStore, rateLimitTracker, switchFlow });
  const snapshotStore =
    deps.snapshotStore ||
    new SnapshotStore({
      snapshotsDir: path.join(
        path.dirname(accountStore.getStorePath()),
        "snapshots",
      ),
      accountStore,
      autoSwitchService,
    });
  const relayServer = deps.relayServer || new RelayServer();
  const tunnelManager = deps.tunnelManager || new TunnelManager();
  const settingsStore =
    deps.settingsStore ||
    new SettingsStore({
      storePath: path.join(
        path.dirname(accountStore.getStorePath()),
        "settings.json",
      ),
    });
  const notifier =
    deps.notifier ||
    new NativeNotifier({
      settingsStore,
      getMainWindow: deps.getMainWindow,
    });
  const trayManager = deps.trayManager;

  // Wire SwitchFlow hook to UpstreamBridge
  relayServer.getUpstreamBridge().hookSwitchFlow(switchFlow);

  let activeOAuthServer: OAuthLoopbackServer | null = null;

  // 1. accounts:get-all
  ipcMain.handle(
    IpcChannels.ACCOUNTS_GET_ALL,
    async (): Promise<GoogleAccount[]> => {
      return accountStore.getAll();
    },
  );

  // 2. accounts:initiate-oauth
  ipcMain.handle(IpcChannels.ACCOUNTS_INITIATE_OAUTH, async () => {
    let currentServer: OAuthLoopbackServer | null = null;
    try {
      if (activeOAuthServer && activeOAuthServer.isInProgress()) {
        activeOAuthServer.cancel("Superseded by new OAuth flow");
      }

      currentServer = new OAuthLoopbackServer(accountStore, oauthConfig);
      activeOAuthServer = currentServer;

      const account = await currentServer.startFlow({
        openBrowser: (url) => shell.openExternal(url),
      });

      return {
        success: true,
        account,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
      };
    } finally {
      if (activeOAuthServer === currentServer) {
        activeOAuthServer = null;
      }
    }
  });

  // 3. accounts:delete
  ipcMain.handle(
    IpcChannels.ACCOUNTS_DELETE,
    async (_event, rawPayload: unknown) => {
      const parseResult = AccountIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const deleted = await accountStore.delete(parseResult.data.id);
        return { success: deleted };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  );

  // 4. accounts:refresh-token
  ipcMain.handle(
    IpcChannels.ACCOUNTS_REFRESH_TOKEN,
    async (_event, rawPayload: unknown) => {
      const parseResult = AccountIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const account = await accountStore.get(parseResult.data.id);
        if (!account) {
          return {
            success: false,
            error: `Account not found with ID ${parseResult.data.id}`,
          };
        }

        const result = await refreshTokenIfNeeded(
          account,
          accountStore,
          oauthConfig,
          {
            force: true,
          },
        );

        return {
          success: true,
          token: result.token,
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  );

  // 5. accounts:set-active
  ipcMain.handle(
    IpcChannels.ACCOUNTS_SET_ACTIVE,
    async (_event, rawPayload: unknown) => {
      const parseResult = AccountIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const updated = await accountStore.setActive(parseResult.data.id);
        return { success: updated };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  );

  // 6. services:get-status
  ipcMain.handle(IpcChannels.SERVICES_GET_STATUS, async () => {
    return processController.getStatus();
  });

  // 7. services:start
  ipcMain.handle(
    IpcChannels.SERVICES_START,
    async (_event, rawPayload: unknown) => {
      const parseResult = ServiceTargetPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const processInfo = await processController.startService(
          parseResult.data.target as ServiceTarget,
        );
        return {
          success: processInfo.state === "running",
          process: processInfo,
          error: processInfo.errorMessage,
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  );

  // 8. services:stop
  ipcMain.handle(
    IpcChannels.SERVICES_STOP,
    async (_event, rawPayload: unknown) => {
      const parseResult = ServiceTargetPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const processInfo = await processController.stopService(
          parseResult.data.target as ServiceTarget,
        );
        return {
          success: processInfo.state === "stopped",
          process: processInfo,
          error: processInfo.errorMessage,
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
        };
      }
    },
  );

  // 9. quota:poll-all
  ipcMain.handle(IpcChannels.QUOTA_POLL_ALL, async () => {
    try {
      const results = await quotaMonitor.pollAll();
      return { success: true, data: results };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 10. quota:poll-account
  ipcMain.handle(
    IpcChannels.QUOTA_POLL_ACCOUNT,
    async (_event, rawPayload: unknown) => {
      const parseResult = QuotaPollAccountPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const result = await quotaMonitor.pollAccount(
          parseResult.data.accountId,
        );
        return {
          success: result.success,
          data: result,
          error: result.error,
        };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 11. switcher:get-config
  ipcMain.handle(IpcChannels.SWITCHER_GET_CONFIG, async () => {
    try {
      const config = autoSwitchService.getConfig();
      return { success: true, data: config };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 12. switcher:set-config
  ipcMain.handle(
    IpcChannels.SWITCHER_SET_CONFIG,
    async (_event, rawPayload: unknown) => {
      const parseResult = SwitcherSetConfigPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const updated = autoSwitchService.setConfig(parseResult.data);
        if (parseResult.data.pollIntervalMs) {
          quotaMonitor.setInterval(parseResult.data.pollIntervalMs);
        }
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 13. switcher:manual-trigger
  ipcMain.handle(
    IpcChannels.SWITCHER_MANUAL_TRIGGER,
    async (_event, rawPayload: unknown) => {
      const parseResult =
        SwitcherManualTriggerPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const result = await switchFlow.executeSwitch(
          parseResult.data.accountId,
          "manual_request",
        );
        return { success: result.success, data: result };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 14. rate-limit:get-states
  ipcMain.handle(IpcChannels.RATE_LIMIT_GET_STATES, async () => {
    try {
      const states = rateLimitTracker.getAllStates();
      return { success: true, data: states };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 15. rate-limit:clear
  ipcMain.handle(
    IpcChannels.RATE_LIMIT_CLEAR,
    async (_event, rawPayload: unknown) => {
      const parseResult = AccountIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        rateLimitTracker.clearRateLimit(parseResult.data.id);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 16. snapshots:list
  ipcMain.handle(IpcChannels.SNAPSHOTS_LIST, async () => {
    try {
      const snapshots = await snapshotStore.listSnapshots();
      return { success: true, data: snapshots };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 17. snapshots:create
  ipcMain.handle(
    IpcChannels.SNAPSHOTS_CREATE,
    async (_event, rawPayload: unknown) => {
      const parseResult = CreateSnapshotPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const metadata = await snapshotStore.createSnapshot({
          name: parseResult.data.name,
          description: parseResult.data.description,
        });
        return { success: true, data: metadata };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 18. snapshots:restore
  ipcMain.handle(
    IpcChannels.SNAPSHOTS_RESTORE,
    async (_event, rawPayload: unknown) => {
      const parseResult = SnapshotIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const result = await snapshotStore.restoreSnapshot(parseResult.data.id);
        return { success: result.success, accountCount: result.accountCount };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 19. snapshots:delete
  ipcMain.handle(
    IpcChannels.SNAPSHOTS_DELETE,
    async (_event, rawPayload: unknown) => {
      const parseResult = SnapshotIdPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const deleted = await snapshotStore.deleteSnapshot(parseResult.data.id);
        return { success: deleted };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // Listen to process controller status updates and forward to renderer
  processController.onStatusUpdated((status) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.SERVICES_STATUS_UPDATED, status);
    }
  });

  // Listen to quota updates and forward to renderer
  quotaMonitor.onQuotaUpdated((data) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.QUOTA_UPDATED, data);
    }
  });

  // Listen to switch events and forward to renderer
  switchFlow.onSwitchEvent((result) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.SWITCHER_EVENT, result);
    }
  });

  // Listen to pool exhaustion events and forward to renderer
  autoSwitchService.onPoolExhausted((info) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.SWITCHER_EVENT, {
        type: "pool_exhausted",
        ...info,
      });
    }
  });

  // --- Relay Server IPC Channels ---

  // 20. relay:get-status
  ipcMain.handle(IpcChannels.RELAY_GET_STATUS, async () => {
    return relayServer.getStatus();
  });

  // 21. relay:start
  ipcMain.handle(
    IpcChannels.RELAY_START,
    async (_event, rawPayload: unknown) => {
      const parseResult = RelayStartPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const status = await relayServer.start(parseResult.data);
        return { success: true, data: status };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 22. relay:stop
  ipcMain.handle(IpcChannels.RELAY_STOP, async () => {
    try {
      await relayServer.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 23. relay:get-sessions & sessions:get-active
  const handleGetSessions = async () => {
    return relayServer.getSessionManager().getActiveSessions();
  };
  ipcMain.handle(IpcChannels.RELAY_GET_SESSIONS, handleGetSessions);
  ipcMain.handle(IpcChannels.SESSIONS_GET_ACTIVE, handleGetSessions);

  // 24. relay:revoke-session & sessions:revoke
  const handleRevokeSession = async (_event: unknown, rawPayload: unknown) => {
    const parseResult = SessionIdPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      return {
        success: false,
        error: parseResult.error.errors.map((e) => e.message).join(", "),
      };
    }

    try {
      const revoked = relayServer
        .getSessionManager()
        .revokeSession(parseResult.data.sessionId);
      return { success: revoked };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  };
  ipcMain.handle(IpcChannels.RELAY_REVOKE_SESSION, handleRevokeSession);
  ipcMain.handle(IpcChannels.SESSIONS_REVOKE, handleRevokeSession);

  // --- Cloudflare Tunnel IPC Channels ---

  // 25. tunnel:get-status
  ipcMain.handle(IpcChannels.TUNNEL_GET_STATUS, async () => {
    return tunnelManager.getStatus();
  });

  // 26. tunnel:start
  ipcMain.handle(
    IpcChannels.TUNNEL_START,
    async (_event, rawPayload: unknown) => {
      const parseResult = TunnelStartPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const status = await tunnelManager.start(
          parseResult.data?.config as any,
        );
        return { success: true, data: status };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 27. tunnel:stop
  ipcMain.handle(IpcChannels.TUNNEL_STOP, async () => {
    try {
      await tunnelManager.stop();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 28. tunnel:get-url
  ipcMain.handle(IpcChannels.TUNNEL_GET_URL, async () => {
    return { publicUrl: tunnelManager.getPublicUrl() };
  });

  // Listen to relay server status updates and forward to renderer
  relayServer.onStatusUpdated((status) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.RELAY_STATUS_UPDATED, status);
    }
  });

  // Listen to tunnel status updates and forward to renderer
  tunnelManager.onStatusUpdated((status) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.TUNNEL_STATUS_UPDATED, status);
    }
  });

  // --- Settings IPC Channels ---

  // 29. settings:get
  ipcMain.handle(IpcChannels.SETTINGS_GET, async () => {
    try {
      const settings = await settingsStore.get();
      return { success: true, data: settings };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 30. settings:update
  ipcMain.handle(
    IpcChannels.SETTINGS_UPDATE,
    async (_event, rawPayload: unknown) => {
      const parseResult = PartialAppSettingsSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const updated = await settingsStore.update(parseResult.data);

        // Reconcile runtime managers if credentials changed
        if (parseResult.data.oauth) {
          if (parseResult.data.oauth.clientId) {
            oauthConfig.clientId = parseResult.data.oauth.clientId;
          }
          if (parseResult.data.oauth.clientSecret !== undefined) {
            oauthConfig.clientSecret = parseResult.data.oauth.clientSecret;
          }
        }

        const win = deps.getMainWindow ? deps.getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.SETTINGS_UPDATED, updated);
        }

        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 31. settings:reset
  ipcMain.handle(IpcChannels.SETTINGS_RESET, async () => {
    try {
      const resetSettings = await settingsStore.reset();
      const win = deps.getMainWindow ? deps.getMainWindow() : null;
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.SETTINGS_UPDATED, resetSettings);
      }
      return { success: true, data: resetSettings };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // --- System Tray IPC Channels ---

  // 32. tray:get-state
  ipcMain.handle(IpcChannels.TRAY_GET_STATE, async () => {
    try {
      if (trayManager) {
        const state = await trayManager.getState();
        return { success: true, data: state };
      }
      const active = await accountStore.getActive();
      const services = await processController.getStatus();
      return {
        success: true,
        data: {
          isVisible: false,
          activeAccountEmail: active?.email ?? null,
          serviceRunningCount: services.runningCount,
          totalServiceCount: services.totalCount,
          isBuffering: relayServer.getStatus().isBuffering,
          lastUpdated: Date.now(),
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 33. tray:update-menu
  ipcMain.handle(IpcChannels.TRAY_UPDATE_MENU, async () => {
    try {
      if (trayManager) {
        await trayManager.updateMenu();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 34. tray:show-window
  ipcMain.handle(IpcChannels.TRAY_SHOW_WINDOW, async () => {
    try {
      if (trayManager) {
        trayManager.showWindow();
      } else {
        const win = deps.getMainWindow ? deps.getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 35. tray:minimize-to-tray
  ipcMain.handle(IpcChannels.TRAY_MINIMIZE_TO_TRAY, async () => {
    try {
      if (trayManager) {
        trayManager.minimizeToTray();
      } else {
        const win = deps.getMainWindow ? deps.getMainWindow() : null;
        if (win && !win.isDestroyed()) {
          win.hide();
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // --- Native Desktop Notification IPC Channels ---

  // 36. notifications:send
  ipcMain.handle(
    IpcChannels.NOTIFICATIONS_SEND,
    async (_event, rawPayload: unknown) => {
      const parseResult = NotificationPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const dispatched = await notifier.send(parseResult.data);
        return { success: dispatched };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // 37. notifications:get-preferences
  ipcMain.handle(IpcChannels.NOTIFICATIONS_GET_PREFERENCES, async () => {
    try {
      const prefs = await notifier.getPreferences();
      return { success: true, data: prefs };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // 38. notifications:update-preferences
  ipcMain.handle(
    IpcChannels.NOTIFICATIONS_UPDATE_PREFERENCES,
    async (_event, rawPayload: unknown) => {
      const parseResult =
        NotificationPreferencesSchema.partial().safeParse(rawPayload);
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error.errors.map((e) => e.message).join(", "),
        };
      }

      try {
        const updated = await notifier.updatePreferences(parseResult.data);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // --- Background Service Hooks for Notifications & Tray ---
  switchFlow.onSwitchEvent((result) => {
    if (result.success) {
      notifier
        .notifyAccountSwitched(result.previousAccountId, result.newAccountEmail)
        .catch(() => {});
      if (trayManager) {
        trayManager.updateMenu().catch(() => {});
      }
    }
  });

  processController.onStatusUpdated((status) => {
    for (const info of Object.values(status.services)) {
      if (info.state === "error") {
        notifier
          .notifyServiceCrash(info.displayName, info.errorMessage)
          .catch(() => {});
      }
    }
    if (trayManager) {
      trayManager.updateMenu().catch(() => {});
    }
  });
}
