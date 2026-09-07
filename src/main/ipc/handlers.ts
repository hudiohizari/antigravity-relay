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

export interface RegisterIpcHandlersDependencies {
  accountStore: AccountStore;
  processController: ProcessController;
  oauthConfig: OAuthConfig;
  quotaMonitor?: QuotaMonitor;
  rateLimitTracker?: RateLimitTracker;
  autoSwitchService?: AutoSwitchService;
  switchFlow?: SwitchFlow;
  snapshotStore?: SnapshotStore;
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
    try {
      if (activeOAuthServer && activeOAuthServer.isInProgress()) {
        return {
          success: false,
          error: "An OAuth flow is already in progress",
        };
      }

      activeOAuthServer = new OAuthLoopbackServer(accountStore, oauthConfig);
      const account = await activeOAuthServer.startFlow({
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
      activeOAuthServer = null;
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
}
