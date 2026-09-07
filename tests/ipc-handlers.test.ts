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
import { QuotaMonitor } from "../src/main/quota/quota-monitor";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { SwitchFlow } from "../src/main/switcher/switch-flow";
import { AutoSwitchService } from "../src/main/switcher/auto-switch.service";
import { SnapshotStore } from "../src/main/snapshots/snapshot-store";

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
  let rateLimitTracker: RateLimitTracker;
  let quotaMonitor: QuotaMonitor;
  let switchFlow: SwitchFlow;
  let autoSwitchService: AutoSwitchService;
  let snapshotStore: SnapshotStore;
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

    rateLimitTracker = new RateLimitTracker();
    quotaMonitor = new QuotaMonitor({ accountStore, rateLimitTracker });
    switchFlow = new SwitchFlow({ accountStore, processController });
    autoSwitchService = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
      switchFlow,
    });
    snapshotStore = new SnapshotStore({
      snapshotsDir: path.join(tempDir, "snapshots"),
      accountStore,
      autoSwitchService,
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
      quotaMonitor,
      rateLimitTracker,
      switchFlow,
      autoSwitchService,
      snapshotStore,
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

  describe("Quota and Switcher IPC Channels Verification", () => {
    const sampleAccount: GoogleAccount = {
      id: "ipc-account-1",
      email: "ipc@example.com",
      status: "active",
      tokens: {
        access_token: "mock-access",
        refresh_token: "mock-refresh",
        expires_in: 3600,
        expiry_timestamp: Date.now() + 3600000,
        token_type: "Bearer",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    beforeEach(async () => {
      await accountStore.saveAccount(sampleAccount);
    });

    it("should handle quota:poll-all successfully", async () => {
      const handler = registeredHandlers.get(IpcChannels.QUOTA_POLL_ALL)!;
      expect(handler).toBeDefined();
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it("should validate and handle quota:poll-account", async () => {
      const handler = registeredHandlers.get(IpcChannels.QUOTA_POLL_ACCOUNT)!;
      expect(handler).toBeDefined();

      const invalidRes = await handler({}, { accountId: "" });
      expect(invalidRes.success).toBe(false);

      const validRes = await handler({}, { accountId: sampleAccount.id });
      expect(validRes.data).toBeDefined();
    });

    it("should handle switcher:get-config", async () => {
      const handler = registeredHandlers.get(IpcChannels.SWITCHER_GET_CONFIG)!;
      expect(handler).toBeDefined();

      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(true);
      expect(result.data.minQuotaThresholdPercent).toBe(10);
    });

    it("should validate and handle switcher:set-config", async () => {
      const handler = registeredHandlers.get(IpcChannels.SWITCHER_SET_CONFIG)!;
      expect(handler).toBeDefined();

      const invalidRes = await handler({}, { minQuotaThresholdPercent: 150 });
      expect(invalidRes.success).toBe(false);

      const validRes = await handler({}, { minQuotaThresholdPercent: 20 });
      expect(validRes.success).toBe(true);
      expect(validRes.data.minQuotaThresholdPercent).toBe(20);
    });

    it("should validate and handle switcher:manual-trigger", async () => {
      const handler = registeredHandlers.get(
        IpcChannels.SWITCHER_MANUAL_TRIGGER,
      )!;
      expect(handler).toBeDefined();

      const invalidRes = await handler({}, { accountId: "" });
      expect(invalidRes.success).toBe(false);

      const targetAcc: GoogleAccount = {
        ...sampleAccount,
        id: "ipc-target-2",
        email: "target@example.com",
      };
      await accountStore.saveAccount(targetAcc);

      const validRes = await handler({}, { accountId: "ipc-target-2" });
      expect(validRes.success).toBe(true);
      expect(validRes.data.newAccountId).toBe("ipc-target-2");
    });

    it("should handle rate-limit:get-states and rate-limit:clear", async () => {
      const getHandler = registeredHandlers.get(
        IpcChannels.RATE_LIMIT_GET_STATES,
      )!;
      const clearHandler = registeredHandlers.get(
        IpcChannels.RATE_LIMIT_CLEAR,
      )!;

      const getRes = await getHandler({});
      expect(getRes.success).toBe(true);
      expect(typeof getRes.data).toBe("object");

      const invalidClear = await clearHandler({}, { id: "" });
      expect(invalidClear.success).toBe(false);

      const validClear = await clearHandler({}, { id: sampleAccount.id });
      expect(validClear.success).toBe(true);
    });

    it("should handle snapshots lifecycle over IPC (list, create, restore, delete)", async () => {
      const listHandler = registeredHandlers.get(IpcChannels.SNAPSHOTS_LIST)!;
      const createHandler = registeredHandlers.get(
        IpcChannels.SNAPSHOTS_CREATE,
      )!;
      const restoreHandler = registeredHandlers.get(
        IpcChannels.SNAPSHOTS_RESTORE,
      )!;
      const deleteHandler = registeredHandlers.get(
        IpcChannels.SNAPSHOTS_DELETE,
      )!;

      // 1. Initial list
      const initialList = await listHandler({});
      expect(initialList.success).toBe(true);
      expect(initialList.data.length).toBe(0);

      // 2. Create validation
      const invalidCreate = await createHandler({}, { name: "" });
      expect(invalidCreate.success).toBe(false);

      // 3. Create valid snapshot
      const createRes = await createHandler(
        {},
        { name: "IPC Backup", description: "Created via IPC" },
      );
      expect(createRes.success).toBe(true);
      expect(createRes.data.name).toBe("IPC Backup");
      const snapshotId = createRes.data.id;

      // 4. List again
      const afterList = await listHandler({});
      expect(afterList.data.length).toBe(1);

      // 5. Restore validation
      const invalidRestore = await restoreHandler({}, { id: "" });
      expect(invalidRestore.success).toBe(false);

      // 6. Restore valid snapshot
      const restoreRes = await restoreHandler({}, { id: snapshotId });
      expect(restoreRes.success).toBe(true);

      // 7. Delete validation
      const invalidDelete = await deleteHandler({}, { id: "" });
      expect(invalidDelete.success).toBe(false);

      // 8. Delete valid snapshot
      const deleteRes = await deleteHandler({}, { id: snapshotId });
      expect(deleteRes.success).toBe(true);
    });

    it("should broadcast quota, switcher, and pool exhaustion events to renderer", async () => {
      // 1. Quota updated broadcast
      (quotaMonitor as any).notifyQuotaUpdated("ipc-account-1", {
        models: {},
        last_polled_at: Date.now(),
        source: "api",
      });
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IpcChannels.QUOTA_UPDATED,
        expect.objectContaining({ accountId: "ipc-account-1" }),
      );

      // 2. Switcher event broadcast
      (switchFlow as any).notifyListeners({
        success: true,
        newAccountId: "ipc-account-1",
      });
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IpcChannels.SWITCHER_EVENT,
        expect.objectContaining({ newAccountId: "ipc-account-1" }),
      );

      // 3. Pool exhaustion broadcast
      (autoSwitchService as any).notifyPoolExhausted("All accounts depleted");
      expect(mockWin.webContents.send).toHaveBeenCalledWith(
        IpcChannels.SWITCHER_EVENT,
        expect.objectContaining({
          type: "pool_exhausted",
          reason: "All accounts depleted",
        }),
      );
    });

    it("should handle error rejections across all quota and switcher IPC channels cleanly", async () => {
      // 1. Quota poll all error
      vi.spyOn(quotaMonitor, "pollAll").mockRejectedValueOnce(
        new Error("Poll all failed"),
      );
      const pollAllRes = await registeredHandlers.get(
        IpcChannels.QUOTA_POLL_ALL,
      )!({});
      expect(pollAllRes.success).toBe(false);
      expect(pollAllRes.error).toBe("Poll all failed");

      // 2. Quota poll account error
      vi.spyOn(quotaMonitor, "pollAccount").mockRejectedValueOnce(
        new Error("Poll account failed"),
      );
      const pollAccRes = await registeredHandlers.get(
        IpcChannels.QUOTA_POLL_ACCOUNT,
      )!({}, { accountId: "ipc-account-1" });
      expect(pollAccRes.success).toBe(false);
      expect(pollAccRes.error).toBe("Poll account failed");

      // 3. Switcher get config error
      vi.spyOn(autoSwitchService, "getConfig").mockImplementationOnce(() => {
        throw new Error("Get config failed");
      });
      const getCfgRes = await registeredHandlers.get(
        IpcChannels.SWITCHER_GET_CONFIG,
      )!({});
      expect(getCfgRes.success).toBe(false);
      expect(getCfgRes.error).toBe("Get config failed");

      // 4. Switcher set config error
      vi.spyOn(autoSwitchService, "setConfig").mockImplementationOnce(() => {
        throw new Error("Set config failed");
      });
      const setCfgRes = await registeredHandlers.get(
        IpcChannels.SWITCHER_SET_CONFIG,
      )!({}, { minQuotaThresholdPercent: 20 });
      expect(setCfgRes.success).toBe(false);
      expect(setCfgRes.error).toBe("Set config failed");

      // 5. Switcher manual trigger error
      vi.spyOn(switchFlow, "executeSwitch").mockRejectedValueOnce(
        new Error("Switch failed"),
      );
      const manualRes = await registeredHandlers.get(
        IpcChannels.SWITCHER_MANUAL_TRIGGER,
      )!({}, { accountId: "ipc-account-1" });
      expect(manualRes.success).toBe(false);
      expect(manualRes.error).toBe("Switch failed");

      // 6. Rate limit get states error
      vi.spyOn(rateLimitTracker, "getAllStates").mockImplementationOnce(() => {
        throw new Error("Get states failed");
      });
      const getStatesRes = await registeredHandlers.get(
        IpcChannels.RATE_LIMIT_GET_STATES,
      )!({});
      expect(getStatesRes.success).toBe(false);
      expect(getStatesRes.error).toBe("Get states failed");

      // 7. Rate limit clear error
      vi.spyOn(rateLimitTracker, "clearRateLimit").mockImplementationOnce(
        () => {
          throw new Error("Clear failed");
        },
      );
      const clearRes = await registeredHandlers.get(
        IpcChannels.RATE_LIMIT_CLEAR,
      )!({}, { id: "ipc-account-1" });
      expect(clearRes.success).toBe(false);
      expect(clearRes.error).toBe("Clear failed");

      // 8. Snapshots list error
      vi.spyOn(snapshotStore, "listSnapshots").mockRejectedValueOnce(
        new Error("List snapshots failed"),
      );
      const listRes = await registeredHandlers.get(IpcChannels.SNAPSHOTS_LIST)!(
        {},
      );
      expect(listRes.success).toBe(false);
      expect(listRes.error).toBe("List snapshots failed");

      // 9. Snapshots create error
      vi.spyOn(snapshotStore, "createSnapshot").mockRejectedValueOnce(
        new Error("Create snapshot failed"),
      );
      const createRes = await registeredHandlers.get(
        IpcChannels.SNAPSHOTS_CREATE,
      )!({}, { name: "Test Snap" });
      expect(createRes.success).toBe(false);
      expect(createRes.error).toBe("Create snapshot failed");

      // 10. Snapshots restore error
      vi.spyOn(snapshotStore, "restoreSnapshot").mockRejectedValueOnce(
        new Error("Restore snapshot failed"),
      );
      const restoreRes = await registeredHandlers.get(
        IpcChannels.SNAPSHOTS_RESTORE,
      )!({}, { id: "some-id" });
      expect(restoreRes.success).toBe(false);
      expect(restoreRes.error).toBe("Restore snapshot failed");

      // 11. Snapshots delete error
      vi.spyOn(snapshotStore, "deleteSnapshot").mockRejectedValueOnce(
        new Error("Delete snapshot failed"),
      );
      const deleteRes = await registeredHandlers.get(
        IpcChannels.SNAPSHOTS_DELETE,
      )!({}, { id: "some-id" });
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toBe("Delete snapshot failed");
    });

    it("should update quotaMonitor interval when pollIntervalMs is provided in set-config", async () => {
      const setHandler = registeredHandlers.get(
        IpcChannels.SWITCHER_SET_CONFIG,
      )!;
      const res = await setHandler({}, { pollIntervalMs: 45000 });
      expect(res.success).toBe(true);
      expect(quotaMonitor.getInterval()).toBe(45000);
    });

    it("should instantiate default fallback instances when optional dependencies are omitted", () => {
      expect(() => {
        registerIpcHandlers({
          accountStore,
          processController,
          oauthConfig: mockOAuthConfig,
        });
      }).not.toThrow();
    });

    it("should safely skip event forwarding when window is destroyed or null", () => {
      mockWin.isDestroyed.mockReturnValue(true);
      (quotaMonitor as any).notifyQuotaUpdated("ipc-account-1", {
        models: {},
        last_polled_at: Date.now(),
        source: "api",
      });
      (switchFlow as any).notifyListeners({ success: true });
      (autoSwitchService as any).notifyPoolExhausted("Depleted");
      (processController as any).notifyListeners({});
      mockWin.isDestroyed.mockReturnValue(false);
    });
  });
});
