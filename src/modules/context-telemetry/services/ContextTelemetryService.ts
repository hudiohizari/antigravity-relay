import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import {
  getAntigravityConversationSummariesDbPath,
  getAntigravityConversationsDir,
  maskUserPath,
} from "@/shared/platform/paths";
import { logger } from "@/shared/logging/logger";
import {
  parseGenMetadataProtobuf,
  parseStepMetadataProtobuf,
  type ParsedTokenMetrics,
} from "../protobuf/genMetadataParser";
import {
  calculatePressureState,
  getAvailableModelCeilings,
  resolveModelContextWindow,
  type ContextPressureState,
  type ModelCeilingInfo,
} from "../models/modelCeilings";

export interface ActiveSubagentTelemetry {
  conversationId: string;
  agentName: string;
  usedTokens: number;
  status: string;
}

export interface ActiveChatTelemetrySnapshot {
  conversationId: string;
  title: string;
  workspaceUris: string[];
  status: "running" | "idle" | "interrupted";
  isCompacting: boolean;
  lastModifiedTime: string;
  model: ModelCeilingInfo;
  tokens: {
    usedTokens: number;
    cachedTokens: number;
    freshInputTokens: number;
    completionTokens: number;
    thinkingTokens: number;
    outputTokens: number;
    ratioPct: number;
    pressureState: ContextPressureState;
    isEstimated: boolean;
  };
  activeSubagents: ActiveSubagentTelemetry[];
}

export interface CompactionEvent {
  conversationId: string;
  tokenDelta: number;
  previousTokens: number;
  currentTokens: number;
  timestamp: number;
}

export interface ConcurrentChatSummary {
  conversationId: string;
  title: string;
  usedTokens: number;
  maxTokens: number;
  ratioPct: number;
  pressureState: ContextPressureState;
  isCompacting?: boolean;
  model?: ModelCeilingInfo;
  status?: "running" | "idle" | "interrupted";
  workspaceUris?: string[];
  lastModifiedTime?: string;
  tokens?: {
    usedTokens: number;
    cachedTokens: number;
    freshInputTokens: number;
    completionTokens: number;
    thinkingTokens: number;
    outputTokens: number;
    ratioPct: number;
    pressureState: ContextPressureState;
    isEstimated: boolean;
  };
  activeSubagents?: ActiveSubagentTelemetry[];
  snapshot?: ActiveChatTelemetrySnapshot;
}

export interface ContextTelemetryResponse {
  runtimeState: "antigravity_not_detected" | "idle_no_active_chat" | "active";
  hasActiveChat: boolean;
  pollingIntervalMs: number; // 3000 if running, 15000 if idle
  primaryChat: ActiveChatTelemetrySnapshot | null;
  concurrentChats: ConcurrentChatSummary[];
  recentCompactionEvent: CompactionEvent | null;
  availableModels: ModelCeilingInfo[];
  isStale?: boolean;
}

interface CachedConversationTelemetry {
  mtimeMs: number;
  metrics: ParsedTokenMetrics;
  modelIdentifier?: string;
  timestamp: number;
}

export interface DatabaseAccessor {
  open(dbPath: string, options: { readonly: boolean; timeout: number }): Database.Database;
  stat(filePath: string): { mtimeMs: number } | null;
}

export class DefaultDatabaseAccessor implements DatabaseAccessor {
  public open(dbPath: string, options: { readonly: boolean; timeout: number }): Database.Database {
    const DatabaseConstructor =
      typeof Database === "function" ? Database : (Database as any)?.default;
    const db = new DatabaseConstructor(dbPath, {
      readonly: options.readonly,
      fileMustExist: true,
      timeout: options.timeout,
    });
    try {
      db.pragma("query_only = ON");
      db.pragma(`busy_timeout = ${options.timeout}`);
    } catch {
      // Ignore pragma failures on mock or in-memory
    }
    return db;
  }

  public stat(filePath: string): { mtimeMs: number } | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.statSync(filePath);
    } catch {
      return null;
    }
  }
}

export class ContextTelemetryService {
  private readonly dbAccessor: DatabaseAccessor;
  private readonly tokenCache = new Map<string, CachedConversationTelemetry>();
  private readonly lastKnownTokens = new Map<string, number>();
  private readonly recentCompactionEvents = new Map<string, CompactionEvent>();

