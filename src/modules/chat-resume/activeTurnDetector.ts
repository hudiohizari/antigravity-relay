import fs from "node:fs";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { getAntigravityDbPaths } from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import {
  sessionContinuityBuffer,
  SessionContinuityBuffer,
} from "./SessionContinuityBuffer";
import { chatResumeEvents } from "./telemetry";
import type {
  ActiveTurnSnapshot,
  ChatResumeSwitchSource,
  InFlightChatSnapshot,
  InFlightPromptPayload,
} from "./types";

export interface ActiveTurnDetectionOptions {
  source?: ChatResumeSwitchSource;
  accountEmail?: string;
  buffer?: SessionContinuityBuffer;
  dbPaths?: string[];
  customDetector?: (
    target: AntigravityAppTarget,
  ) => Promise<ActiveTurnSnapshot | null>;
}

export function isCliTarget(target?: AntigravityAppTarget | null): boolean {
  return target === "cli" || target === "agy";
}

export async function detectActiveTurnInDatabase(
  dbPath: string,
): Promise<ActiveTurnSnapshot | null> {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  let db: Database.Database | null = null;
  try {
    const DatabaseConstructor =
      typeof Database === "function" ? Database : (Database as any)?.default;
    const dbInstance: Database.Database = new DatabaseConstructor(dbPath, {
      readonly: true,
      fileMustExist: true,
      timeout: 1000,
    });
    db = dbInstance;

    // 1. Check all tables for a table with a 'status' column or known turn tables
    const tables = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;

    for (const { name } of tables) {
      if (name === "ItemTable") {
        continue;
      }

      try {
        const columns = dbInstance.pragma(`table_info(${name})`) as Array<{
          name: string;
        }>;
        const hasStatus = columns.some(
          (col) => col.name.toLowerCase() === "status",
        );

        if (hasStatus) {
          // Status = 2 indicates an actively running / executing turn
          const activeRow = dbInstance
            .prepare(
              `SELECT * FROM ${name} WHERE status = 2 ORDER BY rowid DESC LIMIT 1`,
            )
            .get() as Record<string, unknown> | undefined;

          if (activeRow) {
            const cascadeId = String(
              activeRow.cascade_id ??
                activeRow.cascadeId ??
                activeRow.thread_id ??
                activeRow.id ??
                "active-cascade",
            );
            const promptText = String(
              activeRow.prompt ??
                activeRow.text ??
                activeRow.user_message ??
                activeRow.content ??
                "",
            );
            const model = activeRow.model ? String(activeRow.model) : undefined;

            if (promptText.trim().length > 0) {
              return {
                cascadeId,
                sessionId: activeRow.session_id
                  ? String(activeRow.session_id)
                  : undefined,
                promptPayload: {
                  prompt: promptText,
                  requestedModel: model,
                  cascadeConfig: model
                    ? { requestedModel: { model } }
                    : undefined,
                },
              };
            }
          }
        }
      } catch {
        // Continue checking next table
      }
    }

    // 2. Check ItemTable for keys containing active turns or JSON objects with "status": 2
    const hasItemTable = tables.some((t) => t.name === "ItemTable");
    if (hasItemTable) {
      const rows = dbInstance
        .prepare(
          `SELECT key, value FROM ItemTable WHERE key LIKE '%active%' OR value LIKE '%"status":2%' OR value LIKE '%"status": 2%' LIMIT 10`,
        )
        .all() as Array<{ key: string; value: string | null }>;

      for (const row of rows) {
        if (!row.value) continue;
        try {
          const parsed = JSON.parse(row.value);
          if (parsed && typeof parsed === "object") {
            const status = parsed.status ?? parsed.stepStatus;
            if (status === 2 || status === "2" || status === "RUNNING") {
              const prompt =
                parsed.prompt ??
                parsed.text ??
                parsed.content ??
                parsed.userPrompt;
              if (
                prompt &&
                typeof prompt === "string" &&
                prompt.trim().length > 0
              ) {
                return {
                  cascadeId: String(
                    parsed.cascadeId ?? parsed.threadId ?? row.key,
                  ),
                  sessionId: parsed.sessionId
                    ? String(parsed.sessionId)
                    : undefined,
                  promptPayload: {
                    prompt,
                    requestedModel: parsed.model ?? parsed.requestedModel,
                    cascadeConfig: parsed.cascadeConfig,
                    contextReferences: parsed.contextReferences,
                  },
                };
              }
            }
          }
        } catch {
          // Non-JSON or not matching
        }
      }
    }
  } catch (err) {
    logger.warn(
      `Failed to inspect SQLite database for active turn at ${dbPath}`,
      err,
    );
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }

  return null;
}

export async function detectActiveTurn(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<ActiveTurnSnapshot | null> {
  // Explicit CLI exclusion
  if (isCliTarget(target)) {
    logger.info("Skipping active turn detection for CLI target");
    return null;
  }

  const effectiveTarget = target ?? "app";
  const buffer = options?.buffer ?? sessionContinuityBuffer;

  // 1. Check custom detector hook if provided
  if (options?.customDetector) {
    try {
      const customResult = await options.customDetector(effectiveTarget);
      if (customResult) {
        return customResult;
      }
    } catch (err) {
      logger.warn("Custom active turn detector threw error", err);
    }
  }

  // 2. Check volatile in-memory registered active prompts
  const inMemoryPrompt = buffer.getActivePrompt(effectiveTarget);
  if (inMemoryPrompt) {
    return inMemoryPrompt;
  }

  // 3. Inspect resolved SQLite state databases
  const paths = options?.dbPaths ?? getAntigravityDbPaths(target);
  for (const dbPath of paths) {
    const detected = await detectActiveTurnInDatabase(dbPath);
    if (detected) {
      return detected;
    }
  }

  return null;
}

export async function captureAndBufferActiveTurn(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<InFlightChatSnapshot | null> {
  if (isCliTarget(target)) {
    return null;
  }

  const activeTurn = await detectActiveTurn(target, options);
  if (!activeTurn) {
    logger.info(
      `No active in-flight turn detected for target ${target ?? "app"}`,
    );
    return null;
  }

  const buffer = options?.buffer ?? sessionContinuityBuffer;
  const effectiveTarget = target ?? "app";

  const snapshot = buffer.store({
    appTarget: effectiveTarget,
    cascadeId: activeTurn.cascadeId,
    sessionId: activeTurn.sessionId,
    promptPayload: activeTurn.promptPayload,
    source: options?.source ?? "auto_switch",
    accountEmail: options?.accountEmail,
  });

  chatResumeEvents.recordSnapshotCaptured({
    resumptionId: snapshot.resumptionId,
    appTarget: effectiveTarget,
    source: options?.source ?? "auto_switch",
  });

  return snapshot;
}
