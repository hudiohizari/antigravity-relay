import crypto from "node:crypto";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import { logger } from "@/shared/logging/logger";
import type {
  ActiveTurnSnapshot,
  ChatDraftScratch,
  InFlightChatSnapshot,
  InFlightPromptPayload,
} from "./types";

export const DEFAULT_RESUMPTION_TTL_MS = 300_000; // 300 seconds
export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export class PayloadTooLargeError extends Error {
  constructor(size: number, limit: number) {
    super(
      `Payload size of ${size} bytes exceeds max allowable limit of ${limit} bytes`,
    );
    this.name = "PayloadTooLargeError";
  }
}

export class SessionContinuityBuffer {
  private readonly snapshots = new Map<string, InFlightChatSnapshot>();
  private readonly draftScratch = new Map<string, ChatDraftScratch>();
  private readonly activePrompts = new Map<
    AntigravityAppTarget,
    ActiveTurnSnapshot
  >();
  private readonly defaultTtlMs: number;
  private readonly maxPayloadBytes: number;

  constructor(options?: { defaultTtlMs?: number; maxPayloadBytes?: number }) {
    this.defaultTtlMs = options?.defaultTtlMs ?? DEFAULT_RESUMPTION_TTL_MS;
    this.maxPayloadBytes = options?.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
  }

  public store(
    params: Omit<
      InFlightChatSnapshot,
      "resumptionId" | "capturedAt" | "expiresAt" | "status"
    > &
      Partial<
        Pick<
          InFlightChatSnapshot,
          "resumptionId" | "capturedAt" | "expiresAt" | "status"
        >
      >,
  ): InFlightChatSnapshot {
    const payloadBytes = Buffer.byteLength(
      JSON.stringify(params.promptPayload ?? ""),
    );
    if (payloadBytes > this.maxPayloadBytes) {
      throw new PayloadTooLargeError(payloadBytes, this.maxPayloadBytes);
    }

    const resumptionId = params.resumptionId ?? crypto.randomUUID();
    const now = Date.now();
    const capturedAt = params.capturedAt ?? now;
    const expiresAt = params.expiresAt ?? capturedAt + this.defaultTtlMs;

    const snapshot: InFlightChatSnapshot = {
      ...params,
      resumptionId,
      capturedAt,
      expiresAt,
      status: params.status ?? "pending",
    };

    this.snapshots.set(resumptionId, snapshot);
    logger.info(
      `SessionContinuityBuffer: Stored snapshot ${resumptionId} for target ${snapshot.appTarget}`,
    );
    return snapshot;
  }

  public get(resumptionId: string): InFlightChatSnapshot | null {
    const snapshot = this.snapshots.get(resumptionId);
    if (!snapshot) {
      return null;
    }

    if (Date.now() > snapshot.expiresAt) {
      this.expireSnapshot(snapshot, "ttl_expired");
      return null;
    }

    return snapshot;
  }

  public peek(resumptionId: string): InFlightChatSnapshot | null {
    const snapshot = this.snapshots.get(resumptionId);
    if (!snapshot) {
      return null;
    }

    if (Date.now() > snapshot.expiresAt) {
      this.expireSnapshot(snapshot, "ttl_expired");
      return null;
    }

    return { ...snapshot };
  }

  public consume(resumptionId: string): InFlightChatSnapshot | null {
    const snapshot = this.snapshots.get(resumptionId);
    if (!snapshot) {
      return null;
    }

    this.snapshots.delete(resumptionId);

    if (Date.now() > snapshot.expiresAt) {
      this.expireSnapshot(snapshot, "ttl_expired");
      return null;
    }

    snapshot.status = "resumed";
    return snapshot;
  }

  public getLatestForTarget(
    appTarget: AntigravityAppTarget,
  ): InFlightChatSnapshot | null {
    let latest: InFlightChatSnapshot | null = null;
    const now = Date.now();

    for (const [id, snapshot] of this.snapshots.entries()) {
      if (snapshot.appTarget === appTarget) {
        if (now > snapshot.expiresAt) {
          this.expireSnapshot(snapshot, "ttl_expired");
          continue;
        }

        if (!latest || snapshot.capturedAt > latest.capturedAt) {
          latest = snapshot;
        }
      }
    }

    return latest;
  }

  public consumeLatestForTarget(
    appTarget: AntigravityAppTarget,
  ): InFlightChatSnapshot | null {
    const latest = this.getLatestForTarget(appTarget);
    if (!latest) {
      return null;
    }

    return this.consume(latest.resumptionId);
  }

  public has(resumptionId: string): boolean {
    const snapshot = this.snapshots.get(resumptionId);
    if (!snapshot) {
      return false;
    }

    if (Date.now() > snapshot.expiresAt) {
      this.expireSnapshot(snapshot, "ttl_expired");
      return false;
    }

    return true;
  }

  public pruneExpired(): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const [, snapshot] of this.snapshots.entries()) {
      if (now > snapshot.expiresAt) {
        this.expireSnapshot(snapshot, "ttl_expired");
        prunedCount += 1;
      }
    }

    return prunedCount;
  }

  public size(): number {
    this.pruneExpired();
    return this.snapshots.size;
  }

  public clear(): void {
    this.snapshots.clear();
  }

  public saveDraft(draft: Omit<ChatDraftScratch, "savedAt">): void {
    const savedAt = Date.now();
    this.draftScratch.set(draft.resumptionId, {
      ...draft,
      savedAt,
    });
    logger.info(
      `SessionContinuityBuffer: Saved draft scratch for ${draft.resumptionId}`,
    );
  }

  public getDraft(resumptionId: string): ChatDraftScratch | null {
    return this.draftScratch.get(resumptionId) ?? null;
  }

  public getLatestDraft(
    target?: AntigravityAppTarget,
  ): ChatDraftScratch | null {
    let latest: ChatDraftScratch | null = null;

    for (const draft of this.draftScratch.values()) {
      if (!target || draft.appTarget === target) {
        if (!latest || draft.savedAt > latest.savedAt) {
          latest = draft;
        }
      }
    }

    return latest;
  }

  public getAllDrafts(): ChatDraftScratch[] {
    return Array.from(this.draftScratch.values()).sort(
      (a, b) => b.savedAt - a.savedAt,
    );
  }

  public clearDrafts(): void {
    this.draftScratch.clear();
  }

  public registerActivePrompt(
    target: AntigravityAppTarget,
    turn: ActiveTurnSnapshot,
  ): void {
    this.activePrompts.set(target, turn);
  }

  public getActivePrompt(
    target: AntigravityAppTarget,
  ): ActiveTurnSnapshot | null {
    return this.activePrompts.get(target) ?? null;
  }

  public clearActivePrompt(target: AntigravityAppTarget): void {
    this.activePrompts.delete(target);
  }

  private expireSnapshot(snapshot: InFlightChatSnapshot, reason: string): void {
    this.snapshots.delete(snapshot.resumptionId);
    snapshot.status = "expired";

    const promptText = snapshot.promptPayload.prompt;
    if (promptText) {
      this.saveDraft({
        resumptionId: snapshot.resumptionId,
        prompt: promptText,
        appTarget: snapshot.appTarget,
        reason,
        accountEmail: snapshot.accountEmail,
      });
    }

    logger.warn(
      `SessionContinuityBuffer: Evicted expired snapshot ${snapshot.resumptionId}`,
    );
  }
}

export const sessionContinuityBuffer = new SessionContinuityBuffer();
