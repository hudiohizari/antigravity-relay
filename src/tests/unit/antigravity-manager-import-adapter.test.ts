import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AntigravityManagerImportAdapter,
  normalizeEmailHint,
  resolveAntigravityManagerDatabasePath,
  resolveAntigravityManagerMasterKeyPaths,
} from "@/modules/cloud-account/persistence/antigravity-manager-import-adapter";
import { encryptWithKey } from "@/shared/security/crypto";

interface MockDbConfig {
  tables?: Array<{ name: string }>;
  tableColumns?: Record<string, Array<{ name: string }>>;
  rows?: any[];
  pragmaHandler?: (pragma: string) => any;
  throwOnOpen?: Error;
  throwOnQuery?: Error;
}

function createMockDatabase(config: MockDbConfig = {}) {
  const pragmaCalls: string[] = [];
  let closed = false;

  const db = {
    pragma: vi.fn((cmd: string) => {
      pragmaCalls.push(cmd);
      if (config.pragmaHandler) {
        return config.pragmaHandler(cmd);
      }
      return [];
    }),
    prepare: vi.fn((sql: string) => {
      if (config.throwOnQuery) {
        throw config.throwOnQuery;
      }
      return {
        all: vi.fn(() => {
          if (sql.includes("sqlite_master")) {
            return config.tables ?? [{ name: "accounts" }];
          }
          if (sql.includes("PRAGMA table_info")) {
            const match = sql.match(/table_info\((.+?)\)/i);
            const tableName = match ? match[1] : "accounts";
            return (
              config.tableColumns?.[tableName] ?? [
                { name: "id" },
                { name: "email" },
                { name: "name" },
                { name: "avatar_url" },
                { name: "token_json" },
                { name: "status" },
              ]
            );
          }
          return config.rows ?? [];
        }),
      };
    }),
    close: vi.fn(() => {
      closed = true;
    }),
    get isClosed() {
      return closed;
    },
    get pragmaCalls() {
      return pragmaCalls;
    },
  };

  return db;
}

