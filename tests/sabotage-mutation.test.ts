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
});
