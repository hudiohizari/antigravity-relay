import { ipcMain, BrowserWindow, shell } from "electron";
import { z } from "zod";
import { IpcChannels, GoogleAccount, ServiceTarget } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { OAuthLoopbackServer, OAuthConfig } from "../oauth/oauth-server";
import { refreshTokenIfNeeded } from "../oauth/token-refresh";
import { ProcessController } from "../process/process-controller";

const AccountIdPayloadSchema = z.object({
  id: z.string().min(1, "Account identifier is required"),
});

const ServiceTargetPayloadSchema = z.object({
  target: z.enum(["antigravity_daemon", "antigravity_ide"]),
});

export interface RegisterIpcHandlersDependencies {
  accountStore: AccountStore;
  processController: ProcessController;
  oauthConfig: OAuthConfig;
  getMainWindow?: () => BrowserWindow | null;
}

export function registerIpcHandlers(
  deps: RegisterIpcHandlersDependencies,
): void {
  const { accountStore, processController, oauthConfig } = deps;
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

  // Listen to process controller status updates and forward to renderer
  processController.onStatusUpdated((status) => {
    const win = deps.getMainWindow ? deps.getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.SERVICES_STATUS_UPDATED, status);
    }
  });
}
