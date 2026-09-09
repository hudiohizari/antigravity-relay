import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { uniq } from "lodash-es";
import { logger } from "@/shared/logging/logger";
import {
  canDecryptPayloadWithKey,
  decryptParsedPayloadWithKey,
  isEncryptedPayloadCandidate,
  parseEncryptedPayload,
} from "@/shared/security/crypto";
import { getDecryptionKeys } from "@/shared/security/security";
import {
  createLocalAccountDiscoveryFailure,
  createLocalAccountDiscoveryFailureByCode,
} from "../local-import/discovery-errors";
import {
  DiscoveredCredentialSchema,
  type LocalAccountCredentialCandidate,
  type LocalAccountDiscoveryFailure,
  type LocalAccountDiscoveryFailureCode,
} from "../local-import/types";

const MAX_MASTER_KEY_FILE_SIZE_BYTES = 64 * 1024;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 3000;
const HEX_64_PATTERN = /^[a-f0-9]{64}$/i;
const KEYCHAIN_SERVICES = [
  "Antigravity Manager",
  "AntigravityManager",
] as const;
const KEYCHAIN_ACCOUNTS = ["MasterKey", "MasterKeyV2"] as const;

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  decryptString?(buffer: Buffer): string;
  decrypt?(buffer: Buffer): Buffer;
}

export interface KeytarAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword?(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
}

export type SqliteDatabaseOpener = (
  dbPath: string,
  options?: Database.Options,
) => Database.Database;

export interface AntigravityManagerImportAdapterOptions {
  agentDir?: string;
  databasePath?: string;
  masterKeyPaths?: string[];
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  openDatabase?: SqliteDatabaseOpener;
  safeStorage?: SafeStorageAdapter | null;
  safeStorageDecrypt?: (buffer: Buffer) => Buffer | string | null;
  keytar?: KeytarAdapter | null;
  keytarLoader?: () => Promise<KeytarAdapter | null> | (KeytarAdapter | null);
  getRelayDecryptionKeys?: () => Array<{ key: Buffer; source?: string }>;
  readFile?: (filePath: string) => Buffer;
  existsSync?: (filePath: string) => boolean;
  statSync?: (filePath: string) => { size: number };
}

export interface AntigravityManagerImportResult {
  candidates: LocalAccountCredentialCandidate[];
  failures: LocalAccountDiscoveryFailure[];
}

export function normalizeEmailHint(
  email: string | undefined | null,
): string | undefined {
  const normalized = email?.trim();
  if (!normalized || normalized.toLowerCase() === "unknown") {
    return undefined;
  }
  return normalized;
}

export function resolveAntigravityManagerDatabasePath(options?: {
  agentDir?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}): string {
  if (options?.agentDir) {
    return path.join(options.agentDir, "cloud_accounts.db");
  }
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const homedir = options?.homeDir ?? os.homedir();

  if (platform === "win32") {
    const userProfile = env.USERPROFILE || homedir;
    return path.join(userProfile, ".antigravity-agent", "cloud_accounts.db");
  }
  return path.join(homedir, ".antigravity-agent", "cloud_accounts.db");
}

export function resolveAntigravityManagerMasterKeyPaths(options?: {
  masterKeyPaths?: string[];
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
}): string[] {
  if (options?.masterKeyPaths && options.masterKeyPaths.length > 0) {
    return options.masterKeyPaths;
  }
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const homedir = options?.homeDir ?? os.homedir();

  if (platform === "darwin") {
    return [
      path.join(
        homedir,
        "Library",
        "Application Support",
        "Antigravity Manager",
        ".mk",
      ),
    ];
  }

  if (platform === "win32") {
    const appData =
      env.APPDATA ||
      path.join(env.USERPROFILE || homedir, "AppData", "Roaming");
    return [path.join(appData, "Antigravity Manager", ".mk")];
  }

  const configHome = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
  const candidatePaths = [
    path.join(configHome, "Antigravity Manager", ".mk"),
    path.join(configHome, "antigravity-manager", ".mk"),
  ];
  const standardConfig = path.join(homedir, ".config");
  if (standardConfig !== configHome) {
    candidatePaths.push(
      path.join(standardConfig, "Antigravity Manager", ".mk"),
      path.join(standardConfig, "antigravity-manager", ".mk"),
    );
  }
  return uniq(candidatePaths);
}

