import fs from "node:fs";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { getAntigravityDbPaths } from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";

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
  dbPaths?: string[];
}

export async function checkpointStateDatabases(
  target?: AntigravityAppTarget,
  options?: WalCheckpointOptions,
): Promise<WalCheckpointResult> {
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 1000;
  const paths = options?.dbPaths ?? getAntigravityDbPaths(target);

  const result: WalCheckpointResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    durationMs: 0,
    details: [],
  };

  for (const dbPath of paths) {
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
        timeout: timeoutMs,
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
  return result;
}
