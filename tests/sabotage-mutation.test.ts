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
});