function classifyDatabaseError(
  error: unknown,
): LocalAccountDiscoveryFailureCode {
  if (!error) return "read-failed";
  const err = error as { code?: string; message?: string };
  const code = (err.code || "").toUpperCase();
  const msg = (err.message || "").toLowerCase();

  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_LOCKED" ||
    code === "SQLITE_CANTOPEN" ||
    msg.includes("sqlite_busy") ||
    msg.includes("sqlite_locked") ||
    msg.includes("sqlite_cantopen") ||
    msg.includes("database is locked") ||
    msg.includes("unable to open database file")
  ) {
    return "locked";
  }

  if (
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    code === "SQLITE_SCHEMA" ||
    msg.includes("file is not a database") ||
    msg.includes("database disk image is malformed") ||
    msg.includes("corrupt") ||
    msg.includes("malformed")
  ) {
    return "malformed";
  }

  if (
    code === "SQLITE_AUTH" ||
    code === "SQLITE_PERM" ||
    code === "EACCES" ||
    code === "EPERM" ||
    msg.includes("permission denied") ||
    msg.includes("access denied")
  ) {
    return "permission-denied";
  }

  return "read-failed";
}

function defaultOpenDatabase(
  dbPath: string,
  options?: Database.Options,
): Database.Database {
  if (typeof Database !== "function") {
    throw new Error("SQLite database driver is not available");
  }
  return new Database(dbPath, options);
}

export class AntigravityManagerImportAdapter {
  private readonly databasePath: string;
  private readonly masterKeyPaths: string[];
  private readonly openDatabaseFn: SqliteDatabaseOpener;
  private readonly safeStorage: SafeStorageAdapter | null | undefined;
  private readonly safeStorageDecryptFn?: (
    buffer: Buffer,
  ) => Buffer | string | null;
  private readonly keytar: KeytarAdapter | null | undefined;
  private readonly keytarLoader?: () =>
    Promise<KeytarAdapter | null> | (KeytarAdapter | null);
  private readonly getRelayDecryptionKeysFn?: () => Array<{
    key: Buffer;
    source?: string;
  }>;
  private readonly readFileFn: (filePath: string) => Buffer;
  private readonly existsSyncFn: (filePath: string) => boolean;
  private readonly statSyncFn: (filePath: string) => { size: number };

  constructor(options: AntigravityManagerImportAdapterOptions = {}) {
    this.databasePath =
      options.databasePath ??
      resolveAntigravityManagerDatabasePath({
        agentDir: options.agentDir,
        homeDir: options.homeDir,
        platform: options.platform,
        env: options.env,
      });

    this.masterKeyPaths = resolveAntigravityManagerMasterKeyPaths({
      masterKeyPaths: options.masterKeyPaths,
      homeDir: options.homeDir,
      platform: options.platform,
      env: options.env,
    });

    this.openDatabaseFn = options.openDatabase ?? defaultOpenDatabase;
    this.safeStorage = options.safeStorage;
    this.safeStorageDecryptFn = options.safeStorageDecrypt;
    this.keytar = options.keytar;
    this.keytarLoader = options.keytarLoader;
    this.getRelayDecryptionKeysFn =
      options.getRelayDecryptionKeys ?? getDecryptionKeys;
    this.readFileFn = options.readFile ?? fs.readFileSync;
    this.existsSyncFn = options.existsSync ?? fs.existsSync;
    this.statSyncFn = options.statSync ?? fs.statSync;
  }

  getDatabasePath(): string {
    return this.databasePath;
  }

  getMasterKeyPaths(): string[] {
    return [...this.masterKeyPaths];
  }

  databaseExists(): boolean {
    try {
      return this.existsSyncFn(this.databasePath);
    } catch {
      return false;
    }
  }

  private async getSafeStorageAdapter(): Promise<SafeStorageAdapter | null> {
    if (this.safeStorage !== undefined) {
      return this.safeStorage;
    }
    try {
      const electron = await import("electron");
      if (
        electron.safeStorage &&
        typeof electron.safeStorage.isEncryptionAvailable === "function"
      ) {
        return electron.safeStorage;
      }
    } catch {
      // SafeStorage unavailable in non-Electron runtime
    }
    return null;
  }

