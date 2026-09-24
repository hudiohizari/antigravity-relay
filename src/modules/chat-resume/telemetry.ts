import { EventEmitter } from "node:events";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { logger } from "@/shared/logging/logger";
import type {
  ChatResumeSwitchSource,
  ChatResumptionStatusPayload,
} from "./types";

export interface ActiveTurnDetectedTelemetry {
  event: "chat_active_turn_detected";
  appTarget: AntigravityAppTarget;
  conversationId: string;
  cascadeId?: string;
  stepIndex?: number;
  modelEnum?: string;
  modelName?: string;
  reason?: string;
  hasSubagents?: boolean;
  isInterrupted?: boolean;
  status: 2;
  occurredAt: number;
}

export interface SubagentParentResolvedTelemetry {
  event: "chat_subagent_parent_resolved";
  subagentCascadeId: string;
  parentCascadeId: string;
  stepIndex?: number;
  occurredAt: number;
}

export interface QuotaExhaustionDetectedTelemetry {
  event: "chat_quota_exhaustion_detected";
  cascadeId: string;
  matchedField: string;
  pattern: string;
  occurredAt: number;
}

export interface ModelResolvedTelemetry {
  event: "chat_model_resolved";
  appTarget: AntigravityAppTarget;
  resolvedEnum?: string;
  modelName?: string;
  inheritedNative: boolean;
  occurredAt: number;
}

export interface SnapshotCapturedTelemetry {
  event: "chat_session_snapshot_captured";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  source: ChatResumeSwitchSource;
  model?: string;
  promptLength?: number;
  hasActivePrompt: true;
  occurredAt: number;
}

export interface WalCheckpointExecutedTelemetry {
  event: "chat_wal_checkpoint_executed";
  attempted: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  occurredAt: number;
}

export interface SessionAutoResumedTelemetry {
  event: "chat_session_auto_resumed";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  resumptionLatencyMs: number;
  status: "success";
  occurredAt: number;
}

export interface SessionResumeFailedTelemetry {
  event: "chat_session_resume_failed";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  reason: string;
  preservedInScratch: boolean;
  durationMs: number;
  occurredAt: number;
}

export interface ResumeSkippedCliTelemetry {
  event: "chat_resume_skipped_cli";
  target: "cli";
  occurredAt: number;
}

export interface TurnDrainingInitiatedTelemetry {
  event: "chat_turn_draining_initiated";
  appTarget: AntigravityAppTarget;
  activeModel: string;
  currentQuota: number;
  timeoutMs: number;
  occurredAt: number;
}

export interface TurnDrainedTelemetry {
  event: "chat_turn_drained";
  appTarget: AntigravityAppTarget;
  drainDurationMs: number;
  completedStatus: 3;
  occurredAt: number;
}

export interface AccountDepletedModelScopedTelemetry {
  event: "account_depleted_model_scoped";
  accountId: string;
  activeModel: string;
  quotaPercentage: number;
  isDepleted: boolean;
  occurredAt: number;
}

export interface PortDiscoveryStaleRejectedTelemetry {
  event: "chat_port_discovery_stale_rejected";
  appTarget?: AntigravityAppTarget;
  stalePort: number;
  discoveredPort: number;
  elapsedMs?: number;
  reason?: string;
  occurredAt: number;
}

export interface ResumptionTransientRetryTelemetry {
  event: "chat_resumption_transient_retry";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  error: string;
  retryCount: number;
  status: "pending";
  occurredAt: number;
}

export interface HandshakePortSwitchedTelemetry {
  event: "chat_handshake_port_switched";
  appTarget: AntigravityAppTarget;
  oldPort: number;
  newPort: number;
  handshakeElapsedMs: number;
  occurredAt: number;
}

export interface PortDiscoveryLifecycleTelemetry {
  event: "chat_port_discovery_lifecycle_event";
  source: "app_lifecycle" | "relay_server";
  active: boolean;
  occurredAt: number;
}

export type ChatResumeTelemetry =
  | ActiveTurnDetectedTelemetry
  | SubagentParentResolvedTelemetry
  | QuotaExhaustionDetectedTelemetry
  | ModelResolvedTelemetry
  | SnapshotCapturedTelemetry
  | WalCheckpointExecutedTelemetry
  | SessionAutoResumedTelemetry
  | SessionResumeFailedTelemetry
  | ResumeSkippedCliTelemetry
  | TurnDrainingInitiatedTelemetry
  | TurnDrainedTelemetry
  | AccountDepletedModelScopedTelemetry
  | PortDiscoveryStaleRejectedTelemetry
  | ResumptionTransientRetryTelemetry
  | HandshakePortSwitchedTelemetry
  | PortDiscoveryLifecycleTelemetry;

class ChatResumeEventEmitter extends EventEmitter {
  private readonly telemetryHistory: ChatResumeTelemetry[] = [];
  private readonly maxHistorySize = 100;

