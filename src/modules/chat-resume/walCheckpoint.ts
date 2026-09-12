import fs from "node:fs";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationDbPaths,
  getAntigravityDbPaths,
} from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import { chatResumeEvents } from "./telemetry";
import { isCliTarget } from "./activeTurnDetector";

export interface WalCheckpointResult {
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  details: Array<{
    path: string;
    success: boolean;
    error?: string;
  }>;
}

export interface WalCheckpointOptions {
  timeoutMs?: number;
  globalTimeoutMs?: number;
  dbPaths?: string[];
}

export const DEFAULT_PER_DB_TIMEOUT_MS = 500;
export const DEFAULT_GLOBAL_CHECKPOINT_TIMEOUT_MS = 1500;

export async function checkpointStateDatabases(
  target?: AntigravityAppTarget,
  options?: WalCheckpointOptions,
): Promise<WalCheckpointResult> {
  const startTime = Date.now();
  const perDbTimeoutMs = options?.timeoutMs ?? DEFAULT_PER_DB_TIMEOUT_MS;
  const globalTimeoutMs =
    options?.globalTimeoutMs ?? DEFAULT_GLOBAL_CHECKPOINT_TIMEOUT_MS;

  const result: WalCheckpointResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    durationMs: 0,
    details: [],
  };

  if (isCliTarget(target)) {
    chatResumeEvents.recordSkippedCli();
    return result;
  }

  // Resolve candidate paths: conversation databases (top 5) + state.vscdb storage databases
  const candidatePaths: string[] = [];
  if (options?.dbPaths) {
    candidatePaths.push(...options.dbPaths);
  } else {
    for (const p of getAntigravityConversationDbPaths(target)) {
      if (!candidatePaths.includes(p)) candidatePaths.push(p);
    }
    for (const p of getAntigravityDbPaths(target)) {
      if (!candidatePaths.includes(p)) candidatePaths.push(p);
    }
  }

  for (const dbPath of candidatePaths) {
    if (Date.now() - startTime >= globalTimeoutMs) {
      logger.warn(
        `WAL checkpoint cumulative global timeout (${globalTimeoutMs}ms) reached; aborting remaining candidates`,
      );
      break;
    }

    if (!fs.existsSync(dbPath)) {
      continue;
    }

    result.attempted += 1;
    let db: Database.Database | null = null;

    try {
      const DatabaseConstructor =
        typeof Database === "function" ? Database : (Database as any)?.default;
      const dbInstance: Database.Database = new DatabaseConstructor(dbPath, {
        readonly: false,
        fileMustExist: true,
        timeout: perDbTimeoutMs,
      });
      db = dbInstance;

      dbInstance.pragma("wal_checkpoint(PASSIVE)");
      result.succeeded += 1;
      result.details.push({ path: dbPath, success: true });
      logger.info(
        `WAL checkpoint (PASSIVE) successfully executed on ${dbPath}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      result.failed += 1;
      result.details.push({
        path: dbPath,
        success: false,
        error: errorMessage,
      });
      logger.warn(
        `WAL checkpoint (PASSIVE) skipped/failed on ${dbPath}: ${errorMessage}`,
      );
    } finally {
      if (db) {
        try {
          db.close();
        } catch (closeError) {
          logger.warn(
            `Failed to close database handle after WAL checkpoint on ${dbPath}`,
            closeError,
          );
        }
      }
    }
  }

  result.durationMs = Date.now() - startTime;

  chatResumeEvents.recordWalCheckpointExecuted({
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    durationMs: result.durationMs,
  });

  return result;
}