  private async getKeytarAdapter(): Promise<KeytarAdapter | null> {
    if (this.keytar !== undefined) {
      return this.keytar;
    }
    if (this.keytarLoader) {
      try {
        return await this.keytarLoader();
      } catch {
        return null;
      }
    }
    try {
      const { default: keytarModule } = await import("keytar");
      if (keytarModule && typeof keytarModule.getPassword === "function") {
        return keytarModule;
      }
    } catch {
      // Keytar unavailable in non-native runtime
    }
    return null;
  }

  async resolveMasterKeys(): Promise<Buffer[]> {
    const candidateKeys: Buffer[] = [];

    // 1. Direct File Read and SafeStorage Decryption (.mk)
    for (const mkPath of this.masterKeyPaths) {
      try {
        if (!this.existsSyncFn(mkPath)) {
          continue;
        }
        const stat = this.statSyncFn(mkPath);
        if (stat.size > MAX_MASTER_KEY_FILE_SIZE_BYTES) {
          logger.warn(`Skipping master key file exceeding limit: ${mkPath}`);
          continue;
        }

        const buffer = this.readFileFn(mkPath);
        const textContent = buffer.toString("utf8").trim();

        // 1a. Hex decode of raw .mk file (64 hex characters -> 32 bytes)
        if (HEX_64_PATTERN.test(textContent)) {
          candidateKeys.push(Buffer.from(textContent, "hex"));
          continue;
        }

        // 1b. SafeStorage decryption fallback for binary or non-hex .mk
        let decrypted: Buffer | string | null = null;
        if (this.safeStorageDecryptFn) {
          try {
            decrypted = this.safeStorageDecryptFn(buffer);
          } catch {
            decrypted = null;
          }
        } else {
          const safeStorage = await this.getSafeStorageAdapter();
          if (safeStorage && safeStorage.isEncryptionAvailable()) {
            try {
              if (typeof safeStorage.decryptString === "function") {
                decrypted = safeStorage.decryptString(buffer);
              } else if (typeof safeStorage.decrypt === "function") {
                decrypted = safeStorage.decrypt(buffer);
              }
            } catch {
              decrypted = null;
            }
          }
        }

        if (decrypted) {
          if (typeof decrypted === "string") {
            const trimmed = decrypted.trim();
            if (HEX_64_PATTERN.test(trimmed)) {
              candidateKeys.push(Buffer.from(trimmed, "hex"));
            } else if (Buffer.byteLength(trimmed) === 32) {
              candidateKeys.push(Buffer.from(trimmed));
            }
          } else if (Buffer.isBuffer(decrypted)) {
            if (decrypted.length === 32) {
              candidateKeys.push(decrypted);
            } else if (decrypted.length === 64) {
              const str = decrypted.toString("utf8").trim();
              if (HEX_64_PATTERN.test(str)) {
                candidateKeys.push(Buffer.from(str, "hex"));
              }
            }
          }
        }
      } catch (fileError) {
        logger.warn(
          `Failed reading candidate master key file: ${mkPath}`,
          fileError,
        );
      }
    }

    // 2. OS Keychain (keytar) fallback
    try {
      const keytar = await this.getKeytarAdapter();
      if (keytar && typeof keytar.getPassword === "function") {
        for (const service of KEYCHAIN_SERVICES) {
          for (const account of KEYCHAIN_ACCOUNTS) {
            try {
              const password = await keytar.getPassword(service, account);
              if (password) {
                const trimmed = password.trim();
                if (HEX_64_PATTERN.test(trimmed)) {
                  candidateKeys.push(Buffer.from(trimmed, "hex"));
                } else if (Buffer.byteLength(trimmed) === 32) {
                  candidateKeys.push(Buffer.from(trimmed));
                }
              }
            } catch {
              // Ignore single keychain slot access error
            }
          }
        }
      }
    } catch {
      // Ignore keychain subsystem error
    }

    // 3. Relay MasterKeyManager decryption keys fallback
    if (this.getRelayDecryptionKeysFn) {
      try {
        const relayKeys = this.getRelayDecryptionKeysFn();
        for (const candidate of relayKeys) {
          if (
            candidate?.key &&
            Buffer.isBuffer(candidate.key) &&
            candidate.key.length === 32
          ) {
            candidateKeys.push(candidate.key);
          }
        }
      } catch {
        // Ignore Relay MasterKeyManager lookup error
      }
    }

    // Deduplicate candidate keys
    const uniqueKeys: Buffer[] = [];
    for (const key of candidateKeys) {
      if (
        Buffer.isBuffer(key) &&
        key.length === 32 &&
        !uniqueKeys.some((existing) => existing.equals(key))
      ) {
        uniqueKeys.push(key);
      }
    }

    return uniqueKeys;
  }