describe("AntigravityManagerImportAdapter", () => {
  const testKey = crypto.randomBytes(32);
  const testKeyHex = testKey.toString("hex");

  describe("Path Resolution", () => {
    it("resolves macOS default database and master key paths", () => {
      const dbPath = resolveAntigravityManagerDatabasePath({
        platform: "darwin",
        homeDir: "/Users/testuser",
      });
      const keyPaths = resolveAntigravityManagerMasterKeyPaths({
        platform: "darwin",
        homeDir: "/Users/testuser",
      });

      expect(dbPath).toBe(
        "/Users/testuser/.antigravity-agent/cloud_accounts.db",
      );
      expect(keyPaths).toEqual([
        "/Users/testuser/Library/Application Support/Antigravity Manager/.mk",
      ]);
    });

    it("resolves Windows default database and master key paths", () => {
      const dbPath = resolveAntigravityManagerDatabasePath({
        platform: "win32",
        homeDir: "C:\\Users\\testuser",
        env: {
          USERPROFILE: "C:\\Users\\testuser",
          APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        },
      });
      const keyPaths = resolveAntigravityManagerMasterKeyPaths({
        platform: "win32",
        homeDir: "C:\\Users\\testuser",
        env: {
          USERPROFILE: "C:\\Users\\testuser",
          APPDATA: "C:\\Users\\testuser\\AppData\\Roaming",
        },
      });

      expect(dbPath).toContain(".antigravity-agent");
      expect(dbPath).toContain("cloud_accounts.db");
      expect(keyPaths).toEqual([
        "C:\\Users\\testuser\\AppData\\Roaming/Antigravity Manager/.mk",
      ]);
    });

    it("resolves Linux default database and master key paths including fallback", () => {
      const dbPath = resolveAntigravityManagerDatabasePath({
        platform: "linux",
        homeDir: "/home/testuser",
      });
      const keyPaths = resolveAntigravityManagerMasterKeyPaths({
        platform: "linux",
        homeDir: "/home/testuser",
        env: { XDG_CONFIG_HOME: "/home/testuser/.config" },
      });

      expect(dbPath).toBe(
        "/home/testuser/.antigravity-agent/cloud_accounts.db",
      );
      expect(keyPaths).toEqual([
        "/home/testuser/.config/Antigravity Manager/.mk",
        "/home/testuser/.config/antigravity-manager/.mk",
      ]);
    });

    it("honors injected custom paths in adapter constructor", () => {
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/custom/db.sqlite",
        masterKeyPaths: ["/custom/key.mk"],
      });

      expect(adapter.getDatabasePath()).toBe("/custom/db.sqlite");
      expect(adapter.getMasterKeyPaths()).toEqual(["/custom/key.mk"]);
    });
  });

  describe("Master Key Resolution Chain", () => {
    it("resolves 64-hex master key from .mk file directly", async () => {
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/db.sqlite",
        masterKeyPaths: ["/test/.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 64 }),
        readFile: () => Buffer.from(testKeyHex, "utf8"),
      });

      const keys = await adapter.resolveMasterKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].equals(testKey)).toBe(true);
    });

    it("ignores .mk file exceeding 64KB limit", async () => {
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/db.sqlite",
        masterKeyPaths: ["/test/huge.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 65 * 1024 }),
        readFile: () => Buffer.from(testKeyHex, "utf8"),
      });

      const keys = await adapter.resolveMasterKeys();
      expect(keys).toEqual([]);
    });

    it("decrypts binary .mk file via SafeStorage fallback", async () => {
      const binaryCiphertext = Buffer.from("encrypted-safe-storage-key");
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/db.sqlite",
        masterKeyPaths: ["/test/.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 32 }),
        readFile: () => binaryCiphertext,
        safeStorageDecrypt: (buf) => {
          if (buf.equals(binaryCiphertext)) {
            return testKeyHex;
          }
          return null;
        },
      });

      const keys = await adapter.resolveMasterKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].equals(testKey)).toBe(true);
    });

    it("retrieves master key from OS Keychain (keytar) fallback", async () => {
      const mockKeytar = {
        getPassword: vi.fn(async (service: string, account: string) => {
          if (service === "Antigravity Manager" && account === "MasterKey") {
            return testKeyHex;
          }
          return null;
        }),
      };

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/db.sqlite",
        masterKeyPaths: ["/test/nonexistent.mk"],
        existsSync: () => false,
        keytar: mockKeytar,
      });

      const keys = await adapter.resolveMasterKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].equals(testKey)).toBe(true);
    });

    it("falls back to Relay MasterKeyManager decryption keys", async () => {
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/db.sqlite",
        masterKeyPaths: ["/test/nonexistent.mk"],
        existsSync: () => false,
        keytar: { getPassword: async () => null },
        getRelayDecryptionKeys: () => [{ key: testKey, source: "safeStorage" }],
      });

      const keys = await adapter.resolveMasterKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].equals(testKey)).toBe(true);
    });
  });

  describe("Database Connection & PRAGMA Guards", () => {
    it("executes readonly, query_only = ON, busy_timeout = 3000, and closes db", async () => {
      const mockDb = createMockDatabase({
        rows: [
          {
            id: "1",
            email: "user@example.com",
            token_json: JSON.stringify({ refresh_token: "valid-refresh" }),
          },
        ],
      });

      let openedOptions: any;
      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        existsSync: () => true,
        openDatabase: (_path, opts) => {
          openedOptions = opts;
          return mockDb as any;
        },
      });

      const result = await adapter.importAccounts();

      expect(openedOptions).toEqual({ readonly: true, fileMustExist: true });
      expect(mockDb.pragmaCalls).toContain("query_only = ON");
      expect(mockDb.pragmaCalls).toContain("busy_timeout = 3000");
      expect(mockDb.isClosed).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].credential.refreshToken).toBe(
        "valid-refresh",
      );
    });

    it("unconditionally closes database connection even on query failure", async () => {
      const mockDb = createMockDatabase({
        throwOnQuery: new Error(
          "SQLITE_CORRUPT: database disk image is malformed",
        ),
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        existsSync: () => true,
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(mockDb.isClosed).toBe(true);
      expect(result.candidates).toEqual([]);
      expect(result.failures).toEqual([
        {
          source: { id: "legacy-agent", location: "/test/cloud_accounts.db" },
          code: "malformed",
          message: "The local credential data is malformed.",
        },
      ]);
    });
  });

  describe("Safe SQLite Error Classification", () => {
    it.each([
      ["SQLITE_BUSY", "locked"],
      ["SQLITE_LOCKED", "locked"],
      ["SQLITE_CANTOPEN", "locked"],
      ["database is locked", "locked"],
      ["unable to open database file", "locked"],
      ["SQLITE_CORRUPT", "malformed"],
      ["SQLITE_NOTADB", "malformed"],
      ["file is not a database", "malformed"],
      ["EACCES", "permission-denied"],
      ["permission denied", "permission-denied"],
    ])("maps error %s to code %s", async (errorCondition, expectedCode) => {
      const error = new Error(errorCondition);
      (error as any).code = errorCondition;

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        existsSync: () => true,
        openDatabase: () => {
          throw error;
        },
      });

      const result = await adapter.importAccounts();

      expect(result.candidates).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].code).toBe(expectedCode);
      expect(result.failures[0].source.location).toBe(
        "/test/cloud_accounts.db",
      );
    });

    it("emits locked when encrypted rows exist but master key cannot be resolved", async () => {
      const encryptedPayload = encryptWithKey(
        testKey,
        JSON.stringify({ refresh_token: "secret" }),
      );
      const mockDb = createMockDatabase({
        rows: [
          {
            id: "enc-1",
            email: "user@example.com",
            token_json: encryptedPayload,
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        masterKeyPaths: ["/test/.mk"],
        existsSync: (p) => p === "/test/cloud_accounts.db",
        openDatabase: () => mockDb as any,
        keytar: { getPassword: async () => null },
        getRelayDecryptionKeys: () => [],
      });

      const result = await adapter.importAccounts();

      expect(result.candidates).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toEqual({
        source: { id: "legacy-agent", location: "/test/cloud_accounts.db" },
        code: "locked",
        message: "The local credential source is locked or busy.",
      });
    });
  });

  describe("Schema Drift Tolerance & Decryption", () => {
    it("discovers and decrypts versioned agm_enc_v1 tokens", async () => {
      const encrypted = encryptWithKey(
        testKey,
        JSON.stringify({
          access_token: "acc-token",
          refresh_token: "ref-token",
          id_token: "id-tok",
          project_id: "my-proj",
          expiry_timestamp: 1800000000,
        }),
      );

      const mockDb = createMockDatabase({
        rows: [
          {
            id: "acc-1",
            email: "user@example.com",
            token_json: encrypted,
            status: "active",
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        masterKeyPaths: ["/test/.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 64 }),
        readFile: () => Buffer.from(testKeyHex, "utf8"),
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(result.failures).toEqual([]);
      expect(result.candidates).toEqual([
        {
          source: {
            id: "legacy-agent",
            location: "/test/cloud_accounts.db",
          },
          credential: {
            accessToken: "acc-token",
            refreshToken: "ref-token",
            idToken: "id-tok",
            projectId: "my-proj",
            expiryTimestamp: 1800000000,
          },
          emailHint: "user@example.com",
        },
      ]);
    });

    it("discovers and decrypts unversioned AES-256-GCM tokens", async () => {
      const versioned = encryptWithKey(
        testKey,
        JSON.stringify({ refresh_token: "unversioned-refresh" }),
      );
      const unversioned = versioned.replace("agm_enc_v1:", "");

      const mockDb = createMockDatabase({
        rows: [
          {
            id: "acc-2",
            email: "unversioned@example.com",
            token_json: unversioned,
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        masterKeyPaths: ["/test/.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 64 }),
        readFile: () => Buffer.from(testKeyHex, "utf8"),
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(result.failures).toEqual([]);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].credential.refreshToken).toBe(
        "unversioned-refresh",
      );
    });

    it("falls back to cloud_accounts table when accounts table does not exist", async () => {
      const mockDb = createMockDatabase({
        tables: [{ name: "cloud_accounts" }],
        rows: [
          {
            id: "legacy-1",
            email: "old@example.com",
            token_json: JSON.stringify({ refresh_token: "old-refresh" }),
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        existsSync: () => true,
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(result.failures).toEqual([]);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].credential.refreshToken).toBe("old-refresh");
    });

    it("extracts credentials even if row status is revoked or disabled", async () => {
      const mockDb = createMockDatabase({
        rows: [
          {
            id: "revoked-1",
            email: "revoked@example.com",
            token_json: JSON.stringify({ refresh_token: "revoked-refresh" }),
            status: "revoked",
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        existsSync: () => true,
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].credential.refreshToken).toBe(
        "revoked-refresh",
      );
    });
  });

  describe("Row-Level Error Isolation", () => {
    it("isolates corrupt row to cloud_accounts.db#<id> without dropping valid rows", async () => {
      const validPayload = encryptWithKey(
        testKey,
        JSON.stringify({ refresh_token: "valid-refresh-token" }),
      );

      const mockDb = createMockDatabase({
        rows: [
          {
            id: "valid-1",
            email: "valid@example.com",
            token_json: validPayload,
          },
          {
            id: "corrupt-1",
            email: "corrupt@example.com",
            token_json: "corrupted-non-encrypted-bad-json",
          },
          {
            id: "corrupt-tag",
            email: "tagfail@example.com",
            token_json:
              "agm_enc_v1:0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef:deadbeef",
          },
          {
            id: "missing-refresh",
            email: "norefresh@example.com",
            token_json: JSON.stringify({ access_token: "only-access" }),
          },
        ],
      });

      const adapter = new AntigravityManagerImportAdapter({
        databasePath: "/test/cloud_accounts.db",
        masterKeyPaths: ["/test/.mk"],
        existsSync: () => true,
        statSync: () => ({ size: 64 }),
        readFile: () => Buffer.from(testKeyHex, "utf8"),
        openDatabase: () => mockDb as any,
      });

      const result = await adapter.importAccounts();

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].credential.refreshToken).toBe(
        "valid-refresh-token",
      );
      expect(result.candidates[0].emailHint).toBe("valid@example.com");

      expect(result.failures).toHaveLength(3);
      expect(result.failures).toEqual([
        {
          source: {
            id: "legacy-agent",
            location: "/test/cloud_accounts.db#corrupt-1",
          },
          code: "malformed",
          message: "The local credential data is malformed.",
        },
        {
          source: {
            id: "legacy-agent",
            location: "/test/cloud_accounts.db#corrupt-tag",
          },
          code: "malformed",
          message: "The local credential data is malformed.",
        },
        {
          source: {
            id: "legacy-agent",
            location: "/test/cloud_accounts.db#missing-refresh",
          },
          code: "malformed",
          message: "The local credential data is malformed.",
        },
      ]);
    });
  });

  describe("normalizeEmailHint helper", () => {
    it("normalizes valid emails and suppresses Unknown case-insensitively", () => {
      expect(normalizeEmailHint("  test@example.com  ")).toBe(
        "test@example.com",
      );
      expect(normalizeEmailHint("Unknown")).toBeUndefined();
      expect(normalizeEmailHint("unknown")).toBeUndefined();
      expect(normalizeEmailHint("")).toBeUndefined();
      expect(normalizeEmailHint("   ")).toBeUndefined();
      expect(normalizeEmailHint(undefined)).toBeUndefined();
      expect(normalizeEmailHint(null)).toBeUndefined();
    });
  });
});
