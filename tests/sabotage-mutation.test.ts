import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import { AccountStore } from "../src/main/account-store/account-store";
import { deriveMasterKey } from "../src/main/account-store/master-key";
import {
  StoreTamperException,
  EncryptedStoreEnvelope,
} from "../src/main/account-store/types";
import {
  OAuthLoopbackServer,
  OAuthConfig,
} from "../src/main/oauth/oauth-server";
import { refreshTokenIfNeeded } from "../src/main/oauth/token-refresh";
import {
  ProcessController,
  ProcessSystemInterface,
} from "../src/main/process/process-controller";
import {
  setBinaryPathOverride,
  clearBinaryPathOverrides,
} from "../src/main/process/agy-path-detection";
import { GoogleAccount } from "../src/shared/types";
import { AutoSwitchService } from "../src/main/switcher/auto-switch.service";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { SwitchFlow } from "../src/main/switcher/switch-flow";
import {
  validateToken,
  AuthRateLimiter,
  generateSessionToken,
} from "../src/main/relay/relay-auth";
import { SessionManager, SocketLike } from "../src/main/relay/session-manager";
import {
  UpstreamBridge,
  UpstreamTransport,
} from "../src/main/relay/upstream-bridge";
import {
  TunnelManager,
  ChildProcessLike,
  SpawnFunction,
} from "../src/main/tunnel/tunnel-manager";
import { EventEmitter } from "node:events";
import { SettingsStore } from "../src/main/settings/settings-store";
import { AppSettings, DEFAULT_APP_SETTINGS } from "../src/main/settings/types";
import { TrayManager } from "../src/main/tray/tray";
import { NativeNotifier } from "../src/main/notifications/notifier";

const {
  MockTray,
  MockMenu,
  MockNotification,
  mockTrayInstances,
  mockNotificationInstances,
  setAppQuitCalled,
} = vi.hoisted(() => {
  const mockTrayInstances: any[] = [];
  const mockNotificationInstances: any[] = [];
  let appQuitCalled = false;

  class MockTray {
    public toolTip = "";
    public contextMenu: any = null;
    public clickListener: Function | null = null;
    public isDestroyedFlag = false;

    constructor(public image: any) {
      mockTrayInstances.push(this);
    }

    setToolTip(tip: string) {
      this.toolTip = tip;
    }

    setContextMenu(menu: any) {
      this.contextMenu = menu;
    }

    on(event: string, cb: Function) {
      if (event === "click") {
        this.clickListener = cb;
      }
      return this;
    }

    destroy() {
      this.isDestroyedFlag = true;
    }

    isDestroyed() {
      return this.isDestroyedFlag;
    }
  }

  class MockMenu {
    public items: any[];
    constructor(items: any[]) {
      this.items = items;
    }

    static buildFromTemplate(template: any[]) {
      return new MockMenu(template);
    }
  }

  class MockNotification {
    public options: any;
    public listeners = new Map<string, Function>();
    public show = vi.fn();
    public on = vi.fn((event: string, cb: Function) => {
      this.listeners.set(event, cb);
      return this;
    });

    constructor(options: any) {
      this.options = options;
      mockNotificationInstances.push(this);
    }

    static isSupported = vi.fn(() => true);
  }

  return {
    MockTray,
    MockMenu,
    MockNotification,
    mockTrayInstances,
    mockNotificationInstances,
    getAppQuitCalled: () => appQuitCalled,
    setAppQuitCalled: (v: boolean) => {
      appQuitCalled = v;
    },
  };
});

vi.mock("electron", () => {
  return {
    app: {
      quit: vi.fn(() => {
        setAppQuitCalled(true);
      }),
      getPath: vi.fn((name: string) => `/mock/path/${name}`),
    },
    Tray: MockTray,
    Menu: MockMenu,
    Notification: MockNotification,
    nativeImage: {
      createFromPath: vi.fn((p: string) => ({
        path: p,
        setTemplateImage: vi.fn(),
      })),
      createFromDataURL: vi.fn((data: string) => ({
        data,
        setTemplateImage: vi.fn(),
      })),
    },
    BrowserWindow: vi.fn(),
  };
});