  public recordActiveTurnDetected(params: {
    appTarget: AntigravityAppTarget;
    conversationId: string;
    cascadeId?: string;
    stepIndex?: number;
    modelEnum?: string;
    modelName?: string;
    reason?: string;
    hasSubagents?: boolean;
    isInterrupted?: boolean;
  }): ActiveTurnDetectedTelemetry {
    const payload: ActiveTurnDetectedTelemetry = {
      event: "chat_active_turn_detected",
      appTarget: params.appTarget,
      conversationId: params.conversationId,
      cascadeId: params.cascadeId ?? params.conversationId,
      stepIndex: params.stepIndex,
      modelEnum: params.modelEnum,
      modelName: params.modelName,
      reason: params.reason,
      hasSubagents: params.hasSubagents,
      isInterrupted: params.isInterrupted,
      status: 2,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Active turn detected", payload);
    this.emit("telemetry:active-turn-detected", payload);
    return payload;
  }

  public recordSubagentParentResolved(params: {
    subagentCascadeId: string;
    parentCascadeId: string;
    stepIndex?: number;
  }): SubagentParentResolvedTelemetry {
    const payload: SubagentParentResolvedTelemetry = {
      event: "chat_subagent_parent_resolved",
      subagentCascadeId: params.subagentCascadeId,
      parentCascadeId: params.parentCascadeId,
      stepIndex: params.stepIndex,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Subagent parent resolved", payload);
    this.emit("telemetry:subagent-parent-resolved", payload);
    return payload;
  }

  public recordQuotaExhaustionDetected(params: {
    cascadeId: string;
    matchedField: string;
    pattern: string;
  }): QuotaExhaustionDetectedTelemetry {
    const payload: QuotaExhaustionDetectedTelemetry = {
      event: "chat_quota_exhaustion_detected",
      cascadeId: params.cascadeId,
      matchedField: params.matchedField,
      pattern: params.pattern,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Quota exhaustion detected", payload);
    this.emit("telemetry:quota-exhaustion-detected", payload);
    return payload;
  }

  public recordModelResolved(params: {
    appTarget: AntigravityAppTarget;
    resolvedEnum?: string;
    modelName?: string;
    inheritedNative: boolean;
  }): ModelResolvedTelemetry {
    const payload: ModelResolvedTelemetry = {
      event: "chat_model_resolved",
      appTarget: params.appTarget,
      resolvedEnum: params.resolvedEnum,
      modelName: params.modelName,
      inheritedNative: params.inheritedNative,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Model resolved", payload);
    this.emit("telemetry:model-resolved", payload);
    return payload;
  }

  public recordSnapshotCaptured(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    source?: ChatResumeSwitchSource;
    model?: string;
    promptLength?: number;
  }): SnapshotCapturedTelemetry {
    const payload: SnapshotCapturedTelemetry = {
      event: "chat_session_snapshot_captured",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      source: params.source ?? "unknown",
      model: params.model,
      promptLength: params.promptLength,
      hasActivePrompt: true,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Snapshot captured", payload);
    this.emit("telemetry:snapshot-captured", payload);
    return payload;
  }

  public recordWalCheckpointExecuted(params: {
    attempted: number;
    succeeded: number;
    failed: number;
    durationMs: number;
  }): WalCheckpointExecutedTelemetry {
    const payload: WalCheckpointExecutedTelemetry = {
      event: "chat_wal_checkpoint_executed",
      attempted: params.attempted,
      succeeded: params.succeeded,
      failed: params.failed,
      durationMs: Math.max(0, Math.round(params.durationMs)),
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] WAL checkpoint executed", payload);
    this.emit("telemetry:wal-checkpoint-executed", payload);
    return payload;
  }

  public recordSessionAutoResumed(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    resumptionLatencyMs: number;
    status?: "success";
  }): SessionAutoResumedTelemetry {
    const payload: SessionAutoResumedTelemetry = {
      event: "chat_session_auto_resumed",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      resumptionLatencyMs: Math.max(0, Math.round(params.resumptionLatencyMs)),
      status: "success",
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Session auto-resumed", payload);
    this.emit("telemetry:auto-resumed", payload);
    return payload;
  }

  public recordSessionResumeFailed(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    reason: string;
    durationMs: number;
    preservedInScratch?: boolean;
  }): SessionResumeFailedTelemetry {
    const payload: SessionResumeFailedTelemetry = {
      event: "chat_session_resume_failed",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      reason: params.reason,
      preservedInScratch: params.preservedInScratch ?? true,
      durationMs: Math.max(0, Math.round(params.durationMs)),
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.warn("[chat-resume-telemetry] Session resume failed", payload);
    this.emit("telemetry:resume-failed", payload);
    return payload;
  }

  public recordSkippedCli(): ResumeSkippedCliTelemetry {
    const payload: ResumeSkippedCliTelemetry = {
      event: "chat_resume_skipped_cli",
      target: "cli",
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Resume skipped for CLI", payload);
    this.emit("telemetry:skipped-cli", payload);
    return payload;
  }

  public recordTurnDrainingInitiated(params: {
    appTarget: AntigravityAppTarget;
    activeModel: string;
    currentQuota: number;
    timeoutMs?: number;
  }): TurnDrainingInitiatedTelemetry {
    const payload: TurnDrainingInitiatedTelemetry = {
      event: "chat_turn_draining_initiated",
      appTarget: params.appTarget,
      activeModel: params.activeModel,
      currentQuota: params.currentQuota,
      timeoutMs: params.timeoutMs ?? 60000,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Turn draining initiated", payload);
    this.emit("telemetry:turn-draining-initiated", payload);
    return payload;
  }

  public recordTurnDrained(params: {
    appTarget: AntigravityAppTarget;
    drainDurationMs: number;
    completedStatus?: 3;
  }): TurnDrainedTelemetry {
    const payload: TurnDrainedTelemetry = {
      event: "chat_turn_drained",
      appTarget: params.appTarget,
      drainDurationMs: Math.max(0, Math.round(params.drainDurationMs)),
      completedStatus: 3,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Turn drained cleanly", payload);
    this.emit("telemetry:turn-drained", payload);
    return payload;
  }

  public recordAccountDepletedModelScoped(params: {
    accountId: string;
    activeModel: string;
    quotaPercentage: number;
    isDepleted: boolean;
  }): AccountDepletedModelScopedTelemetry {
    const payload: AccountDepletedModelScopedTelemetry = {
      event: "account_depleted_model_scoped",
      accountId: params.accountId,
      activeModel: params.activeModel,
      quotaPercentage: params.quotaPercentage,
      isDepleted: params.isDepleted,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info(
      "[chat-resume-telemetry] Account depletion evaluated with model scope",
      payload,
    );
    this.emit("telemetry:account-depleted-model-scoped", payload);
    return payload;
  }

  public recordPortDiscoveryStaleRejected(params: {
    appTarget?: AntigravityAppTarget;
    stalePort: number;
    discoveredPort: number;
    elapsedMs?: number;
    reason?: string;
  }): PortDiscoveryStaleRejectedTelemetry {
    const payload: PortDiscoveryStaleRejectedTelemetry = {
      event: "chat_port_discovery_stale_rejected",
      appTarget: params.appTarget,
      stalePort: params.stalePort,
      discoveredPort: params.discoveredPort,
      elapsedMs:
        params.elapsedMs !== undefined
          ? Math.max(0, Math.round(params.elapsedMs))
          : undefined,
      reason: params.reason,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Stale port rejected", payload);
    this.emit("telemetry:stale-port-rejected", payload);
    return payload;
  }

  public recordResumptionTransientRetry(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    error: string;
    retryCount: number;
    status?: "pending";
  }): ResumptionTransientRetryTelemetry {
    const payload: ResumptionTransientRetryTelemetry = {
      event: "chat_resumption_transient_retry",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      error: params.error,
      retryCount: params.retryCount,
      status: "pending",
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Resumption transient retry", payload);
    this.emit("telemetry:transient-retry", payload);
    return payload;
  }

  public recordHandshakePortSwitched(params: {
    appTarget: AntigravityAppTarget;
    oldPort: number;
    newPort: number;
    handshakeElapsedMs: number;
  }): HandshakePortSwitchedTelemetry {
    const payload: HandshakePortSwitchedTelemetry = {
      event: "chat_handshake_port_switched",
      appTarget: params.appTarget,
      oldPort: params.oldPort,
      newPort: params.newPort,
      handshakeElapsedMs: Math.max(0, Math.round(params.handshakeElapsedMs)),
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Handshake port switched", payload);
    this.emit("telemetry:handshake-port-switched", payload);
    return payload;
  }

  public recordPortDiscoveryLifecycle(params: {
    source: "app_lifecycle" | "relay_server";
    active: boolean;
  }): PortDiscoveryLifecycleTelemetry {
    const payload: PortDiscoveryLifecycleTelemetry = {
      event: "chat_port_discovery_lifecycle_event",
      source: params.source,
      active: params.active,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info(
      "[chat-resume-telemetry] Port discovery lifecycle event",
      payload,
    );
    this.emit("telemetry:port-discovery-lifecycle", payload);
    return payload;
  }

  public emitResumptionStatus(payload: ChatResumptionStatusPayload): void {
    logger.info(
      `[chat-resume-ipc] Emitting resumption status: ${payload.status}`,
    );
    this.emit("resumption-status", payload);

    try {
      // Broadcast via Electron if running in main process
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require("electron");
      const BrowserWindow = electron?.BrowserWindow;
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send("chat-session:resumption-status", payload);
          }
        }
      }
    } catch {
      // In headless unit test environments, Electron may not be present
    }
  }

  public getTelemetryHistory(): ChatResumeTelemetry[] {
    return [...this.telemetryHistory];
  }

  public clearTelemetryHistory(): void {
    this.telemetryHistory.length = 0;
  }

  private pushTelemetry(item: ChatResumeTelemetry): void {
    this.telemetryHistory.push(item);
    if (this.telemetryHistory.length > this.maxHistorySize) {
      this.telemetryHistory.shift();
    }
  }
}

export const chatResumeEvents = new ChatResumeEventEmitter();
