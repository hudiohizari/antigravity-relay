import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityAnnotationsDir,
  getAntigravityBrainDir,
  getAntigravityConversationDbPaths,
  getAntigravityConversationsDir,
  getAntigravityConversationSummariesDbPath,
  getAntigravityDbPaths,
} from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import {
  sessionContinuityBuffer,
  SessionContinuityBuffer,
} from "./SessionContinuityBuffer";
import {
  isValidModelName,
  isValidProtoModelEnum,
  normalizeModelToProtoEnum,
} from "./ChatResumeDispatcher";
import { chatResumeEvents } from "./telemetry";
import type {
  ActiveTurnSnapshot,
  ChatResumeSwitchSource,
  InFlightChatSnapshot,
} from "./types";

export const CASCADE_RUN_STATUS = {
  RUNNING: "CASCADE_RUN_STATUS_RUNNING",
  IDLE: "CASCADE_RUN_STATUS_IDLE",
} as const;

export interface ActiveConversationSummary {
  conversationId: string;
  title: string;
  status: string;
  notFullyIdle: boolean;
  killed: boolean;
  nestingDepth: number;
  parentConversationId?: string;
  workspaceUris?: string;
  lastModifiedTime?: string | number;
}

export function getActiveConversationsFromSummaries(
  target: AntigravityAppTarget = "app",
): Map<string, ActiveConversationSummary> | null {
  if (isCliTarget(target)) {
    return null;
  }

  const summariesDbPath = getAntigravityConversationSummariesDbPath(target);
  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    return null;
  }

  let db: Database.Database | null = null;
  try {
    const DatabaseConstructor =
      typeof Database === "function" ? Database : (Database as any)?.default;
    const dbInstance: Database.Database = new DatabaseConstructor(
      summariesDbPath,
      {
        readonly: true,
        fileMustExist: true,
        timeout: 500,
      },
    );
    db = dbInstance;
    try {
      dbInstance.pragma("busy_timeout = 500");
    } catch {
      // Ignore pragma error
    }

    const hasTable = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();
    if (!hasTable) {
      return null;
    }

    const rows = dbInstance
      .prepare(
        `SELECT conversation_id, title, status, not_fully_idle, killed, nesting_depth, parent_conversation_id, workspace_uris, last_modified_time
         FROM conversation_summaries
         WHERE (not_fully_idle = 1 OR status = ?)
           AND killed = 0
         ORDER BY last_modified_time DESC`,
      )
      .all(CASCADE_RUN_STATUS.RUNNING) as Array<Record<string, unknown>>;

    const activeMap = new Map<string, ActiveConversationSummary>();

    for (const row of rows) {
      const convId = String(row.conversation_id ?? "");
      if (!convId) continue;

      const nestingDepth = Number(row.nesting_depth ?? 0);
      const parentId = row.parent_conversation_id
        ? String(row.parent_conversation_id)
        : "";

      const summary: ActiveConversationSummary = {
        conversationId: convId,
        title: String(row.title ?? ""),
        status: String(row.status ?? ""),
        notFullyIdle: Boolean(row.not_fully_idle),
        killed: Boolean(row.killed),
        nestingDepth,
        parentConversationId: parentId || undefined,
        workspaceUris: row.workspace_uris
          ? String(row.workspace_uris)
          : undefined,
        lastModifiedTime: row.last_modified_time as any,
      };

      if (nestingDepth > 0 && parentId) {
        if (!activeMap.has(parentId)) {
          let parentSummary: ActiveConversationSummary | null = null;
          let isKilledParent = false;
          try {
            const parentRow = dbInstance
              .prepare(
                `SELECT conversation_id, title, status, not_fully_idle, killed, nesting_depth, parent_conversation_id, workspace_uris, last_modified_time
                 FROM conversation_summaries
                 WHERE conversation_id = ?`,
              )
              .get(parentId) as Record<string, unknown> | undefined;
            if (parentRow && Boolean(parentRow.killed)) {
              isKilledParent = true;
            } else if (parentRow) {
              parentSummary = {
                conversationId: parentId,
                title: String(parentRow.title ?? summary.title),
                status: String(parentRow.status ?? summary.status),
                notFullyIdle: true,
                killed: false,
                nestingDepth: Number(parentRow.nesting_depth ?? 0),
                parentConversationId: parentRow.parent_conversation_id
                  ? String(parentRow.parent_conversation_id)
                  : undefined,
                workspaceUris: parentRow.workspace_uris
                  ? String(parentRow.workspace_uris)
                  : summary.workspaceUris,
                lastModifiedTime: parentRow.last_modified_time as any,
              };
            }
          } catch {
            // Ignore query error
          }

          if (isKilledParent) {
            continue;
          }

          activeMap.set(
            parentId,
            parentSummary ?? {
              ...summary,
              conversationId: parentId,
              nestingDepth: 0,
            },
          );
        }
      } else {
        activeMap.set(convId, summary);
      }
    }

    return activeMap;
  } catch (err) {
    logger.warn(
      `Failed to query conversation summaries from ${summariesDbPath}`,
      err,
    );
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }
}

