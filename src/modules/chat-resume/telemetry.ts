import { EventEmitter } from "node:events";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { logger } from "@/shared/logging/logger";
import type {
  ChatResumeSwitchSource,
  ChatResumptionStatusPayload,
} from "./types";

export interface SnapshotCapturedTelemetry {
  event: "chat_session_snapshot_captured";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  source: ChatResumeSwitchSource;
  hasActivePrompt: true;
  occurredAt: number;
}

export interface SessionAutoResumedTelemetry {
  event: "chat_session_auto_resumed";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  resumptionLatencyMs: number;
  status: "success" | "model_fallback";
  occurredAt: number;
}

export interface SessionResumeFailedTelemetry {
  event: "chat_session_resume_failed";
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  reason: string;
  durationMs: number;
  occurredAt: number;
}

export type ChatResumeTelemetry =
  | SnapshotCapturedTelemetry
  | SessionAutoResumedTelemetry
  | SessionResumeFailedTelemetry;

class ChatResumeEventEmitter extends EventEmitter {
  private readonly telemetryHistory: ChatResumeTelemetry[] = [];
  private readonly maxHistorySize = 100;

  public recordSnapshotCaptured(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    source?: ChatResumeSwitchSource;
  }): SnapshotCapturedTelemetry {
    const payload: SnapshotCapturedTelemetry = {
      event: "chat_session_snapshot_captured",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      source: params.source ?? "unknown",
      hasActivePrompt: true,
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.info("[chat-resume-telemetry] Snapshot captured", payload);
    this.emit("telemetry:snapshot-captured", payload);
    return payload;
  }

  public recordSessionAutoResumed(params: {
    resumptionId: string;
    appTarget: AntigravityAppTarget;
    resumptionLatencyMs: number;
    status?: "success" | "model_fallback";
  }): SessionAutoResumedTelemetry {
    const payload: SessionAutoResumedTelemetry = {
      event: "chat_session_auto_resumed",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      resumptionLatencyMs: Math.max(0, Math.round(params.resumptionLatencyMs)),
      status: params.status ?? "success",
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
  }): SessionResumeFailedTelemetry {
    const payload: SessionResumeFailedTelemetry = {
      event: "chat_session_resume_failed",
      resumptionId: params.resumptionId,
      appTarget: params.appTarget,
      reason: params.reason,
      durationMs: Math.max(0, Math.round(params.durationMs)),
      occurredAt: Date.now(),
    };

    this.pushTelemetry(payload);
    logger.warn("[chat-resume-telemetry] Session resume failed", payload);
    this.emit("telemetry:resume-failed", payload);
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
