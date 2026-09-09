import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  RelayServer,
  generateAutoReloadScript,
} from "@/modules/relay/relay-server";
import { SessionManager } from "@/modules/relay/session-manager";
import { UpstreamBridge } from "@/modules/relay/upstream-bridge";
import { PortDiscoveryService } from "@/modules/relay/port-discovery";
import {
  MockUpstreamServer,
  TEST_TLS_KEY,
  TEST_TLS_CERT,
} from "../helpers/mock-upstream";
import https from "node:https";
import { request as undiciRequest } from "undici";

describe("RelayServer Reverse Proxy Mirror", () => {
  let mockUpstream: MockUpstreamServer;
  let upstreamPort: number;
  let relayServer: RelayServer;
  let relayPort: number;
  let tempDir: string;
  let logFilePath: string;
  let portDiscovery: PortDiscoveryService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-mirror-test-"));
    logFilePath = path.join(tempDir, "main.log");

    mockUpstream = new MockUpstreamServer({
      csrfToken: "test-initial-csrf-token",
      validateCsrf: true,
    });
    upstreamPort = await mockUpstream.start();

    fs.writeFileSync(
      logFilePath,
      `[LOG] listening on https://127.0.0.1:${upstreamPort}/\n`,
      "utf-8",
    );

    portDiscovery = new PortDiscoveryService({
      logPath: logFilePath,
      pollIntervalMs: 50,
      debounceMs: 10,
    });

    relayServer = new RelayServer({
      config: {
        port: 0,
        host: "127.0.0.1",
      },
      portDiscovery,
    });

    const status = await relayServer.start();
    relayPort = status.port;
  });

  afterEach(async () => {
    if (relayServer) {
      await relayServer.stop();
      relayServer.dispose();
    }
    if (mockUpstream) {
      await mockUpstream.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Suppress temp dir cleanup error
    }
  });

  describe("HTTP Reverse Proxying", () => {
    it("proxies root GET request returning HTML with CSRF token and custom headers", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/`);
      expect(res.status).toBe(200);

      const contentType = res.headers.get("content-type");
      expect(contentType).toContain("text/html");

      const customHeader = res.headers.get("x-custom-header");
      expect(customHeader).toBe("antigravity-upstream");

      const bodyText = await res.text();
      expect(bodyText).toContain(
        'window.__APP_CONFIG__ = {csrfToken: "test-initial-csrf-token"}',
      );
      expect(bodyText).toContain("<h1>Antigravity App</h1>");
    });

    it("proxies static asset requests with correct Content-Type headers", async () => {
      const assets = [
        { path: "/main.js", expectedType: "application/javascript" },
        { path: "/compiled_tailwind.css", expectedType: "text/css" },
        { path: "/jetbox.css", expectedType: "text/css" },
        { path: "/prism_bundle.js", expectedType: "application/javascript" },
      ];

      for (const asset of assets) {
        const res = await fetch(`http://127.0.0.1:${relayPort}${asset.path}`);
        expect(res.status).toBe(200);
        const ct = res.headers.get("content-type") || "";
        expect(ct).toContain(asset.expectedType);
      }
    });

    it("proxies POST requests with body intact and sets upstream Host header", async () => {
      const payload = { prompt: "Explain quantum computing", maxTokens: 100 };

      const res = await fetch(`http://127.0.0.1:${relayPort}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Session": "mobile-client-01",
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.method).toBe("POST");
      expect(json.receivedBody).toEqual(payload);

      // Verify that mock upstream received the correct Host header
      const lastReq =
        mockUpstream.recordedRequests[mockUpstream.recordedRequests.length - 1];
      expect(lastReq.headers["host"]).toBe(`127.0.0.1:${upstreamPort}`);
      expect(lastReq.headers["x-client-session"]).toBe("mobile-client-01");
    });

    it("proxies PUT and DELETE requests to upstream API", async () => {
      const putRes = await fetch(`http://127.0.0.1:${relayPort}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: "dark" }),
      });
      expect(putRes.status).toBe(200);

      const delRes = await fetch(`http://127.0.0.1:${relayPort}/api/item/1`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);
    });

    it("returns 503 with retry information when upstream port is not yet discovered", async () => {
      const unlinkedDiscovery = new PortDiscoveryService({
        logPath: path.join(tempDir, "missing.log"),
      });

      const unlinkedServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1" },
        portDiscovery: unlinkedDiscovery,
      });

      const st = await unlinkedServer.start();
      try {
        const res = await fetch(`http://127.0.0.1:${st.port}/`);
        expect(res.status).toBe(503);
        expect(res.headers.get("retry-after")).toBe("2");
        const body = (await res.json()) as any;
        expect(body.error).toBe("upstream_unavailable");
        expect(body.retry_after_ms).toBe(2000);
      } finally {
        await unlinkedServer.stop();
        unlinkedServer.dispose();
      }
    });

    it("returns 503 when upstream port is set but upstream server is unreachable", async () => {
      const deadPortDiscovery = new PortDiscoveryService({
        initialPort: 65530, // Unassigned port
        logPath: path.join(tempDir, "dead.log"),
      });

      const deadServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1" },
        portDiscovery: deadPortDiscovery,
      });

      const st = await deadServer.start();
      try {
        const res = await fetch(`http://127.0.0.1:${st.port}/`);
        expect(res.status).toBe(503);
        const body = (await res.json()) as any;
        expect(body.error).toBe("upstream_unavailable");
      } finally {
        await deadServer.stop();
        deadServer.dispose();
      }
    });
  });

  describe("WebSocket Reverse Proxying and CSRF Verification", () => {
    it("upgrades /connect-websocket, forwards CSRF token, and bridges bidirectional frames", async () => {
      const csrfToken = mockUpstream.getCsrfToken();

      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.send("ping-frame-1");
        });

        ws.on("message", (data) => {
          expect(data.toString()).toBe("ping-frame-1");
          ws.close();
          resolve();
        });

        ws.on("error", reject);
      });

      // Assert upstream recorded the CSRF header
      expect(mockUpstream.recordedWsHeaders).toHaveLength(1);
      expect(mockUpstream.recordedWsHeaders[0]["x-codeium-csrf-token"]).toBe(
        csrfToken,
      );
      expect(mockUpstream.recordedWsMessages).toContain("ping-frame-1");
    });

    it("rejects connection when CSRF token is invalid according to upstream validation", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": "wrong-token",
          },
        },
      );

      await new Promise<void>((resolve) => {
        ws.on("close", (code) => {
          expect(code).toBe(1011);
          resolve();
        });
        ws.on("error", () => {
          // Expected close error on 403 upgrade failure
        });
      });
    });

    it("propagates close frames from downstream client to upstream server within 1 second", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: { "x-codeium-csrf-token": mockUpstream.getCsrfToken() },
        },
      );

      await new Promise<void>((resolve) => {
        ws.on("open", () => {
          // Send close from client
          ws.close(1000, "Client normal exit");
        });

        const checkUpstreamClosed = setInterval(() => {
          if (mockUpstream.connectedSockets.size === 0) {
            clearInterval(checkUpstreamClosed);
            resolve();
          }
        }, 50);

        setTimeout(() => {
          clearInterval(checkUpstreamClosed);
          resolve();
        }, 1000);
      });

      expect(mockUpstream.connectedSockets.size).toBe(0);
    });

    it("propagates close frames from upstream server to downstream client within 1 second", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: { "x-codeium-csrf-token": mockUpstream.getCsrfToken() },
        },
      );

      await new Promise<void>((resolve, reject) => {
        // Send a frame on open to ensure upstream bridge is active
        ws.on("open", () => {
          ws.send("ready-check");
        });

        // Poll until mockUpstream has the connected socket
        const checkInterval = setInterval(() => {
          if (mockUpstream.connectedSockets.size > 0) {
            clearInterval(checkInterval);
            for (const s of mockUpstream.connectedSockets) {
              s.close(1000, "Upstream closed");
            }
          }
        }, 20);

        ws.on("close", (code) => {
          clearInterval(checkInterval);
          expect(code).toBe(1000);
          resolve();
        });

        ws.on("error", (err) => {
          clearInterval(checkInterval);
          reject(err);
        });
      });
    });

    it("returns HTTP 503 when attempting WebSocket upgrade while port is unknown", async () => {
      const noPortServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1" },
        portDiscovery: new PortDiscoveryService({
          logPath: "/nonexistent/path.log",
        }),
      });

      const st = await noPortServer.start();

      const ws = new WebSocket(`ws://127.0.0.1:${st.port}/connect-websocket`);

      await new Promise<void>((resolve) => {
        ws.on("error", () => {
          resolve();
        });
      });

      await noPortServer.stop();
      noPortServer.dispose();
    });
  });

  describe("Transparent CSRF Token Passthrough", () => {
    it("preserves csrfToken script while injecting auto-reload client script", async () => {
      const proxiedRes = await fetch(`http://127.0.0.1:${relayPort}/`);
      const proxiedHtml = await proxiedRes.text();

      expect(proxiedHtml).toContain(
        `window.__APP_CONFIG__ = {csrfToken: "${mockUpstream.getCsrfToken()}"};`,
      );
      expect(proxiedHtml).toContain('id="antigravity-relay-autoreload"');
      expect(proxiedHtml).toContain("initialPort");
    });

    it("delivers HTML byte-for-byte identical when injectAutoReload is disabled", async () => {
      const rawRelay = new RelayServer({
        config: {
          port: 0,
          host: "127.0.0.1",
          injectAutoReload: false,
        },
        portDiscovery,
      });
      const rawStatus = await rawRelay.start();

      try {
        const directUpstreamRes = await undiciRequest(
          `https://127.0.0.1:${upstreamPort}/`,
          {
            dispatcher: (rawRelay as any).upstreamDispatcher,
          },
        );
        const directHtml = await directUpstreamRes.body.text();

        const proxiedRes = await fetch(`http://127.0.0.1:${rawStatus.port}/`);
        const proxiedHtml = await proxiedRes.text();

        expect(proxiedHtml).toBe(directHtml);
        expect(proxiedHtml).toContain(mockUpstream.getCsrfToken());
      } finally {
        await rawRelay.stop();
        rawRelay.dispose();
      }
    });
  });

  describe("Account Swap Resilience and Port Re-targeting", () => {
    it("detects new port, closes existing WebSockets with code 1012, and proxies to new upstream", async () => {
      // 1. Establish an active WebSocket connection on the initial port
      const clientWs = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: { "x-codeium-csrf-token": mockUpstream.getCsrfToken() },
        },
      );

      await new Promise<void>((resolve) => {
        clientWs.on("open", () => resolve());
      });

      let closeCodeReceived: number | null = null;
      let closeReasonReceived: string | null = null;
      clientWs.on("close", (code, reason) => {
        closeCodeReceived = code;
        closeReasonReceived = reason.toString();
      });

      // 2. Start a new mock upstream server simulating language_server restart
      const secondUpstream = new MockUpstreamServer({
        csrfToken: "new-account-csrf-token-777",
        validateCsrf: true,
      });
      const secondPort = await secondUpstream.start();

      try {
        // 3. Mark port discovery as restarting during gap
        portDiscovery.setRestarting(true);

        // Verify that HTTP requests during the gap return 503 upstream_restarting
        const gapRes = await fetch(`http://127.0.0.1:${relayPort}/api/test`);
        expect(gapRes.status).toBe(503);
        const gapJson = (await gapRes.json()) as any;
        expect(gapJson.error).toBe("upstream_restarting");

        // 4. Update log file with new listen port
        fs.appendFileSync(
          logFilePath,
          `[LOG] account switch restart\nlistening on https://127.0.0.1:${secondPort}/\n`,
          "utf-8",
        );

        // Wait for port discovery to detect the new port
        await new Promise<void>((resolve) => {
          if (portDiscovery.getPort() === secondPort) {
            resolve();
          } else {
            portDiscovery.once("port-changed", () => resolve());
          }
        });

        // 5. Assert that the old WebSocket connection was closed with code 1012 (Service Restart)
        await new Promise<void>((resolve) => {
          if (closeCodeReceived !== null) {
            resolve();
          } else {
            clientWs.once("close", () => resolve());
          }
        });

        expect(closeCodeReceived).toBe(1012);
        expect(closeReasonReceived).toContain("Service Restart");

        // 6. Assert that new HTTP requests receive the new HTML and CSRF token
        const newHtmlRes = await fetch(`http://127.0.0.1:${relayPort}/`);
        expect(newHtmlRes.status).toBe(200);
        const newHtml = await newHtmlRes.text();
        expect(newHtml).toContain('csrfToken: "new-account-csrf-token-777"');

        // 7. Assert that new WebSocket can connect to the new upstream with the new token
        const newWs = new WebSocket(
          `ws://127.0.0.1:${relayPort}/connect-websocket`,
          {
            headers: { "x-codeium-csrf-token": "new-account-csrf-token-777" },
          },
        );

        await new Promise<void>((resolve, reject) => {
          newWs.on("open", () => {
            newWs.send("hello-new-upstream");
          });
          newWs.on("message", (msg) => {
            expect(msg.toString()).toBe("hello-new-upstream");
            newWs.close();
            resolve();
          });
          newWs.on("error", reject);
        });
      } finally {
        await secondUpstream.stop();
      }
    });
  });

  describe("TLS Certificate Security and Scoped Verification Bypass", () => {
    it("does not set NODE_TLS_REJECT_UNAUTHORIZED globally in environment", () => {
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    });

    it("verifies certificates on non-whitelisted dispatchers while proxying localhost self-signed certs", async () => {
      // Localhost self-signed connection through RelayServer reverse proxy succeeds
      const res = await fetch(`http://127.0.0.1:${relayPort}/health`);
      expect(res.status).toBe(200);

      // A direct fetch using standard Node TLS validation against self-signed HTTPS server fails
      let directError: any = null;
      try {
        await fetch(`https://127.0.0.1:${upstreamPort}/`);
      } catch (err) {
        directError = err;
      }

      // Assert standard fetch without custom dispatcher rejected the self-signed cert
      expect(directError).not.toBeNull();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    });
  });

  describe("Non-Proxied Monitoring Endpoints and Server Subsystems", () => {
    it("serves operational health check on /health without proxying upstream", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.status).toBe("healthy");
      expect(json.isRunning).toBe(true);
      expect(json.upstreamPort).toBe(upstreamPort);
    });

    it("serves server status on /api/status without proxying upstream", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/api/status`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.data.isRunning).toBe(true);
      expect(json.data.port).toBe(relayPort);
    });

    it("maintains session management backwards compatibility", async () => {
      const sessionManager = relayServer.getSessionManager();
      const session = sessionManager.createSession();
      expect(session.sessionId).toBeTruthy();

      const listRes = await fetch(`http://127.0.0.1:${relayPort}/api/sessions`);
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as any;
      expect(listJson.data.length).toBeGreaterThan(0);

      const revokeRes = await fetch(
        `http://127.0.0.1:${relayPort}/api/sessions/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
        },
      );
      expect(revokeRes.status).toBe(200);
      const revokeJson = (await revokeRes.json()) as any;
      expect(revokeJson.success).toBe(true);
    });

    it("handles lifecycle stop and dispose cleanly", async () => {
      expect(relayServer.getStatus().isRunning).toBe(true);
      await relayServer.stop();
      expect(relayServer.getStatus().isRunning).toBe(false);
      expect(() => relayServer.dispose()).not.toThrow();
    });
  });

  describe("Phone Session Tracking and Revocation in Reverse Proxy", () => {
    it("registers a phone session on HTTP root request with client IP and User-Agent", async () => {
      const initialCount = relayServer
        .getSessionManager()
        .getActiveSessions().length;
      expect(initialCount).toBe(0);

      const res = await fetch(`http://127.0.0.1:${relayPort}/`, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
          "x-forwarded-for": "192.168.1.55",
        },
      });
      expect(res.status).toBe(200);

      const sessions = relayServer.getSessionManager().getActiveSessions();
      expect(sessions).toHaveLength(1);
      const session = sessions[0];
      expect(session.clientIp).toBe("192.168.1.55");
      expect(session.userAgent).toContain("iPhone");
      expect(session.socketState).toBe("disconnected");
      expect(session.authenticated).toBe(true);
    });

    it("registers a phone session with explicit pairing token from query parameter", async () => {
      const res = await fetch(
        `http://127.0.0.1:${relayPort}/?pair=token-xyz-123`,
        {
          headers: {
            "user-agent": "AndroidPhone/1.0",
          },
        },
      );
      expect(res.status).toBe(200);

      const session = relayServer
        .getSessionManager()
        .getSessionByToken("token-xyz-123");
      expect(session).toBeDefined();
      expect(session?.token).toBe("token-xyz-123");
      expect(session?.userAgent).toBe("AndroidPhone/1.0");
      expect(session?.authenticated).toBe(true);
    });

    it("updates session activity on repeated HTTP requests without creating duplicate sessions", async () => {
      await fetch(`http://127.0.0.1:${relayPort}/?pair=repeat-token`, {
        headers: { "user-agent": "MobileClient/1.0" },
      });
      const firstSession = relayServer
        .getSessionManager()
        .getSessionByToken("repeat-token")!;
      const initialActiveAt = firstSession.lastActiveAt;

      await new Promise((r) => setTimeout(r, 15));

      await fetch(`http://127.0.0.1:${relayPort}/?pair=repeat-token`, {
        headers: { "user-agent": "MobileClient/1.0" },
      });

      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        1,
      );
      const updatedSession = relayServer
        .getSessionManager()
        .getSessionByToken("repeat-token")!;
      expect(updatedSession.lastActiveAt).toBeGreaterThan(initialActiveAt);
    });

    it("registers and binds client WebSocket on /connect-websocket, transitioning socketState to connected", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=ws-session-token`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            "user-agent": "CustomMobileApp/3.0",
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = relayServer
        .getSessionManager()
        .getSessionByToken("ws-session-token");
      expect(session).toBeDefined();
      expect(session?.socketState).toBe("connected");
      expect(session?.userAgent).toBe("CustomMobileApp/3.0");

      ws.close();
      await new Promise<void>((resolve) => ws.on("close", () => resolve()));
    });

    it("updates session lastActiveAt on message frames flowing through WebSocket bridge", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=activity-token`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = relayServer
        .getSessionManager()
        .getSessionByToken("activity-token")!;
      const beforeMessageAt = session.lastActiveAt;

      await new Promise((r) => setTimeout(r, 15));

      await new Promise<void>((resolve, reject) => {
        ws.send("message-from-client");
        ws.on("message", (data) => {
          expect(data.toString()).toBe("message-from-client");
          resolve();
        });
        ws.on("error", reject);
      });

      expect(session.lastActiveAt).toBeGreaterThan(beforeMessageAt);

      ws.close();
      await new Promise<void>((resolve) => ws.on("close", () => resolve()));
    });

    it("transitions session socketState to disconnected when client WebSocket closes", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=disconnect-token`,
        {
          headers: { "x-codeium-csrf-token": csrfToken },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = relayServer
        .getSessionManager()
        .getSessionByToken("disconnect-token")!;
      expect(session.socketState).toBe("connected");

      ws.close(1000, "Normal disconnection");
      await new Promise<void>((resolve) => ws.on("close", () => resolve()));

      await new Promise<void>((resolve) => {
        if (session.socketState === "disconnected") return resolve();
        const check = setInterval(() => {
          if (session.socketState === "disconnected") {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      expect(session.socketState).toBe("disconnected");
      expect(
        relayServer.getSessionManager().getActiveSessions(),
      ).toContainEqual(session);
    });

    it("closes client WebSocket with code 4401 and removes session upon revocation", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=revocation-token`,
        {
          headers: { "x-codeium-csrf-token": csrfToken },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = relayServer
        .getSessionManager()
        .getSessionByToken("revocation-token")!;
      expect(session.socketState).toBe("connected");

      let receivedCloseCode: number | null = null;
      let receivedCloseReason: string | null = null;

      const closePromise = new Promise<void>((resolve) => {
        ws.on("close", (code, reason) => {
          receivedCloseCode = code;
          receivedCloseReason = reason.toString();
          resolve();
        });
      });

      const revoked = relayServer
        .getSessionManager()
        .revokeSession(session.sessionId);
      expect(revoked).toBe(true);

      await closePromise;
      expect(receivedCloseCode).toBe(4401);
      expect(receivedCloseReason).toBe("Session revoked");

      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        0,
      );
      expect(
        relayServer.getSessionManager().getSession(session.sessionId),
      ).toBeUndefined();
    });

    it("supports multiple concurrent phone sessions independently", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const ws1 = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=phone-1`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            "user-agent": "Phone1",
          },
        },
      );
      const ws2 = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket?pair=phone-2`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            "user-agent": "Phone2",
          },
        },
      );

      await Promise.all([
        new Promise<void>((r, rej) => {
          ws1.on("open", () => r());
          ws1.on("error", rej);
        }),
        new Promise<void>((r, rej) => {
          ws2.on("open", () => r());
          ws2.on("error", rej);
        }),
      ]);

      const active = relayServer.getSessionManager().getActiveSessions();
      expect(active).toHaveLength(2);

      const session1 = relayServer
        .getSessionManager()
        .getSessionByToken("phone-1")!;
      const session2 = relayServer
        .getSessionManager()
        .getSessionByToken("phone-2")!;
      expect(session1.socketState).toBe("connected");
      expect(session2.socketState).toBe("connected");

      const closePromise1 = new Promise<number>((resolve) => {
        ws1.on("close", (code) => resolve(code));
      });
      relayServer.getSessionManager().revokeSession(session1.sessionId);
      const closeCode1 = await closePromise1;
      expect(closeCode1).toBe(4401);

      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        1,
      );
      expect(session2.socketState).toBe("connected");

      ws2.close();
      await new Promise<void>((r) => ws2.on("close", () => r()));
    });
  });

  describe("Auto-Reload Script Injection & Client State Synchronization", () => {
    it("generates auto reload script containing port and epoch", () => {
      const script = generateAutoReloadScript(54518, 3);
      expect(script).toContain('id="antigravity-relay-autoreload"');
      expect(script).toContain("initialPort = 54518");
      expect(script).toContain("initialEpoch = 3");
      expect(script).toContain("/health");
      expect(script).toContain("window.location.reload()");
    });

    it("handles null upstream port in generated script", () => {
      const script = generateAutoReloadScript(null, 0);
      expect(script).toContain("initialPort = null");
      expect(script).toContain("initialEpoch = 0");
    });

    it("exposes upstreamEpoch and isRestarting in /health endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.status).toBe("healthy");
      expect(json.upstreamPort).toBe(upstreamPort);
      expect(typeof json.upstreamEpoch).toBe("number");
      expect(typeof json.isRestarting).toBe("boolean");
    });

    it("increments upstreamEpoch when port changes", async () => {
      const initialStatus = relayServer.getStatus();
      const initialEpoch = initialStatus.upstreamEpoch ?? 0;

      const newPort = 59999;
      portDiscovery.setPort(newPort);

      const updatedStatus = relayServer.getStatus();
      expect(updatedStatus.upstreamPort).toBe(newPort);
      expect(updatedStatus.upstreamEpoch).toBe(initialEpoch + 1);

      const healthRes = await fetch(`http://127.0.0.1:${relayPort}/health`);
      const healthJson = (await healthRes.json()) as any;
      expect(healthJson.upstreamEpoch).toBe(initialEpoch + 1);
      expect(healthJson.upstreamPort).toBe(newPort);
    });
  });
});