  async importAccounts(): Promise<AntigravityManagerImportResult> {
    const candidates: LocalAccountCredentialCandidate[] = [];
    const failures: LocalAccountDiscoveryFailure[] = [];

    if (!this.databaseExists()) {
      failures.push(
        createLocalAccountDiscoveryFailureByCode(
          { id: "legacy-agent", location: this.databasePath },
          "missing",
        ),
      );
      return { candidates, failures };
    }

    let db: Database.Database | null = null;
    let rows: any[] = [];
    let detectedTable: string | null = null;

    try {
      db = this.openDatabaseFn(this.databasePath, {
        readonly: true,
        fileMustExist: true,
      });

      db.pragma("query_only = ON");
      db.pragma(`busy_timeout = ${DEFAULT_SQLITE_BUSY_TIMEOUT_MS}`);

      // Locate accounts table (fallback to cloud_accounts)
      try {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts', 'cloud_accounts')",
          )
          .all() as Array<{ name: string }>;
        const tableNames = tables.map((t) => t.name.toLowerCase());
        if (tableNames.includes("accounts")) {
          detectedTable = "accounts";
        } else if (tableNames.includes("cloud_accounts")) {
          detectedTable = "cloud_accounts";
        }
      } catch {
        // Will try querying accounts directly below
      }

      const targetTable = detectedTable ?? "accounts";

      // Tolerant column selection to handle schema drift across versions
      try {
        const tableInfo = db
          .prepare(`PRAGMA table_info(${targetTable})`)
          .all() as Array<{
          name: string;
        }>;
        const availableCols = new Set(
          tableInfo.map((c) => c.name.toLowerCase()),
        );

        if (availableCols.size > 0) {
          const selectParts = [
            availableCols.has("id") ? "id" : "rowid AS id",
            availableCols.has("provider") ? "provider" : "NULL AS provider",
            availableCols.has("email") ? "email" : "NULL AS email",
            availableCols.has("name") ? "name" : "NULL AS name",
            availableCols.has("avatar_url")
              ? "avatar_url"
              : "NULL AS avatar_url",
            availableCols.has("token_json")
              ? "token_json"
              : "NULL AS token_json",
            availableCols.has("status") ? "status" : "NULL AS status",
          ];
          rows = db
            .prepare(`SELECT ${selectParts.join(", ")} FROM ${targetTable}`)
            .all();
        } else {
          rows = db.prepare(`SELECT * FROM ${targetTable}`).all();
        }
      } catch {
        rows = db.prepare(`SELECT * FROM ${targetTable}`).all();
      }
    } catch (error) {
      const errorCode = classifyDatabaseError(error);
      failures.push(
        createLocalAccountDiscoveryFailureByCode(
          { id: "legacy-agent", location: this.databasePath },
          errorCode,
        ),
      );
      return { candidates, failures };
    } finally {
      if (db) {
        try {
          db.close();
        } catch (closeError) {
          logger.warn("Failed closing legacy SQLite database", closeError);
        }
      }
    }

    if (rows.length === 0) {
      return { candidates, failures };
    }

    // Resolve candidate master keys
    const candidateKeys = await this.resolveMasterKeys();

    // Check if any row requires decryption
    let sampleEncryptedPayload: string | null = null;
    for (const row of rows) {
      const rawToken = row.token_json ?? row.tokenJson;
      if (
        typeof rawToken === "string" &&
        isEncryptedPayloadCandidate(rawToken)
      ) {
        sampleEncryptedPayload = rawToken;
        break;
      }
    }

    let activeKey: Buffer | null = null;

