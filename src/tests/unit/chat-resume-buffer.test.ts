import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESUMPTION_TTL_MS,
  MAX_PAYLOAD_BYTES,
  PayloadTooLargeError,
  SessionContinuityBuffer,
} from "@/modules/chat-resume/SessionContinuityBuffer";

describe("SessionContinuityBuffer", () => {
  let buffer: SessionContinuityBuffer;

  beforeEach(() => {
    buffer = new SessionContinuityBuffer();
    vi.useRealTimers();
  });

  describe("Store and Retrieval", () => {
    it("stores an in-flight chat snapshot with auto-generated correlation UUID", () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-101",
        promptPayload: {
          prompt: "Refactor database pool connection",
          requestedModel: "gemini-1.5-pro",
        },
        source: "auto_switch",
      });

      expect(snapshot.resumptionId).toBeDefined();
      expect(snapshot.resumptionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(snapshot.appTarget).toBe("ide");
      expect(snapshot.cascadeId).toBe("cascade-101");
      expect(snapshot.status).toBe("pending");
      expect(snapshot.expiresAt).toBe(
        snapshot.capturedAt + DEFAULT_RESUMPTION_TTL_MS,
      );

      const retrieved = buffer.get(snapshot.resumptionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.cascadeId).toBe("cascade-101");
    });

    it("respects caller-provided resumptionId and timestamp", () => {
      const customId = "custom-resumption-uuid-001";
      const customTime = Date.now();

      const snapshot = buffer.store({
        resumptionId: customId,
        appTarget: "app",
        cascadeId: "cascade-202",
        promptPayload: { prompt: "Explain AST parsing" },
        capturedAt: customTime,
      });

      expect(snapshot.resumptionId).toBe(customId);
      expect(snapshot.capturedAt).toBe(customTime);
      expect(snapshot.expiresAt).toBe(customTime + DEFAULT_RESUMPTION_TTL_MS);
      expect(buffer.has(customId)).toBe(true);
    });
  });

  describe("Monotonic 300s TTL Expiration", () => {
    it("evicts snapshot and preserves draft when 300-second TTL expires", () => {
      vi.useFakeTimers();
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);

      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-ttl-test",
        promptPayload: {
          prompt: "Optimize recursive descent parser",
        },
      });

      expect(buffer.get(snapshot.resumptionId)).not.toBeNull();

      // Fast forward 299 seconds -> still valid
      vi.advanceTimersByTime(299_000);
      expect(buffer.get(snapshot.resumptionId)).not.toBeNull();

      // Fast forward 2 more seconds (total 301 seconds) -> expired
      vi.advanceTimersByTime(2_000);
      expect(buffer.get(snapshot.resumptionId)).toBeNull();
      expect(buffer.has(snapshot.resumptionId)).toBe(false);

      // Verify prompt was safely archived to draft scratch
      const draft = buffer.getLatestDraft("ide");
      expect(draft).not.toBeNull();
      expect(draft?.prompt).toBe("Optimize recursive descent parser");
      expect(draft?.reason).toBe("ttl_expired");

      vi.useRealTimers();
    });

    it("prunes all expired snapshots across multiple targets", () => {
      vi.useFakeTimers();
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);

      buffer.store({
        appTarget: "ide",
        cascadeId: "c1",
        promptPayload: { prompt: "P1" },
      });

      buffer.store({
        appTarget: "app",
        cascadeId: "c2",
        promptPayload: { prompt: "P2" },
      });

      expect(buffer.size()).toBe(2);

      vi.advanceTimersByTime(300_001);
      const pruned = buffer.pruneExpired();
      expect(pruned).toBe(2);
      expect(buffer.size()).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("Payload Size Limit (5MB)", () => {
    it("rejects prompt payloads exceeding 5MB strictly", () => {
      const hugePrompt = "x".repeat(MAX_PAYLOAD_BYTES + 1024);

      expect(() => {
        buffer.store({
          appTarget: "ide",
          cascadeId: "huge-cascade",
          promptPayload: {
            prompt: hugePrompt,
          },
        });
      }).toThrow(PayloadTooLargeError);
    });

    it("accepts payloads within the 5MB boundary", () => {
      const moderatePrompt = "a".repeat(100 * 1024); // 100 KB
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "moderate-cascade",
        promptPayload: {
          prompt: moderatePrompt,
        },
      });

      expect(snapshot).toBeDefined();
      expect(buffer.has(snapshot.resumptionId)).toBe(true);
    });
  });

  describe("Singleflight Idempotency", () => {
    it("evicts snapshot immediately upon consumption so it cannot be resumed twice", () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "singleflight-cascade",
        promptPayload: { prompt: "Generate unit tests" },
      });

      // First consume -> returns snapshot with status 'resumed'
      const consumed = buffer.consume(snapshot.resumptionId);
      expect(consumed).not.toBeNull();
      expect(consumed?.resumptionId).toBe(snapshot.resumptionId);
      expect(consumed?.status).toBe("resumed");

      // Second consume -> returns null
      const secondConsume = buffer.consume(snapshot.resumptionId);
      expect(secondConsume).toBeNull();

      // Subsequent get -> returns null
      expect(buffer.get(snapshot.resumptionId)).toBeNull();
    });

    it("consumeLatestForTarget consumes the most recent snapshot for that target", () => {
      const now = Date.now();

      buffer.store({
        resumptionId: "id-older",
        appTarget: "ide",
        cascadeId: "c-old",
        promptPayload: { prompt: "Old prompt" },
        capturedAt: now - 1000,
        expiresAt: now + DEFAULT_RESUMPTION_TTL_MS,
      });

      buffer.store({
        resumptionId: "id-newer",
        appTarget: "ide",
        cascadeId: "c-new",
        promptPayload: { prompt: "New prompt" },
        capturedAt: now,
        expiresAt: now + DEFAULT_RESUMPTION_TTL_MS,
      });

      const latest = buffer.consumeLatestForTarget("ide");
      expect(latest?.resumptionId).toBe("id-newer");
      expect(latest?.cascadeId).toBe("c-new");

      // Now the latest is the older one
      const remaining = buffer.consumeLatestForTarget("ide");
      expect(remaining?.resumptionId).toBe("id-older");

      // Empty now
      expect(buffer.consumeLatestForTarget("ide")).toBeNull();
    });
  });

  describe("Draft Scratch Memory", () => {
    it("stores and retrieves drafts sorted by saved timestamp", () => {
      buffer.saveDraft({
        resumptionId: "res-1",
        prompt: "First draft",
        appTarget: "ide",
        reason: "handshake_timeout",
      });

      buffer.saveDraft({
        resumptionId: "res-2",
        prompt: "Second draft",
        appTarget: "app",
        reason: "model_rejected",
      });

      const drafts = buffer.getAllDrafts();
      expect(drafts).toHaveLength(2);

      const latestIde = buffer.getLatestDraft("ide");
      expect(latestIde?.resumptionId).toBe("res-1");
      expect(latestIde?.prompt).toBe("First draft");

      buffer.clearDrafts();
      expect(buffer.getAllDrafts()).toHaveLength(0);
    });
  });

  describe("In-Memory Active Prompt Registration", () => {
    it("allows registering and retrieving in-flight prompts for runtime coordination", () => {
      expect(buffer.getActivePrompt("ide")).toBeNull();

      buffer.registerActivePrompt("ide", {
        cascadeId: "live-cascade-1",
        promptPayload: { prompt: "Live streaming prompt" },
      });

      const active = buffer.getActivePrompt("ide");
      expect(active?.cascadeId).toBe("live-cascade-1");

      buffer.clearActivePrompt("ide");
      expect(buffer.getActivePrompt("ide")).toBeNull();
    });
  });
});