  constructor(accessor?: DatabaseAccessor) {
    this.dbAccessor = accessor ?? new DefaultDatabaseAccessor();
  }

  /**
   * Resets in-memory state (useful for tests).
   */
  public resetCache(): void {
    this.tokenCache.clear();
    this.lastKnownTokens.clear();
    this.recentCompactionEvents.clear();
  }

  /**
   * Extracts token metrics from a single conversation database using stat caching.
   */
  public getTokensForConversation(
    dbPath: string,
    cascadeId: string,
  ): { metrics: ParsedTokenMetrics; modelIdentifier?: string; isStale: boolean } {
    const cached = this.tokenCache.get(cascadeId);
    const stat = this.dbAccessor.stat(dbPath);
    if (!stat) {
      if (cached) {
        return {
          metrics: cached.metrics,
          modelIdentifier: cached.modelIdentifier,
          isStale: true,
        };
      }
      return {
        metrics: {
          usedTokens: 0,
          cachedTokens: 0,
          freshInputTokens: 0,
          completionTokens: 0,
          thinkingTokens: 0,
          outputTokens: 0,
          isEstimated: false,
        },
        isStale: false,
      };
    }

    let effectiveMtimeMs = stat.mtimeMs;
    const walStat = this.dbAccessor.stat(`${dbPath}-wal`);
    if (walStat) {
      effectiveMtimeMs = Math.max(effectiveMtimeMs, walStat.mtimeMs);
    }

    if (cached && effectiveMtimeMs > 0 && cached.mtimeMs === effectiveMtimeMs) {
      return {
        metrics: cached.metrics,
        modelIdentifier: cached.modelIdentifier,
        isStale: false,
      };
    }

    let db: Database.Database | null = null;
    try {
      db = this.dbAccessor.open(dbPath, { readonly: true, timeout: 1500 });
      let metrics: ParsedTokenMetrics = {
        usedTokens: 0,
        cachedTokens: 0,
        freshInputTokens: 0,
        completionTokens: 0,
        thinkingTokens: 0,
        outputTokens: 0,
        isEstimated: false,
      };
      let modelIdentifier: string | undefined;

      const hasGenMeta = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='gen_metadata'",
        )
        .get();

      if (hasGenMeta) {
        const stmt = db.prepare(
          "SELECT data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx DESC LIMIT 5",
        );
        let rows: Array<{ data: Buffer | Uint8Array | null }> = [];
        if (typeof stmt?.all === "function") {
          rows = stmt.all() as any;
        } else if (typeof stmt?.get === "function") {
          const single = stmt.get() as any;
          if (single) rows = [single];
        }

        for (let i = 0; i < rows.length; i++) {
          const candidateData = rows[i]?.data;
          if (!candidateData) continue;
          const candidateMetrics = parseGenMetadataProtobuf(candidateData);
          const candidateModel =
            candidateMetrics.modelNameRaw ?? candidateMetrics.modelEnumRaw;

          if (i === 0) {
            metrics = candidateMetrics;
            modelIdentifier = candidateModel;
          }

          if (candidateMetrics.usedTokens > 0) {
            metrics = candidateMetrics;
            if (candidateModel) modelIdentifier = candidateModel;
            if (i > 0) {
              metrics.isEstimated = true;
            }
            break;
          }
        }
      }

      // Step-level metadata fallback: if usedTokens is still 0, check steps table
      if (metrics.usedTokens === 0) {
        const hasSteps = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='steps'",
          )
          .get();

        if (hasSteps) {
          const stepStmt = db.prepare(
            "SELECT metadata FROM steps WHERE step_type = 15 AND metadata IS NOT NULL ORDER BY idx DESC LIMIT 5",
          );
          let stepRows: Array<{ metadata: Buffer | Uint8Array | null }> = [];
          if (typeof stepStmt?.all === "function") {
            stepRows = stepStmt.all() as any;
          } else if (typeof stepStmt?.get === "function") {
            const single = stepStmt.get() as any;
            if (single) stepRows = [single];
          }

          for (const stepRow of stepRows) {
            if (!stepRow?.metadata) continue;
            const stepMetrics = parseStepMetadataProtobuf(stepRow.metadata);
            if (stepMetrics && stepMetrics.usedTokens > 0) {
              metrics = stepMetrics;
              if (stepMetrics.modelNameRaw || stepMetrics.modelEnumRaw) {
                modelIdentifier =
                  stepMetrics.modelNameRaw ?? stepMetrics.modelEnumRaw;
              }
              break;
            }
          }
        }
      }