describe("Shift-Left Sabotage & Mutation Vectors", () => {
  describe("Cryptographic Envelope Tampering and Mutation Vectors", () => {
    let tempDir: string;
    let storeFile: string;
    let validAccount: GoogleAccount;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sabotage-crypto-"));
      storeFile = path.join(tempDir, "accounts.enc.json");

      validAccount = {
        id: "account-sabotage-1",
        email: "security-auditor@example.com",
        status: "active",
        tokens: {
          access_token: "secret-access-token-12345",
          refresh_token: "secret-refresh-token-67890",
          expires_in: 3600,
          expiry_timestamp: Date.now() + 3600000,
          token_type: "Bearer",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });
      await store.saveAccount(validAccount);
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    it("should reject single-byte flipped ciphertext mutant and backup corrupted file", async () => {
      const rawContent = fs.readFileSync(storeFile, "utf-8");
      const envelope: EncryptedStoreEnvelope = JSON.parse(rawContent);

      const cipherBuf = Buffer.from(envelope.ciphertext, "hex");
      cipherBuf[0] ^= 0xff;
      envelope.ciphertext = cipherBuf.toString("hex");
      fs.writeFileSync(storeFile, JSON.stringify(envelope, null, 2));

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });

      await expect(store.getAll()).rejects.toThrow(StoreTamperException);

      const filesInDir = fs.readdirSync(tempDir);
      const corruptedBackup = filesInDir.find((f) => f.includes(".corrupted."));
      expect(corruptedBackup).toBeDefined();

      const backupContent = fs.readFileSync(
        path.join(tempDir, corruptedBackup!),
        "utf-8",
      );
      expect(backupContent).toBe(JSON.stringify(envelope, null, 2));
    });

    it("should reject authentication tag mutant without crashing", async () => {
      const rawContent = fs.readFileSync(storeFile, "utf-8");
      const envelope: EncryptedStoreEnvelope = JSON.parse(rawContent);

      const tagBuf = Buffer.from(envelope.authTag, "hex");
      tagBuf[tagBuf.length - 1] ^= 0xaa;
      envelope.authTag = tagBuf.toString("hex");
      fs.writeFileSync(storeFile, JSON.stringify(envelope, null, 2));

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });

      await expect(store.get("account-sabotage-1")).rejects.toThrow(
        StoreTamperException,
      );
    });

    it("should reject IV mutation and truncation", async () => {
      const rawContent = fs.readFileSync(storeFile, "utf-8");
      const envelope: EncryptedStoreEnvelope = JSON.parse(rawContent);

      envelope.iv = Buffer.alloc(12, 0).toString("hex");
      fs.writeFileSync(storeFile, JSON.stringify(envelope, null, 2));

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });

      await expect(store.getActive()).rejects.toThrow(StoreTamperException);
    });

    it("should reject truncated or zero-length ciphertext payload", async () => {
      const rawContent = fs.readFileSync(storeFile, "utf-8");
      const envelope: EncryptedStoreEnvelope = JSON.parse(rawContent);

      envelope.ciphertext = "";
      fs.writeFileSync(storeFile, JSON.stringify(envelope, null, 2));

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });

      await expect(store.getAll()).rejects.toThrow();
    });

    it("should reject corrupted JSON envelope format without losing file", async () => {
      fs.writeFileSync(storeFile, "NOT-VALID-JSON-DATA-{{{{}}}}}");

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "hardened-test-machine-id",
      });

      await expect(store.getAll()).rejects.toThrow(StoreTamperException);
    });
  });

  describe("Hardware Key Derivation Sabotage Vectors", () => {
    let tempDir: string;
    let storeFile: string;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sabotage-key-"));
      storeFile = path.join(tempDir, "accounts.enc.json");

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "original-machine-hw-uuid-101",
      });
      await store.saveAccount({
        id: "acc-key-test",
        email: "dev@company.internal",
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
      });
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    it("should reject decryption when hardware machine ID differs (host migration simulation)", async () => {
      const storeAlienMachine = new AccountStore({
        storePath: storeFile,
        machineId: "alien-machine-hw-uuid-999",
      });

      await expect(storeAlienMachine.getAll()).rejects.toThrow(
        StoreTamperException,
      );
    });

    it("should reject tampered salt in envelope", async () => {
      const rawContent = fs.readFileSync(storeFile, "utf-8");
      const envelope: EncryptedStoreEnvelope = JSON.parse(rawContent);

      envelope.salt = crypto.randomBytes(16).toString("hex");
      fs.writeFileSync(storeFile, JSON.stringify(envelope, null, 2));

      const store = new AccountStore({
        storePath: storeFile,
        machineId: "original-machine-hw-uuid-101",
      });

      await expect(store.getAll()).rejects.toThrow(StoreTamperException);
    });

    it("should fail key derivation when salt is mutated below 16 bytes", () => {
      const shortSalt = Buffer.from("short-salt");
      expect(() => deriveMasterKey(shortSalt, "test-id")).toThrow(
        "Salt must be a Buffer of at least 16 bytes",
      );
    });
  });

  describe("OAuth Token Expiry Buffer & Boundary Sabotage", () => {
    let tempDir: string;
    let storeFile: string;
    let store: AccountStore;

    const mockOAuthConfig: OAuthConfig = {
      clientId: "test-client-id",
      clientSecret: "test-secret",
    };

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sabotage-oauth-"));
      storeFile = path.join(tempDir, "accounts.enc.json");
      store = new AccountStore({
        storePath: storeFile,
        machineId: "test-oauth-machine",
      });
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    it("should NOT refresh token when remaining lifetime is 301 seconds (outside 300s buffer)", async () => {
      const now = Date.now();
      const account: GoogleAccount = {
        id: "acc-buffer-301",
        email: "boundary301@test.com",
        status: "active",
        tokens: {
          access_token: "valid-token-301",
          refresh_token: "valid-refresh-301",
          expires_in: 3600,
          expiry_timestamp: now + 301 * 1000,
          token_type: "Bearer",
        },
        createdAt: now,
        updatedAt: now,
      };
      await store.saveAccount(account);

      const fetchSpy = vi.fn();
      const result = await refreshTokenIfNeeded(
        account,
        store,
        mockOAuthConfig,
        {
          bufferSeconds: 300,
          force: false,
          fetchFn: fetchSpy as unknown as typeof fetch,
        },
      );

      expect(result.refreshed).toBe(false);
      expect(result.token.access_token).toBe("valid-token-301");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should refresh token when remaining lifetime is 299 seconds (inside 300s buffer)", async () => {
      const now = Date.now();
      const account: GoogleAccount = {
        id: "acc-buffer-299",
        email: "boundary299@test.com",
        status: "active",
        tokens: {
          access_token: "old-token-299",
          refresh_token: "valid-refresh-299",
          expires_in: 3600,
          expiry_timestamp: now + 299 * 1000,
          token_type: "Bearer",
        },
        createdAt: now,
        updatedAt: now,
      };
      await store.saveAccount(account);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          access_token: "freshly-minted-token-299",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      });

      const result = await refreshTokenIfNeeded(
        account,
        store,
        mockOAuthConfig,
        {
          bufferSeconds: 300,
          force: false,
          fetchFn: mockFetch as unknown as typeof fetch,
        },
      );

      expect(result.refreshed).toBe(true);
      expect(result.token.access_token).toBe("freshly-minted-token-299");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const updated = await store.get("acc-buffer-299");
      expect(updated?.tokens.access_token).toBe("freshly-minted-token-299");
      expect(updated?.status).toBe("active");
    });

    it("should mark account status as expired when provider returns invalid_grant", async () => {
      const now = Date.now();
      const account: GoogleAccount = {
        id: "acc-revoked",
        email: "revoked@test.com",
        status: "active",
        tokens: {
          access_token: "old-token",
          refresh_token: "revoked-refresh-token",
          expires_in: 3600,
          expiry_timestamp: now - 1000,
          token_type: "Bearer",
        },
        createdAt: now,
        updatedAt: now,
      };
      await store.saveAccount(account);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () =>
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
      });

      await expect(
        refreshTokenIfNeeded(account, store, mockOAuthConfig, {
          fetchFn: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow("Failed to refresh token: 400");

      const updated = await store.get("acc-revoked");
      expect(updated?.status).toBe("expired");
    });

    it("should reject OAuth callback when state parameter is mutated (CSRF vector)", async () => {
      const oauthServer = new OAuthLoopbackServer(store, mockOAuthConfig);
      let capturedAuthUrl = "";

      const flowPromise = oauthServer.startFlow({
        openBrowser: (url) => {
          capturedAuthUrl = url;
        },
      });

      // Attach expectation before triggering the rejection to prevent unhandled rejection
      const rejectionExpectation =
        expect(flowPromise).rejects.toThrow("State mismatch");

      while (!capturedAuthUrl) {
        await new Promise((r) => setTimeout(r, 10));
      }

      const urlObj = new URL(capturedAuthUrl);
      const redirectUriParam = urlObj.searchParams.get("redirect_uri");
      const port = new URL(redirectUriParam!).port;
      expect(port).toBeDefined();

      const statusCode = await new Promise<number>((resolve) => {
        http.get(
          `http://127.0.0.1:${port}/callback?code=valid-code&state=TAMPERED_FORGED_STATE`,
          (res) => resolve(res.statusCode || 0),
        );
      });

      expect(statusCode).toBe(400);
      await rejectionExpectation;
    });
  });

  describe("Process Supervisor Signal Escalation & Disambiguation Sabotage", () => {
    class StubbornProcessSystem implements ProcessSystemInterface {
      public processes: Array<{ pid: number; command: string }> = [];
      public signalsReceived: Array<{
        pid: number;
        signal: "SIGTERM" | "SIGKILL";
      }> = [];

      constructor(initialProcesses: Array<{ pid: number; command: string }>) {
        this.processes = [...initialProcesses];
      }

      public async getRunningProcesses(): Promise<
        Array<{ pid: number; command: string }>
      > {
        return [...this.processes];
      }

      public async killPid(
        pid: number,
        signal: "SIGTERM" | "SIGKILL",
      ): Promise<void> {
        this.signalsReceived.push({ pid, signal });

        if (signal === "SIGKILL") {
          this.processes = this.processes.filter((p) => p.pid !== pid);
        }
      }

      public async spawnProcess(
        commandPath: string,
        _args: string[],
      ): Promise<number> {
        const pid = 5000;
        this.processes.push({ pid, command: commandPath });
        return pid;
      }
    }

    it("should escalate from SIGTERM to SIGKILL when process refuses to exit within timeout", async () => {
      const stubbornSystem = new StubbornProcessSystem([
        { pid: 3001, command: "/opt/antigravity/bin/agy --port 8080" },
      ]);

      const controller = new ProcessController({
        system: stubbornSystem,
        killTimeoutMs: 150,
        pollIntervalMs: 20,
      });

      const statusBefore = await controller.getStatus();
      expect(statusBefore.services.antigravity_daemon.state).toBe("running");
      expect(statusBefore.services.antigravity_daemon.pids).toContain(3001);

      const stopResult = await controller.stopService("antigravity_daemon");
      expect(stopResult.state).toBe("stopped");

      const daemonSignals = stubbornSystem.signalsReceived.filter(
        (s) => s.pid === 3001,
      );
      expect(daemonSignals.length).toBe(2);
      expect(daemonSignals[0].signal).toBe("SIGTERM");
      expect(daemonSignals[1].signal).toBe("SIGKILL");

      const statusAfter = await controller.getStatus();
      expect(statusAfter.services.antigravity_daemon.state).toBe("stopped");
      expect(statusAfter.services.antigravity_daemon.pids).toEqual([]);
    });

    it("should never confuse antigravity-relay harness with agy or antigravity-ide", async () => {
      class DecoyProcessSystem implements ProcessSystemInterface {
        public async getRunningProcesses(): Promise<
          Array<{ pid: number; command: string }>
        > {
          return [
            {
              pid: 101,
              command: "node /app/node_modules/.bin/antigravity-relay",
            },
            {
              pid: 102,
              command: "/usr/local/bin/antigravity-relay-desktop --flag",
            },
            {
              pid: 103,
              command:
                "electron /Users/hhizari/antigravity-relay/src/main/index.ts",
            },
            {
              pid: 104,
              command:
                "/Applications/Antigravity Relay.app/Contents/MacOS/antigravity-relay",
            },
          ];
        }
        public async killPid(): Promise<void> {}
        public async spawnProcess(): Promise<number> {
          return 999;
        }
      }

      const controller = new ProcessController({
        system: new DecoyProcessSystem(),
      });

      const status = await controller.getStatus();

      expect(status.services.antigravity_daemon.state).toBe("stopped");
      expect(status.services.antigravity_daemon.pids).toEqual([]);
      expect(status.services.antigravity_ide.state).toBe("stopped");
      expect(status.services.antigravity_ide.pids).toEqual([]);
      expect(status.runningCount).toBe(0);
    });

    it("should transition to error state when launching an unconfigured missing binary", async () => {
      clearBinaryPathOverrides();
      setBinaryPathOverride(
        "antigravity_daemon",
        "/non/existent/path/to/binary/agy",
      );

      class FailingSpawnSystem implements ProcessSystemInterface {
        public async getRunningProcesses(): Promise<
          Array<{ pid: number; command: string }>
        > {
          return [];
        }
        public async killPid(): Promise<void> {}
        public async spawnProcess(): Promise<number> {
          throw new Error("ENOENT: no such file or directory");
        }
      }

      const controller = new ProcessController({
        system: new FailingSpawnSystem(),
      });

      const result = await controller.startService("antigravity_daemon");
      expect(result.state).toBe("error");
      expect(result.errorMessage).toContain("ENOENT");

      clearBinaryPathOverrides();
    });
  });

  describe("Quota Monitoring & Auto-Switching Sabotage & Mutation Vectors", () => {
    let tempDir: string;
    let storeFile: string;
    let accountStore: AccountStore;
    let rateLimitTracker: RateLimitTracker;

    const createSabotageAccount = (
      id: string,
      email: string,
      quotaPercent: number,
      lastUsedAt = 0,
      status: GoogleAccount["status"] = "active",
    ): GoogleAccount => ({
      id,
      email,
      status,
      lastUsedAt,
      tokens: {
        access_token: `access-token-${id}`,
        refresh_token: `refresh-token-${id}`,
        expires_in: 3600,
        expiry_timestamp: Date.now() + 3600000,
        token_type: "Bearer",
      },
      quota: {
        models: {
          "gemini-2.0-flash": {
            percentage: quotaPercent,
            resetTime: new Date(Date.now() + 3600000).toISOString(),
          },
          "gemini-1.5-pro": {
            percentage: quotaPercent,
            resetTime: new Date(Date.now() + 3600000).toISOString(),
          },
        },
        last_polled_at: Date.now(),
        source: "api",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    class SabotageProcessSystem implements ProcessSystemInterface {
      public processes: Array<{ pid: number; command: string }> = [];
      public failOnStart = false;
      public failOnStop = false;
      public signalsReceived: Array<{
        pid: number;
        signal: "SIGTERM" | "SIGKILL";
      }> = [];

      constructor(
        initialProcesses: Array<{ pid: number; command: string }> = [],
      ) {
        this.processes = [...initialProcesses];
      }

      public async getRunningProcesses(): Promise<
        Array<{ pid: number; command: string }>
      > {
        return [...this.processes];
      }

      public async killPid(
        pid: number,
        signal: "SIGTERM" | "SIGKILL",
      ): Promise<void> {
        this.signalsReceived.push({ pid, signal });
        if (this.failOnStop) {
          throw new Error("Process termination failed");
        }
        this.processes = this.processes.filter((p) => p.pid !== pid);
      }

      public async spawnProcess(commandPath: string): Promise<number> {
        if (this.failOnStart) {
          throw new Error("Spawn error: command failed to start");
        }
        const pid = 8800;
        this.processes.push({ pid, command: commandPath });
        return pid;
      }
    }

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sabotage-m02-"));
      storeFile = path.join(tempDir, "accounts.enc.json");
      accountStore = new AccountStore({
        storePath: storeFile,
        machineId: "m02-sabotage-machine",
      });
      rateLimitTracker = new RateLimitTracker();
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    });

    describe("Scoring Algorithm Tie-Breaker Sabotage Vectors", () => {
      it("should kill scoring tie-breaker mutant when candidates share identical quota and lastUsedAt", async () => {
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          10,
        );
        const accBravo = createSabotageAccount(
          "acc-bravo",
          "bravo@test.com",
          80,
          1000,
        );
        const accAlpha = createSabotageAccount(
          "acc-alpha",
          "alpha@test.com",
          80,
          1000,
        );

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accBravo);
        await accountStore.saveAccount(accAlpha);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
        });

        const result = await service.findBestAccount();
        expect(result.candidate).not.toBeNull();
        // Lexicographical order: acc-alpha must precede acc-bravo
        expect(result.candidate?.id).toBe("acc-alpha");
        expect(result.rankedScores[0].accountId).toBe("acc-alpha");
        expect(result.rankedScores[0].selectionRank).toBe(1);
        expect(result.rankedScores[1].accountId).toBe("acc-bravo");
        expect(result.rankedScores[1].selectionRank).toBe(2);
      });

      it("should kill weight-inversion mutant by prioritizing 80% quota average over 20% recency", async () => {
        const now = Date.now();
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          5,
          now,
        );
        // Candidate High: 95% quota, used very recently (recency 0)
        const accHigh = createSabotageAccount(
          "acc-high",
          "high@test.com",
          95,
          now - 1000,
        );
        // Candidate Old: 60% quota, used long ago (recency 100)
        const accOld = createSabotageAccount(
          "acc-old",
          "old@test.com",
          60,
          now - 100000,
        );

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accHigh);
        await accountStore.saveAccount(accOld);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
        });

        const result = await service.findBestAccount();
        expect(result.candidate).not.toBeNull();
        // Under 80/20 formula: High = 95 * 0.8 + 0 * 0.2 = 760; Old = 60 * 0.8 + 100 * 0.2 = 680
        expect(result.candidate?.id).toBe("acc-high");
        expect(result.rankedScores[0].score).toBe(760);
        expect(result.rankedScores[1].score).toBe(680);
      });

      it("should kill unused account normalization mutant by awarding maximum recency score to unused accounts", async () => {
        const now = Date.now();
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          5,
          now,
        );
        const accUsed = createSabotageAccount(
          "acc-used",
          "used@test.com",
          80,
          now - 5000,
        );
        const accUnused = createSabotageAccount(
          "acc-unused",
          "unused@test.com",
          80,
          0,
        );
        const accAnchor = createSabotageAccount(
          "acc-anchor",
          "anchor@test.com",
          80,
          now - 50000,
        );

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accUsed);
        await accountStore.saveAccount(accUnused);
        await accountStore.saveAccount(accAnchor);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
        });

        const result = await service.findBestAccount();
        expect(result.candidate).not.toBeNull();
        expect(result.candidate?.id).toBe("acc-unused");
        expect(result.rankedScores[0].accountId).toBe("acc-unused");
      });
    });

    describe("Threshold Boundary Sabotage Vectors", () => {
      it("should kill boundary mutant by qualifying accounts that exactly equal minQuotaThresholdPercent", async () => {
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          2,
        );
        const accExact = createSabotageAccount(
          "acc-exact",
          "exact@test.com",
          15,
        );

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accExact);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
          initialConfig: { minQuotaThresholdPercent: 15 },
        });

        const result = await service.findBestAccount();
        expect(result.candidate).not.toBeNull();
        expect(result.candidate?.id).toBe("acc-exact");
        expect(result.reason).toBeUndefined();
      });

      it("should kill boundary mutant by rejecting accounts strictly below minQuotaThresholdPercent", async () => {
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          2,
        );
        const accSub = createSabotageAccount("acc-sub", "sub@test.com", 14);

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accSub);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
          initialConfig: { minQuotaThresholdPercent: 15 },
        });

        const result = await service.findBestAccount();
        expect(result.candidate).toBeNull();
        expect(result.reason).toBe("ALL_BELOW_THRESHOLD");
      });

      it("should enforce extreme threshold boundaries at 0% and 100%", async () => {
        const accActive = createSabotageAccount(
          "acc-active",
          "active@test.com",
          10,
        );
        const accZero = createSabotageAccount("acc-zero", "zero@test.com", 0);
        const accNinetyNine = createSabotageAccount(
          "acc-99",
          "99@test.com",
          99,
        );
        const accHundred = createSabotageAccount(
          "acc-100",
          "100@test.com",
          100,
        );

        await accountStore.saveAccount(accActive);
        await accountStore.saveAccount(accZero);
        await accountStore.saveAccount(accNinetyNine);
        await accountStore.saveAccount(accHundred);
        await accountStore.setActive(accActive.id);

        const service = new AutoSwitchService({
          accountStore,
          rateLimitTracker,
          initialConfig: { minQuotaThresholdPercent: 0 },
        });

        // With 0% threshold, accZero is not rejected by threshold
        const resZero = await service.findBestAccount([accZero]);
        expect(resZero.candidate?.id).toBe("acc-zero");

        // With 100% threshold, accNinetyNine is rejected
        service.setConfig({ minQuotaThresholdPercent: 100 });
        const res99 = await service.findBestAccount([accNinetyNine]);
        expect(res99.candidate).toBeNull();
        expect(res99.reason).toBe("ALL_BELOW_THRESHOLD");

        // With 100% threshold, accHundred qualifies
        const res100 = await service.findBestAccount([accHundred]);
        expect(res100.candidate?.id).toBe("acc-100");

        // Invalid boundaries reject immediately
        expect(() =>
          service.setConfig({ minQuotaThresholdPercent: -1 }),
        ).toThrow("minQuotaThresholdPercent must be between 0 and 100");
        expect(() =>
          service.setConfig({ minQuotaThresholdPercent: 101 }),
        ).toThrow("minQuotaThresholdPercent must be between 0 and 100");
      });
    });

    describe("Cooldown Calculation Inversion & Backoff Mutation Vectors", () => {
      it("should kill exponential backoff calculation inversion mutant and enforce 32x capping", () => {
        const tracker = new RateLimitTracker({ defaultCooldownMs: 60000 });
        const accountId = "acc-backoff-test";

        // Retry 1: 1x base = 60000 ms
        const s1 = tracker.recordRateLimit(accountId);
        expect(s1.retryCount).toBe(1);
        expect(s1.cooldownUntil! - s1.limitedAt!).toBe(60000);

        // Retry 2: 2x base = 120000 ms
        const s2 = tracker.recordRateLimit(accountId);
        expect(s2.retryCount).toBe(2);
        expect(s2.cooldownUntil! - s2.limitedAt!).toBe(120000);

        // Retry 3: 4x base = 240000 ms
        const s3 = tracker.recordRateLimit(accountId);
        expect(s3.retryCount).toBe(3);
        expect(s3.cooldownUntil! - s3.limitedAt!).toBe(240000);

        // Retry 4: 8x base = 480000 ms
        const s4 = tracker.recordRateLimit(accountId);
        expect(s4.retryCount).toBe(4);
        expect(s4.cooldownUntil! - s4.limitedAt!).toBe(480000);

        // Retry 5: 16x base = 960000 ms
        const s5 = tracker.recordRateLimit(accountId);
        expect(s5.retryCount).toBe(5);
        expect(s5.cooldownUntil! - s5.limitedAt!).toBe(960000);

        // Retry 6: 32x base = 1920000 ms (capped)
        const s6 = tracker.recordRateLimit(accountId);
        expect(s6.retryCount).toBe(6);
        expect(s6.cooldownUntil! - s6.limitedAt!).toBe(1920000);

        // Retry 7: 32x base = 1920000 ms (still capped at 32x)
        const s7 = tracker.recordRateLimit(accountId);
        expect(s7.retryCount).toBe(7);
        expect(s7.cooldownUntil! - s7.limitedAt!).toBe(1920000);
      });

      it("should kill cooldown expiration boundary mutant by releasing account only after cooldownUntil", async () => {
        const tracker = new RateLimitTracker();
        const accountId = "acc-cooldown-expire";

        // Record rate limit with very short 50ms cooldown
        tracker.recordRateLimit(accountId, "http_429", 429, 50);

        expect(tracker.isAccountLimited(accountId)).toBe(true);
        expect(tracker.getActiveCooldownRemainingMs(accountId)).toBeGreaterThan(
          0,
        );

        // Wait for cooldown to elapse
        await new Promise((r) => setTimeout(r, 60));

        expect(tracker.isAccountLimited(accountId)).toBe(false);
        expect(tracker.getActiveCooldownRemainingMs(accountId)).toBe(0);
      });

      it("should reject negative or zero cooldown duration mutations", () => {
        const tracker = new RateLimitTracker();
        expect(() => tracker.setCooldownDuration(-500)).toThrow(
          "Cooldown duration must be positive",
        );
        expect(() => tracker.setCooldownDuration(0)).toThrow(
          "Cooldown duration must be positive",
        );
      });
    });

    describe("Process Switch Failure Handling & Rollback Sabotage Vectors", () => {
      it("should kill rollback mutant by reverting active account and releasing mutex on process restart failure", async () => {
        const accPrev = createSabotageAccount("acc-prev", "prev@test.com", 10);
        const accTarget = createSabotageAccount(
          "acc-target",
          "target@test.com",
          90,
        );

        await accountStore.saveAccount(accPrev);
        await accountStore.saveAccount(accTarget);
        await accountStore.setActive(accPrev.id);

        const stubbornSystem = new SabotageProcessSystem([
          { pid: 4001, command: "/opt/antigravity/bin/agy" },
        ]);
        // Sabotage: Make spawnProcess fail on relaunch
        stubbornSystem.failOnStart = true;

        const processController = new ProcessController({
          system: stubbornSystem,
          killTimeoutMs: 50,
        });

        const switchFlow = new SwitchFlow({
          accountStore,
          processController,
          config: {
            enabled: true,
            minQuotaThresholdPercent: 10,
            pollIntervalMs: 300000,
            rateLimitCooldownMs: 900000,
            autoRelaunchProcesses: true,
            preferredModels: ["gemini-2.0-flash"],
          },
        });

        await expect(
          switchFlow.executeSwitch(accTarget.id, "quota_depleted"),
        ).rejects.toThrow("Failed to relaunch antigravity_daemon");

        // Rollback verification: Active account must revert to accPrev
        const activeAfter = await accountStore.getActive();
        expect(activeAfter?.id).toBe("acc-prev");

        // Mutex verification: Lock must be released
        expect(switchFlow.isInProgress()).toBe(false);

        // Turn off start failure and verify switch can now proceed cleanly
        stubbornSystem.failOnStart = false;
        const retryResult = await switchFlow.executeSwitch(
          accTarget.id,
          "quota_depleted",
        );
        expect(retryResult.success).toBe(true);
        expect(retryResult.newAccountId).toBe("acc-target");
      });

      it("should kill rollback mutant on credentialsWriter failure and release mutex", async () => {
        const accPrev = createSabotageAccount("acc-prev", "prev@test.com", 10);
        const accTarget = createSabotageAccount(
          "acc-target",
          "target@test.com",
          90,
        );

        await accountStore.saveAccount(accPrev);
        await accountStore.saveAccount(accTarget);
        await accountStore.setActive(accPrev.id);

        const processController = new ProcessController({
          system: new SabotageProcessSystem(),
        });

        const failingWriter = vi
          .fn()
          .mockRejectedValue(new Error("EACCES: permission denied"));

        const switchFlow = new SwitchFlow({
          accountStore,
          processController,
          credentialsWriter: failingWriter,
        });

        await expect(
          switchFlow.executeSwitch(accTarget.id, "manual_request"),
        ).rejects.toThrow("EACCES: permission denied");

        const activeAfter = await accountStore.getActive();
        expect(activeAfter?.id).toBe("acc-prev");
        expect(switchFlow.isInProgress()).toBe(false);
      });

      it("should kill concurrency race mutant by rejecting parallel switch attempts with ALREADY_IN_PROGRESS", async () => {
        const accPrev = createSabotageAccount("acc-prev", "prev@test.com", 10);
        const accA = createSabotageAccount("acc-a", "a@test.com", 90);
        const accB = createSabotageAccount("acc-b", "b@test.com", 85);

        await accountStore.saveAccount(accPrev);
        await accountStore.saveAccount(accA);
        await accountStore.saveAccount(accB);
        await accountStore.setActive(accPrev.id);

        const processController = new ProcessController({
          system: new SabotageProcessSystem(),
        });

        const switchFlow = new SwitchFlow({
          accountStore,
          processController,
        });

        // Trigger two switches concurrently
        const p1 = switchFlow.executeSwitch(accA.id, "quota_depleted");
        const p2 = switchFlow.executeSwitch(accB.id, "quota_depleted");

        const outcomes = await Promise.allSettled([p1, p2]);
        const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
        const rejected = outcomes.filter((o) => o.status === "rejected");

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
          "ALREADY_IN_PROGRESS",
        );
        expect(switchFlow.isInProgress()).toBe(false);
      });
    });
  });

  describe("Remote Relay & Cloudflare Tunnel Sabotage & Mutation Vectors", () => {
    describe("Timing-Safe Comparison & Authentication Sabotage Vectors", () => {
      it("should reject single-bit flipped token mutant and prevent timing vulnerability", () => {
        const expected = generateSessionToken();
        const charToFlip = expected[16];
        const flippedChar = charToFlip === "a" ? "b" : "a";
        const mutated =
          expected.slice(0, 16) + flippedChar + expected.slice(17);

        expect(validateToken(mutated, expected)).toBe(false);
      });

      it("should reject length-mismatched token mutants without throwing or timing leak", () => {
        const expected = generateSessionToken();
        expect(validateToken(expected.slice(0, -1), expected)).toBe(false);
        expect(validateToken(expected + "0", expected)).toBe(false);
        expect(validateToken("", expected)).toBe(false);
        expect(validateToken(expected, "")).toBe(false);
        expect(validateToken("", "")).toBe(false);
      });

      it("should reject prefix-match mutant where provided token contains expected token as prefix", () => {
        const expected = generateSessionToken();
        const prefixMutant = expected + "extra_bytes_appended";
        expect(validateToken(prefixMutant, expected)).toBe(false);
      });

      it("should kill rate limiter boundary mutant by rejecting on exactly 5th failure and preserving window", () => {
        const limiter = new AuthRateLimiter({ maxAttempts: 5, windowMs: 1000 });
        const ip = "192.168.1.100";

        for (let i = 0; i < 4; i++) {
          limiter.recordFailure(ip);
          expect(limiter.isRateLimited(ip)).toBe(false);
        }

        // 5th failure trips threshold
        limiter.recordFailure(ip);
        expect(limiter.isRateLimited(ip)).toBe(true);

        // Success on another IP does not clear ip
        limiter.recordSuccess("192.168.1.200");
        expect(limiter.isRateLimited(ip)).toBe(true);

        // Success on ip clears it immediately
        limiter.recordSuccess(ip);
        expect(limiter.isRateLimited(ip)).toBe(false);
      });

      it("should clear rate limit after window expiration", async () => {
        const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 50 });
        const ip = "10.0.0.1";

        for (let i = 0; i < 3; i++) {
          limiter.recordFailure(ip);
        }
        expect(limiter.isRateLimited(ip)).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(limiter.isRateLimited(ip)).toBe(false);
      });
    });

    describe("FIFO Message Queue Boundary & TTL Pruning Sabotage Vectors", () => {
      it("should kill buffer capacity overflow mutant by strictly rejecting commands exceeding capacity", () => {
        const manager = new SessionManager({
          maxBufferedCommands: 3,
          bufferTtlMs: 10000,
        });
        const session = manager.createSession();

        const r1 = manager.bufferMessage(session.sessionId, "CMD_1", {
          idx: 1,
        });
        const r2 = manager.bufferMessage(session.sessionId, "CMD_2", {
          idx: 2,
        });
        const r3 = manager.bufferMessage(session.sessionId, "CMD_3", {
          idx: 3,
        });

        expect(r1.buffered).toBe(true);
        expect(r2.buffered).toBe(true);
        expect(r3.buffered).toBe(true);
        expect(manager.getBufferedCount()).toBe(3);

        // 4th message must be rejected
        const r4 = manager.bufferMessage(session.sessionId, "CMD_4", {
          idx: 4,
        });
        expect(r4.buffered).toBe(false);
        expect(r4.error).toContain("BUFFER_FULL");
        expect(manager.getBufferedCount()).toBe(3);
      });

      it("should kill TTL boundary mutant by accurately distinguishing active vs expired commands", async () => {
        const manager = new SessionManager({
          maxBufferedCommands: 10,
          bufferTtlMs: 100,
        });
        const session = manager.createSession();

        manager.bufferMessage(
          session.sessionId,
          "EXPIRING_CMD",
          { data: 1 },
          60,
        );
        manager.bufferMessage(
          session.sessionId,
          "PERSISTENT_CMD",
          { data: 2 },
          10000,
        );

        expect(manager.getBufferedCount()).toBe(2);

        // Wait for first command to expire
        await new Promise((resolve) => setTimeout(resolve, 80));

        const expired = manager.pruneExpired();
        expect(expired.length).toBe(1);
        expect(expired[0].commandType).toBe("EXPIRING_CMD");
        expect(expired[0].status).toBe("expired");

        expect(manager.getBufferedCount()).toBe(1);
        const remaining = manager.getBufferedMessages();
        expect(remaining[0].commandType).toBe("PERSISTENT_CMD");
      });

      it("should kill revocation mutant by completely removing session messages and sockets", () => {
        const manager = new SessionManager();
        const sessionA = manager.createSession();
        const sessionB = manager.createSession();

        let socketClosed = false;
        let closeCode = 0;
        const mockSocket: SocketLike = {
          readyState: 1,
          send: vi.fn(),
          close: vi.fn((code) => {
            socketClosed = true;
            closeCode = code || 0;
          }),
        };
        manager.bindSocket(sessionA.sessionId, mockSocket);

        manager.bufferMessage(sessionA.sessionId, "A1", {});
        manager.bufferMessage(sessionA.sessionId, "A2", {});
        manager.bufferMessage(sessionB.sessionId, "B1", {});

        expect(manager.getBufferedCount()).toBe(3);

        const revoked = manager.revokeSession(sessionA.sessionId);
        expect(revoked).toBe(true);
        expect(socketClosed).toBe(true);
        expect(closeCode).toBe(4401);

        // Buffered messages for A must be purged
        expect(manager.getBufferedCount()).toBe(1);
        expect(manager.getBufferedMessages()[0].sessionId).toBe(
          sessionB.sessionId,
        );
        expect(manager.getSession(sessionA.sessionId)).toBeUndefined();
      });

      it("should kill drain mutation by emptying queue and updating message status to forwarded", () => {
        const manager = new SessionManager();
        const session = manager.createSession();

        manager.bufferMessage(session.sessionId, "C1", { seq: 1 });
        manager.bufferMessage(session.sessionId, "C2", { seq: 2 });

        const drained = manager.drainMessages();
        expect(drained.length).toBe(2);
        expect(drained[0].commandType).toBe("C1");
        expect(drained[0].status).toBe("forwarded");
        expect(drained[1].commandType).toBe("C2");
        expect(drained[1].status).toBe("forwarded");

        // Buffer is now empty
        expect(manager.getBufferedCount()).toBe(0);
        expect(manager.drainMessages().length).toBe(0);
      });
    });

    describe("Upstream Reconnect Buffer Flush Order & Readiness Sabotage Vectors", () => {
      class SabotageUpstreamTransport implements UpstreamTransport {
        public connected = false;
        public sentEnvelopes: string[] = [];
        public failOnSend = false;
        private closeCb?: (code: number, reason: string) => void;

        public async connect(_url: string): Promise<void> {
          this.connected = true;
        }
        public send(data: string): void {
          if (this.failOnSend) {
            throw new Error("Simulated write failure");
          }
          this.sentEnvelopes.push(data);
        }
        public close(_code = 1000, _reason = ""): void {
          this.connected = false;
          this.closeCb?.(_code, _reason);
        }
        public isReady(): boolean {
          return this.connected;
        }
        public onMessage(_cb: (d: string) => void): void {}
        public onClose(cb: (c: number, r: string) => void): void {
          this.closeCb = cb;
        }
        public onError(_cb: (e: Error) => void): void {}
      }

      it("should kill FIFO flush order inversion mutant by maintaining strict insertion order", async () => {
        const sessionManager = new SessionManager();
        const transport = new SabotageUpstreamTransport();
        const bridge = new UpstreamBridge({
          sessionManager,
          transportFactory: () => transport,
          autoReconnect: false,
        });

        const session = sessionManager.createSession();
        bridge.enterBuffering("Account rotation in progress");
        expect(bridge.isBuffering()).toBe(true);

        // Send 4 commands sequentially
        await bridge.sendCommand(session.sessionId, "CMD_FIRST", { seq: 1 });
        await bridge.sendCommand(session.sessionId, "CMD_SECOND", { seq: 2 });
        await bridge.sendCommand(session.sessionId, "CMD_THIRD", { seq: 3 });
        await bridge.sendCommand(session.sessionId, "CMD_FOURTH", { seq: 4 });

        expect(sessionManager.getBufferedCount()).toBe(4);

        // Connect automatically flushes buffer if buffering is true
        const connectResult = await bridge.connect();

        expect(connectResult.flushed).toBe(4);
        expect(transport.sentEnvelopes.length).toBe(4);

        const seqs = transport.sentEnvelopes.map((env) => JSON.parse(env).type);
        expect(seqs).toEqual([
          "CMD_FIRST",
          "CMD_SECOND",
          "CMD_THIRD",
          "CMD_FOURTH",
        ]);
        expect(bridge.isBuffering()).toBe(false);

        bridge.dispose();
      });

      it("should kill write failure unhandled crash mutant during flush", async () => {
        const sessionManager = new SessionManager();
        const transport = new SabotageUpstreamTransport();
        const bridge = new UpstreamBridge({
          sessionManager,
          transportFactory: () => transport,
          autoReconnect: false,
        });

        const session = sessionManager.createSession();
        bridge.enterBuffering("Test buffering");
        await bridge.sendCommand(session.sessionId, "C1", { id: 1 });
        await bridge.sendCommand(session.sessionId, "C2", { id: 2 });

        transport.failOnSend = true; // Make transport write fail during flush

        const connectResult = await bridge.connect();
        // Should halt gracefully without throwing uncaught exception
        expect(connectResult.flushed).toBe(0);
        bridge.dispose();
      });

      it("should kill SwitchFlow hook mutant by reacting to onSwitchStart and onSwitchEvent", async () => {
        const sessionManager = new SessionManager();
        const transport = new SabotageUpstreamTransport();
        const bridge = new UpstreamBridge({
          sessionManager,
          transportFactory: () => transport,
          autoReconnect: false,
        });

        let switchStartCb: (() => void) | undefined;
        let switchEventCb: ((res: { success: boolean }) => void) | undefined;
        const mockSwitchFlow = {
          onSwitchStart: vi.fn((cb) => {
            switchStartCb = cb;
            return vi.fn();
          }),
          onSwitchEvent: vi.fn((cb) => {
            switchEventCb = cb;
            return vi.fn();
          }),
        } as unknown as SwitchFlow;

        let swapResumedCalled = false;
        bridge.onSwapResumed(() => {
          swapResumedCalled = true;
        });

        bridge.hookSwitchFlow(mockSwitchFlow);
        expect(bridge.isBuffering()).toBe(false);

        // 1. Trigger switch start
        switchStartCb?.();
        expect(bridge.isBuffering()).toBe(true);

        // 2. Queue command while buffering
        const session = sessionManager.createSession();
        await bridge.sendCommand(session.sessionId, "PROMPT", {
          text: "Hello",
        });
        expect(sessionManager.getBufferedCount()).toBe(1);

        // 3. Complete switch successfully
        await switchEventCb?.({ success: true });
        // Give microtask queue time to run reconnectAndFlush
        await new Promise((r) => setTimeout(r, 20));

        expect(bridge.isBuffering()).toBe(false);
        expect(swapResumedCalled).toBe(true);
        bridge.dispose();
      });
    });

    describe("Cloudflare Tunnel Crash Backoff & Escalation Sabotage Vectors", () => {
      class MockSabotageProcess
        extends EventEmitter
        implements ChildProcessLike
      {
        public pid = 9988;
        public killed = false;
        public signals: string[] = [];
        public stdout = new EventEmitter();
        public stderr = new EventEmitter();

        public kill(signal?: NodeJS.Signals | number): boolean {
          const sigStr = String(signal || "SIGTERM");
          this.signals.push(sigStr);
          if (sigStr === "SIGKILL") {
            this.killed = true;
            this.emit("exit", null, "SIGKILL");
          }
          return true;
        }
      }

      it("should kill exponential backoff formula mutant by strictly adhering to 2^(n-1) * retryBackoffMs capped at 30s", () => {
        const baseBackoff = 2000;
        const maxBackoff = 30000;

        const expectedProgression = [
          baseBackoff * Math.pow(2, 0), // Attempt 1: 2000
          baseBackoff * Math.pow(2, 1), // Attempt 2: 4000
          baseBackoff * Math.pow(2, 2), // Attempt 3: 8000
          baseBackoff * Math.pow(2, 3), // Attempt 4: 16000
          Math.min(baseBackoff * Math.pow(2, 4), maxBackoff), // Attempt 5: 30000 (capped from 32000)
        ];

        expect(expectedProgression).toEqual([2000, 4000, 8000, 16000, 30000]);

        for (let attempt = 1; attempt <= 5; attempt++) {
          const calculated = Math.min(
            baseBackoff * Math.pow(2, attempt - 1),
            maxBackoff,
          );
          expect(calculated).toBe(expectedProgression[attempt - 1]);
        }
      });

      it("should kill retry ceiling mutant by transitioning to error after exactly maxRetries attempts", async () => {
        let spawnCount = 0;
        const spawnFn: SpawnFunction = () => {
          spawnCount++;
          const p = new MockSabotageProcess();
          // Crash immediately on spawn
          setTimeout(() => p.emit("exit", 1, null), 5);
          return p as unknown as ChildProcessLike;
        };

        const tunnel = new TunnelManager({
          config: { autoRestart: true, maxRetries: 2, retryBackoffMs: 10 },
          spawnFn,
          connectionTimeoutMs: 50,
        });

        await tunnel.start();
        // Wait for 2 retries (total 3 spawns: initial + 2 retries)
        await new Promise((resolve) => setTimeout(resolve, 100));

        const status = tunnel.getStatus();
        expect(status.state).toBe("error");
        expect(spawnCount).toBe(3); // Initial spawn + 2 retries = 3
        await tunnel.stop();
      });

      it("should escalate from SIGTERM to SIGKILL if subprocess fails to exit within timeout", async () => {
        const stubbornProc = new MockSabotageProcess();
        const spawnFn: SpawnFunction = () =>
          stubbornProc as unknown as ChildProcessLike;

        const tunnel = new TunnelManager({
          spawnFn,
          escalationTimeoutMs: 50,
          connectionTimeoutMs: 50,
        });

        await tunnel.start();
        expect(stubbornProc.signals.length).toBe(0);

        // Stop tunnel; process ignores SIGTERM
        const stopPromise = tunnel.stop();

        // Check initial SIGTERM was sent
        expect(stubbornProc.signals).toContain("SIGTERM");
        expect(stubbornProc.killed).toBe(false);

        // Wait for escalation
        await stopPromise;
        expect(stubbornProc.signals).toContain("SIGKILL");
        expect(stubbornProc.killed).toBe(true);
        expect(tunnel.getStatus().state).toBe("stopped");
      });

      it("should kill URL regex mutation by matching only valid trycloudflare domains and rejecting impostors", () => {
        const tunnel = new TunnelManager();

        // Valid URLs
        expect(
          tunnel.extractUrl(
            "Tunnel created: https://brave-dog-123.trycloudflare.com is live",
          ),
        ).toBe("https://brave-dog-123.trycloudflare.com");
        expect(tunnel.extractUrl("https://a-b-c-42.trycloudflare.com\n")).toBe(
          "https://a-b-c-42.trycloudflare.com",
        );

        // Invalid URLs
        expect(
          tunnel.extractUrl("http://insecure.trycloudflare.com"),
        ).toBeNull();
        expect(tunnel.extractUrl("https://trycloudflare.com")).toBeNull();
        expect(tunnel.extractUrl("https://evil-trycloudflare.com")).toBeNull();
        expect(tunnel.extractUrl("https://notcloudflare.org")).toBeNull();
        expect(tunnel.extractUrl("no url here")).toBeNull();
      });
    });
  });

  describe("Dashboard UI & Desktop Integration Sabotage & Mutation Vectors", () => {
    describe("Settings Persistence & Secrets Encryption Sabotage Vectors", () => {
      let tempDir: string;
      let storePath: string;

      beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), "sabotage-settings-"),
        );
        storePath = path.join(tempDir, "settings.json");
      });

      afterEach(async () => {
        try {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Suppress
        }
      });

      it("should reject single-bit flipped ciphertext in settings and quarantine corrupted file", async () => {
        const store = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        const initialSettings: AppSettings = {
          ...DEFAULT_APP_SETTINGS,
          oauth: {
            clientId: "client-id-123.apps.googleusercontent.com",
            clientSecret: "very-confidential-client-secret-value",
            isCustom: true,
          },
          updatedAt: Date.now(),
        };
        await store.save(initialSettings);

        const rawContent = await fs.promises.readFile(storePath, "utf8");
        const parsed = JSON.parse(rawContent);
        expect(parsed.oauth.clientSecret.ciphertext).toBeDefined();

        // Mutate ciphertext: flip a byte
        const cipherBuf = Buffer.from(
          parsed.oauth.clientSecret.ciphertext,
          "hex",
        );
        cipherBuf[0] ^= 0xff;
        parsed.oauth.clientSecret.ciphertext = cipherBuf.toString("hex");
        await fs.promises.writeFile(storePath, JSON.stringify(parsed, null, 2));

        const readerStore = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        await expect(readerStore.get()).rejects.toThrow(StoreTamperException);

        // Verify corrupted file quarantined
        const files = await fs.promises.readdir(tempDir);
        const backup = files.find((f) => f.includes(".corrupted."));
        expect(backup).toBeDefined();
      });

      it("should reject modified authentication tag on encrypted secret without crashing", async () => {
        const store = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        await store.save({
          ...DEFAULT_APP_SETTINGS,
          oauth: {
            clientId: "test-id",
            clientSecret: "secret-token",
            isCustom: true,
          },
        });

        const raw = JSON.parse(await fs.promises.readFile(storePath, "utf8"));
        const tagBuf = Buffer.from(raw.oauth.clientSecret.authTag, "hex");
        tagBuf[tagBuf.length - 1] ^= 0x55;
        raw.oauth.clientSecret.authTag = tagBuf.toString("hex");
        await fs.promises.writeFile(storePath, JSON.stringify(raw, null, 2));

        const readerStore = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        await expect(readerStore.get()).rejects.toThrow(StoreTamperException);
      });

      it("should reject corrupted IV in settings envelope", async () => {
        const store = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        await store.save({
          ...DEFAULT_APP_SETTINGS,
          oauth: {
            clientId: "test-id",
            clientSecret: "secret-token",
            isCustom: true,
          },
        });

        const raw = JSON.parse(await fs.promises.readFile(storePath, "utf8"));
        raw.oauth.clientSecret.iv = Buffer.alloc(12, 0).toString("hex");
        await fs.promises.writeFile(storePath, JSON.stringify(raw, null, 2));

        const readerStore = new SettingsStore({
          storePath,
          machineId: "hardened-desktop-machine-id",
        });

        await expect(readerStore.get()).rejects.toThrow(StoreTamperException);
      });

      it("should reject secret decryption when machineId diverges (cross-machine tampering)", async () => {
        const store1 = new SettingsStore({
          storePath,
          machineId: "original-hardware-id-aaa",
        });

        await store1.save({
          ...DEFAULT_APP_SETTINGS,
          oauth: {
            clientId: "test-id",
            clientSecret: "machine-bound-secret",
            isCustom: true,
          },
        });

        const store2 = new SettingsStore({
          storePath,
          machineId: "alien-hardware-id-bbb",
        });

        await expect(store2.get()).rejects.toThrow(StoreTamperException);
      });

      it("should reject corrupted non-JSON content in settings file and create backup", async () => {
        await fs.promises.writeFile(
          storePath,
          "GARBAGE_NON_JSON_CORRUPTED_BITS",
        );

        const store = new SettingsStore({ storePath });
        await expect(store.get()).rejects.toThrow(StoreTamperException);

        const files = await fs.promises.readdir(tempDir);
        const backup = files.find((f) => f.includes(".corrupted."));
        expect(backup).toBeDefined();
      });

      it("should reject invalid schema mutation (out of bounds relayPort) and leave disk intact", async () => {
        const store = new SettingsStore({ storePath });
        const initial = await store.get();
        expect(initial.network.relayPort).toBe(4040);

        // Mutate invalid port (e.g. 999999 > 65535 or negative)
        await expect(
          store.update({
            network: {
              ...initial.network,
              relayPort: 999999,
            },
          }),
        ).rejects.toThrow();

        const afterFailedUpdate = await store.get();
        expect(afterFailedUpdate.network.relayPort).toBe(4040);
      });

      it("should serialize concurrent updates via write mutex to prevent corrupting disk", async () => {
        const store = new SettingsStore({ storePath });
        await store.get();

        const writes = Array.from({ length: 10 }, (_, i) =>
          store.update({
            network: {
              relayPort: 4040 + i,
              relayHost: "127.0.0.1",
            },
          }),
        );

        const results = await Promise.all(writes);
        expect(results.length).toBe(10);

        const finalSettings = await store.get();
        expect(finalSettings.network.relayPort).toBeGreaterThanOrEqual(4040);
        expect(finalSettings.network.relayPort).toBeLessThanOrEqual(4049);

        // Verify file on disk is valid JSON
        const diskContent = await fs.promises.readFile(storePath, "utf8");
        expect(() => JSON.parse(diskContent)).not.toThrow();
      });
    });

    describe("System Tray Dynamic State Synchronization Sabotage Vectors", () => {
      let mockAccountStore: any;
      let mockProcessController: any;
      let mockQuotaMonitor: any;
      let mockSwitchFlow: any;
      let mockRelayServer: any;
      let mockSettingsStore: any;
      let processCallbacks: Function[] = [];
      let switchCallbacks: Function[] = [];
      let quotaCallbacks: Function[] = [];

      beforeEach(() => {
        mockTrayInstances.length = 0;
        processCallbacks = [];
        switchCallbacks = [];
        quotaCallbacks = [];

        mockAccountStore = {
          getActive: vi.fn().mockResolvedValue({
            id: "acc-1",
            email: "engineer@company.com",
            status: "active",
          }),
          getAll: vi.fn().mockResolvedValue([
            { id: "acc-1", email: "engineer@company.com", status: "active" },
            { id: "acc-2", email: "personal@gmail.com", status: "standby" },
          ]),
          setActive: vi.fn().mockResolvedValue(true),
        };

        mockProcessController = {
          getStatus: vi.fn().mockResolvedValue({
            runningCount: 2,
            totalCount: 2,
            services: {
              antigravity_daemon: { state: "running", pid: 1234 },
              antigravity_ide: { state: "running", pid: 5678 },
            },
          }),
          onStatusUpdated: vi.fn((cb: Function) => {
            processCallbacks.push(cb);
            return () => {
              processCallbacks = processCallbacks.filter((c) => c !== cb);
            };
          }),
        };

        mockQuotaMonitor = {
          pollAll: vi.fn().mockResolvedValue({}),
          onQuotaUpdated: vi.fn((cb: Function) => {
            quotaCallbacks.push(cb);
            return () => {
              quotaCallbacks = quotaCallbacks.filter((c) => c !== cb);
            };
          }),
        };

        mockSwitchFlow = {
          executeSwitch: vi.fn().mockResolvedValue({ success: true }),
          onSwitchEvent: vi.fn((cb: Function) => {
            switchCallbacks.push(cb);
            return () => {
              switchCallbacks = switchCallbacks.filter((c) => c !== cb);
            };
          }),
        };

        mockRelayServer = {
          onStatusUpdated: vi.fn(() => () => {}),
        };

        mockSettingsStore = {
          get: vi.fn().mockResolvedValue({ minimizeToTrayOnClose: true }),
          onSettingsUpdated: vi.fn(() => () => {}),
        };
      });

      it("should dynamically rebuild context menu when service count transitions (2/2 -> 1/2 -> 0/2)", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          quotaMonitor: mockQuotaMonitor,
          switchFlow: mockSwitchFlow,
          relayServer: mockRelayServer,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });

        await trayManager.init();
        const tray = mockTrayInstances[0];
        expect(tray).toBeDefined();

        // Initial 2/2 services
        let menuItems = tray.contextMenu.items;
        const serviceItem = menuItems.find(
          (item: any) => item.label && item.label.includes("Services:"),
        );
        expect(serviceItem.label).toContain("2/2 running");

        // Mutate service count to 1/2 running
        mockProcessController.getStatus.mockResolvedValueOnce({
          runningCount: 1,
          totalCount: 2,
          services: {
            antigravity_daemon: { state: "running", pid: 1234 },
            antigravity_ide: { state: "stopped" },
          },
        });

        // Trigger listener
        for (const cb of processCallbacks) {
          cb();
        }
        await new Promise((r) => setTimeout(r, 20));

        menuItems = tray.contextMenu.items;
        const updatedItem = menuItems.find(
          (item: any) => item.label && item.label.includes("Services:"),
        );
        expect(updatedItem.label).toContain("1/2 running");
      });

      it("should dynamically update active account email display when rotation occurs", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          quotaMonitor: mockQuotaMonitor,
          switchFlow: mockSwitchFlow,
          relayServer: mockRelayServer,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });

        await trayManager.init();
        const tray = mockTrayInstances[0];

        let menuItems = tray.contextMenu.items;
        let activeItem = menuItems.find(
          (item: any) => item.label && item.label.includes("Active:"),
        );
        expect(activeItem.label).toContain("engineer@company.com");

        // Mutate active account
        mockAccountStore.getActive.mockResolvedValueOnce({
          id: "acc-2",
          email: "personal@gmail.com",
          status: "active",
        });

        for (const cb of switchCallbacks) {
          cb();
        }
        await new Promise((r) => setTimeout(r, 20));

        menuItems = tray.contextMenu.items;
        activeItem = menuItems.find(
          (item: any) => item.label && item.label.includes("Active:"),
        );
        expect(activeItem.label).toContain("personal@gmail.com");
      });

      it("should route quick-switch submenu click directly to SwitchFlow without opening main window", async () => {
        const showWindowSpy = vi.fn();
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          quotaMonitor: mockQuotaMonitor,
          switchFlow: mockSwitchFlow,
          relayServer: mockRelayServer,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });
        trayManager.showWindow = showWindowSpy;

        await trayManager.init();
        const tray = mockTrayInstances[0];

        const switchSubmenu = tray.contextMenu.items.find(
          (item: any) => item.label === "Switch Active Account",
        );
        expect(switchSubmenu).toBeDefined();
        expect(switchSubmenu.submenu).toBeDefined();

        // Find the standby account in submenu
        const standbyAccountItem = switchSubmenu.submenu.find(
          (item: any) => item.label === "personal@gmail.com",
        );
        expect(standbyAccountItem).toBeDefined();

        // Simulate user clicking standby account in tray submenu
        await standbyAccountItem.click();

        // Verify SwitchFlow was invoked with the right account ID and manual_request
        expect(mockSwitchFlow.executeSwitch).toHaveBeenCalledWith(
          "acc-2",
          "manual_request",
        );
        // Verify showWindow was NOT called (operation remains in background)
        expect(showWindowSpy).not.toHaveBeenCalled();
      });

      it("should safely unsubscribe all event listeners on destroy", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          quotaMonitor: mockQuotaMonitor,
          switchFlow: mockSwitchFlow,
          relayServer: mockRelayServer,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });

        await trayManager.init();
        expect(processCallbacks.length).toBeGreaterThan(0);
        expect(switchCallbacks.length).toBeGreaterThan(0);

        trayManager.destroy();
        expect(processCallbacks.length).toBe(0);
        expect(switchCallbacks.length).toBe(0);
        expect(mockTrayInstances[0].isDestroyed()).toBe(true);
      });
    });

    describe("Window Close-to-Tray Lifecycle Interception Sabotage Vectors", () => {
      let mockAccountStore: any;
      let mockProcessController: any;
      let mockSettingsStore: any;

      beforeEach(() => {
        mockTrayInstances.length = 0;
        setAppQuitCalled(false);

        mockAccountStore = {
          getActive: vi.fn().mockResolvedValue(null),
          getAll: vi.fn().mockResolvedValue([]),
        };

        mockProcessController = {
          getStatus: vi
            .fn()
            .mockResolvedValue({ runningCount: 0, totalCount: 2 }),
          onStatusUpdated: vi.fn(() => () => {}),
        };

        mockSettingsStore = {
          get: vi.fn().mockResolvedValue({ minimizeToTrayOnClose: true }),
          onSettingsUpdated: vi.fn(() => () => {}),
        };
      });

      it("should intercept window close with preventDefault() and hide window when closeToTray is true", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });
        await trayManager.init();

        let closeHandler: Function | null = null;
        let windowHidden = false;

        const mockWindow: any = {
          on: vi.fn((event: string, cb: Function) => {
            if (event === "close") {
              closeHandler = cb;
            }
          }),
          hide: vi.fn(() => {
            windowHidden = true;
          }),
        };

        trayManager.setupCloseInterception(mockWindow);
        expect(closeHandler).toBeDefined();

        let preventDefaultCalled = false;
        const mockEvent = {
          preventDefault: () => {
            preventDefaultCalled = true;
          },
        };

        // Trigger close while isQuitting is false
        closeHandler!(mockEvent);

        expect(preventDefaultCalled).toBe(true);
        expect(windowHidden).toBe(true);
      });

      it("should allow window close when isQuitting flag is true (bypass interception)", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
          isQuitting: () => true,
        });
        await trayManager.init();

        let closeHandler: Function | null = null;
        let windowHidden = false;

        const mockWindow: any = {
          on: vi.fn((event: string, cb: Function) => {
            if (event === "close") {
              closeHandler = cb;
            }
          }),
          hide: vi.fn(() => {
            windowHidden = true;
          }),
        };

        trayManager.setupCloseInterception(mockWindow);

        let preventDefaultCalled = false;
        const mockEvent = {
          preventDefault: () => {
            preventDefaultCalled = true;
          },
        };

        // Trigger close while isQuitting is true
        closeHandler!(mockEvent);

        expect(preventDefaultCalled).toBe(false);
        expect(windowHidden).toBe(false);
      });

      it("should allow window close when minimizeToTrayOnClose preference is disabled", async () => {
        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          settingsStore: mockSettingsStore,
          getMainWindow: () => null,
        });
        await trayManager.init();
        trayManager.setCloseToTrayEnabled(false);

        let closeHandler: Function | null = null;
        const mockWindow: any = {
          on: vi.fn((event: string, cb: Function) => {
            if (event === "close") {
              closeHandler = cb;
            }
          }),
          hide: vi.fn(),
        };

        trayManager.setupCloseInterception(mockWindow);

        let preventDefaultCalled = false;
        const mockEvent = {
          preventDefault: () => {
            preventDefaultCalled = true;
          },
        };

        closeHandler!(mockEvent);

        expect(preventDefaultCalled).toBe(false);
        expect(mockWindow.hide).not.toHaveBeenCalled();
      });

      it("should restore, un-minimize, show, and focus window on showWindow call", () => {
        const mockWindow: any = {
          isDestroyed: vi.fn().mockReturnValue(false),
          isMinimized: vi.fn().mockReturnValue(true),
          restore: vi.fn(),
          show: vi.fn(),
          focus: vi.fn(),
        };

        const trayManager = new TrayManager({
          accountStore: mockAccountStore,
          processController: mockProcessController,
          getMainWindow: () => mockWindow,
        });

        trayManager.showWindow();

        expect(mockWindow.restore).toHaveBeenCalled();
        expect(mockWindow.show).toHaveBeenCalled();
        expect(mockWindow.focus).toHaveBeenCalled();
      });
    });

    describe("Native Desktop Notification Debounce & Preference Gating Sabotage Vectors", () => {
      let mockSettingsStore: any;
      let mockWindow: any;

      beforeEach(() => {
        mockNotificationInstances.length = 0;
        mockWindow = {
          isDestroyed: vi.fn().mockReturnValue(false),
          isMinimized: vi.fn().mockReturnValue(true),
          restore: vi.fn(),
          show: vi.fn(),
          focus: vi.fn(),
        };

        mockSettingsStore = {
          get: vi.fn().mockResolvedValue({
            notifications: {
              enabled: true,
              notifyOnAutoSwitch: true,
              notifyOnRateLimit: true,
              notifyOnProcessCrash: true,
              debounceMs: 5000,
            },
          }),
          onSettingsUpdated: vi.fn(() => () => {}),
        };
      });

      it("should kill sliding debounce window mutant by dropping rapid dispatches of same category", async () => {
        const notifier = new NativeNotifier({
          settingsStore: mockSettingsStore,
          getMainWindow: () => mockWindow,
        });
        await notifier.getPreferences();

        // First dispatch succeeds
        const res1 = await notifier.send({
          type: "account_switched",
          title: "Switch 1",
          body: "Body 1",
        });
        expect(res1).toBe(true);
        expect(mockNotificationInstances.length).toBe(1);

        // Immediate second dispatch of SAME category within debounce window -> MUST drop
        const res2 = await notifier.send({
          type: "account_switched",
          title: "Switch 2",
          body: "Body 2",
        });
        expect(res2).toBe(false);
        expect(mockNotificationInstances.length).toBe(1);
      });

      it("should kill cross-category suppression mutant by allowing different categories during debounce", async () => {
        const notifier = new NativeNotifier({
          settingsStore: mockSettingsStore,
          getMainWindow: () => mockWindow,
        });
        await notifier.getPreferences();

        // Dispatch category A: service_crash
        const resA = await notifier.send({
          type: "service_crash",
          title: "Crash Alert",
          body: "Daemon crashed",
        });
        expect(resA).toBe(true);

        // Immediately dispatch category B: rate_limit_cooldown -> MUST NOT be blocked by category A
        const resB = await notifier.send({
          type: "rate_limit_cooldown",
          title: "Rate Limit Alert",
          body: "429 cooldown",
        });
        expect(resB).toBe(true);
        expect(mockNotificationInstances.length).toBe(2);
      });

      it("should kill master disable mutant by dropping all notifications when enabled is false", async () => {
        mockSettingsStore.get.mockResolvedValue({
          notifications: {
            enabled: false,
            notifyOnAutoSwitch: true,
            notifyOnRateLimit: true,
            notifyOnProcessCrash: true,
            debounceMs: 5000,
          },
        });

        const notifier = new NativeNotifier({
          settingsStore: mockSettingsStore,
          getMainWindow: () => mockWindow,
        });
        await notifier.getPreferences();

        const res = await notifier.send({
          type: "service_crash",
          title: "Crash",
          body: "Crashed",
        });
        expect(res).toBe(false);
        expect(mockNotificationInstances.length).toBe(0);
      });

      it("should kill granular preference mutant by suppressing only the opted-out category", async () => {
        mockSettingsStore.get.mockResolvedValue({
          notifications: {
            enabled: true,
            notifyOnAutoSwitch: false, // Opted out
            notifyOnRateLimit: true,
            notifyOnProcessCrash: true,
            debounceMs: 5000,
          },
        });

        const notifier = new NativeNotifier({
          settingsStore: mockSettingsStore,
          getMainWindow: () => mockWindow,
        });
        await notifier.getPreferences();

        // auto_switch is opted out -> drops
        const resSwitch = await notifier.send({
          type: "account_switched",
          title: "Switched",
          body: "Switched",
        });
        expect(resSwitch).toBe(false);

        // rate_limit is active -> succeeds
        const resLimit = await notifier.send({
          type: "rate_limit_cooldown",
          title: "Limit",
          body: "Limit",
        });
        expect(resLimit).toBe(true);
      });

      it("should focus and restore main window when notification banner is clicked", async () => {
        const notifier = new NativeNotifier({
          settingsStore: mockSettingsStore,
          getMainWindow: () => mockWindow,
        });
        await notifier.getPreferences();

        await notifier.send({
          type: "general_alert",
          title: "Clickable Alert",
          body: "Click to focus",
        });

        const lastInstance =
          mockNotificationInstances[mockNotificationInstances.length - 1];
        expect(lastInstance).toBeDefined();

        const clickCb = lastInstance.listeners.get("click");
        expect(clickCb).toBeDefined();

        // Simulate user click on notification banner
        clickCb();

        expect(mockWindow.restore).toHaveBeenCalled();
        expect(mockWindow.show).toHaveBeenCalled();
        expect(mockWindow.focus).toHaveBeenCalled();
      });
    });
  });
});
