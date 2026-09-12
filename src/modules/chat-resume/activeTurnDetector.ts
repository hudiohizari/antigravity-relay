import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityAnnotationsDir,
  getAntigravityBrainDir,
  getAntigravityConversationDbPaths,
  getAntigravityDbPaths,
} from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import {
  sessionContinuityBuffer,
  SessionContinuityBuffer,
} from "./SessionContinuityBuffer";
import { normalizeModelToProtoEnum } from "./ChatResumeDispatcher";
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

export function isSubagentConversation(
  cascadeId: string,
  appTarget: AntigravityAppTarget = "app",
  dbInstance?: Database.Database | null,
): boolean {
  if (!cascadeId) {
    return false;
  }

  const annotationsDir = getAntigravityAnnotationsDir(appTarget);
  if (annotationsDir && fs.existsSync(annotationsDir)) {
    const pbtxtPath = path.join(annotationsDir, `${cascadeId}.pbtxt`);
    if (fs.existsSync(pbtxtPath)) {
      try {
        const content = fs.readFileSync(pbtxtPath, "utf-8");
        if (content.includes("title:")) {
          return false;
        }
        return true;
      } catch {
        // Continue to database check
      }
    }
  }

  if (dbInstance) {
    try {
      const hasBlobTable = dbInstance
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'",
        )
        .get();
      if (hasBlobTable) {
        const row = dbInstance
          .prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1")
          .get() as { data: Buffer | string | null } | undefined;
        if (row && row.data) {
          const raw = Buffer.isBuffer(row.data)
            ? row.data.toString("utf-8")
            : String(row.data);
          if (raw.includes(`2$${cascadeId}`)) {
            return false;
          }
          return true;
        }
      }
    } catch {
      // Ignore query error
    }
  }

  return false;
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

export interface TranscriptTurnAnalysis {
  hasActiveTurn: boolean;
  isInterrupted: boolean;
  promptText: string;
  stepIndex?: number;
}

