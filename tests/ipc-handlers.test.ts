import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AccountStore } from "../src/main/account-store/account-store";
import {
  ProcessController,
  ProcessSystemInterface,
} from "../src/main/process/process-controller";
import {
  OAuthConfig,
  OAuthLoopbackServer,
} from "../src/main/oauth/oauth-server";
import { registerIpcHandlers } from "../src/main/ipc/handlers";
import { IpcChannels } from "../src/main/ipc/channels";
import { GoogleAccount, DualServiceStatus } from "../src/shared/types";
import * as tokenRefreshModule from "../src/main/oauth/token-refresh";

// Mock Electron ipcMain and shell
const registeredHandlers = new Map<
  string,
  (event: any, ...args: any[]) => Promise<any>
>();

vi.mock("electron", () => {
  return {
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          handler: (event: any, ...args: any[]) => Promise<any>,
        ) => {
          registeredHandlers.set(channel, handler);
        },
      ),
    },
    BrowserWindow: vi.fn(),
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  };
});

class MockProcessSystem implements ProcessSystemInterface {
  public processes: Array<{ pid: number; command: string }> = [];
  public async getRunningProcesses() {
    return [...this.processes];
  }
  public async killPid(pid: number) {
    this.processes = this.processes.filter((p) => p.pid !== pid);
  }
  public async spawnProcess(cmd: string) {
    const pid = 1234;
    this.processes.push({ pid, command: cmd });
    return pid;
  }
}

