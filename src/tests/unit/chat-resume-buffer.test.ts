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

  describe("revertToPending", () => {
    it("reverts claimed in-flight snapshot back to pending and increments retryCount", () => {
      const snap = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-revert",
        promptPayload: { prompt: "Test prompt" },
      });

      expect(snap.status).toBe("pending");
      expect(snap.retryCount).toBeUndefined();

      // Claim as in_flight
      const claimed = buffer.claimInFlight(snap.resumptionId);
      expect(claimed?.status).toBe("in_flight");

      // Revert to pending on transient connection error
      const reverted = buffer.revertToPending(snap.resumptionId);
      expect(reverted).not.toBeNull();
      expect(reverted?.status).toBe("pending");
      expect(reverted?.retryCount).toBe(1);

      // Subsequent revert increments retryCount again
      const secondRevert = buffer.revertToPending(snap.resumptionId);
      expect(secondRevert?.retryCount).toBe(2);
      expect(secondRevert?.status).toBe("pending");

      // Appears in getAllPendingForTarget
      const pending = buffer.getAllPendingForTarget("app");
      expect(pending).toHaveLength(1);
      expect(pending[0].resumptionId).toBe(snap.resumptionId);
    });

    it("returns null when trying to revert a non-existent resumption ID", () => {
      expect(buffer.revertToPending("non-existent-id")).toBeNull();
    });

    it("returns null and archives draft when reverting an expired snapshot", () => {
      vi.useFakeTimers();
      const baseTime = 1000000;
      vi.setSystemTime(baseTime);

      const snap = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-revert-expired",
        promptPayload: { prompt: "Expired revert prompt" },
      });

      buffer.claimInFlight(snap.resumptionId);

      // Advance past TTL (301 seconds)
      vi.advanceTimersByTime(301_000);

      const reverted = buffer.revertToPending(snap.resumptionId);
      expect(reverted).toBeNull();
      expect(buffer.get(snap.resumptionId)).toBeNull();

      const draft = buffer.getLatestDraft("ide");
      expect(draft?.prompt).toBe("Expired revert prompt");
      expect(draft?.reason).toBe("ttl_expired");

      vi.useRealTimers();
    });
  });

  describe("claimInFlight Edge Cases", () => {
    it("returns null when claiming non-existent resumption ID", () => {
      expect(buffer.claimInFlight("missing-claim-id")).toBeNull();
    });

    it("returns null and archives draft when claiming an expired snapshot", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000000);

      const snap = buffer.store({
        appTarget: "app",
        cascadeId: "c-claim-expired",
        promptPayload: { prompt: "Expired claim prompt" },
      });

      vi.advanceTimersByTime(301_000);

      const claimed = buffer.claimInFlight(snap.resumptionId);
      expect(claimed).toBeNull();
      expect(buffer.has(snap.resumptionId)).toBe(false);

      const draft = buffer.getLatestDraft("app");
      expect(draft?.prompt).toBe("Expired claim prompt");
      expect(draft?.reason).toBe("ttl_expired");

      vi.useRealTimers();
    });

    it("returns null when snapshot status is not pending (already in_flight or completed)", () => {
      const snap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-claim-twice",
        promptPayload: { prompt: "Claim twice prompt" },
      });

      const firstClaim = buffer.claimInFlight(snap.resumptionId);
      expect(firstClaim?.status).toBe("in_flight");

      // Second claim attempt should fail
      const secondClaim = buffer.claimInFlight(snap.resumptionId);
      expect(secondClaim).toBeNull();
    });
  });

  describe("claimLatestForTarget Edge Cases", () => {
    it("returns null when no snapshots exist for target", () => {
      expect(buffer.claimLatestForTarget("ide")).toBeNull();
      expect(buffer.claimLatestForTarget("app")).toBeNull();
    });

    it("returns null when latest snapshot status is already in_flight or resumed", () => {
      const snap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-latest-not-pending",
        promptPayload: { prompt: "Already in flight" },
      });

      buffer.claimInFlight(snap.resumptionId);

      // Latest exists, but is in_flight, so claimLatestForTarget returns null
      expect(buffer.claimLatestForTarget("ide")).toBeNull();
    });

    it("successfully claims pending latest snapshot", () => {
      const snap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-latest-valid",
        promptPayload: { prompt: "Valid latest prompt" },
      });

      const claimed = buffer.claimLatestForTarget("ide");
      expect(claimed).not.toBeNull();
      expect(claimed?.resumptionId).toBe(snap.resumptionId);
      expect(claimed?.status).toBe("in_flight");
    });
  });

  describe("peek, has, and clear Edge Cases", () => {
    it("peek returns a shallow clone of active snapshot or null for missing/expired", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000000);

      expect(buffer.peek("missing-peek")).toBeNull();

      const snap = buffer.store({
        appTarget: "app",
        cascadeId: "c-peek",
        promptPayload: { prompt: "Peek prompt" },
      });

      const peeked = buffer.peek(snap.resumptionId);
      expect(peeked).not.toBeNull();
      expect(peeked?.cascadeId).toBe("c-peek");

      // Verify peek returns a clone (mutation does not affect buffer)
      if (peeked) {
        peeked.cascadeId = "mutated-cascade";
      }
      expect(buffer.get(snap.resumptionId)?.cascadeId).toBe("c-peek");

      // Expire and verify peek returns null
      vi.advanceTimersByTime(301_000);
      expect(buffer.peek(snap.resumptionId)).toBeNull();

      vi.useRealTimers();
    });

    it("has returns false for non-existent and expired snapshots", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000000);

      expect(buffer.has("missing-has")).toBe(false);

      const snap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-has",
        promptPayload: { prompt: "Has prompt" },
      });

      expect(buffer.has(snap.resumptionId)).toBe(true);

      vi.advanceTimersByTime(301_000);
      expect(buffer.has(snap.resumptionId)).toBe(false);

      vi.useRealTimers();
    });

    it("clear wipes all snapshots from memory immediately", () => {
      buffer.store({
        appTarget: "ide",
        cascadeId: "c-clear-1",
        promptPayload: { prompt: "P1" },
      });
      buffer.store({
        appTarget: "app",
        cascadeId: "c-clear-2",
        promptPayload: { prompt: "P2" },
      });

      expect(buffer.size()).toBe(2);
      buffer.clear();
      expect(buffer.size()).toBe(0);
      expect(buffer.getAllPendingForTarget("ide")).toEqual([]);
      expect(buffer.getAllPendingForTarget("app")).toEqual([]);
    });

    it("pruneExpired selectively expires only past-TTL snapshots and preserves active ones", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000000);

      const oldSnap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-old",
        promptPayload: { prompt: "Old prompt" },
      });

      // 100 seconds later, store fresh snapshot
      vi.advanceTimersByTime(100_000);

      const freshSnap = buffer.store({
        appTarget: "ide",
        cascadeId: "c-fresh",
        promptPayload: { prompt: "Fresh prompt" },
      });

      // Advance by another 201 seconds (total 301 seconds for oldSnap, 201 seconds for freshSnap)
      vi.advanceTimersByTime(201_000);

      const pruned = buffer.pruneExpired();
      expect(pruned).toBe(1);

      // Old is gone, fresh is still active
      expect(buffer.has(oldSnap.resumptionId)).toBe(false);
      expect(buffer.has(freshSnap.resumptionId)).toBe(true);
      expect(buffer.size()).toBe(1);

      vi.useRealTimers();
    });
  });
});