export function isConversationIdleInSummaries(
  cascadeId: string,
  appTarget: AntigravityAppTarget = "app",
): boolean {
  if (isCliTarget(appTarget) || !cascadeId) {
    return false;
  }

  const summariesDbPath = getAntigravityConversationSummariesDbPath(appTarget);
  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    return false;
  }

  let db: Database.Database | null = null;
  try {
    const DatabaseConstructor =
      typeof Database === "function" ? Database : (Database as any)?.default;
    const dbInstance: Database.Database = new DatabaseConstructor(
      summariesDbPath,
      {
        readonly: true,
        fileMustExist: true,
        timeout: 500,
      },
    );
    db = dbInstance;
    try {
      dbInstance.pragma("busy_timeout = 500");
    } catch {
      // Ignore pragma error
    }

    const hasTable = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();
    if (!hasTable) {
      return false;
    }

    const row = dbInstance
      .prepare(
        `SELECT conversation_id, not_fully_idle, status, killed, nesting_depth, parent_conversation_id
         FROM conversation_summaries
         WHERE conversation_id = ?`,
      )
      .get(cascadeId) as
      | {
          conversation_id: string;
          not_fully_idle: number | boolean;
          status: string;
          killed: number | boolean;
          nesting_depth: number;
          parent_conversation_id: string;
        }
      | undefined;

    if (!row) {
      return false;
    }

    const notFullyIdle = Boolean(row.not_fully_idle);
    const isRunning = row.status === CASCADE_RUN_STATUS.RUNNING;
    const isKilled = Boolean(row.killed);

    if (isKilled) {
      return true;
    }

    if (!notFullyIdle && !isRunning) {
      const activeChild = dbInstance
        .prepare(
          `SELECT conversation_id FROM conversation_summaries
           WHERE parent_conversation_id = ?
             AND (not_fully_idle = 1 OR status = ?)
             AND killed = 0
           LIMIT 1`,
        )
        .get(cascadeId, CASCADE_RUN_STATUS.RUNNING);

      if (!activeChild) {
        return true;
      }
    }

    return false;
  } catch (err) {
    logger.warn(
      `Failed to check conversation idle status in summaries for ${cascadeId}`,
      err,
    );
    return false;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }
}

export function isConversationActiveInSummaries(
  cascadeId: string,
  appTarget: AntigravityAppTarget = "app",
): boolean {
  if (isCliTarget(appTarget) || !cascadeId) {
    return false;
  }

  const summariesDbPath = getAntigravityConversationSummariesDbPath(appTarget);
  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    return false;
  }

  let db: Database.Database | null = null;
  try {
    const DatabaseConstructor =
      typeof Database === "function" ? Database : (Database as any)?.default;
    const dbInstance: Database.Database = new DatabaseConstructor(
      summariesDbPath,
      {
        readonly: true,
        fileMustExist: true,
        timeout: 500,
      },
    );
    db = dbInstance;
    try {
      dbInstance.pragma("busy_timeout = 500");
    } catch {
      // Ignore pragma error
    }

    const hasTable = dbInstance
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();
    if (!hasTable) {
      return false;
    }

    const row = dbInstance
      .prepare(
        `SELECT conversation_id, not_fully_idle, status, killed, nesting_depth, parent_conversation_id
         FROM conversation_summaries
         WHERE conversation_id = ?`,
      )
      .get(cascadeId) as
      | {
          conversation_id: string;
          not_fully_idle?: unknown;
          status?: unknown;
          killed?: unknown;
          nesting_depth?: unknown;
          parent_conversation_id?: unknown;
        }
      | undefined;

    if (!row) {
      return false;
    }

    const isKilled =
      row.killed === 1 ||
      row.killed === "1" ||
      row.killed === true ||
      row.killed === "true";
    if (isKilled) {
      return false;
    }

    const isNotFullyIdle =
      row.not_fully_idle === 1 ||
      row.not_fully_idle === "1" ||
      row.not_fully_idle === true ||
      row.not_fully_idle === "true";
    const isRunning = row.status === CASCADE_RUN_STATUS.RUNNING;

    if (isNotFullyIdle || isRunning) {
      return true;
    }

    const activeChild = dbInstance
      .prepare(
        `SELECT conversation_id FROM conversation_summaries
         WHERE parent_conversation_id = ?
           AND (not_fully_idle = 1 OR not_fully_idle = 'true' OR status = ?)
           AND (killed = 0 OR killed = 'false')
         LIMIT 1`,
      )
      .get(cascadeId, CASCADE_RUN_STATUS.RUNNING);

    return Boolean(activeChild);
  } catch (err) {
    logger.warn(
      `Failed to check conversation active status in summaries for ${cascadeId}`,
      err,
    );
    return false;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }
}

