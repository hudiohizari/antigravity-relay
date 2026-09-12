import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityBrainDir,
  getAntigravityConversationDbPaths,
  getAntigravityDbPaths,
} from "@/shared/platform/paths";
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

export function cleanPromptText(raw: string): string {
  if (!raw || typeof raw !== "string") {
    return "";
  }

  // If wrapped in <USER_REQUEST>...</USER_REQUEST>, extract contents
  const requestMatch = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  let cleaned = requestMatch && requestMatch[1] ? requestMatch[1] : raw;

  // Strip <ADDITIONAL_METADATA>...</ADDITIONAL_METADATA>
  cleaned = cleaned.replace(
    /<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi,
    "",
  );

  // Strip <USER_SETTINGS_CHANGE>...</USER_SETTINGS_CHANGE>
  cleaned = cleaned.replace(
    /<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi,
    "",
  );

  return cleaned.trim();
}

export function extractPromptFromTranscript(
  transcriptPath: string,
): string | null {
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (parsed && typeof parsed === "object") {
          if (
            parsed.type === "USER_INPUT" ||
            parsed.source === "USER_EXPLICIT"
          ) {
            const raw = parsed.content ?? parsed.text ?? parsed.prompt ?? "";
            const cleaned = cleanPromptText(String(raw));
            if (cleaned.length > 0) {
              return cleaned;
            }
          }
        }
      } catch {
        // Continue searching previous line
      }
    }
  } catch (err) {
    logger.warn(`Failed to read transcript at ${transcriptPath}`, err);
  }

  return null;
}

function extractModelFromDatabase(
  dbInstance: Database.Database,
): string | undefined {
  try {
    const hasGenMeta = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='gen_metadata'",
      )
      .get();
    if (hasGenMeta) {
      const rows = dbInstance
        .prepare(
          "SELECT data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx DESC LIMIT 5",
        )
        .all() as Array<{ data: Buffer | string }>;

      for (const row of rows) {
        const text =
          typeof row.data === "string"
            ? row.data
            : Buffer.isBuffer(row.data)
              ? row.data.toString("utf-8")
              : "";
        const matches = text.match(
          /(?:claude-[a-z0-9_\-\.]*|gemini-[a-z0-9_\-\.]*|MODEL_[A-Z0-9_]+)/i,
        );
        if (matches && matches[0]) {
          return matches[0];
        }
      }
    }
  } catch {
    // Ignore extraction error
  }
  return undefined;
}