      this.tokenCache.set(cascadeId, {
        mtimeMs: effectiveMtimeMs,
        metrics,
        modelIdentifier,
        timestamp: Date.now(),
      });

      return { metrics, modelIdentifier, isStale: false };
    } catch (err) {
      logger.warn(`Failed to read tokens from conversation DB ${dbPath}`, err);
      if (cached) {
        return {
          metrics: cached.metrics,
          modelIdentifier: cached.modelIdentifier,
          isStale: true,
        };
      }
      return {
        metrics: {
          usedTokens: 0,
          cachedTokens: 0,
          freshInputTokens: 0,
          completionTokens: 0,
          thinkingTokens: 0,
          outputTokens: 0,
          isEstimated: true,
        },
        isStale: true,
      };
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

  /**
   * Evaluates anti-flapping compaction delta.
   * Compaction is declared ONLY when:
   * current > 0 && prev > 0 && delta <= -5,000 && conversationId === previousConversationId.
   */
  public evaluateCompaction(
    conversationId: string,
    currentTokens: number,
  ): CompactionEvent | null {
    if (currentTokens <= 0) {
      // Clear recent compaction event so stale badges never display on 0-token cards
      this.recentCompactionEvents.delete(conversationId);
      return null;
    }

    const previousTokens = this.lastKnownTokens.get(conversationId);
    this.lastKnownTokens.set(conversationId, currentTokens);

    if (previousTokens !== undefined && previousTokens > 0) {
      const delta = currentTokens - previousTokens;
      if (delta <= -5000 && currentTokens > 0) {
        const event: CompactionEvent = {
          conversationId,
          tokenDelta: delta,
          previousTokens,
          currentTokens,
          timestamp: Date.now(),
        };
        this.recentCompactionEvents.set(conversationId, event);
        return event;
      }
    }

    return this.recentCompactionEvents.get(conversationId) ?? null;
  }

  /**
   * Main query method backing oRPC IPC route.
   */
  public async getActiveChatTelemetry(
    target: AntigravityAppTarget = "app",
  ): Promise<ContextTelemetryResponse> {
    const availableModels = getAvailableModelCeilings();
    const summariesDbPath = getAntigravityConversationSummariesDbPath(target);

    if (!summariesDbPath || !fs.existsSync(summariesDbPath)) {
      return {
        runtimeState: "antigravity_not_detected",
        hasActiveChat: false,
        pollingIntervalMs: 15000,
        primaryChat: null,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels,
      };
    }

    let summariesDb: Database.Database | null = null;
    try {
      summariesDb = this.dbAccessor.open(summariesDbPath, {
        readonly: true,
        timeout: 1500,
      });

      const hasTable = summariesDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
        )
        .get();

      if (!hasTable) {
        return {
          runtimeState: "idle_no_active_chat",
          hasActiveChat: false,
          pollingIntervalMs: 15000,
          primaryChat: null,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels,
        };
      }

      const rows = summariesDb
        .prepare(
          `SELECT conversation_id, title, status, not_fully_idle, killed, nesting_depth, parent_conversation_id, workspace_uris, last_modified_time
           FROM conversation_summaries
           WHERE (not_fully_idle = 1 OR status = 'CASCADE_RUN_STATUS_RUNNING')
             AND killed = 0
           ORDER BY last_modified_time DESC`,
        )
        .all() as Array<Record<string, unknown>>;

      if (rows.length === 0) {
        return {
          runtimeState: "idle_no_active_chat",
          hasActiveChat: false,
          pollingIntervalMs: 15000,
          primaryChat: null,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels,
        };
      }

      const rootRows: Array<Record<string, unknown>> = [];
      const childRows: Array<Record<string, unknown>> = [];

      for (const row of rows) {
        const depth = Number(row.nesting_depth ?? 0);
        const parentId = row.parent_conversation_id
          ? String(row.parent_conversation_id).trim()
          : "";

        if (depth === 0 || !parentId) {
          rootRows.push(row);
        } else {
          childRows.push(row);
        }
      }

      // If no root rows found directly, try resolving parent from active child
      if (rootRows.length === 0 && childRows.length > 0) {
        const parentCandidateId = String(childRows[0].parent_conversation_id);
        const parentRow = summariesDb
          .prepare(
            `SELECT conversation_id, title, status, not_fully_idle, killed, nesting_depth, parent_conversation_id, workspace_uris, last_modified_time
             FROM conversation_summaries
             WHERE conversation_id = ? AND killed = 0`,
          )
          .get(parentCandidateId) as Record<string, unknown> | undefined;

        if (parentRow) {
          rootRows.push(parentRow);
        }
      }

      if (rootRows.length === 0) {
        return {
          runtimeState: "idle_no_active_chat",
          hasActiveChat: false,
          pollingIntervalMs: 15000,
          primaryChat: null,
          concurrentChats: [],
          recentCompactionEvent: null,
          availableModels,
        };
      }

      const convsDir = getAntigravityConversationsDir(target);
      const primaryRow = rootRows[0];
      const primaryCascadeId = String(primaryRow.conversation_id);
      const primaryDbPath = path.join(convsDir, `${primaryCascadeId}.db`);

      const { metrics, modelIdentifier, isStale } = this.getTokensForConversation(
        primaryDbPath,
        primaryCascadeId,
      );

      const modelCeiling = resolveModelContextWindow(modelIdentifier);
      if (metrics.maxContextTokens && metrics.maxContextTokens > 0) {
        modelCeiling.maxTokens = metrics.maxContextTokens;
        modelCeiling.isAuthoritative = true;
      }
      const usedTokens = metrics.usedTokens;
      const ratioPct =
        modelCeiling.maxTokens > 0
          ? Number(((usedTokens / modelCeiling.maxTokens) * 100).toFixed(1))
          : 0;
      const pressureState = calculatePressureState(ratioPct);

      const compactionEvent = this.evaluateCompaction(
        primaryCascadeId,
        usedTokens,
      );

      // Resolve child subagents for primary chat
      const activeSubagents: ActiveSubagentTelemetry[] = [];
      for (const child of childRows) {
        if (String(child.parent_conversation_id) === primaryCascadeId) {
          const childId = String(child.conversation_id);
          const childDbPath = path.join(convsDir, `${childId}.db`);
          const childTokens = this.getTokensForConversation(childDbPath, childId);
          activeSubagents.push({
            conversationId: childId,
            agentName: String(child.title || "Subagent"),
            usedTokens: childTokens.metrics.usedTokens,
            status: String(child.status || "RUNNING"),
          });
        }
      }

      // Format workspace URIs with PII masking
      const rawUris = String(primaryRow.workspace_uris ?? "");
      let workspaceUris: string[] = [];
      try {
        const parsed = JSON.parse(rawUris);
        if (Array.isArray(parsed)) {
          workspaceUris = parsed.map((u) => maskUserPath(String(u)) ?? String(u));
        }
      } catch {
        if (rawUris.trim().length > 0) {
          workspaceUris = [maskUserPath(rawUris) ?? rawUris];
        }
      }

      const isRunning =
        primaryRow.status === "CASCADE_RUN_STATUS_RUNNING" ||
        Boolean(primaryRow.not_fully_idle);

      const primaryStatusRaw = String(primaryRow.status ?? "");
      const primaryStatusLower = primaryStatusRaw.toLowerCase();
      const isPrimaryCompacting =
        primaryStatusLower.includes("compact") ||
        primaryStatusRaw === "CASCADE_RUN_STATUS_COMPACTING";

      const primaryChat: ActiveChatTelemetrySnapshot = {
        conversationId: primaryCascadeId,
        title: String(primaryRow.title || "Untitled Active Cascade"),
        workspaceUris,
        status: isRunning ? "running" : "idle",
        isCompacting: isPrimaryCompacting,
        lastModifiedTime: String(primaryRow.last_modified_time || ""),
        model: modelCeiling,
        tokens: {
          usedTokens,
          cachedTokens: metrics.cachedTokens,
          freshInputTokens: metrics.freshInputTokens,
          completionTokens: metrics.completionTokens,
          thinkingTokens: metrics.thinkingTokens,
          outputTokens: metrics.outputTokens,
          ratioPct,
          pressureState,
          isEstimated: metrics.isEstimated,
        },
        activeSubagents,
      };

      // Concurrent chats
      const concurrentChats: ConcurrentChatSummary[] = [];
      for (let i = 1; i < rootRows.length; i++) {
        const cRow = rootRows[i];
        const cId = String(cRow.conversation_id);
        const cDbPath = path.join(convsDir, `${cId}.db`);
        const cTokens = this.getTokensForConversation(cDbPath, cId);
        const cCeiling = resolveModelContextWindow(cTokens.modelIdentifier);
        if (cTokens.metrics.maxContextTokens && cTokens.metrics.maxContextTokens > 0) {
          cCeiling.maxTokens = cTokens.metrics.maxContextTokens;
          cCeiling.isAuthoritative = true;
        }
        const cUsed = cTokens.metrics.usedTokens;
        const cRatio =
          cCeiling.maxTokens > 0
            ? Number(((cUsed / cCeiling.maxTokens) * 100).toFixed(1))
            : 0;
        const cPressure = calculatePressureState(cRatio);

        const cIsRunning =
          cRow.status === "CASCADE_RUN_STATUS_RUNNING" ||
          Boolean(cRow.not_fully_idle);

        const cStatusRaw = String(cRow.status ?? "");
        const cStatusLower = cStatusRaw.toLowerCase();
        const cIsCompacting =
          cStatusLower.includes("compact") ||
          cStatusRaw === "CASCADE_RUN_STATUS_COMPACTING";

        const cRawUris = String(cRow.workspace_uris ?? "");
        let cWorkspaceUris: string[] = [];
        try {
          const parsed = JSON.parse(cRawUris);
          if (Array.isArray(parsed)) {
            cWorkspaceUris = parsed.map((u) => maskUserPath(String(u)) ?? String(u));
          }
        } catch {
          if (cRawUris.trim().length > 0) {
            cWorkspaceUris = [maskUserPath(cRawUris) ?? cRawUris];
          }
        }

        const cSubagents: ActiveSubagentTelemetry[] = [];
        for (const child of childRows) {
          if (String(child.parent_conversation_id) === cId) {
            const childId = String(child.conversation_id);
            const childDbPath = path.join(convsDir, `${childId}.db`);
            const childTokens = this.getTokensForConversation(childDbPath, childId);
            cSubagents.push({
              conversationId: childId,
              agentName: String(child.title || "Subagent"),
              usedTokens: childTokens.metrics.usedTokens,
              status: String(child.status || "RUNNING"),
            });
          }
        }

        const cTokensBreakdown = {
          usedTokens: cUsed,
          cachedTokens: cTokens.metrics.cachedTokens,
          freshInputTokens: cTokens.metrics.freshInputTokens,
          completionTokens: cTokens.metrics.completionTokens,
          thinkingTokens: cTokens.metrics.thinkingTokens,
          outputTokens: cTokens.metrics.outputTokens,
          ratioPct: cRatio,
          pressureState: cPressure,
          isEstimated: cTokens.metrics.isEstimated,
        };

        const cSnapshot: ActiveChatTelemetrySnapshot = {
          conversationId: cId,
          title: String(cRow.title || "Untitled Chat"),
          workspaceUris: cWorkspaceUris,
          status: cIsRunning ? "running" : "idle",
          isCompacting: cIsCompacting,
          lastModifiedTime: String(cRow.last_modified_time || ""),
          model: cCeiling,
          tokens: cTokensBreakdown,
          activeSubagents: cSubagents,
        };

        concurrentChats.push({
          conversationId: cId,
          title: String(cRow.title || "Untitled Chat"),
          usedTokens: cUsed,
          maxTokens: cCeiling.maxTokens,
          ratioPct: cRatio,
          pressureState: cPressure,
          isCompacting: cIsCompacting,
          model: cCeiling,
          status: cIsRunning ? "running" : "idle",
          workspaceUris: cWorkspaceUris,
          lastModifiedTime: String(cRow.last_modified_time || ""),
          tokens: cTokensBreakdown,
          activeSubagents: cSubagents,
          snapshot: cSnapshot,
        });
      }

      return {
        runtimeState: "active",
        hasActiveChat: true,
        pollingIntervalMs: isRunning ? 3000 : 15000,
        primaryChat,
        concurrentChats,
        recentCompactionEvent: compactionEvent,
        availableModels,
        isStale,
      };
    } catch (err) {
      logger.error("Failed to query active chat context telemetry", err);
      return {
        runtimeState: "idle_no_active_chat",
        hasActiveChat: false,
        pollingIntervalMs: 15000,
        primaryChat: null,
        concurrentChats: [],
        recentCompactionEvent: null,
        availableModels,
        isStale: true,
      };
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
}

export const contextTelemetryService = new ContextTelemetryService();