    if (sampleEncryptedPayload) {
      for (const key of candidateKeys) {
        if (canDecryptPayloadWithKey(sampleEncryptedPayload, key)) {
          activeKey = key;
          break;
        }
      }

      if (!activeKey) {
        // Master key resolution failed for encrypted database
        failures.push(
          createLocalAccountDiscoveryFailureByCode(
            { id: "legacy-agent", location: this.databasePath },
            "locked",
          ),
        );
        return { candidates, failures };
      }
    }

    // Row-level fault isolation
    for (const row of rows) {
      const rowId =
        row.id !== undefined && row.id !== null ? String(row.id) : undefined;
      const rowLocation = rowId
        ? `${this.databasePath}#${rowId}`
        : this.databasePath;

      try {
        const rawToken = row.token_json ?? row.tokenJson;
        if (typeof rawToken !== "string" || !rawToken.trim()) {
          failures.push(
            createLocalAccountDiscoveryFailureByCode(
              { id: "legacy-agent", location: rowLocation },
              "malformed",
            ),
          );
          continue;
        }

        let tokenJsonString: string;

        if (isEncryptedPayloadCandidate(rawToken)) {
          const payload = parseEncryptedPayload(rawToken);
          if (!payload) {
            failures.push(
              createLocalAccountDiscoveryFailureByCode(
                { id: "legacy-agent", location: rowLocation },
                "malformed",
              ),
            );
            continue;
          }

          let decrypted: string | null = null;
          if (activeKey) {
            try {
              decrypted = decryptParsedPayloadWithKey(activeKey, payload);
            } catch {
              decrypted = null;
            }
          }

          if (!decrypted) {
            for (const key of candidateKeys) {
              if (activeKey && key.equals(activeKey)) continue;
              try {
                decrypted = decryptParsedPayloadWithKey(key, payload);
                activeKey = key;
                break;
              } catch {
                decrypted = null;
              }
            }
          }

          if (!decrypted) {
            failures.push(
              createLocalAccountDiscoveryFailureByCode(
                { id: "legacy-agent", location: rowLocation },
                "malformed",
              ),
            );
            continue;
          }

          tokenJsonString = decrypted;
        } else {
          tokenJsonString = rawToken;
        }

        let parsedPayload: any;
        try {
          parsedPayload = JSON.parse(tokenJsonString);
        } catch {
          failures.push(
            createLocalAccountDiscoveryFailureByCode(
              { id: "legacy-agent", location: rowLocation },
              "malformed",
            ),
          );
          continue;
        }

        const token = parsedPayload?.token ?? parsedPayload;
        const refreshToken = (
          token?.refresh_token ??
          token?.refreshToken ??
          ""
        ).trim();

        if (!refreshToken) {
          failures.push(
            createLocalAccountDiscoveryFailureByCode(
              { id: "legacy-agent", location: rowLocation },
              "malformed",
            ),
          );
          continue;
        }

        const accessToken =
          (token?.access_token ?? token?.accessToken ?? "").trim() || undefined;
        const idToken =
          (token?.id_token ?? token?.idToken ?? "").trim() || undefined;
        const projectId =
          (token?.project_id ?? token?.projectId ?? "").trim() || undefined;

        let expiryTimestamp: number | undefined;
        const rawExpiry =
          token?.expiry_timestamp ??
          token?.expiryTimestamp ??
          token?.expires_at;
        if (
          typeof rawExpiry === "number" &&
          Number.isFinite(rawExpiry) &&
          rawExpiry >= 0
        ) {
          expiryTimestamp = Math.floor(rawExpiry);
        }

        const credential = DiscoveredCredentialSchema.parse({
          refreshToken,
          ...(accessToken ? { accessToken } : {}),
          ...(idToken ? { idToken } : {}),
          ...(projectId ? { projectId } : {}),
          ...(expiryTimestamp !== undefined ? { expiryTimestamp } : {}),
        });

        const rawEmail =
          parsedPayload?.email ??
          parsedPayload?.emailHint ??
          token?.email ??
          row.email;
        const emailHint = normalizeEmailHint(rawEmail);

        candidates.push({
          source: {
            id: "legacy-agent",
            location: this.databasePath,
          },
          credential,
          ...(emailHint ? { emailHint } : {}),
        });
      } catch (error) {
        failures.push(
          createLocalAccountDiscoveryFailure(
            { id: "legacy-agent", location: rowLocation },
            error,
          ),
        );
      }
    }

    return { candidates, failures };
  }
}