export function inspectTranscriptForActiveTurn(
  transcriptPath: string,
): TranscriptTurnAnalysis | null {
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }

    // Find the latest USER_INPUT or USER_EXPLICIT step by scanning backwards
    let lastUserIdx = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (line.includes('"USER_INPUT"') || line.includes('"USER_EXPLICIT"')) {
        try {
          const parsed = JSON.parse(line);
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed.type === "USER_INPUT" || parsed.source === "USER_EXPLICIT")
          ) {
            lastUserIdx = i;
            break;
          }
        } catch {
          // Continue scanning
        }
      }
    }

    if (lastUserIdx === -1) {
      return null;
    }

    let userStep: Record<string, unknown> = {};
    try {
      userStep = JSON.parse(lines[lastUserIdx]);
    } catch {
      return null;
    }

    const rawUserPrompt =
      userStep.content ?? userStep.text ?? userStep.prompt ?? "";
    const userPrompt = cleanPromptText(String(rawUserPrompt));

    const stepsAfter: Array<Record<string, unknown>> = [];
    for (let i = lastUserIdx + 1; i < lines.length; i += 1) {
      try {
        const step = JSON.parse(lines[i]);
        if (step && typeof step === "object") {
          stepsAfter.push(step);
        }
      } catch {
        // Ignore malformed line
      }
    }

    // Case 1: Fresh user prompt with zero subsequent steps
    if (stepsAfter.length === 0) {
      if (!userPrompt) return null;
      return {
        hasActiveTurn: true,
        isInterrupted: false,
        promptText: userPrompt,
        stepIndex:
          typeof userStep.step_index === "number"
            ? userStep.step_index
            : undefined,
      };
    }

    // Case 2: Quota or rate limit exhaustion occurred in steps after user prompt
    for (const step of stepsAfter) {
      const rawText = `${String(step.content ?? "")} ${String(step.thinking ?? "")} ${String(step.error_details ?? "")}`;
      if (
        rawText.includes("RESOURCE_EXHAUSTED") ||
        rawText.includes("Individual quota reached") ||
        rawText.includes("code 429")
      ) {
        return {
          hasActiveTurn: true,
          isInterrupted: true,
          promptText: userPrompt || "Continue your previous response.",
          stepIndex:
            typeof step.step_index === "number"
              ? step.step_index
              : typeof userStep.step_index === "number"
                ? userStep.step_index
                : undefined,
        };
      }
    }

    // Case 3: Inspect the tail step following user prompt
    const lastStep = stepsAfter[stepsAfter.length - 1];

    if (lastStep.status === "RUNNING") {
      return {
        hasActiveTurn: true,
        isInterrupted: true,
        promptText: userPrompt || "Continue your previous response.",
        stepIndex:
          typeof lastStep.step_index === "number"
            ? lastStep.step_index
            : typeof userStep.step_index === "number"
              ? userStep.step_index
              : undefined,
      };
    }

    if (lastStep.type === "PLANNER_RESPONSE") {
      const hasContent =
        typeof lastStep.content === "string" &&
        lastStep.content.trim().length > 0;
      const hasTools =
        Array.isArray(lastStep.tool_calls) && lastStep.tool_calls.length > 0;

      // Model cut off mid-thinking or produced empty output
      if (!hasContent && !hasTools) {
        return {
          hasActiveTurn: true,
          isInterrupted: true,
          promptText: userPrompt || "Continue your previous response.",
          stepIndex:
            typeof lastStep.step_index === "number"
              ? lastStep.step_index
              : typeof userStep.step_index === "number"
                ? userStep.step_index
                : undefined,
        };
      }

      // Model requested tool call, but tool result never arrived before shutdown
      if (hasTools) {
        return {
          hasActiveTurn: true,
          isInterrupted: true,
          promptText: userPrompt || "Continue your previous response.",
          stepIndex:
            typeof lastStep.step_index === "number"
              ? lastStep.step_index
              : typeof userStep.step_index === "number"
                ? userStep.step_index
                : undefined,
        };
      }

      // Model output text with no tools: check if subagents were invoked in stepsAfter
      const hasSubagents = stepsAfter.some((s) => {
        const tools = s.tool_calls;
        return (
          Array.isArray(tools) &&
          tools.some((t: any) => t?.name === "invoke_subagent")
        );
      });

      if (hasSubagents) {
        return {
          hasActiveTurn: true,
          isInterrupted: true,
          promptText: "Continue your previous response.",
          stepIndex:
            typeof lastStep.step_index === "number"
              ? lastStep.step_index
              : typeof userStep.step_index === "number"
                ? userStep.step_index
                : undefined,
        };
      }

      // Check if any background tasks were launched in stepsAfter
      const hasBackgroundTasks = stepsAfter.some((s) => {
        return (
          s.type === "GENERIC" &&
          typeof s.content === "string" &&
          s.content.includes("Tool is running as a background task")
        );
      });

      if (hasBackgroundTasks) {
        return {
          hasActiveTurn: true,
          isInterrupted: true,
          promptText: "Continue your previous response.",
          stepIndex:
            typeof lastStep.step_index === "number"
              ? lastStep.step_index
              : typeof userStep.step_index === "number"
                ? userStep.step_index
                : undefined,
        };
      }

      // Model successfully generated final content response - turn completed
      return null;
    }

    // Case 4: Tool output (GENERIC), SYSTEM_MESSAGE, or CHECKPOINT was received,
    // but model never finished the turn with a completed PLANNER_RESPONSE
    if (
      lastStep.type === "GENERIC" ||
      lastStep.type === "SYSTEM_MESSAGE" ||
      lastStep.type === "CHECKPOINT" ||
      lastStep.type === "ERROR_MESSAGE"
    ) {
      return {
        hasActiveTurn: true,
        isInterrupted: true,
        promptText: userPrompt || "Continue your previous response.",
        stepIndex:
          typeof lastStep.step_index === "number"
            ? lastStep.step_index
            : typeof userStep.step_index === "number"
              ? userStep.step_index
              : undefined,
      };
    }
  } catch (err) {
    logger.warn(`Failed to inspect transcript at ${transcriptPath}`, err);
  }

  return null;
}

