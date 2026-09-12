import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";

export type ChatResumptionStatus = "resumed" | "failed";

export type ChatResumeSwitchSource =
  "auto_switch" | "manual_switch" | "tray" | "resync" | "manual" | "unknown";

export interface InFlightPromptPayload {
  prompt: string;
  requestedModel?: string;
  cascadeConfig?: Record<string, unknown>;
  contextReferences?: unknown[];
  [key: string]: unknown;
}

export interface InFlightChatSnapshot {
  resumptionId: string;
  appTarget: AntigravityAppTarget;
  sessionId?: string;
  cascadeId: string;
  promptPayload: InFlightPromptPayload;
  capturedAt: number;
  expiresAt: number;
  source?: ChatResumeSwitchSource;
  accountEmail?: string;
  status: "pending" | "in_flight" | "resumed" | "failed" | "expired";
  isInterrupted?: boolean;
}

export interface ChatDraftScratch {
  resumptionId: string;
  prompt: string;
  appTarget: AntigravityAppTarget;
  savedAt: number;
  reason: string;
  accountEmail?: string;
}

export interface ChatResumptionStatusPayload {
  status: ChatResumptionStatus;
  resumptionId?: string;
  target?: AntigravityAppTarget;
  accountEmail?: string;
  reason?: string;
  draftPrompt?: string;
  fallbackModel?: string;
  resumptionLatencyMs?: number;
}

export interface ActiveTurnSnapshot {
  cascadeId: string;
  sessionId?: string;
  promptPayload: InFlightPromptPayload;
  conversationDbPath?: string;
  isInterrupted?: boolean;
}
