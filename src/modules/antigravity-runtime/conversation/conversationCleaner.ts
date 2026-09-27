import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { logger } from "@/shared/logging/logger";
import {
  type AntigravityAppTarget,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationsDir,
  getAntigravityConversationSummariesDbPath,
  maskUserPath,
  type PathResolutionOptions,
} from "@/shared/platform/paths";
import { configureDatabase } from "@/shared/persistence/database/dbConnection";

export * from "./types";
import {
  type BrokenChatItem,
  type BrokenProjectGroup,
  type InvalidChatsStats,
  type CleanInvalidChatsResult,
  type ParsedWorkspaceInfo,
  CONVERSATION_CLEANER_CONSTANTS,
} from "./types";

/**
 * Normalizes raw workspace URI strings from SQLite and derives a clean project name
 * and PII-masked path.
 */
export function parseWorkspaceInfo(
  rawWorkspaceUris: unknown,
): ParsedWorkspaceInfo {
  const fallback: ParsedWorkspaceInfo = {
    projectName: CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME,
    workspacePath: "",
  };

  if (!rawWorkspaceUris || typeof rawWorkspaceUris !== "string") {
    return fallback;
  }

  const trimmed = rawWorkspaceUris.trim();
  if (
    !trimmed ||
    trimmed === "[]" ||
    trimmed === "null" ||
    trimmed === "[null]"
  ) {
    return fallback;
  }

  let candidateUri = "";

  // 1. Safe JSON parsing with fallback to raw string
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const firstValid = parsed.find(
        (item) => typeof item === "string" && item.trim().length > 0,
      );
      if (firstValid) {
        candidateUri = String(firstValid).trim();
      }
    } else if (typeof parsed === "string") {
      candidateUri = parsed.trim();
    }
  } catch {
    // Legacy or unquoted URI
    candidateUri = trimmed;
  }

  if (!candidateUri) {
    return fallback;
  }

  // 2. Decode percent-encoding safely
  let decoded = candidateUri;
  try {
    decoded = decodeURIComponent(candidateUri);
  } catch {
    // If malformed percent encoding, keep raw candidateUri
  }

  // 3. Strip file:// scheme and normalize Windows drive letter
  let normalizedPath = decoded;
  if (normalizedPath.startsWith("file://localhost/")) {
    normalizedPath = normalizedPath.slice("file://localhost".length);
  } else if (normalizedPath.startsWith("file://")) {
    normalizedPath = normalizedPath.slice("file://".length);
  }

  // Handle Windows paths like /c:/Users/... or /C:/Users/...
  if (/^\/[a-zA-Z]:[\\/]/.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(1);
  }

  // Normalize drive letter to uppercase (e.g. c:/ -> C:/)
  if (/^[a-zA-Z]:[\\/]/.test(normalizedPath)) {
    normalizedPath =
      normalizedPath.charAt(0).toUpperCase() + normalizedPath.slice(1);
  }

  // Remove trailing slashes
  normalizedPath = normalizedPath.replace(/[/\\]+$/, "");

  // 4. Extract Project Name (terminal segment)
  const segments = normalizedPath.split(/[/\\]/).filter(Boolean);
  let projectName = segments.length > 0 ? segments[segments.length - 1] : "";

  // Guard against root drive letters (e.g. "C:") or meaningless single dots
  if (!projectName || projectName.endsWith(":") || projectName === ".") {
    projectName = CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;
  }

  // 5. PII Masking via maskUserPath()
  const maskedPath = maskUserPath(normalizedPath) ?? normalizedPath;

  return {
    projectName,
    workspacePath: maskedPath,
  };
}

/**
 * Parses timestamp value from last_modified_time column into ms since epoch.
 */