describe("IPC Boundary and Handler Verification", () => {
  let tempDir: string;
  let storeFile: string;
  let accountStore: AccountStore;
  let processController: ProcessController;
  let mockWin: any;

  const mockOAuthConfig: OAuthConfig = {
    clientId: "ipc-test-client-id",
    clientSecret: "ipc-test-secret",
  };

  beforeEach(async () => {
    registeredHandlers.clear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");

    accountStore = new AccountStore({
      storePath: storeFile,
      machineId: "ipc-test-machine",
    });

    processController = new ProcessController({
      system: new MockProcessSystem(),
      killTimeoutMs: 100,
    });

    mockWin = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn(),
      },
    };

    registerIpcHandlers({
      accountStore,
      processController,
      oauthConfig: mockOAuthConfig,
      getMainWindow: () => mockWin,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it("should register all 8 expected IPC invoke channels", () => {
    expect(registeredHandlers.has(IpcChannels.ACCOUNTS_GET_ALL)).toBe(true);
    expect(registeredHandlers.has(IpcChannels.ACCOUNTS_INITIATE_OAUTH)).toBe(
      true,
    );
    expect(registeredHandlers.has(IpcChannels.ACCOUNTS_DELETE)).toBe(true);
    expect(registeredHandlers.has(IpcChannels.ACCOUNTS_REFRESH_TOKEN)).toBe(
      true,
    );
    expect(registeredHandlers.has(IpcChannels.ACCOUNTS_SET_ACTIVE)).toBe(true);
    expect(registeredHandlers.has(IpcChannels.SERVICES_GET_STATUS)).toBe(true);
    expect(registeredHandlers.has(IpcChannels.SERVICES_START)).toBe(true);
    expect(registeredHandlers.has(IpcChannels.SERVICES_STOP)).toBe(true);
  });

  describe("accounts:get-all channel", () => {
    it("should return empty list when no accounts saved", async () => {
      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_GET_ALL)!;
      const result = await handler({});
      expect(result).toEqual([]);
    });

    it("should return saved accounts", async () => {
      const account: GoogleAccount = {
        id: "acc-ipc-1",
        email: "ipc1@test.com",
        status: "active",
        tokens: {
          access_token: "tok-1",
          refresh_token: "ref-1",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await accountStore.saveAccount(account);

      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_GET_ALL)!;
      const result = await handler({});
      expect(result.length).toBe(1);
      expect(result[0].email).toBe("ipc1@test.com");
    });
  });

  describe("accounts:initiate-oauth channel", () => {
    it("should initiate oauth flow and return account on success and trigger openBrowser", async () => {
      const mockAccount: GoogleAccount = {
        id: "oauth-user-1",
        email: "oauth@test.com",
        status: "active",
        tokens: {
          access_token: "access-token-oauth",
          refresh_token: "refresh-token-oauth",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      vi.spyOn(OAuthLoopbackServer.prototype, "startFlow").mockImplementation(
        async (opts) => {
          if (opts?.openBrowser) {
            await opts.openBrowser(
              "https://accounts.google.com/o/oauth2/v2/auth",
            );
          }
          return mockAccount;
        },
      );

      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_INITIATE_OAUTH,
      )!;
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.account?.email).toBe("oauth@test.com");
      vi.restoreAllMocks();
    });

    it("should reject concurrent OAuth flow invocation when one is already in progress", async () => {
      let releaseFlow: () => void = () => {};
      const pendingFlow = new Promise<GoogleAccount>((resolve) => {
        releaseFlow = () =>
          resolve({
            id: "oauth-concurrent",
            email: "concurrent@test.com",
            status: "active",
            tokens: {
              access_token: "tok",
              refresh_token: "ref",
              expires_in: 3600,
              expiry_timestamp: Date.now() + 3600000,
              token_type: "Bearer",
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
      });

      vi.spyOn(OAuthLoopbackServer.prototype, "startFlow").mockImplementation(
        async () => {
          return pendingFlow;
        },
      );
      vi.spyOn(OAuthLoopbackServer.prototype, "isInProgress").mockReturnValue(
        true,
      );

      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_INITIATE_OAUTH,
      )!;

      const firstCallPromise = handler({});
      // Call again while first is in flight
      const secondCallResult = await handler({});

      expect(secondCallResult.success).toBe(false);
      expect(secondCallResult.error).toBe(
        "An OAuth flow is already in progress",
      );

      releaseFlow();
      const firstCallResult = await firstCallPromise;
      expect(firstCallResult.success).toBe(true);

      vi.restoreAllMocks();
    });

    it("should handle error thrown during oauth flow", async () => {
      vi.spyOn(OAuthLoopbackServer.prototype, "startFlow").mockRejectedValue(
        new Error("Flow failed"),
      );

      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_INITIATE_OAUTH,
      )!;
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Flow failed");
      vi.restoreAllMocks();
    });
  });

  describe("accounts:delete channel", () => {
    it("should reject payload failing Zod schema", async () => {
      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_DELETE)!;

      const emptyResult = await handler({}, {});
      expect(emptyResult.success).toBe(false);
      expect(emptyResult.error).toBeDefined();

      const invalidTypeResult = await handler({}, { id: "" });
      expect(invalidTypeResult.success).toBe(false);
      expect(invalidTypeResult.error).toContain(
        "Account identifier is required",
      );
    });

    it("should delete existing account and return true", async () => {
      const account: GoogleAccount = {
        id: "acc-to-delete",
        email: "delete-me@test.com",
        status: "active",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await accountStore.saveAccount(account);

      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_DELETE)!;
      const result = await handler({}, { id: "acc-to-delete" });
      expect(result.success).toBe(true);

      const after = await accountStore.get("acc-to-delete");
      expect(after).toBeNull();
    });

    it("should handle error when store.delete throws", async () => {
      vi.spyOn(accountStore, "delete").mockRejectedValue(
        new Error("Disk failure"),
      );

      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_DELETE)!;
      const result = await handler({}, { id: "some-id" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Disk failure");
      vi.restoreAllMocks();
    });
  });

  describe("accounts:set-active channel", () => {
    it("should reject invalid schema payload", async () => {
      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_SET_ACTIVE)!;
      const result = await handler({}, { id: 123 });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should set active account for existing ID", async () => {
      const account: GoogleAccount = {
        id: "acc-active-target",
        email: "active@test.com",
        status: "active",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await accountStore.saveAccount(account);

      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_SET_ACTIVE)!;
      const result = await handler({}, { id: "acc-active-target" });
      expect(result.success).toBe(true);

      const active = await accountStore.getActive();
      expect(active?.id).toBe("acc-active-target");
    });

    it("should handle error when store.setActive throws", async () => {
      vi.spyOn(accountStore, "setActive").mockRejectedValue(
        new Error("Active failure"),
      );

      const handler = registeredHandlers.get(IpcChannels.ACCOUNTS_SET_ACTIVE)!;
      const result = await handler({}, { id: "some-id" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Active failure");
      vi.restoreAllMocks();
    });
  });

  describe("accounts:refresh-token channel", () => {
    it("should return error if account does not exist", async () => {
      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_REFRESH_TOKEN,
      )!;
      const result = await handler({}, { id: "non-existent-account" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Account not found");
    });

    it("should reject invalid payload schema", async () => {
      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_REFRESH_TOKEN,
      )!;
      const result = await handler({}, null);
      expect(result.success).toBe(false);
    });

    it("should successfully refresh token and return updated tokens", async () => {
      const account: GoogleAccount = {
        id: "acc-refresh-target",
        email: "refresh@test.com",
        status: "active",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await accountStore.saveAccount(account);

      vi.spyOn(tokenRefreshModule, "refreshTokenIfNeeded").mockResolvedValue({
        refreshed: true,
        token: {
          ...account.tokens,
          access_token: "brand-new-access-token",
        },
      });

      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_REFRESH_TOKEN,
      )!;
      const result = await handler({}, { id: "acc-refresh-target" });

      expect(result.success).toBe(true);
      expect(result.token?.access_token).toBe("brand-new-access-token");
      vi.restoreAllMocks();
    });

    it("should handle error when refreshTokenIfNeeded throws", async () => {
      const account: GoogleAccount = {
        id: "acc-fail-refresh",
        email: "fail@test.com",
        status: "active",
        tokens: {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await accountStore.saveAccount(account);

      vi.spyOn(tokenRefreshModule, "refreshTokenIfNeeded").mockRejectedValue(
        new Error("Network unreachable"),
      );

      const handler = registeredHandlers.get(
        IpcChannels.ACCOUNTS_REFRESH_TOKEN,
      )!;
      const result = await handler({}, { id: "acc-fail-refresh" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network unreachable");
      vi.restoreAllMocks();
    });
  });

  describe("services:get-status, services:start and services:stop channels", () => {
    it("should return current service status", async () => {
      const handler = registeredHandlers.get(IpcChannels.SERVICES_GET_STATUS)!;
      const status: DualServiceStatus = await handler({});
      expect(status.services.antigravity_daemon).toBeDefined();
      expect(status.services.antigravity_ide).toBeDefined();
      expect(status.totalCount).toBe(2);
    });

    it("should reject invalid service target enum on start and stop", async () => {
      const startHandler = registeredHandlers.get(IpcChannels.SERVICES_START)!;
      const stopHandler = registeredHandlers.get(IpcChannels.SERVICES_STOP)!;

      const invalidStart = await startHandler(
        {},
        { target: "invalid_service" },
      );
      expect(invalidStart.success).toBe(false);
      expect(invalidStart.error).toBeDefined();

      const invalidStop = await stopHandler({}, { target: "invalid_service" });
      expect(invalidStop.success).toBe(false);
      expect(invalidStop.error).toBeDefined();
    });

    it("should start service successfully", async () => {
      vi.spyOn(processController, "startService").mockResolvedValue({
        target: "antigravity_daemon",
        displayName: "Antigravity",
        binaryName: "agy",
        state: "running",
        pids: [2001],
        mainPid: 2001,
        uptimeSeconds: 0,
        lastCheckedAt: Date.now(),
      });

      const startHandler = registeredHandlers.get(IpcChannels.SERVICES_START)!;
      const result = await startHandler({}, { target: "antigravity_daemon" });

      expect(result.success).toBe(true);
      expect(result.process.state).toBe("running");
      vi.restoreAllMocks();
    });

    it("should handle error when processController.startService throws", async () => {
      vi.spyOn(processController, "startService").mockRejectedValue(
        new Error("Spawn error"),
      );

      const startHandler = registeredHandlers.get(IpcChannels.SERVICES_START)!;
      const result = await startHandler({}, { target: "antigravity_daemon" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Spawn error");
      vi.restoreAllMocks();
    });

    it("should stop running service successfully", async () => {
      const stopHandler = registeredHandlers.get(IpcChannels.SERVICES_STOP)!;
      const result = await stopHandler({}, { target: "antigravity_daemon" });
      expect(result.success).toBe(true);
      expect(result.process.state).toBe("stopped");
    });

    it("should handle error when processController.stopService throws", async () => {
      vi.spyOn(processController, "stopService").mockRejectedValue(
        new Error("Stop error"),
      );

      const stopHandler = registeredHandlers.get(IpcChannels.SERVICES_STOP)!;
      const result = await stopHandler({}, { target: "antigravity_daemon" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stop error");
      vi.restoreAllMocks();
    });
  });

  describe("services:status-updated broadcast", () => {
    it("should push status updates to main window webContents", async () => {
      await processController.getStatus();

      const testStatus: DualServiceStatus = {
        services: {
          antigravity_daemon: {
            target: "antigravity_daemon",
            displayName: "Antigravity",
            binaryName: "agy",
            state: "running",
            pids: [9999],
            mainPid: 9999,
            uptimeSeconds: 10,
            lastCheckedAt: Date.now(),
          },
          antigravity_ide: {
            target: "antigravity_ide",
            displayName: "Antigravity IDE",
            binaryName: "antigravity-ide",
            state: "stopped",
            pids: [],
            mainPid: null,
            uptimeSeconds: 0,
            lastCheckedAt: Date.now(),
          },
        },
        runningCount: 1,
        totalCount: 2,
        lastUpdated: Date.now(),
      };

      (processController as any).notifyListeners(testStatus);

      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IpcChannels.SERVICES_STATUS_UPDATED,
        testStatus,
      );
    });
  });
});