export async function detectActiveTurnInDatabase(
  dbPath: string,
  appTarget: AntigravityAppTarget = "app",
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
      timeout: 500,
    });
    db = dbInstance;

    // 1. Check for real conversation DB schema: table 'steps' with indexed 'status' column
    const hasStepsTable = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='steps'",
      )
      .get();

    if (hasStepsTable) {
      let activeStep: Record<string, unknown> | undefined;
      try {
        activeStep = dbInstance
          .prepare(
            "SELECT * FROM steps WHERE status = 2 ORDER BY rowid DESC LIMIT 1",
          )
          .get() as Record<string, unknown> | undefined;
      } catch {
        try {
          activeStep = dbInstance
            .prepare("SELECT * FROM steps WHERE status = 2 LIMIT 1")
            .get() as Record<string, unknown> | undefined;
        } catch {
          activeStep = undefined;
        }
      }

      if (activeStep) {
        // Resolve cascadeId from activeStep, trajectory_meta or filename
        let cascadeId =
          activeStep.cascade_id || activeStep.cascadeId
            ? String(activeStep.cascade_id || activeStep.cascadeId)
            : "";

        if (!cascadeId) {
          try {
            const hasTrajectoryMeta = dbInstance
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_meta'",
              )
              .get();
            if (hasTrajectoryMeta) {
              const trajRow = dbInstance
                .prepare(
                  "SELECT cascade_id, trajectory_id FROM trajectory_meta LIMIT 1",
                )
                .get() as Record<string, unknown> | undefined;
              if (trajRow?.cascade_id) {
                cascadeId = String(trajRow.cascade_id);
              } else if (trajRow?.trajectory_id) {
                cascadeId = String(trajRow.trajectory_id);
              }
            }
          } catch {
            // Fall back to filename
          }
        }

        if (!cascadeId) {
          cascadeId = path.basename(dbPath, ".db");
        }

        // Extract prompt from transcript log
        const brainDir = getAntigravityBrainDir(appTarget);
        const transcriptPath = path.join(
          brainDir,
          cascadeId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );

        let promptText = extractPromptFromTranscript(transcriptPath);

        // Fallback to steps table payload / task_details if transcript is unreadable
        if (!promptText) {
          const raw =
            activeStep.prompt ??
            activeStep.task_details ??
            activeStep.step_payload ??
            activeStep.metadata;
          if (raw) {
            const rawStr = Buffer.isBuffer(raw)
              ? raw.toString("utf-8")
              : String(raw);
            const cleaned = cleanPromptText(rawStr);
            if (cleaned.length > 0) {
              promptText = cleaned;
            }
          }
        }

        const model =
          (activeStep.model ? String(activeStep.model) : undefined) ??
          extractModelFromDatabase(dbInstance);

        if (promptText && promptText.trim().length > 0) {
          chatResumeEvents.recordActiveTurnDetected({
            appTarget,
            conversationId: cascadeId,
            stepIndex:
              typeof activeStep.idx === "number" ? activeStep.idx : undefined,
          });

          return {
            cascadeId,
            conversationDbPath: dbPath,
            promptPayload: {
              prompt: promptText,
              requestedModel: model,
              cascadeConfig: model ? { requestedModel: { model } } : undefined,
            },
          };
        }
      }
    }

    // 2. Generic table scanner (handles test mocks or legacy schemas)
    const tables = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as Array<{ name: string }>;

    for (const { name } of tables) {
      if (name === "ItemTable" || name === "steps") {
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
            const rawPrompt = String(
              activeRow.prompt ??
                activeRow.text ??
                activeRow.user_message ??
                activeRow.content ??
                "",
            );
            const promptText = cleanPromptText(rawPrompt);
            const model = activeRow.model ? String(activeRow.model) : undefined;

            if (promptText.trim().length > 0) {
              return {
                cascadeId,
                conversationDbPath: dbPath,
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

    // 3. ItemTable scan (VS Code global storage / test mocks)
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
              const rawPrompt =
                parsed.prompt ??
                parsed.text ??
                parsed.content ??
                parsed.userPrompt;
              const prompt = cleanPromptText(String(rawPrompt ?? ""));
              if (prompt.trim().length > 0) {
                return {
                  cascadeId: String(
                    parsed.cascadeId ?? parsed.threadId ?? row.key,
                  ),
                  conversationDbPath: dbPath,
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
    chatResumeEvents.recordSkippedCli();
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

  // 3. Inspect real Antigravity conversation databases (sorted by mtimeMs, capped to top 5)
  const candidatePaths =
    options?.dbPaths ?? getAntigravityConversationDbPaths(effectiveTarget);

  for (const dbPath of candidatePaths) {
    const detected = await detectActiveTurnInDatabase(dbPath, effectiveTarget);
    if (detected) {
      return detected;
    }
  }

  // 4. Fallback inspection for test environments or state storage
  if (!options?.dbPaths) {
    const stateDbPaths = getAntigravityDbPaths(effectiveTarget);
    for (const dbPath of stateDbPaths) {
      if (!candidatePaths.includes(dbPath)) {
        const detected = await detectActiveTurnInDatabase(
          dbPath,
          effectiveTarget,
        );
        if (detected) {
          return detected;
        }
      }
    }
  }

  return null;
}

export async function captureAndBufferActiveTurn(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<InFlightChatSnapshot | null> {
  if (isCliTarget(target)) {
    chatResumeEvents.recordSkippedCli();
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
    model: activeTurn.promptPayload.requestedModel,
    promptLength: activeTurn.promptPayload.prompt.length,
  });

  return snapshot;
}
