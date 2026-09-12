import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatResumeDispatcher,
  extractCsrfTokenFromHtml,
  type HttpRequester,
} from "@/modules/chat-resume/ChatResumeDispatcher";
import { SessionContinuityBuffer } from "@/modules/chat-resume/SessionContinuityBuffer";
import { chatResumeEvents } from "@/modules/chat-resume/telemetry";

describe("ChatResumeDispatcher", () => {
  let buffer: SessionContinuityBuffer;
  let mockRequester: ReturnType<typeof vi.fn>;
  let dispatcher: ChatResumeDispatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    chatResumeEvents.clearTelemetryHistory();
    buffer = new SessionContinuityBuffer();
    mockRequester = vi.fn();
    dispatcher = new ChatResumeDispatcher({
      buffer,
      httpRequester: mockRequester as unknown as HttpRequester,
      handshakeTimeoutMs: 1000,
      initialBackoffMs: 10,
      maxBackoffMs: 50,
      defaultFallbackModel: "gemini-1.5-flash",
    });
  });

  describe("CSRF Token Extraction", () => {
    it("extracts csrfToken from window.__APP_CONFIG__ in HTML", () => {
      const html = `<!doctype html><html><head><script>window.__APP_CONFIG__ = {csrfToken: "sec-csrf-token-12345"};</script></head><body></body></html>`;
      const token = extractCsrfTokenFromHtml(html);
      expect(token).toBe("sec-csrf-token-12345");
    });

    it("extracts csrfToken from meta tag fallback", () => {
      const html = `<html><head><meta name="csrf-token" content="meta-csrf-token-abc"/></head></html>`;
      const token = extractCsrfTokenFromHtml(html);
      expect(token).toBe("meta-csrf-token-abc");
    });

    it("returns null when HTML does not contain CSRF token", () => {
      const html = `<html><body>Just a blank page</body></html>`;
      const token = extractCsrfTokenFromHtml(html);
      expect(token).toBeNull();
    });
  });

  describe("Connect-RPC Readiness Handshake", () => {
    it("completes handshake successfully when /GetAuthStatus returns 200", async () => {
      // Step 1: GET / returns HTML with CSRF
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: `<script>window.__APP_CONFIG__ = {csrfToken: "csrf-handshake-ok"};</script>`,
      });

      // Step 2: POST /GetAuthStatus returns 200 OK
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ authenticated: true }),
      });

      const result = await dispatcher.performReadinessHandshake(9000);
      expect(result.ready).toBe(true);
      expect(result.csrfToken).toBe("csrf-handshake-ok");
    });

    it("retries with exponential backoff on cold-start errors until server is ready", async () => {
      // 1. GET / returns HTML with CSRF
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: `<script>window.__APP_CONFIG__ = {csrfToken: "csrf-backoff-tok"};</script>`,
      });

      // 2. Initial probe fails with 503
      mockRequester.mockResolvedValueOnce({
        status: 503,
        headers: {},
        data: "Service Unavailable",
      });

      // 3. Next probe to fallback endpoint fails with connection error
      mockRequester.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      // 4. Subsequent probe succeeds
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ status: "authenticated" }),
      });

      const result = await dispatcher.performReadinessHandshake(9000, {
        timeoutMs: 1500,
      });
      expect(result.ready).toBe(true);
      expect(result.csrfToken).toBe("csrf-backoff-tok");
    });

    it("times out and reports error if Language Server never reports ready within timeout", async () => {
      // Mock all requests failing with 500
      mockRequester.mockResolvedValue({
        status: 500,
        headers: {},
        data: "Internal Server Error",
      });

      const result = await dispatcher.performReadinessHandshake(9000, {
        timeoutMs: 100,
      });
      expect(result.ready).toBe(false);
      expect(result.error).toContain("timed out");
    });
  });

  describe("Dispatch Prompt & Resumption Execution", () => {
    it("dispatches /SendUserCascadeMessage with cascadeConfig and emits resumed IPC", async () => {
      const statusListener = vi.fn();
      chatResumeEvents.on("resumption-status", statusListener);

      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-alpha",
        promptPayload: {
          prompt: "Write binary search in Go",
          requestedModel: "gemini-1.5-pro",
          cascadeConfig: { model: "gemini-1.5-pro", temperature: 0.2 },
        },
        accountEmail: "developer@example.com",
      });

      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ messageId: "msg-123" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "valid-csrf",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("resumed");
      expect(mockRequester).toHaveBeenCalledWith(
        "https://127.0.0.1:9000/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-codeium-csrf-token": "valid-csrf",
          }),
          body: JSON.stringify({
            cascadeId: "cascade-alpha",
            items: [
              {
                chunk: {
                  case: "text",
                  value: "Write binary search in Go",
                },
              },
            ],
            prompt: "Write binary search in Go",
            cascadeConfig: { requestedModel: { model: "gemini-1.5-pro" } },
            contextReferences: [],
          }),
        }),
      );

      // Snapshot evicted from buffer
      expect(buffer.get(snapshot.resumptionId)).toBeNull();

      // IPC event emitted
      expect(statusListener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "resumed",
          resumptionId: snapshot.resumptionId,
          target: "ide",
          accountEmail: "developer@example.com",
        }),
      );

      // Telemetry recorded
      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_session_auto_resumed",
            status: "success",
            resumptionId: snapshot.resumptionId,
          }),
        ]),
      );

      chatResumeEvents.off("resumption-status", statusListener);
    });

    it("does not silently downgrade model on 403 quota error; cleanly aborts and preserves prompt in draft scratch", async () => {
      const statusListener = vi.fn();
      chatResumeEvents.on("resumption-status", statusListener);

      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-fallback",
        promptPayload: {
          prompt: "Analyze architecture",
          requestedModel: "claude-3-5-sonnet",
        },
        accountEmail: "fallback@example.com",
      });

      // Primary dispatch fails with 403 Quota Exceeded
      mockRequester.mockResolvedValueOnce({
        status: 403,
        headers: {},
        data: JSON.stringify({ error: "model_quota_exhausted" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "csrf-token",
      );

      // Verified: Zero silent downgrade, cleanly failed
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");

      // Verify only 1 call made - NO fallback to a different model
      expect(mockRequester).toHaveBeenCalledTimes(1);

      // Preserved in draft scratch
      const draft = buffer.getDraft(snapshot.resumptionId);
      expect(draft).not.toBeNull();
      expect(draft?.prompt).toBe("Analyze architecture");

      // Emitted failed status
      expect(statusListener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          resumptionId: snapshot.resumptionId,
        }),
      );

      chatResumeEvents.off("resumption-status", statusListener);
    });

    it("preserves unsent prompt in draft scratch and emits failed status on unrecoverable error", async () => {
      const statusListener = vi.fn();
      chatResumeEvents.on("resumption-status", statusListener);

      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-unrecoverable",
        promptPayload: {
          prompt: "Critical unpersisted refactor prompt",
          requestedModel: "gemini-1.5-pro",
        },
        accountEmail: "user@example.com",
      });

      // Primary attempt fails with 500
      mockRequester.mockResolvedValueOnce({
        status: 500,
        headers: {},
        data: "Crash",
      });
      // Fallback endpoint also fails
      mockRequester.mockResolvedValueOnce({
        status: 500,
        headers: {},
        data: "Crash",
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "csrf-token",
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");

      // Evicted from buffer
      expect(buffer.get(snapshot.resumptionId)).toBeNull();

      // Preserved in draft scratch memory
      const draft = buffer.getLatestDraft("app");
      expect(draft).not.toBeNull();
      expect(draft?.prompt).toBe("Critical unpersisted refactor prompt");
      expect(draft?.accountEmail).toBe("user@example.com");

      // Failure IPC emitted
      expect(statusListener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          resumptionId: snapshot.resumptionId,
          draftPrompt: "Critical unpersisted refactor prompt",
        }),
      );

      // Failure telemetry recorded
      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_session_resume_failed",
            resumptionId: snapshot.resumptionId,
          }),
        ]),
      );

      chatResumeEvents.off("resumption-status", statusListener);
    });

    it("prevents concurrent duplicate dispatch for the same resumptionId", async () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "c-dup",
        promptPayload: { prompt: "Duplicate test" },
      });

      // Add to in-flight set manually to simulate concurrent call
      (dispatcher as any).inFlightDispatches.add(snapshot.resumptionId);

      const result = await dispatcher.dispatchSnapshot(snapshot, 9000, "csrf");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("duplicate_dispatch_in_flight");
    });
  });

  describe("triggerResumptionForTarget", () => {
    it("returns null if no pending snapshot exists for the target", async () => {
      const result = await dispatcher.triggerResumptionForTarget("ide", {
        explicitPort: 9000,
      });
      expect(result).toBeNull();
    });

    it("runs handshake and dispatch when pending snapshot exists", async () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "c-trigger",
        promptPayload: { prompt: "Run migration" },
      });

      // GET / for CSRF
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: `<script>window.__APP_CONFIG__ = {csrfToken: "t-123"};</script>`,
      });
      // POST /GetAuthStatus
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ ok: true }),
      });
      // POST /SendUserCascadeMessage
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ ok: true }),
      });

      const result = await dispatcher.triggerResumptionForTarget("ide", {
        explicitPort: 8888,
        accountEmail: "new@example.com",
      });

      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.resumptionId).toBe(snapshot.resumptionId);
    });

    it("waits for dynamically discovered port when port is restarting", async () => {
      const { PortDiscoveryService } =
        await import("@/modules/relay/port-discovery");
      const mockPortDiscovery = new PortDiscoveryService();
      dispatcher.bindPortDiscovery(mockPortDiscovery);

      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "c-dynamic-wait",
        promptPayload: { prompt: "Hello dynamic port" },
      });

      // Target begins restarting
      dispatcher.notifyTargetRestarting("app");
      expect(mockPortDiscovery.isRestarting()).toBe(true);
      expect(mockPortDiscovery.getPort()).toBeNull();

      // Mock HTTP responses for handshake and dispatch
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: `<script>window.__APP_CONFIG__ = {csrfToken: "t-dyn"};</script>`,
      });
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ ok: true }),
      });
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ ok: true }),
      });

      const triggerPromise = dispatcher.triggerResumptionForTarget("app");

      // Simulate discovery of new port 59357 after 50ms
      setTimeout(() => {
        mockPortDiscovery.setPort(59357);
      }, 50);

      const result = await triggerPromise;
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
      expect(result?.resumptionId).toBe(snapshot.resumptionId);
    });
  });
});