export function parseTimestamp(rawTime: unknown): number | undefined {
  if (typeof rawTime === "number" && !Number.isNaN(rawTime)) {
    return rawTime;
  }
  if (typeof rawTime === "string" && rawTime.trim().length > 0) {
    const parsed = Date.parse(rawTime);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function getInvalidChatsStats(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): InvalidChatsStats {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    return {
      target: canonicalTarget,
      summariesDbPath: summariesDbPath || "",
      exists: false,
      totalChats: 0,
      invalidChats: 0,
      validChats: 0,
      projectGroups: [],
    };
  }

  let db: Database.Database | null = null;
  try {
    // O(1) in-memory trajectory existence check using Set(fs.readdirSync(...))
    let trajectorySet = new Set<string>();
    if (conversationsDir && fs.existsSync(conversationsDir)) {
      const entries = fs.readdirSync(conversationsDir);
      trajectorySet = new Set(entries);
    }

    db = new Database(summariesDbPath, { fileMustExist: true });
    configureDatabase(db, {
      busyTimeoutMs: CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_READ,
      readOnly: true,
    });

    const hasTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      return {
        target: canonicalTarget,
        summariesDbPath,
        exists: true,
        totalChats: 0,
        invalidChats: 0,
        validChats: 0,
        projectGroups: [],
      };
    }

    let rows: Array<{
      conversation_id: string;
      title?: string | null;
      workspace_uris?: string | null;
      last_modified_time?: string | number | null;
    }> = [];

    try {
      rows = db
        .prepare(
          "SELECT conversation_id, title, workspace_uris, last_modified_time FROM conversation_summaries",
        )
        .all() as typeof rows;
    } catch {
      // Fallback query if optional columns are absent in older tables
      rows = db
        .prepare("SELECT conversation_id FROM conversation_summaries")
        .all() as typeof rows;
    }

    let validCount = 0;
    let invalidCount = 0;
    const groupMap = new Map<string, BrokenProjectGroup>();

    for (const row of rows) {
      const cid = row.conversation_id;
      if (trajectorySet.has(`${cid}.db`)) {
        validCount++;
      } else {
        invalidCount++;
        const { projectName, workspacePath } = parseWorkspaceInfo(
          row.workspace_uris,
        );
        const groupKey = `${projectName}:::${workspacePath}`;

        let group = groupMap.get(groupKey);
        if (!group) {
          group = {
            projectName,
            workspacePath,
            brokenCount: 0,
            conversations: [],
          };
          groupMap.set(groupKey, group);
        }

        group.brokenCount++;
        group.conversations.push({
          conversationId: cid,
          title:
            row.title?.trim() ||
            CONVERSATION_CLEANER_CONSTANTS.FALLBACK_CHAT_TITLE,
          updatedAt: parseTimestamp(row.last_modified_time),
        });
      }
    }

    // Sort project groups: Named projects alphabetical, Fallback project last
    const projectGroups = Array.from(groupMap.values()).sort((a, b) => {
      const isAFallback =
        a.projectName === CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;
      const isBFallback =
        b.projectName === CONVERSATION_CLEANER_CONSTANTS.FALLBACK_PROJECT_NAME;

      if (isAFallback && !isBFallback) return 1;
      if (!isAFallback && isBFallback) return -1;

      const comp = a.projectName.localeCompare(b.projectName, undefined, {
        sensitivity: "base",
      });
      if (comp !== 0) return comp;
      return a.workspacePath.localeCompare(b.workspacePath);
    });

    // Sort conversations inside each group descending by updatedAt
    for (const group of projectGroups) {
      group.conversations.sort((a, b) => {
        const timeA = a.updatedAt ?? 0;
        const timeB = b.updatedAt ?? 0;
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        return a.conversationId.localeCompare(b.conversationId);
      });
    }

    return {
      target: canonicalTarget,
      summariesDbPath,
      exists: true,
      totalChats: rows.length,
      invalidChats: invalidCount,
      validChats: validCount,
      projectGroups,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Failed to inspect conversation summaries: ${summariesDbPath}`,
      error,
    );
    return {
      target: canonicalTarget,
      summariesDbPath,
      exists: true,
      totalChats: 0,
      invalidChats: 0,
      validChats: 0,
      projectGroups: [],
      error: errorMsg,
    };
  } finally {
    if (db) {
      db.close();
    }
  }
}

export function cleanInvalidChats(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): CleanInvalidChatsResult {
  const canonicalTarget = resolveAntigravityAppTarget(target);
  const summariesDbPath = getAntigravityConversationSummariesDbPath(
    canonicalTarget,
    options,
  );
  const conversationsDir = getAntigravityConversationsDir(
    canonicalTarget,
    options,
  );

  const result: CleanInvalidChatsResult = {
    target: canonicalTarget,
    summariesDbPath: summariesDbPath || "",
    totalChecked: 0,
    prunedCount: 0,
    errors: [],
  };

  if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
    result.errors.push(`Conversation database not found: ${summariesDbPath}`);
    return result;
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(summariesDbPath, { fileMustExist: true });
    configureDatabase(db, {
      busyTimeoutMs:
        CONVERSATION_CLEANER_CONSTANTS.SQLITE_BUSY_TIMEOUT_MS_WRITE,
      readOnly: false,
    });

    const hasTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
      )
      .get();

    if (!hasTable) {
      result.errors.push("Table conversation_summaries does not exist.");
      return result;
    }

    // Fresh directory read to prevent TOCTOU race conditions
    let trajectorySet = new Set<string>();
    if (conversationsDir && fs.existsSync(conversationsDir)) {
      const entries = fs.readdirSync(conversationsDir);
      trajectorySet = new Set(entries);
    }

    const rows = db
      .prepare("SELECT conversation_id FROM conversation_summaries")
      .all() as Array<{ conversation_id: string }>;

    result.totalChecked = rows.length;

    const invalidIds: string[] = [];
    for (const row of rows) {
      const cid = row.conversation_id;
      if (!trajectorySet.has(`${cid}.db`)) {
        invalidIds.push(cid);
      }
    }

    if (invalidIds.length > 0) {
      const deleteStmt = db.prepare(
        "DELETE FROM conversation_summaries WHERE conversation_id = ?",
      );

      const deleteTransaction = db.transaction((ids: string[]) => {
        for (const id of ids) {
          deleteStmt.run(id);
        }
      });

      deleteTransaction(invalidIds);
      result.prunedCount = invalidIds.length;
      logger.info(
        `Pruned ${invalidIds.length} invalid chat entries from ${summariesDbPath}`,
      );

      // Invalidate protobuf mirror caches
      const parentDir = path.dirname(summariesDbPath);
      for (const protoName of CONVERSATION_CLEANER_CONSTANTS.PROTO_MIRROR_CANDIDATES) {
        const protoPath = path.join(parentDir, protoName);
        if (fs.existsSync(protoPath)) {
          try {
            fs.unlinkSync(protoPath);
            logger.info(`Removed stale summary proto mirror: ${protoPath}`);
          } catch (unlinkErr) {
            logger.warn(
              `Failed to remove stale summary proto: ${protoPath}`,
              unlinkErr,
            );
          }
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Failed to clean conversation summaries: ${errorMsg}`);
    logger.error("Error during invalid chat cleanup", error);
  } finally {
    if (db) {
      db.close();
    }
  }

  return result;
}
