import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { isObjectLike, isString } from "lodash-es";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import { GoogleAPIService } from "@/modules/cloud-account/services/GoogleAPIService";
import type { CloudAccount } from "@/modules/cloud-account/types";
import { logger } from "@/shared/logging/logger";
import { getAntigravityDbPaths } from "@/shared/platform/paths";
import { openDrizzleConnection } from "@/shared/persistence/database/dbConnection";
import { itemTable } from "@/shared/persistence/database/schema";
import * as drizzleSchema from "@/shared/persistence/database/schema";
import { ItemTableValueRowSchema } from "@/shared/persistence/database/types";
import { parseRow } from "@/shared/persistence/database/sqlite";
import { ProtobufUtils } from "@/shared/serialization/protobuf";
import { CloudAccountRepo } from "./cloudHandler";
import { resolveImportedTokenLifetime } from "./ide-token-lifetime";
import { getAgyCliCandidateTokenPaths } from "./agyCliTokenPaths";
import {
  CredentialStoreReadError,
  parseCredentialStorePayload,
  readAntigravityCredentialStoreToken,
} from "./antigravityCredentialStore";

export const AGY_SYNC_FROM_IDE_UNSUPPORTED_MESSAGE =
  "Antigravity CLI accounts are stored in the system credential store and cannot be synced from IDE SQLite state.";

export function getTargetDisplayName(target?: AntigravityAppTarget): string {
  const resolved = resolveAntigravityAppTarget(target);
  if (resolved === "ide") {
    return "Antigravity IDE";
  }
  if (resolved === "agy") {
    return "Antigravity CLI";
  }
  return "Antigravity";
}

const SQLITE_BUSY_CODES = new Set(["SQLITE_BUSY", "SQLITE_LOCKED"]);
const SQLITE_BUSY_TIMEOUT_MS = 3000;
const SQLITE_RETRY_DELAY_MS = 150;
const SQLITE_MAX_RETRIES = 3;

type DrizzleExecutor = Pick<
  BetterSQLite3Database<typeof drizzleSchema>,
  "insert" | "update" | "delete" | "select"
>;

function isSqliteBusyError(error: unknown): boolean {
  if (!isObjectLike(error)) {
    return false;
  }
  const err = error as { code?: string; message?: string };
  if (err.code && SQLITE_BUSY_CODES.has(err.code)) {
    return true;
  }
  if (isString(err.message)) {
    return (
      err.message.includes("SQLITE_BUSY") ||
      err.message.includes("SQLITE_LOCKED")
    );
  }
  return false;
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const array = new Int32Array(buffer);
  Atomics.wait(array, 0, 0, ms);
}

function getIdeDb(
  dbPath: string,
  readOnly: boolean,
): {
  raw: import("better-sqlite3").Database;
  orm: BetterSQLite3Database<typeof drizzleSchema>;
} {
  return openDrizzleConnection(
    dbPath,
    { readonly: readOnly },
    { readOnly, busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS },
  );
}

function getItemValue(
  db: DrizzleExecutor,
  key: string,
  context: string,
): string | null {
  const rows = db
    .select({ value: itemTable.value })
    .from(itemTable)
    .where(eq(itemTable.key, key))
    .all();
  const row = parseRow(ItemTableValueRowSchema, rows[0], context);
  return row?.value ?? null;
}

export interface IdeTokenInfo {
  accessToken?: string;
  refreshToken: string;
  expiryTimestamp?: number;
  idToken?: string;
  projectId?: string;
}

export class IdeAccountImportAdapter {
  private static readTokenInfoFromDb(db: DrizzleExecutor): IdeTokenInfo {
    const enterpriseProjectId = this.readEnterpriseProjectIdFromDb(db);
    const unifiedValue = getItemValue(
      db,
      "antigravityUnifiedStateSync.oauthToken",
      "ide.itemTable.antigravityUnifiedStateSync.oauthToken",
    );

    let tokenInfo: IdeTokenInfo | null = null;
    if (unifiedValue) {
      try {
        const unifiedBuffer = Buffer.from(unifiedValue, "base64");
        const unifiedData = new Uint8Array(unifiedBuffer);
        tokenInfo =
          ProtobufUtils.extractOAuthTokenDetailsFromUnifiedState(unifiedData) ??
          ProtobufUtils.extractOAuthTokenInfoFromUnifiedState(unifiedData);
      } catch (error) {
        logger.warn("SyncLocal: Failed to parse unified OAuth token", error);
      }
    }

    if (!tokenInfo) {
      const encodedLegacyState = getItemValue(
        db,
        "jetskiStateSync.agentManagerInitState",
        "ide.itemTable.jetskiStateSync.agentManagerInitState",
      );

      if (!encodedLegacyState) {
        const message =
          "No cloud account found in IDE. Please login to a Google account in Antigravity IDE first.";
        logger.warn(`SyncLocal: ${message}`);
        throw new Error(message);
      }

      const legacyStateBuffer = Buffer.from(encodedLegacyState, "base64");
      const legacyStateBytes = new Uint8Array(legacyStateBuffer);
      tokenInfo =
        ProtobufUtils.extractOAuthTokenDetails(legacyStateBytes) ??
        ProtobufUtils.extractOAuthTokenInfo(legacyStateBytes);
    }

    if (!tokenInfo) {
      const message =
        "No OAuth token found in IDE state. Please login to a Google account in Antigravity IDE first.";
      logger.warn(`SyncLocal: ${message}`);
      throw new Error(message);
    }

    return {
      ...tokenInfo,
      projectId: enterpriseProjectId,
    };
  }

