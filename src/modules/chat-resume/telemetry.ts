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
  stepIndex?: number;
  status: 2;
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

export type ChatResumeTelemetry =
  | ActiveTurnDetectedTelemetry
  | SnapshotCapturedTelemetry
  | WalCheckpointExecutedTelemetry
  | SessionAutoResumedTelemetry
  | SessionResumeFailedTelemetry
  | ResumeSkippedCliTelemetry
  | TurnDrainingInitiatedTelemetry
  | TurnDrainedTelemetry
  | AccountDepletedModelScopedTelemetry;

class ChatResumeEventEmitter extends EventEmitter {
  private readonly telemetryHistory: ChatResumeTelemetry[] = [];
  private readonly maxHistorySize = 100;

  public recordActiveTurnDetected(params: {
    appTarget: AntigravityAppTarget;
    conversationId: string;
    stepIndex?: number;
  }): ActiveTurnDetectedTelemetry {
    const payload: ActiveTurnDetectedTelemetry = {
      event: "chat_active_turn_detected",
      appTarget: params.appTarget,
      conversationId: params.conversationId,
      stepIndex: params.stepIndex,
      status: 2,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Active turn detected", payload);
    this.emit("telemetry:active-turn-detected", payload);
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