export function hasActiveBackgroundTasksInStepsAfter(
  stepsAfter: Array<Record<string, unknown>>,
): boolean {
  let anonymousTaskCount = 0;
  const activeTaskIds = new Set<string>();

  for (const step of stepsAfter) {
    const content = typeof step.content === "string" ? step.content : "";
    const text = typeof step.text === "string" ? step.text : "";
    const message = typeof step.message === "string" ? step.message : "";
    const combined = `${content}\n${text}\n${message}`;

    const isGenericBgStart =
      step.type === "GENERIC" &&
      combined.includes("Tool is running as a background task");

    const isToolCallBgStart =
      Array.isArray(step.tool_calls) &&
      step.tool_calls.some(
        (t: any) =>
          t?.name === "run_command" &&
          (t?.args?.IsDaemon === true || t?.arguments?.IsDaemon === true),
      );

    if (isGenericBgStart || isToolCallBgStart) {
      const match = combined.match(/task id:\s*([^\s\n\r"']+)/i);
      if (match && match[1]) {
        activeTaskIds.add(match[1]);
      } else {
        anonymousTaskCount++;
      }
    }

    if (activeTaskIds.size > 0 || anonymousTaskCount > 0) {
      let matchedSpecificTask = false;
      for (const taskId of Array.from(activeTaskIds)) {
        if (
          combined.includes(taskId) &&
          /(?:exited with code|finished with result|completed|cancelled|killed|Command finished)/i.test(
            combined,
          )
        ) {
          activeTaskIds.delete(taskId);
          matchedSpecificTask = true;
        }
      }

      const isCompletionNotice =
        /(?:The command exited with code|exited with code \d+|finished with result:|Task .* finished|Task .* completed|Task .* cancelled|Task .* killed)/i.test(
          combined,
        );

      if (isCompletionNotice && !matchedSpecificTask) {
        if (activeTaskIds.size > 0) {
          const firstId = activeTaskIds.values().next().value;
          if (firstId) {
            activeTaskIds.delete(firstId);
          }
        } else if (anonymousTaskCount > 0) {
          anonymousTaskCount--;
        }
      }
    }
  }

  return activeTaskIds.size > 0 || anonymousTaskCount > 0;
}

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

export function resolveParentCascadeIdFromSubagent(
  subagentCascadeId: string,
  appTarget: AntigravityAppTarget = "app",
  dbInstance?: Database.Database | null,
): string | null {
  if (!subagentCascadeId) {
    return null;
  }

  const brainDir = getAntigravityBrainDir(appTarget);

  // 1. Inspect subagent transcript for caller agent reminder:
  // e.g. caller agent (name: "parent", id: "<parentCascadeId>")
  // or caller agent (name: 'parent', id: '<parentCascadeId>')
  // or "Recipient": "<parentCascadeId>"
  // or "parent_cascade_id": "<parentCascadeId>"
  const transcriptPath = path.join(
    brainDir,
    subagentCascadeId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );

  if (fs.existsSync(transcriptPath)) {
    try {
      const content = fs.readFileSync(transcriptPath, "utf-8");

      // Match: caller agent (name: "parent", id: "...")
      const callerMatch = content.match(
        /caller\s+agent\s*\(\s*name:\s*["']parent["'],\s*id:\s*["']([a-zA-Z0-9_\-\.]+)["']\s*\)/i,
      );
      if (
        callerMatch &&
        callerMatch[1] &&
        callerMatch[1] !== subagentCascadeId
      ) {
        return callerMatch[1];
      }

      // Match: Recipient: "..." when sending message to parent
      const recipientMatch = content.match(
        /Recipient["']?\s*[:=]\s*["']([a-zA-Z0-9_\-\.]{8,})["']/i,
      );
      if (
        recipientMatch &&
        recipientMatch[1] &&
        recipientMatch[1] !== subagentCascadeId
      ) {
        return recipientMatch[1];
      }

      // Match: parentCascadeId / parent_cascade_id
      const parentIdMatch = content.match(
        /["'](?:parent_cascade_id|parentCascadeId)["']\s*:\s*["']([a-zA-Z0-9_\-\.]+)["']/i,
      );
      if (
        parentIdMatch &&
        parentIdMatch[1] &&
        parentIdMatch[1] !== subagentCascadeId
      ) {
        return parentIdMatch[1];
      }
    } catch {
      // Continue to next resolution strategies
    }
  }

  // 2. Inspect SQLite trajectory_meta or trajectory_metadata_blob or parent_references
  if (dbInstance) {
    try {
      // Check trajectory_meta table
      const hasTrajectoryMeta = dbInstance
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_meta'",
        )
        .get();
      if (hasTrajectoryMeta) {
        const columns = (
          dbInstance.pragma("table_info(trajectory_meta)") as Array<{
            name: string;
          }>
        ).map((c) => c.name.toLowerCase());
        for (const col of [
          "parent_cascade_id",
          "parent_trajectory_id",
          "parent_id",
          "caller_id",
        ]) {
          if (columns.includes(col)) {
            const row = dbInstance
              .prepare(
                `SELECT ${col} FROM trajectory_meta WHERE ${col} IS NOT NULL LIMIT 1`,
              )
              .get() as Record<string, unknown> | undefined;
            if (row && row[col] && String(row[col]) !== subagentCascadeId) {
              return String(row[col]);
            }
          }
        }
      }

      // Check trajectory_metadata_blob table
      const hasBlobTable = dbInstance
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='trajectory_metadata_blob'",
        )
        .get();
      if (hasBlobTable) {
        const rows = dbInstance
          .prepare("SELECT data FROM trajectory_metadata_blob LIMIT 5")
          .all() as Array<{ data: Buffer | string | null }>;
        for (const row of rows) {
          if (!row.data) continue;
          const raw = Buffer.isBuffer(row.data)
            ? row.data.toString("utf-8")
            : String(row.data);

          const uuidMatch = raw.match(
            /2\$([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i,
          );
          if (uuidMatch && uuidMatch[1] && uuidMatch[1] !== subagentCascadeId) {
            return uuidMatch[1];
          }

          const wireMatch = raw.match(
            /2\$([a-zA-Z0-9_\-\.]+?)(?=[:"'\s\0\x00-\x1f]|$)/,
          );
          if (wireMatch && wireMatch[1] && wireMatch[1] !== subagentCascadeId) {
            return wireMatch[1];
          }

          const callerMatch = raw.match(
            /(?:parent_cascade_id|parentCascadeId|caller_id|callerId)["']?\s*[:=]\s*["']([a-zA-Z0-9_\-\.]+)["']/i,
          );
          if (
            callerMatch &&
            callerMatch[1] &&
            callerMatch[1] !== subagentCascadeId
          ) {
            return callerMatch[1];
          }
        }
      }

      // Check parent_references table if it exists
      const hasParentRefTable = dbInstance
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='parent_references'",
        )
        .get();
      if (hasParentRefTable) {
        const row = dbInstance
          .prepare(
            "SELECT parent_cascade_id FROM parent_references WHERE parent_cascade_id IS NOT NULL LIMIT 1",
          )
          .get() as { parent_cascade_id?: string } | undefined;
        if (
          row?.parent_cascade_id &&
          String(row.parent_cascade_id) !== subagentCascadeId
        ) {
          return String(row.parent_cascade_id);
        }
      }
    } catch {
      // Continue to annotations check
    }
  }

  // 3. Annotations pbtxt
  const annotationsDir = getAntigravityAnnotationsDir(appTarget);
  if (annotationsDir && fs.existsSync(annotationsDir)) {
    const pbtxtPath = path.join(annotationsDir, `${subagentCascadeId}.pbtxt`);
    if (fs.existsSync(pbtxtPath)) {
      try {
        const content = fs.readFileSync(pbtxtPath, "utf-8");
        const parentMatch = content.match(
          /(?:parent_cascade_id|parent_id|caller_id):\s*["']?([a-zA-Z0-9_\-\.]+)["']?/i,
        );
        if (
          parentMatch &&
          parentMatch[1] &&
          parentMatch[1] !== subagentCascadeId
        ) {
          return parentMatch[1];
        }
      } catch {
        // Suppress
      }
    }
  }

  return null;
}

export function hasActiveSubagentForParent(
  parentCascadeId: string,
  appTarget: AntigravityAppTarget = "app",
): boolean {
  if (!parentCascadeId) return false;

  const summariesDbPath = getAntigravityConversationSummariesDbPath(appTarget);
  if (summariesDbPath && fs.existsSync(summariesDbPath)) {
    let summariesDb: Database.Database | null = null;
    try {
      const DatabaseConstructor =
        typeof Database === "function" ? Database : (Database as any)?.default;
      const summariesDbInstance: Database.Database = new DatabaseConstructor(
        summariesDbPath,
        {
          readonly: true,
          fileMustExist: true,
          timeout: 500,
        },
      );
      summariesDb = summariesDbInstance;
      const hasTable = summariesDbInstance
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
        )
        .get();
      if (hasTable) {
        const activeChild = summariesDbInstance
          .prepare(
            `SELECT conversation_id FROM conversation_summaries
             WHERE parent_conversation_id = ?
               AND (not_fully_idle = 1 OR status = ?)
               AND killed = 0
             LIMIT 1`,
          )
          .get(parentCascadeId, CASCADE_RUN_STATUS.RUNNING);
        if (activeChild) {
          return true;
        }

        const parentRow = summariesDbInstance
          .prepare(
            "SELECT not_fully_idle, status, killed FROM conversation_summaries WHERE conversation_id = ?",
          )
          .get(parentCascadeId) as
          | {
              not_fully_idle?: number | boolean;
              status?: string;
              killed?: number | boolean;
            }
          | undefined;
        if (
          parentRow &&
          (Boolean(parentRow.killed) ||
            (!parentRow.not_fully_idle &&
              parentRow.status === CASCADE_RUN_STATUS.IDLE))
        ) {
          return false;
        }
      }
    } catch {
      // Continue to SQLite candidate DB scan
    } finally {
      if (summariesDb) {
        try {
          summariesDb.close();
        } catch {
          // Ignore close error
        }
      }
    }
  }

  try {
    const candidateDbs = getAntigravityConversationDbPaths(appTarget);
    for (const dbPath of candidateDbs) {
      const filename = path.basename(dbPath, ".db");
      if (filename === parentCascadeId) continue;

      try {
        const stat = fs.statSync(dbPath);
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
          continue;
        }
      } catch {
        continue;
      }

      let db: Database.Database | null = null;
      try {
        const DatabaseConstructor =
          typeof Database === "function"
            ? Database
            : (Database as any)?.default;
        db = new DatabaseConstructor(dbPath, {
          readonly: true,
          fileMustExist: true,
          timeout: 200,
        });
        if (!db) continue;

        const hasSteps = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='steps'",
          )
          .get();
        if (!hasSteps) continue;

        const activeStep = db
          .prepare(
            "SELECT status, idx, step_payload, task_details, metadata FROM steps ORDER BY idx DESC LIMIT 1",
          )
          .get() as
          | {
              status?: number;
              idx?: number;
              step_payload?: unknown;
              task_details?: unknown;
              metadata?: unknown;
            }
          | undefined;
        if (!activeStep || (activeStep.status !== 2 && activeStep.status !== 8))
          continue;

        const raw =
          activeStep.step_payload ??
          activeStep.task_details ??
          activeStep.metadata;
        const rawStr = raw
          ? Buffer.isBuffer(raw)
            ? raw.toString("utf-8")
            : String(raw)
          : "";
        const isDaemon =
          rawStr.includes('"IsDaemon":true') ||
          rawStr.includes('"IsDaemon": true');
        if (isDaemon) continue;

        const resolvedParent = resolveParentCascadeIdFromSubagent(
          filename,
          appTarget,
          db,
        );
        if (resolvedParent === parentCascadeId) {
          return true;
        }
      } catch {
        // Ignore single db error
      } finally {
        if (db) {
          try {
            db.close();
          } catch {
            // Ignore close error
          }
        }
      }
    }
  } catch {
    // Ignore scan failure
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
  appTarget: AntigravityAppTarget = "app",
  hasActiveSubagent?: boolean,
): TranscriptTurnAnalysis | null {
  if (!fs.existsSync(transcriptPath)) {
    return null;
  }

  let effectiveTarget = appTarget;
  if (effectiveTarget === "app" && transcriptPath.includes("antigravity-ide")) {
    effectiveTarget = "ide";
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

    const pathParts = transcriptPath.split(path.sep);
    const sysGenIdx = pathParts.indexOf(".system_generated");
    let cascadeIdFromPath = sysGenIdx > 0 ? pathParts[sysGenIdx - 1] : "";
    if (
      !cascadeIdFromPath &&
      path.basename(transcriptPath) === "transcript.jsonl"
    ) {
      const candidateDir = path.basename(
        path.resolve(transcriptPath, "../../.."),
      );
      if (
        candidateDir &&
        candidateDir !== "." &&
        candidateDir !== "/" &&
        candidateDir !== "transcript"
      ) {
        cascadeIdFromPath = candidateDir;
      }
    }

    // Case 2: Quota or rate limit exhaustion occurred in steps after user prompt
    const quotaPatterns = [
      "RESOURCE_EXHAUSTED",
      "Individual quota reached",
      "code 429",
      "quota exceeded",
    ];

    const errorFields = [
      "error",
      "error_details",
      "message",
      "text",
      "content",
      "thinking",
    ] as const;

    for (const step of stepsAfter) {
      for (const field of errorFields) {
        const val = step[field];
        if (val !== undefined && val !== null) {
          const valStr = typeof val === "string" ? val : JSON.stringify(val);
          for (const pattern of quotaPatterns) {
            if (valStr.includes(pattern)) {
              chatResumeEvents.recordQuotaExhaustionDetected({
                cascadeId: String(step.cascade_id || cascadeIdFromPath),
                matchedField: field,
                pattern,
              });

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
        }
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
      const rawContent = lastStep.content ?? lastStep.text ?? lastStep.message;
      const hasContent =
        typeof rawContent === "string" && rawContent.trim().length > 0;
      const tools = lastStep.tool_calls ?? lastStep.tools;
      const hasTools = Array.isArray(tools) && tools.length > 0;

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

      // Model output text with no tools: check if background tasks or child subagents are actually active
      const isBackgroundTaskActive =
        hasActiveBackgroundTasksInStepsAfter(stepsAfter);

      let cascadeId = cascadeIdFromPath;
      if (!cascadeId) {
        for (const s of stepsAfter) {
          if (s.cascade_id) {
            cascadeId = String(s.cascade_id);
            break;
          }
        }
      }
      if (!cascadeId) {
        if (path.basename(transcriptPath) === "transcript.jsonl") {
          const candidateDir = path.basename(
            path.resolve(transcriptPath, "../../.."),
          );
          if (
            candidateDir &&
            candidateDir !== "." &&
            candidateDir !== "/" &&
            candidateDir !== "transcript"
          ) {
            cascadeId = candidateDir;
          }
        }
        if (!cascadeId) {
          const base = path.basename(transcriptPath, ".jsonl");
          if (base !== "transcript") {
            cascadeId = base;
          }
        }
      }

      const isChildSubagentActive =
        typeof hasActiveSubagent === "boolean"
          ? hasActiveSubagent
          : cascadeId
            ? hasActiveSubagentForParent(cascadeId, effectiveTarget)
            : false;

      const isSummaryActive = cascadeId
        ? isConversationActiveInSummaries(cascadeId, effectiveTarget)
        : false;

      if (isBackgroundTaskActive || isChildSubagentActive || isSummaryActive) {
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

      // Model successfully generated final content response - turn completed and idle
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

export interface DatabaseModelInfo {
  enumModel?: string;
  modelName?: string;
}

function extractProtoWireString(
  text: string,
  fieldKey: string,
): string | undefined {
  const pattern = fieldKey + "\x12";
  let searchPos = 0;
  while (searchPos < text.length) {
    const idx = text.indexOf(pattern, searchPos);
    if (idx === -1) break;
    const lenPos = idx + pattern.length;
    if (lenPos < text.length) {
      const len = text.charCodeAt(lenPos);
      if (len > 0 && len <= 127 && lenPos + 1 + len <= text.length) {
        return text.substring(lenPos + 1, lenPos + 1 + len);
      }
    }
    searchPos = idx + 1;
  }
  return undefined;
}

export function extractModelFromDatabase(
  dbInstance: Database.Database,
): DatabaseModelInfo | undefined {
  let enumModel: string | undefined;
  let modelName: string | undefined;

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
              ? row.data.toString("latin1")
              : "";

        if (!enumModel) {
          // 1. Binary protobuf wire format: model_enum\x12<len><value>
          const wireEnum = extractProtoWireString(text, "model_enum");
          if (wireEnum && isValidProtoModelEnum(wireEnum)) {
            enumModel = wireEnum;
          } else {
            // 2. Text / JSON key: model_enum: "..." or model_enum=...
            const jsonEnumMatch =
              text.match(
                /model_enum["']?\s*[:=]\s*["']?([A-Za-z0-9_]+)["']?/,
              ) || text.match(/model_enum[^\w]*(MODEL_[A-Z0-9_]+)/i);

            if (
              jsonEnumMatch &&
              jsonEnumMatch[1] &&
              isValidProtoModelEnum(jsonEnumMatch[1])
            ) {
              enumModel = jsonEnumMatch[1];
            } else {
              // 3. Generic fallback for MODEL_... wire constants
              const genericMatch = text.match(/MODEL_[A-Z0-9_]+/);
              if (genericMatch && isValidProtoModelEnum(genericMatch[0])) {
                enumModel = genericMatch[0];
              }
            }
          }
        }

        if (!modelName) {
          // 1. Binary protobuf wire format: model_name\x12<len><value>
          const wireName = extractProtoWireString(text, "model_name");
          if (wireName && isValidModelName(wireName)) {
            modelName = wireName;
          } else {
            // 2. Structured key: model_name: "..." or model_name='...'
            const structuredMatch = text.match(
              /model_name["']?\s*[:=]\s*["']([A-Za-z0-9_\-\.]+)["']/i,
            );

            if (
              structuredMatch &&
              structuredMatch[1] &&
              isValidModelName(structuredMatch[1])
            ) {
              modelName = structuredMatch[1];
            } else {
              // 3. Fallback for recognizable model family prefixes
              const fallbackMatch = text.match(
                /(?:claude-[a-z0-9_\-\.]+|gemini-[a-z0-9_\-\.]+|gpt-[a-z0-9_\-\.]+|o[13]-[a-z0-9_\-\.]+)/i,
              );
              if (fallbackMatch && isValidModelName(fallbackMatch[0])) {
                modelName = fallbackMatch[0];
              }
            }
          }
        }

        if (enumModel && modelName) {
          break;
        }
      }
    }

    if (!enumModel) {
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
            ? row.step_payload.toString("latin1")
            : String(row.step_payload);
          const matches = text.match(/MODEL_[A-Z0-9_]+/);
          if (matches && isValidProtoModelEnum(matches[0])) {
            enumModel = matches[0];
            break;
          }
        }
      }
    }
  } catch {
    // Ignore extraction error
  }

  if (enumModel || modelName) {
    return { enumModel, modelName };
  }
  return undefined;
}

export interface DetectActiveTurnOptions {
  activeSummaries?: Map<string, ActiveConversationSummary> | null;
}

export async function detectActiveTurnInDatabase(
  dbPath: string,
  appTarget: AntigravityAppTarget = "app",
  options?: DetectActiveTurnOptions,
): Promise<ActiveTurnSnapshot | null> {
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  const cascadeIdCandidate = path.basename(dbPath, ".db");
  if (isConversationIdleInSummaries(cascadeIdCandidate, appTarget)) {
    logger.debug(
      `Conversation ${cascadeIdCandidate} is marked idle (not_fully_idle=0, status=idle) in conversation_summaries.db; skipping`,
    );
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
    const dbAge = Date.now() - mtime;
    // 1. Parent database mtime within 60 minutes
    const isDbRecent = dbAge < 60 * 60 * 1000;

    // 2. Conversation transcript modified within 15 minutes
    const brainDir = getAntigravityBrainDir(appTarget);
    const transcriptPath = path.join(
      brainDir,
      cascadeIdCandidate,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    let isTranscriptRecent = false;
    if (fs.existsSync(transcriptPath)) {
      try {
        const transcriptStat = fs.statSync(transcriptPath);
        isTranscriptRecent =
          Date.now() - transcriptStat.mtimeMs < 15 * 60 * 1000;
      } catch {
        // Ignore stat error
      }
    }

    // 3. Associated subagent database modified within 15 minutes
    let isSubagentRecent = false;
    if (!isDbRecent && !isTranscriptRecent) {
      try {
        const convDir = path.dirname(dbPath);
        const files = fs.readdirSync(convDir);
        for (const file of files) {
          if (file.endsWith(".db") && file !== path.basename(dbPath)) {
            const subPath = path.join(convDir, file);
            const subStat = fs.statSync(subPath);
            if (Date.now() - subStat.mtimeMs < 15 * 60 * 1000) {
              isSubagentRecent = true;
              break;
            }
          }
        }
      } catch {
        // Ignore dir read error
      }
    }

    isRecent = isDbRecent || isTranscriptRecent || isSubagentRecent;
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

      if (
        cascadeId !== cascadeIdCandidate &&
        isConversationIdleInSummaries(cascadeId, appTarget)
      ) {
        logger.debug(
          `Conversation ${cascadeId} is marked idle (not_fully_idle=0, status=idle) in conversation_summaries.db; skipping`,
        );
        return null;
      }

      if (isSubagentConversation(cascadeId, appTarget, dbInstance)) {
        try {
          const stat = fs.statSync(dbPath);
          if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
            return null;
          }
        } catch {
          return null;
        }

        let subagentActiveStep: Record<string, unknown> | undefined;
        try {
          const activeRows = dbInstance
            .prepare(
              "SELECT * FROM steps WHERE status = 2 OR status = 8 ORDER BY idx DESC LIMIT 1",
            )
            .all() as Array<Record<string, unknown>>;
          if (activeRows.length > 0) {
            const step = activeRows[0];
            const raw = step.step_payload ?? step.task_details ?? step.metadata;
            const rawStr = raw
              ? Buffer.isBuffer(raw)
                ? raw.toString("utf-8")
                : String(raw)
              : "";
            const isDaemon =
              rawStr.includes('"IsDaemon":true') ||
              rawStr.includes('"IsDaemon": true');
            if (!isDaemon) {
              subagentActiveStep = step;
            }
          }
        } catch {
          // steps table might not have idx or status
        }

        if (!subagentActiveStep) {
          logger.debug(
            `Skipping internal subagent conversation ${cascadeId} (${dbPath})`,
          );
          return null;
        }

        const parentCascadeId = resolveParentCascadeIdFromSubagent(
          cascadeId,
          appTarget,
          dbInstance,
        );

        if (!parentCascadeId) {
          logger.warn(
            `Active subagent conversation ${cascadeId} (${dbPath}) could not resolve parent cascade ID; skipping`,
          );
          return null;
        }

        chatResumeEvents.recordSubagentParentResolved({
          subagentCascadeId: cascadeId,
          parentCascadeId,
          stepIndex:
            typeof subagentActiveStep.idx === "number"
              ? subagentActiveStep.idx
              : undefined,
        });

        const dbModel = extractModelFromDatabase(dbInstance);
        const rawStepModel = subagentActiveStep.model
          ? String(subagentActiveStep.model)
          : undefined;

        const authenticEnum =
          (rawStepModel && isValidProtoModelEnum(rawStepModel)
            ? rawStepModel
            : undefined) ?? dbModel?.enumModel;

        const rawNameCandidate =
          dbModel?.modelName ??
          (rawStepModel && !isValidProtoModelEnum(rawStepModel)
            ? rawStepModel
            : undefined);
        const authenticName =
          rawNameCandidate && isValidModelName(rawNameCandidate)
            ? rawNameCandidate
            : undefined;

        const modelToReport = authenticEnum ?? authenticName;
        const normalized = modelToReport
          ? normalizeModelToProtoEnum(modelToReport, authenticName)
          : undefined;

        chatResumeEvents.recordActiveTurnDetected({
          appTarget,
          conversationId: parentCascadeId,
          cascadeId: parentCascadeId,
          stepIndex:
            typeof subagentActiveStep.idx === "number"
              ? subagentActiveStep.idx
              : undefined,
          modelEnum: authenticEnum,
          modelName: authenticName,
          reason: "subagent_orchestration_yielding",
          hasSubagents: true,
          isInterrupted: true,
        });

        const parentDbCandidate = path.join(
          path.dirname(dbPath),
          `${parentCascadeId}.db`,
        );
        const resolvedDbPath = fs.existsSync(parentDbCandidate)
          ? parentDbCandidate
          : dbPath;

        return {
          cascadeId: parentCascadeId,
          conversationDbPath: resolvedDbPath,
          isInterrupted: true,
          promptPayload: {
            prompt: "Continue your previous response.",
            requestedModel: modelToReport,
            modelName: authenticName ?? normalized?.modelName,
            cascadeConfig:
              normalized && isValidProtoModelEnum(normalized.enumModel)
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
                : normalized?.modelName
                  ? {
                      plannerConfig: {
                        modelName: normalized.modelName,
                      },
                    }
                  : undefined,
          },
        };
      }

      const brainDir = getAntigravityBrainDir(appTarget);
      const transcriptPath = path.join(
        brainDir,
        cascadeId,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );

      let maxIdx: number | null | undefined;
      let recentSteps: Array<Record<string, unknown>> = [];

      try {
        const maxRow = dbInstance
          .prepare("SELECT MAX(idx) as max_idx FROM steps")
          .get() as { max_idx: number | null } | undefined;
        maxIdx = maxRow?.max_idx;

        if (typeof maxIdx === "number") {
          recentSteps = dbInstance
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
            const transcriptAnalysis = inspectTranscriptForActiveTurn(
              transcriptPath,
              appTarget,
            );
            if (transcriptAnalysis && transcriptAnalysis.hasActiveTurn) {
              activeStep = {
                idx: transcriptAnalysis.stepIndex ?? maxIdx,
                cascade_id: cascadeId,
              };
              isInterrupted = transcriptAnalysis.isInterrupted;
              promptText = transcriptAnalysis.promptText;
            }
          }

          // If still not active, check if any child subagent is active for this parent cascade
          if (!activeStep && hasActiveSubagentForParent(cascadeId, appTarget)) {
            activeStep = {
              idx: maxIdx,
              cascade_id: cascadeId,
            };
            isInterrupted = true;
            promptText = "Continue your previous response.";
          }

          // Fallback check on recent steps in SQLite for quota exhaustion
          if (!activeStep && recentSteps.length > 0) {
            const quotaPatterns = [
              "RESOURCE_EXHAUSTED",
              "Individual quota reached",
              "code 429",
              "quota exceeded",
            ];
            const checkFields = [
              "error",
              "error_details",
              "message",
              "text",
              "content",
              "thinking",
              "step_payload",
              "metadata",
            ] as const;

            for (const step of recentSteps) {
              for (const field of checkFields) {
                const val = (step as any)[field];
                if (val !== undefined && val !== null) {
                  const valStr = Buffer.isBuffer(val)
                    ? val.toString("utf-8")
                    : typeof val === "string"
                      ? val
                      : JSON.stringify(val);
                  for (const pattern of quotaPatterns) {
                    if (valStr.includes(pattern)) {
                      activeStep = step;
                      isInterrupted = true;
                      promptText = "Continue your previous response.";
                      chatResumeEvents.recordQuotaExhaustionDetected({
                        cascadeId,
                        matchedField: field,
                        pattern,
                      });
                      break;
                    }
                  }
                  if (activeStep) break;
                }
              }
              if (activeStep) break;
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

      const checkIsActiveInSummaries = (cid: string): boolean => {
        if (options?.activeSummaries !== undefined) {
          if (options.activeSummaries === null) {
            return false;
          }
          return options.activeSummaries.has(cid);
        }
        return isConversationActiveInSummaries(cid, appTarget);
      };

      if (
        !activeStep &&
        (checkIsActiveInSummaries(cascadeId) ||
          checkIsActiveInSummaries(cascadeIdCandidate))
      ) {
        let stepModel: unknown;
        if (typeof recentSteps !== "undefined" && Array.isArray(recentSteps)) {
          for (const s of recentSteps) {
            if (s.model) {
              stepModel = s.model;
              break;
            }
          }
        }
        activeStep = {
          idx: typeof maxIdx === "number" ? maxIdx : 0,
          cascade_id: cascadeId,
          ...(stepModel ? { model: stepModel } : {}),
        };
        isInterrupted = true;
        promptText = "Continue your previous response.";
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

        if (!promptText && isInterrupted) {
          promptText = "Continue your previous response.";
        }

        const dbModel = extractModelFromDatabase(dbInstance);
        const rawStepModel = activeStep.model
          ? String(activeStep.model)
          : undefined;

        // Prioritize authentic proto enum from gen_metadata or steps
        const authenticEnum =
          (rawStepModel && isValidProtoModelEnum(rawStepModel)
            ? rawStepModel
            : undefined) ?? dbModel?.enumModel;

        const rawNameCandidate =
          dbModel?.modelName ??
          (rawStepModel && !isValidProtoModelEnum(rawStepModel)
            ? rawStepModel
            : undefined);
        const authenticName =
          rawNameCandidate && isValidModelName(rawNameCandidate)
            ? rawNameCandidate
            : undefined;

        const modelToReport = authenticEnum ?? authenticName;

        if (promptText && promptText.trim().length > 0) {
          chatResumeEvents.recordActiveTurnDetected({
            appTarget,
            conversationId: cascadeId,
            cascadeId,
            stepIndex:
              typeof activeStep.idx === "number" ? activeStep.idx : undefined,
            modelEnum: authenticEnum,
            modelName: authenticName,
            reason: isInterrupted
              ? "subagent_orchestration_yielding"
              : undefined,
            hasSubagents: isInterrupted,
            isInterrupted,
          });

          const normalized = modelToReport
            ? normalizeModelToProtoEnum(modelToReport, authenticName)
            : undefined;

          return {
            cascadeId,
            conversationDbPath: dbPath,
            isInterrupted,
            promptPayload: {
              prompt: promptText,
              requestedModel: modelToReport,
              modelName: authenticName ?? normalized?.modelName,
              cascadeConfig:
                normalized && isValidProtoModelEnum(normalized.enumModel)
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
                  : normalized?.modelName
                    ? {
                        plannerConfig: {
                          modelName: normalized.modelName,
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
                  modelName: normalized?.modelName,
                  cascadeConfig:
                    normalized && isValidProtoModelEnum(normalized.enumModel)
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
                      : normalized?.modelName
                        ? {
                            plannerConfig: {
                              modelName: normalized.modelName,
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
                    modelName:
                      parsed.modelName ??
                      ((
                        parsed.cascadeConfig?.plannerConfig as
                          Record<string, unknown> | undefined
                      )?.modelName as string | undefined),
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

  // 3. Inspect conversation_summaries.db as authoritative source of truth
  const activeSummaries = getActiveConversationsFromSummaries(effectiveTarget);

  let candidatePaths: string[] = [];

  if (options?.dbPaths) {
    if (activeSummaries !== null) {
      candidatePaths = options.dbPaths.filter((p) => {
        const id = path.basename(p, ".db");
        return activeSummaries.has(id);
      });
    } else {
      candidatePaths = options.dbPaths;
    }
  } else if (activeSummaries !== null) {
    const convsDir = getAntigravityConversationsDir(effectiveTarget);
    if (convsDir && fs.existsSync(convsDir)) {
      for (const cascadeId of activeSummaries.keys()) {
        const candidateDb = path.join(convsDir, `${cascadeId}.db`);
        if (fs.existsSync(candidateDb)) {
          candidatePaths.push(candidateDb);
        }
      }
    }
  } else {
    candidatePaths = getAntigravityConversationDbPaths(effectiveTarget);
  }

  const seenCascades = new Set<string>(results.map((r) => r.cascadeId));

  for (const dbPath of candidatePaths) {
    const detected = await detectActiveTurnInDatabase(dbPath, effectiveTarget, {
      activeSummaries,
    });
    if (detected && !seenCascades.has(detected.cascadeId)) {
      seenCascades.add(detected.cascadeId);
      results.push(detected);
    }
  }

  // 4. Fallback inspection for test environments or state storage
  if (!options?.dbPaths && activeSummaries === null && results.length === 0) {
    const stateDbPaths = getAntigravityDbPaths(effectiveTarget);
    for (const dbPath of stateDbPaths) {
      if (!candidatePaths.includes(dbPath)) {
        const detected = await detectActiveTurnInDatabase(
          dbPath,
          effectiveTarget,
          { activeSummaries },
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