  static readTokenInfoFromPath(dbPath: string): IdeTokenInfo {
    let lastError: unknown;
    for (let attempt = 1; attempt <= SQLITE_MAX_RETRIES; attempt += 1) {
      const { raw, orm } = getIdeDb(dbPath, true);
      try {
        return this.readTokenInfoFromDb(orm);
      } catch (error) {
        lastError = error;
        if (isSqliteBusyError(error) && attempt < SQLITE_MAX_RETRIES) {
          logger.warn(
            `SQLite busy, retrying IDE read (attempt ${attempt})`,
            error,
          );
          sleepSync(SQLITE_RETRY_DELAY_MS);
          continue;
        }
        throw error;
      } finally {
        raw.close();
      }
    }
    throw lastError;
  }

  private static readEnterpriseProjectIdFromDb(
    db: DrizzleExecutor,
  ): string | undefined {
    const enterprisePreferencesValue = getItemValue(
      db,
      "antigravityUnifiedStateSync.enterprisePreferences",
      "ide.itemTable.antigravityUnifiedStateSync.enterprisePreferences",
    );
    if (!enterprisePreferencesValue) {
      return undefined;
    }

    try {
      const { sentinelKey, payload } = ProtobufUtils.decodeUnifiedStateEntry(
        enterprisePreferencesValue,
      );
      if (sentinelKey !== "enterpriseGcpProjectId") {
        return undefined;
      }

      const projectBytes = ProtobufUtils.getField(payload, 3);
      if (!projectBytes) {
        return undefined;
      }

      const projectId = ProtobufUtils.readString(projectBytes).trim();
      if (projectId === "") {
        return undefined;
      }

      return projectId;
    } catch (error) {
      logger.warn(
        "SyncLocal: Failed to parse enterprise project preference",
        error,
      );
      return undefined;
    }
  }

  private static shouldRefreshAccessTokenForUserInfo(
    error: unknown,
    accessToken?: string,
  ): boolean {
    if (!accessToken || accessToken.trim() === "") {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    return (
      normalizedMessage.includes("ide oauth access token is empty") ||
      normalizedMessage.includes('"code":401') ||
      normalizedMessage.includes("http 401") ||
      normalizedMessage.includes("unauthenticated") ||
      normalizedMessage.includes("unauthorized") ||
      normalizedMessage.includes("missing required authentication credential")
    );
  }

  private static isMissingIdeTokenError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();

    return (
      normalizedMessage.includes("no cloud account found") ||
      normalizedMessage.includes("no oauth token found")
    );
  }

  private static isPermissionError(error: unknown): boolean {
    if (
      error instanceof CredentialStoreReadError &&
      error.code === "permission-denied"
    ) {
      return true;
    }
    if (!isObjectLike(error)) {
      return false;
    }
    const err = error as { code?: string; message?: string };
    const code = err.code?.toLowerCase();
    const message = err.message?.toLowerCase() ?? "";
    return (
      code === "eacces" ||
      code === "eperm" ||
      code === "permission-denied" ||
      message.includes("permission denied") ||
      message.includes("access denied") ||
      message.includes("user interaction is not allowed")
    );
  }

  private static isMissingCliTokenError(error: unknown): boolean {
    if (!isObjectLike(error)) {
      return false;
    }
    const err = error as { code?: string; message?: string };
    return (
      err.code === "ENOENT" || (err.message?.includes("not found") ?? false)
    );
  }

