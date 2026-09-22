import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatResumeDispatcher,
  extractCsrfTokenFromHtml,
  isValidProtoModelEnum,
  normalizeModelToProtoEnum,
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

    it("aborts handshake immediately when signal is aborted during probe or backoff", async () => {
      const controller = new AbortController();
      // Mock requester hangs until aborted via signal
      mockRequester.mockImplementation(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_, reject) => {
            if (opts?.signal) {
              opts.signal.addEventListener("abort", () =>
                reject(new Error("Request aborted")),
              );
            }
          }),
      );

      const handshakePromise = dispatcher.performReadinessHandshake(9000, {
        timeoutMs: 10000,
        signal: controller.signal,
      });

      // Abort after 20ms
      setTimeout(() => controller.abort(), 20);

      const result = await handshakePromise;
      expect(result.ready).toBe(false);
      expect(result.error).toBe("Handshake aborted");
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
                text: "Write binary search in Go",
                chunk: {
                  case: "text",
                  value: "Write binary search in Go",
                },
              },
            ],
            prompt: "Write binary search in Go",
            cascadeConfig: {
              model: "gemini-1.5-pro",
              temperature: 0.2,
              plannerConfig: {
                requestedModel: {
                  model: "MODEL_PLACEHOLDER_M318",
                  choice: { case: "model", value: "MODEL_PLACEHOLDER_M318" },
                },
                planModel: "MODEL_PLACEHOLDER_M318",
                modelName: "gemini-1.5-pro",
              },
              requestedModel: {
                model: "MODEL_PLACEHOLDER_M318",
              },
            },
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

    it("dispatches prompt with authentic Claude proto enum MODEL_PLACEHOLDER_M26 and records model resolution telemetry", async () => {
      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-claude-authentic",
        promptPayload: {
          prompt: "Refactor architecture with deep reasoning",
          requestedModel: "MODEL_PLACEHOLDER_M26",
          cascadeConfig: {
            plannerConfig: {
              modelName: "claude-opus-4-6-thinking",
            },
          },
        },
        accountEmail: "sarah@example.com",
      });

      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ messageId: "msg-claude-ok" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "valid-csrf-token",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("resumed");

      const callArgs = mockRequester.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.cascadeConfig.requestedModel).toEqual({
        model: "MODEL_PLACEHOLDER_M26",
      });
      expect(requestBody.cascadeConfig.plannerConfig.requestedModel).toEqual({
        model: "MODEL_PLACEHOLDER_M26",
        choice: { case: "model", value: "MODEL_PLACEHOLDER_M26" },
      });
      expect(requestBody.cascadeConfig.plannerConfig.planModel).toBe(
        "MODEL_PLACEHOLDER_M26",
      );
      expect(requestBody.cascadeConfig.plannerConfig.modelName).toBe(
        "claude-opus-4-6-thinking",
      );

      // Verify ZERO fabricated enums in wire payload
      expect(callArgs[1].body).not.toContain("MODEL_CLAUDE_4_SONNET");

      // Verify chat_model_resolved telemetry recorded
      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_model_resolved",
            appTarget: "app",
            resolvedEnum: "MODEL_PLACEHOLDER_M26",
            modelName: "claude-opus-4-6-thinking",
            inheritedNative: false,
          }),
        ]),
      );
    });

    it("safely omits requestedModel and planModel overrides when raw model has no valid proto enum (native conversation inheritance)", async () => {
      const snapshot = buffer.store({
        appTarget: "ide",
        cascadeId: "cascade-claude-inheritance",
        promptPayload: {
          prompt: "Draft system architecture document",
          requestedModel: "claude-opus-4-6-thinking",
        },
        accountEmail: "engineer@example.com",
      });

      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ messageId: "msg-native-ok" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "valid-csrf-token",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("resumed");

      const callArgs = mockRequester.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Verify requestedModel override is completely omitted from cascadeConfig
      expect(requestBody.cascadeConfig.requestedModel).toBeUndefined();

      // Verify requestedModel and planModel are omitted from plannerConfig (native model inheritance)
      expect(requestBody.cascadeConfig.plannerConfig?.requestedModel).toBeUndefined();
      expect(requestBody.cascadeConfig.plannerConfig?.planModel).toBeUndefined();
      expect(requestBody.cascadeConfig.plannerConfig?.modelName).toBe(
        "claude-opus-4-6-thinking",
      );

      // Verify fabricated enum is NEVER sent
      expect(callArgs[1].body).not.toContain("MODEL_CLAUDE_4_SONNET");

      // Verify chat_model_resolved telemetry recorded with inheritedNative: true
      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_model_resolved",
            appTarget: "ide",
            resolvedEnum: undefined,
            modelName: "claude-opus-4-6-thinking",
            inheritedNative: true,
          }),
        ]),
      );
    });

    it("safely omits requestedModel and planModel overrides when snapshot has undefined model", async () => {
      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-empty-model",
        promptPayload: {
          prompt: "General prompt with no model override",
        },
      });

      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ messageId: "msg-empty-ok" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "csrf-token",
      );

      expect(result.success).toBe(true);
      const callArgs = mockRequester.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      // Entirely omitted
      expect(requestBody.cascadeConfig.requestedModel).toBeUndefined();
      expect(requestBody.cascadeConfig.plannerConfig).toBeUndefined();
    });

    it("dispatches continuation prompt 'Continue your previous response.' when snapshot isInterrupted is true", async () => {
      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-interrupted",
        promptPayload: {
          prompt: "The user original question",
          requestedModel: "gemini-3.8-flash-high",
        },
        isInterrupted: true,
      });

      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: JSON.stringify({ messageId: "msg-cont" }),
      });

      const result = await dispatcher.dispatchSnapshot(
        snapshot,
        9000,
        "valid-csrf",
      );

      expect(result.success).toBe(true);
      expect(mockRequester).toHaveBeenCalledWith(
        "https://127.0.0.1:9000/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
        expect.objectContaining({
          body: expect.stringContaining("Continue your previous response."),
        }),
      );
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

    it("notifies port discovery of restart and passes last known port", async () => {
      const { PortDiscoveryService } =
        await import("@/modules/relay/port-discovery");
      const mockPortDiscovery = new PortDiscoveryService({
        initialPort: 54321,
      });
      dispatcher.bindPortDiscovery(mockPortDiscovery);

      expect(mockPortDiscovery.getPort()).toBe(54321);

      dispatcher.notifyTargetRestarting("app");

      expect(mockPortDiscovery.isRestarting()).toBe(true);
      expect(mockPortDiscovery.getPort()).toBeNull();
      expect(mockPortDiscovery.getStalePort()).toBe(54321);
    });

    it("dynamically aborts active handshake on dead port and pivots to new port on port-changed event without dropping snapshots", async () => {
      const { PortDiscoveryService } =
        await import("@/modules/relay/port-discovery");
      const mockPortDiscovery = new PortDiscoveryService();
      dispatcher.bindPortDiscovery(mockPortDiscovery);

      const snapshot = buffer.store({
        appTarget: "app",
        cascadeId: "cascade-pivot-test",
        promptPayload: { prompt: "Refactor architecture cleanly" },
        accountEmail: "user@corp.com",
      });

      // Dead port 54321: requests hang / wait for abort
      // New port 58999: requests succeed immediately
      mockRequester.mockImplementation((url: string, opts?: any) => {
        if (url.includes("54321")) {
          return new Promise((_, reject) => {
            if (opts?.signal) {
              opts.signal.addEventListener("abort", () =>
                reject(new Error("Handshake aborted")),
              );
            }
          });
        }
        if (url.includes("58999")) {
          if (url.endsWith("/")) {
            return Promise.resolve({
              status: 200,
              headers: {},
              data: `<script>window.__APP_CONFIG__ = {csrfToken: "csrf-new-port"};</script>`,
            });
          }
          if (url.includes("GetAuthStatus")) {
            return Promise.resolve({
              status: 200,
              headers: {},
              data: JSON.stringify({ authenticated: true }),
            });
          }
          if (url.includes("SendUserCascadeMessage")) {
            return Promise.resolve({
              status: 200,
              headers: {},
              data: JSON.stringify({ messageId: "msg-pivoted-success" }),
            });
          }
        }
        return Promise.reject(new Error("Unknown URL"));
      });

      // 1. Initial trigger starts handshake on dead port 54321
      const initialPromise = dispatcher.triggerResumptionForTarget("app", {
        explicitPort: 54321,
      });

      // Verify active handshake is tracking dead port 54321
      expect((dispatcher as any).activeHandshakePorts.get("app")).toBe(54321);

      // 2. Language server emerges 30ms later with new port 58999
      await new Promise((r) => setTimeout(r, 30));
      mockPortDiscovery.setPort(58999);

      // 3. Initial promise returns null due to abort
      const initialResult = await initialPromise;
      expect(initialResult).toBeNull();

      // 4. Wait for autonomous resumption to complete on new port 58999
      await new Promise((r) => setTimeout(r, 100));

      // 5. Verify snapshot was NOT dropped or failed, and was consumed on success
      expect(buffer.get(snapshot.resumptionId)).toBeNull();

      // 6. Verify telemetry recorded chat_handshake_port_switched and chat_session_auto_resumed
      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_handshake_port_switched",
            appTarget: "app",
            oldPort: 54321,
            newPort: 58999,
          }),
          expect.objectContaining({
            event: "chat_session_auto_resumed",
            appTarget: "app",
            resumptionId: snapshot.resumptionId,
            status: "success",
          }),
        ]),
      );
    });

    it("immediately returns null when extractCsrfToken is passed an aborted signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const token = await dispatcher.extractCsrfToken(8888, controller.signal);
      expect(token).toBeNull();
    });

    it("aborts active target handshake and all active handshakes when notifyTargetRestarting is called", () => {
      const controller1 = new AbortController();
      const controller2 = new AbortController();
      (dispatcher as any).activeHandshakes.set("app", controller1);
      (dispatcher as any).activeHandshakePorts.set("app", 54321);
      (dispatcher as any).activeHandshakes.set("ide", controller2);
      (dispatcher as any).activeHandshakePorts.set("ide", 54322);

      dispatcher.notifyTargetRestarting("app");
      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);

      dispatcher.notifyTargetRestarting();
      expect(controller2.signal.aborted).toBe(true);
    });

    it("aborts readiness handshake immediately while sleeping in backoff", async () => {
      mockRequester.mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: '<script>window.__APP_CONFIG__ = {csrfToken: "tok"};</script>',
      });
      // Next call is /GetAuthStatus, fail it so it enters backoff
      mockRequester.mockResolvedValueOnce({
        status: 503,
        headers: {},
        data: '{"error": "starting"}',
      });

      const controller = new AbortController();
      const handshakePromise = dispatcher.performReadinessHandshake(8888, {
        signal: controller.signal,
        timeoutMs: 5000,
      });

      await new Promise((r) => setTimeout(r, 20));
      controller.abort();

      const result = await handshakePromise;
      expect(result.ready).toBe(false);
      expect(result.error).toBe("Handshake aborted");
    });

    it("falls back to HTTP for CSRF extraction when HTTPS fails and signal is active", async () => {
      mockRequester.mockImplementation((url: string) => {
        if (url.startsWith("https")) {
          return Promise.reject(new Error("TLS error"));
        }
        return Promise.resolve({
          status: 200,
          headers: {},
          data: '<script>window.__APP_CONFIG__ = {csrfToken: "http-token"};</script>',
        });
      });

      const token = await dispatcher.extractCsrfToken(
        8888,
        new AbortController().signal,
      );
      expect(token).toBe("http-token");
    });

    it("handles abort occurring immediately after probe failure before backoff completes", async () => {
      const controller = new AbortController();
      mockRequester.mockImplementation((url: string) => {
        if (url.endsWith("/")) {
          return Promise.resolve({
            status: 200,
            headers: {},
            data: '<script>window.__APP_CONFIG__ = {csrfToken: "tok"};</script>',
          });
        }
        // Fail probe and immediately abort
        controller.abort();
        return Promise.reject(new Error("Probe failed"));
      });

      const result = await dispatcher.performReadinessHandshake(8888, {
        signal: controller.signal,
        timeoutMs: 5000,
      });

      expect(result.ready).toBe(false);
      expect(result.error).toBe("Handshake aborted");
    });
  });

  describe("RelayServer Lifecycle Decoupling", () => {
    it("does not stop PortDiscoveryService when RelayServer.prototype.stop is invoked", async () => {
      const { RelayServer } = await import("@/modules/relay/relay-server");
      const { PortDiscoveryService } =
        await import("@/modules/relay/port-discovery");

      const mockDiscovery = new PortDiscoveryService();
      const stopSpy = vi.spyOn(mockDiscovery, "stop");

      const server = new RelayServer({
        portDiscovery: mockDiscovery,
        config: { port: 49999 },
      });

      await server.stop();

      // Verified: portDiscovery.stop() was NOT called
      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  describe("isValidProtoModelEnum", () => {
    it("returns true for valid protobuf MODEL_ enums", () => {
      expect(isValidProtoModelEnum("MODEL_PLACEHOLDER_M26")).toBe(true);
      expect(isValidProtoModelEnum("MODEL_PLACEHOLDER_M318")).toBe(true);
      expect(isValidProtoModelEnum("MODEL_CUSTOM_PRO")).toBe(true);
    });

    it("returns false for non-enum strings, empty strings, and undefined", () => {
      expect(isValidProtoModelEnum("claude-opus-4-6-thinking")).toBe(false);
      expect(isValidProtoModelEnum("gemini-1.5-pro")).toBe(false);
      expect(isValidProtoModelEnum("")).toBe(false);
      expect(isValidProtoModelEnum("   ")).toBe(false);
      expect(isValidProtoModelEnum(undefined)).toBe(false);
      expect(isValidProtoModelEnum(null)).toBe(false);
    });
  });

  describe("normalizeModelToProtoEnum", () => {
    it("preserves already-valid protobuf Model enum identifiers", () => {
      expect(normalizeModelToProtoEnum("MODEL_PLACEHOLDER_M318")).toEqual({
        enumModel: "MODEL_PLACEHOLDER_M318",
      });
      expect(normalizeModelToProtoEnum("MODEL_PLACEHOLDER_M26")).toEqual({
        enumModel: "MODEL_PLACEHOLDER_M26",
      });
    });

    it("maps raw Gemini model names to MODEL_PLACEHOLDER_M318 with modelName preserved", () => {
      expect(normalizeModelToProtoEnum("gemini-3.8-flash-high")).toEqual({
        enumModel: "MODEL_PLACEHOLDER_M318",
        modelName: "gemini-3.8-flash-high",
      });
      expect(normalizeModelToProtoEnum("gemini-2.5-pro")).toEqual({
        enumModel: "MODEL_PLACEHOLDER_M318",
        modelName: "gemini-2.5-pro",
      });
    });

    it("preserves raw Claude model names as modelName without fabricating fake enums (MODEL_CLAUDE_4_SONNET removed)", () => {
      const res1 = normalizeModelToProtoEnum("claude-3-5-sonnet");
      expect(res1).toEqual({
        modelName: "claude-3-5-sonnet",
      });
      expect(res1.enumModel).toBeUndefined();
      expect(JSON.stringify(res1)).not.toContain("MODEL_CLAUDE_4_SONNET");

      const res2 = normalizeModelToProtoEnum("claude-sonnet-4-5");
      expect(res2).toEqual({
        modelName: "claude-sonnet-4-5",
      });
      expect(res2.enumModel).toBeUndefined();
      expect(JSON.stringify(res2)).not.toContain("MODEL_CLAUDE_4_SONNET");

      const res3 = normalizeModelToProtoEnum("claude-opus-4-6-thinking");
      expect(res3).toEqual({
        modelName: "claude-opus-4-6-thinking",
      });
      expect(res3.enumModel).toBeUndefined();
      expect(JSON.stringify(res3)).not.toContain("MODEL_CLAUDE_4_SONNET");
    });

    it("returns empty object without enumModel for empty or undefined inputs", () => {
      expect(normalizeModelToProtoEnum(undefined)).toEqual({});
      expect(normalizeModelToProtoEnum("")).toEqual({});
      expect(normalizeModelToProtoEnum("   ")).toEqual({});
    });
  });
});