function extractModelFromDatabase(
  dbInstance: Database.Database,
): string | undefined {
  try {
    const hasSteps = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='steps'",
      )
      .get();
    if (hasSteps) {
      const stepRows = dbInstance
        .prepare(
          "SELECT step_payload FROM steps WHERE step_type = 14 AND step_payload IS NOT NULL ORDER BY idx DESC LIMIT 5",
        )
        .all() as Array<{ step_payload: Buffer | string }>;
      for (const row of stepRows) {
        const text = Buffer.isBuffer(row.step_payload)
          ? row.step_payload.toString("utf-8")
          : String(row.step_payload);
        const matches = text.match(/MODEL_[A-Z0-9_]+/);
        if (matches && matches[0]) {
          return matches[0];
        }
      }
    }

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

  let isRecent = true;
  try {
    const stat = fs.statSync(dbPath);
    let mtime = stat.mtimeMs;
    const wal = `${dbPath}-wal`;
    if (fs.existsSync(wal)) {
      try {
        mtime = Math.max(mtime, fs.statSync(wal).mtimeMs);
      } catch {
        // Ignore wal stat error
      }
    }
    isRecent = Date.now() - mtime < 10 * 60 * 1000;
  } catch {
    // Ignore stat error
  }

  if (!isRecent) {
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
      let isInterrupted = false;
      let promptText: string | null = null;

      // Resolve cascadeId from trajectory_meta or filename
      let cascadeId = "";
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

      if (!cascadeId) {
        cascadeId = path.basename(dbPath, ".db");
      }

      if (isSubagentConversation(cascadeId, appTarget, dbInstance)) {
        logger.debug(
          `Skipping internal subagent conversation ${cascadeId} (${dbPath})`,
        );
        return null;
      }

      const brainDir = getAntigravityBrainDir(appTarget);
      const transcriptPath = path.join(
        brainDir,
        cascadeId,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );

      try {
        const maxRow = dbInstance
          .prepare("SELECT MAX(idx) as max_idx FROM steps")
          .get() as { max_idx: number | null } | undefined;
        const maxIdx = maxRow?.max_idx;

        if (typeof maxIdx === "number") {
          const recentSteps = dbInstance
            .prepare("SELECT * FROM steps WHERE idx >= ? ORDER BY idx DESC")
            .all(Math.max(0, maxIdx - 5)) as Array<Record<string, unknown>>;

          for (const step of recentSteps) {
            if (step.status === 2 || step.status === 8) {
              const raw =
                step.step_payload ?? step.task_details ?? step.metadata;
              const rawStr = raw
                ? Buffer.isBuffer(raw)
                  ? raw.toString("utf-8")
                  : String(raw)
                : "";
              const isDaemon =
                rawStr.includes('"IsDaemon":true') ||
                rawStr.includes('"IsDaemon": true');
              if (!isDaemon) {
                activeStep = step;
                isInterrupted = true;
                break;
              }
            }
          }

          // If no running step found in SQLite, check transcript log for incomplete/interrupted turn
          if (!activeStep) {
            const transcriptAnalysis =
              inspectTranscriptForActiveTurn(transcriptPath);
            if (transcriptAnalysis && transcriptAnalysis.hasActiveTurn) {
              activeStep = {
                idx: transcriptAnalysis.stepIndex ?? maxIdx,
                cascade_id: cascadeId,
              };
              isInterrupted = transcriptAnalysis.isInterrupted;
              promptText = transcriptAnalysis.promptText;
            }
          }

          // Fallback check on head step in SQLite for quota exhaustion
          if (!activeStep && recentSteps.length > 0) {
            const headStep = recentSteps[0];
            const rawErr =
              headStep.error_details ??
              headStep.step_payload ??
              headStep.metadata;
            const rawErrStr = rawErr
              ? Buffer.isBuffer(rawErr)
                ? rawErr.toString("utf-8")
                : String(rawErr)
              : "";
            if (
              rawErrStr.includes("RESOURCE_EXHAUSTED") ||
              rawErrStr.includes("Individual quota reached") ||
              rawErrStr.includes("code 429")
            ) {
              activeStep = headStep;
              isInterrupted = true;
              promptText = "Continue your previous response.";
            }
          }
        } else {
          activeStep = dbInstance
            .prepare(
              "SELECT * FROM steps WHERE status = 2 ORDER BY rowid DESC LIMIT 1",
            )
            .get() as Record<string, unknown> | undefined;
          if (activeStep) {
            isInterrupted = true;
          }
        }
      } catch {
        try {
          activeStep = dbInstance
            .prepare(
              "SELECT * FROM steps WHERE status = 2 ORDER BY rowid DESC LIMIT 1",
            )
            .get() as Record<string, unknown> | undefined;
          if (activeStep) {
            isInterrupted = true;
          }
        } catch {
          activeStep = undefined;
        }
      }

      if (activeStep) {
        const stepCascadeId =
          activeStep.cascade_id || activeStep.cascadeId
            ? String(activeStep.cascade_id || activeStep.cascadeId)
            : "";
        if (stepCascadeId) {
          cascadeId = stepCascadeId;
        }

        if (!promptText) {
          promptText = extractPromptFromTranscript(transcriptPath);
        }

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

          const normalized = model
            ? normalizeModelToProtoEnum(model)
            : undefined;
          return {
            cascadeId,
            conversationDbPath: dbPath,
            isInterrupted,
            promptPayload: {
              prompt: promptText,
              requestedModel: model,
              cascadeConfig: normalized
                ? {
                    requestedModel: { model: normalized.enumModel },
                    plannerConfig: {
                      requestedModel: {
                        model: normalized.enumModel,
                        choice: { case: "model", value: normalized.enumModel },
                      },
                      planModel: normalized.enumModel,
                      ...(normalized.modelName
                        ? { modelName: normalized.modelName }
                        : {}),
                    },
                  }
                : undefined,
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
              const normalized = model
                ? normalizeModelToProtoEnum(model)
                : undefined;
              return {
                cascadeId,
                conversationDbPath: dbPath,
                sessionId: activeRow.session_id
                  ? String(activeRow.session_id)
                  : undefined,
                promptPayload: {
                  prompt: promptText,
                  requestedModel: model,
                  cascadeConfig: normalized
                    ? {
                        requestedModel: { model: normalized.enumModel },
                        plannerConfig: {
                          requestedModel: {
                            model: normalized.enumModel,
                            choice: {
                              case: "model",
                              value: normalized.enumModel,
                            },
                          },
                          planModel: normalized.enumModel,
                          ...(normalized.modelName
                            ? { modelName: normalized.modelName }
                            : {}),
                        },
                      }
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

export async function detectAllActiveTurns(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<ActiveTurnSnapshot[]> {
  // Explicit CLI exclusion
  if (isCliTarget(target)) {
    chatResumeEvents.recordSkippedCli();
    logger.info("Skipping active turn detection for CLI target");
    return [];
  }

  const effectiveTarget = target ?? "app";
  const buffer = options?.buffer ?? sessionContinuityBuffer;
  const results: ActiveTurnSnapshot[] = [];

  // 1. Check custom detector hook if provided
  if (options?.customDetector) {
    try {
      const customResult = await options.customDetector(effectiveTarget);
      if (customResult) {
        results.push(customResult);
      }
    } catch (err) {
      logger.warn("Custom active turn detector threw error", err);
    }
  }

  // 2. Check volatile in-memory registered active prompts
  const inMemoryPrompt = buffer.getActivePrompt(effectiveTarget);
  if (inMemoryPrompt) {
    results.push(inMemoryPrompt);
  }

  // 3. Inspect real Antigravity conversation databases (sorted by mtimeMs, capped to top 5)
  const candidatePaths =
    options?.dbPaths ?? getAntigravityConversationDbPaths(effectiveTarget);

  const seenCascades = new Set<string>(results.map((r) => r.cascadeId));

  for (const dbPath of candidatePaths) {
    const detected = await detectActiveTurnInDatabase(dbPath, effectiveTarget);
    if (detected && !seenCascades.has(detected.cascadeId)) {
      seenCascades.add(detected.cascadeId);
      results.push(detected);
    }
  }

  // 4. Fallback inspection for test environments or state storage
  if (!options?.dbPaths && results.length === 0) {
    const stateDbPaths = getAntigravityDbPaths(effectiveTarget);
    for (const dbPath of stateDbPaths) {
      if (!candidatePaths.includes(dbPath)) {
        const detected = await detectActiveTurnInDatabase(
          dbPath,
          effectiveTarget,
        );
        if (detected && !seenCascades.has(detected.cascadeId)) {
          seenCascades.add(detected.cascadeId);
          results.push(detected);
          break;
        }
      }
    }
  }

  return results;
}

export async function detectActiveTurn(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<ActiveTurnSnapshot | null> {
  const all = await detectAllActiveTurns(target, options);
  return all[0] ?? null;
}

export async function captureAndBufferActiveTurn(
  target?: AntigravityAppTarget,
  options?: ActiveTurnDetectionOptions,
): Promise<InFlightChatSnapshot | null> {
  if (isCliTarget(target)) {
    chatResumeEvents.recordSkippedCli();
    return null;
  }

  const activeTurns = await detectAllActiveTurns(target, options);
  if (activeTurns.length === 0) {
    logger.info(
      `No active in-flight turn detected for target ${target ?? "app"}`,
    );
    return null;
  }

  const buffer = options?.buffer ?? sessionContinuityBuffer;
  const effectiveTarget = target ?? "app";
  let primarySnapshot: InFlightChatSnapshot | null = null;

  for (const activeTurn of activeTurns) {
    const snapshot = buffer.store({
      appTarget: effectiveTarget,
      cascadeId: activeTurn.cascadeId,
      sessionId: activeTurn.sessionId,
      promptPayload: activeTurn.promptPayload,
      isInterrupted: activeTurn.isInterrupted,
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

    if (!primarySnapshot) {
      primarySnapshot = snapshot;
    }
  }

  return primarySnapshot;
}