  static readCliToken(): IdeTokenInfo {
    const candidatePaths = getAgyCliCandidateTokenPaths();
    let existingPath: string | null = null;

    for (const candidatePath of candidatePaths) {
      if (fs.existsSync(candidatePath)) {
        existingPath = candidatePath;
        break;
      }
    }

    if (!existingPath) {
      const message = `Antigravity CLI token file not found. Please log in using the Antigravity CLI first. Checked paths: ${candidatePaths.join(", ")}`;
      const error = new Error(message);
      (error as { code?: string }).code = "ENOENT";
      throw error;
    }

    const stat = fs.statSync(existingPath);
    if (stat.size > 64 * 1024) {
      const error = new Error(
        `Antigravity CLI token file at ${existingPath} exceeds 64KB limit.`,
      );
      (error as { code?: string }).code = "malformed";
      throw error;
    }

    const raw = fs.readFileSync(existingPath, "utf-8");
    const token = parseCredentialStorePayload(raw);
    return {
      refreshToken: token.refreshToken,
      accessToken: token.accessToken ?? "",
      idToken: token.idToken,
      projectId: token.projectId,
      expiryTimestamp: token.expiryTimestamp,
    };
  }

  static async syncFromIde(
    appTarget?: AntigravityAppTarget,
  ): Promise<CloudAccount | null> {
    const resolvedTarget = resolveAntigravityAppTarget(appTarget);
    const targetName = getTargetDisplayName(appTarget);
    let tokenInfo: IdeTokenInfo | null = null;
    let sourceDescription = "";

    if (resolvedTarget === "agy") {
      logger.info("SyncLocal: Target is agy, reading CLI token file");
      tokenInfo = this.readCliToken();
      sourceDescription = "Antigravity CLI token file";
    } else {
      // Tier 1: SQLite Database
      const dbPaths = getAntigravityDbPaths(appTarget);
      logger.info(
        `SyncLocal: Checking database paths: ${JSON.stringify(dbPaths)}`,
      );

      const existingDbPaths = dbPaths.filter((candidatePath) => {
        const pathExists = fs.existsSync(candidatePath);
        logger.info(
          `SyncLocal: Checking path: ${candidatePath}, exists: ${pathExists}`,
        );
        return pathExists;
      });

      if (existingDbPaths.length > 0) {
        for (const candidatePath of existingDbPaths) {
          try {
            tokenInfo = this.readTokenInfoFromPath(candidatePath);
            sourceDescription = `Antigravity database at: ${candidatePath}`;
            break;
          } catch (error) {
            if (isSqliteBusyError(error)) {
              throw error;
            }
            if (this.isPermissionError(error)) {
              throw error;
            }
            if (this.isMissingIdeTokenError(error)) {
              logger.warn(
                `SyncLocal: No cloud token found at ${candidatePath}, trying next database path`,
              );
              continue;
            }
            throw error;
          }
        }
      }

      // Tier 2: System Credential Store (if Tier 1 yielded no token)
      if (!tokenInfo) {
        logger.info(
          "SyncLocal: Database missing or contains no account; checking System Credential Store",
        );
        try {
          const credentialStoreToken = readAntigravityCredentialStoreToken();
          if (credentialStoreToken) {
            tokenInfo = {
              refreshToken: credentialStoreToken.refreshToken,
              accessToken: credentialStoreToken.accessToken ?? "",
              idToken: credentialStoreToken.idToken,
              projectId: credentialStoreToken.projectId,
              expiryTimestamp: credentialStoreToken.expiryTimestamp,
            };
            sourceDescription = "System Credential Store";
          }
        } catch (error) {
          if (error instanceof CredentialStoreReadError) {
            if (
              error.code === "permission-denied" ||
              error.code === "locked" ||
              error.code === "timed-out"
            ) {
              throw error;
            }
            if (error.code !== "unavailable") {
              throw error;
            }
          } else if (this.isPermissionError(error)) {
            throw error;
          } else {
            throw error;
          }
        }
      }

      // Tier 3: CLI token fallback (if Tier 1 and Tier 2 yielded no token)
      if (!tokenInfo) {
        logger.info(
          "SyncLocal: System Credential Store missing or empty; checking Antigravity CLI token",
        );
        try {
          tokenInfo = this.readCliToken();
          sourceDescription = "Antigravity CLI token file";
        } catch (error) {
          if (this.isPermissionError(error)) {
            throw error;
          }
          if (!this.isMissingCliTokenError(error)) {
            throw error;
          }
        }
      }

      if (!tokenInfo) {
        const message = `No cloud account found in ${targetName}, System Credential Store, or Antigravity CLI.`;
        logger.error(`SyncLocal: ${message}`);
        throw new Error(message);
      }
    }

    try {
      logger.info(`SyncLocal: Using ${sourceDescription}`);
      const effectiveTokenInfo = {
        ...tokenInfo,
        accessToken: tokenInfo.accessToken ?? "",
      };
      let refreshedExpiresIn: number | undefined;
      let hasRefreshedAccessToken = false;

      let googleUserInfo;
      try {
        if (
          !effectiveTokenInfo.accessToken ||
          effectiveTokenInfo.accessToken.trim() === ""
        ) {
          throw new Error("OAuth access token is empty");
        }
        googleUserInfo = await GoogleAPIService.getUserInfo(
          effectiveTokenInfo.accessToken,
        );
      } catch (apiError: unknown) {
        if (
          !this.shouldRefreshAccessTokenForUserInfo(
            apiError,
            effectiveTokenInfo.accessToken,
          )
        ) {
          const apiErrorMessage =
            apiError instanceof Error ? apiError.message : String(apiError);
          const message = `Failed to validate token with Google API. The token may be expired. Please re-login in ${targetName}. Error: ${apiErrorMessage}`;
          logger.error(`SyncLocal: ${message}`, apiError);
          throw new Error(message);
        }

        try {
          const refreshedToken = await GoogleAPIService.refreshAccessToken(
            tokenInfo.refreshToken,
          );
          hasRefreshedAccessToken = true;
          effectiveTokenInfo.accessToken = refreshedToken.access_token;
          effectiveTokenInfo.refreshToken =
            refreshedToken.refresh_token || tokenInfo.refreshToken;
          effectiveTokenInfo.idToken =
            refreshedToken.id_token ?? tokenInfo.idToken;
          refreshedExpiresIn = refreshedToken.expires_in;
          googleUserInfo = await GoogleAPIService.getUserInfo(
            effectiveTokenInfo.accessToken,
          );
        } catch (refreshError: unknown) {
          const refreshErrorMessage =
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError);
          const message = `Failed to refresh token with Google API. Please re-login in ${targetName}. Error: ${refreshErrorMessage}`;
          logger.error(`SyncLocal: ${message}`, refreshError);
          throw new Error(message);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      const tokenLifetime = resolveImportedTokenLifetime(
        now,
        refreshedExpiresIn,
        tokenInfo.expiryTimestamp,
        hasRefreshedAccessToken,
      );
      const account: CloudAccount = {
        id: uuidv4(),
        provider: "google",
        email: googleUserInfo.email,
        name: googleUserInfo.name,
        avatar_url: googleUserInfo.picture,
        token: {
          access_token: effectiveTokenInfo.accessToken,
          refresh_token: effectiveTokenInfo.refreshToken,
          expires_in: tokenLifetime.expiresIn,
          expiry_timestamp: tokenLifetime.expiryTimestamp,
          token_type: "Bearer",
          email: googleUserInfo.email,
          project_id: effectiveTokenInfo.projectId,
          is_gcp_tos: false,
          id_token: effectiveTokenInfo.idToken,
        },
        created_at: now,
        last_used: now,
        status: "active",
        is_active: true,
      };

      const accounts = await CloudAccountRepo.getAccounts();
      const existingAccount = accounts.find(
        (savedAccount) => savedAccount.email === account.email,
      );
      if (existingAccount) {
        const existingProjectId = existingAccount.token.project_id?.trim();

        account.id = existingAccount.id;
        account.created_at = existingAccount.created_at;
        account.name = account.name ?? existingAccount.name;
        account.avatar_url = account.avatar_url ?? existingAccount.avatar_url;
        account.proxy_url = existingAccount.proxy_url;
        account.device_profile = existingAccount.device_profile;
        account.device_history = existingAccount.device_history;
        account.status = "active";
        account.status_reason = undefined;
        account.token = {
          ...existingAccount.token,
          access_token: effectiveTokenInfo.accessToken,
          refresh_token:
            effectiveTokenInfo.refreshToken ||
            existingAccount.token.refresh_token,
          expires_in: tokenLifetime.expiresIn,
          expiry_timestamp: tokenLifetime.expiryTimestamp,
          token_type: "Bearer",
          email: googleUserInfo.email,
          project_id: existingProjectId || effectiveTokenInfo.projectId,
          is_gcp_tos: existingAccount.token.is_gcp_tos ?? false,
          id_token:
            effectiveTokenInfo.idToken ?? existingAccount.token.id_token,
        };
      }

      await CloudAccountRepo.addAccount(account);
      return account;
    } catch (error) {
      logger.error("SyncLocal: Failed to sync account from IDE", error);
      throw error;
    }
  }
}
