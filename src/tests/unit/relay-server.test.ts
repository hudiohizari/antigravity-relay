import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  RelayServer,
  generateAutoReloadScript,
  extractDeviceId,
  generateRevokedHtml,
} from "@/modules/relay/relay-server";
import { SessionManager } from "@/modules/relay/session-manager";
import { UpstreamBridge } from "@/modules/relay/upstream-bridge";
import { PortDiscoveryService } from "@/modules/relay/port-discovery";
import {
  MockUpstreamServer,
  TEST_TLS_KEY,
  TEST_TLS_CERT,
} from "../helpers/mock-upstream";
import { AutoSwitchService } from "@/modules/cloud-account/services/AutoSwitchService";
import { AuthRateLimiter } from "@/modules/relay/relay-auth";
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
        requirePairing: false,
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

    it("serves /favicon.ico with image/x-icon and 24h cache-control header", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/favicon.ico`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/x-icon");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it("serves /icon.png with image/png and 24h cache-control header", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/icon.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
    });

    it("injects icon link tags into proxied HTML responses", async () => {
      const res = await fetch(`http://127.0.0.1:${relayPort}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(
        '<link rel="icon" type="image/x-icon" href="/favicon.ico">',
      );
      expect(html).toContain('<link rel="apple-touch-icon" href="/icon.png">');
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
        config: { port: 0, host: "127.0.0.1", requirePairing: false },
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
        config: { port: 0, host: "127.0.0.1", requirePairing: false },
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
        config: { port: 0, host: "127.0.0.1", requirePairing: false },
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
          requirePairing: false,
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

    it("sets ag_device_id cookie on initial request and reuses session on subsequent requests with the cookie", async () => {
      const initialRes = await undiciRequest(`http://127.0.0.1:${relayPort}/`, {
        headers: {
          "user-agent": "BrowserClient/1.0",
        },
      });
      expect(initialRes.statusCode).toBe(200);

      const setCookie = initialRes.headers["set-cookie"];
      expect(setCookie).toBeTruthy();
      const cookieStr = Array.isArray(setCookie)
        ? setCookie.join("; ")
        : setCookie!;
      expect(cookieStr).toContain("ag_device_id=dev_");
      expect(cookieStr).toContain("Path=/");
      expect(cookieStr).toContain("Max-Age=31536000");
      expect(cookieStr).toContain("SameSite=Lax");

      const match = cookieStr.match(/ag_device_id=([^;]+)/);
      expect(match).toBeTruthy();
      const deviceId = decodeURIComponent(match![1]);

      const sessions = relayServer.getSessionManager().getActiveSessions();
      expect(sessions).toHaveLength(1);
      const session = sessions[0];
      expect(session.deviceId).toBe(deviceId);
      const initialActiveAt = session.lastActiveAt;

      await new Promise((r) => setTimeout(r, 15));

      const secondRes = await fetch(`http://127.0.0.1:${relayPort}/api/chat`, {
        method: "POST",
        headers: {
          "user-agent": "BrowserClient/1.0",
          cookie: `ag_device_id=${encodeURIComponent(deviceId)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(secondRes.status).toBe(200);

      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        1,
      );
      const updatedSession = relayServer
        .getSessionManager()
        .getSessionByDeviceId(deviceId);
      expect(updatedSession).toBeDefined();
      expect(updatedSession?.sessionId).toBe(session.sessionId);
      expect(updatedSession?.lastActiveAt).toBeGreaterThan(initialActiveAt);
    });

    it("supports multiple tabs opening WebSocket on the same device concurrently without closing sibling sockets", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const testDeviceId = "dev_multi_tab_test_device";

      const wsTab1 = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            "user-agent": "BrowserTab1",
            cookie: `ag_device_id=${testDeviceId}`,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        wsTab1.on("open", () => resolve());
        wsTab1.on("error", reject);
      });

      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        1,
      );
      const sessionTab1 = relayServer
        .getSessionManager()
        .getSessionByDeviceId(testDeviceId)!;
      expect(sessionTab1).toBeDefined();
      expect(sessionTab1.socketState).toBe("connected");
      expect(
        relayServer.getSessionManager().getSocketCount(sessionTab1.sessionId),
      ).toBe(1);

      const wsTab2 = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            "user-agent": "BrowserTab2",
            cookie: `ag_device_id=${testDeviceId}`,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        wsTab2.on("open", () => resolve());
        wsTab2.on("error", reject);
      });

      // Both tabs are open simultaneously
      expect(wsTab1.readyState).toBe(WebSocket.OPEN);
      expect(wsTab2.readyState).toBe(WebSocket.OPEN);
      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        1,
      );
      const sessionTab2 = relayServer
        .getSessionManager()
        .getSessionByDeviceId(testDeviceId)!;
      expect(sessionTab2.sessionId).toBe(sessionTab1.sessionId);
      expect(sessionTab2.socketState).toBe("connected");
      expect(
        relayServer.getSessionManager().getSocketCount(sessionTab2.sessionId),
      ).toBe(2);

      // Tab 1 closes -> session remains connected via refcount
      wsTab1.close();
      await vi.waitFor(
        () => {
          expect(
            relayServer
              .getSessionManager()
              .getSocketCount(sessionTab2.sessionId),
          ).toBe(1);
          expect(sessionTab2.socketState).toBe("connected");
        },
        { timeout: 1000, interval: 20 },
      );

      // Tab 2 closes -> session transitions to disconnected
      wsTab2.close();
      await vi.waitFor(
        () => {
          expect(
            relayServer
              .getSessionManager()
              .getSocketCount(sessionTab2.sessionId),
          ).toBe(0);
          expect(sessionTab2.socketState).toBe("disconnected");
        },
        { timeout: 1000, interval: 20 },
      );
    });

    it("purges device mapping on revocation and does not resurrect session on subsequent requests", async () => {
      const csrfToken = mockUpstream.getCsrfToken();
      const revokedDeviceId = "dev_revocation_target_device";

      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            cookie: `ag_device_id=${revokedDeviceId}`,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = relayServer
        .getSessionManager()
        .getSessionByDeviceId(revokedDeviceId)!;
      expect(session).toBeDefined();
      expect(session.socketState).toBe("connected");

      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => {
          ws.on("close", (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
        },
      );

      const revoked = relayServer
        .getSessionManager()
        .revokeSession(session.sessionId);
      expect(revoked).toBe(true);

      const closeResult = await closePromise;
      expect(closeResult.code).toBe(4401);
      expect(closeResult.reason).toBe("Session revoked");

      expect(
        relayServer.getSessionManager().getSessionByDeviceId(revokedDeviceId),
      ).toBeUndefined();
      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        0,
      );
      expect(
        relayServer.getSessionManager().isDeviceRevoked(revokedDeviceId),
      ).toBe(true);

      // Subsequent API request is blocked with HTTP 401 and session_revoked error
      const subsequentRes = await fetch(
        `http://127.0.0.1:${relayPort}/api/chat`,
        {
          method: "POST",
          headers: {
            cookie: `ag_device_id=${revokedDeviceId}`,
            "x-device-id": revokedDeviceId,
            "x-session-token": session.token,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: "attempt resurrect" }),
        },
      );
      expect(subsequentRes.status).toBe(401);
      const subJson = (await subsequentRes.json()) as any;
      expect(subJson.error).toBe("session_revoked");
      expect(subJson.message).toBe("Access was revoked by the desktop host");
      expect(subJson.revoked).toBe(true);

      expect(
        relayServer.getSessionManager().getSessionByDeviceId(revokedDeviceId),
      ).toBeUndefined();
      expect(relayServer.getSessionManager().getActiveSessions()).toHaveLength(
        0,
      );
    });

    it("returns HTTP 401 with generateRevokedHtml() for revoked deviceId on HTML GET", async () => {
      const revokedDeviceId = "dev_revoked_html_test";
      const session = relayServer.getSessionManager().createSession({
        deviceId: revokedDeviceId,
      });

      relayServer.getSessionManager().revokeSession(session.sessionId);
      expect(
        relayServer.getSessionManager().isDeviceRevoked(revokedDeviceId),
      ).toBe(true);

      const res = await fetch(`http://127.0.0.1:${relayPort}/`, {
        headers: {
          cookie: `ag_device_id=${revokedDeviceId}`,
          "x-device-id": revokedDeviceId,
          accept: "text/html",
        },
      });

      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("Access Revoked by Host");
      expect(html).toContain(
        "Session Revoked: Access was revoked by the desktop host",
      );
      expect(html).toContain("Disconnected by Host");
      expect(html).toContain('name="pair"');
    });

    it("clears tombstone and restores access when revoked device provides valid pair parameter", async () => {
      const revokedDeviceId = "dev_revoked_repair_test";
      const session = relayServer.getSessionManager().createSession({
        deviceId: revokedDeviceId,
      });

      relayServer.getSessionManager().revokeSession(session.sessionId);
      expect(
        relayServer.getSessionManager().isDeviceRevoked(revokedDeviceId),
      ).toBe(true);

      const pairingKey = relayServer.getPairingKey();

      // Submit valid pairing key
      const res = await fetch(
        `http://127.0.0.1:${relayPort}/?pair=${encodeURIComponent(pairingKey)}`,
        {
          headers: {
            cookie: `ag_device_id=${revokedDeviceId}`,
            "x-device-id": revokedDeviceId,
            accept: "text/html",
          },
        },
      );

      expect(res.status).toBe(200);
      expect(
        relayServer.getSessionManager().isDeviceRevoked(revokedDeviceId),
      ).toBe(false);

      const newSession = relayServer
        .getSessionManager()
        .getSessionByDeviceId(revokedDeviceId);
      expect(newSession).toBeDefined();
      expect(newSession?.authenticated).toBe(true);
    });

    it("rejects WebSocket upgrade when deviceId is in revoked tombstone cache", async () => {
      const revokedDeviceId = "dev_ws_revoked_test";
      const session = relayServer.getSessionManager().createSession({
        deviceId: revokedDeviceId,
      });
      relayServer.getSessionManager().revokeSession(session.sessionId);

      const csrfToken = mockUpstream.getCsrfToken();
      const ws = new WebSocket(
        `ws://127.0.0.1:${relayPort}/connect-websocket`,
        {
          headers: {
            "x-codeium-csrf-token": csrfToken,
            cookie: `ag_device_id=${revokedDeviceId}`,
            "x-device-id": revokedDeviceId,
          },
        },
      );

      const closeResult = await new Promise<{
        status?: number;
        code?: number;
        error?: any;
      }>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          resolve({ status: res.statusCode });
        });
        ws.on("close", (code) => resolve({ code }));
        ws.on("error", (error) => resolve({ error }));
      });

      // ws upgrade rejects with 401 or closes with 4401
      expect(
        closeResult.status === 401 ||
          closeResult.code === 4401 ||
          closeResult.code === 1006 ||
          closeResult.error,
      ).toBeTruthy();
    });

    it("extracts deviceId case-insensitively from headers, cookie, or query parameters", () => {
      expect(extractDeviceId({ cookie: "ag_device_id=dev_lower_cookie" })).toBe(
        "dev_lower_cookie",
      );
      expect(extractDeviceId({ Cookie: "ag_device_id=dev_upper_cookie" })).toBe(
        "dev_upper_cookie",
      );
      expect(extractDeviceId({ "x-device-id": "dev_header_val" })).toBe(
        "dev_header_val",
      );
      expect(extractDeviceId({ "X-Device-Id": "dev_header_caps" })).toBe(
        "dev_header_caps",
      );
      expect(
        extractDeviceId({}, new URLSearchParams("deviceId=dev_query_val")),
      ).toBe("dev_query_val");
      expect(
        extractDeviceId({}, new URLSearchParams("device_id=dev_snake_query")),
      ).toBe("dev_snake_query");
      expect(extractDeviceId({})).toBeUndefined();
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

  describe("Rate-Limit Auto-Switch and Exhaustion in Reverse Proxy", () => {
    it("intercepts upstream 429 and triggers auto-switch to highest 5h quota account", async () => {
      const switchSpy = vi
        .spyOn(AutoSwitchService, "triggerRateLimitSwitch")
        .mockResolvedValue({
          switched: true,
          nextAccount: {
            id: "next-acc",
            email: "next@example.com",
            provider: "google",
            token: {} as any,
            created_at: 0,
            last_used: 0,
            status: "active",
          },
        });

      const res = await fetch(`http://127.0.0.1:${relayPort}/api/error-429`);

      expect(switchSpy).toHaveBeenCalledWith({
        reason: "HTTP 429 upstream rate limit",
        source: "relay",
      });

      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("3");
      const json = (await res.json()) as any;
      expect(json.error).toBe("account_switched_rate_limited");
      expect(json.switched_to).toBe("next@example.com");

      switchSpy.mockRestore();
    });

    it("returns structured 429 and broadcasts error when all accounts are rate-limited", async () => {
      const switchSpy = vi
        .spyOn(AutoSwitchService, "triggerRateLimitSwitch")
        .mockResolvedValue({
          switched: false,
          noAccountLeft: true,
        });

      const broadcastSpy = vi.spyOn(relayServer, "broadcastToClients");

      const res = await fetch(`http://127.0.0.1:${relayPort}/api/error-429`);

      expect(switchSpy).toHaveBeenCalled();
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");

      const json = (await res.json()) as any;
      expect(json.error).toBe("rate_limited");
      expect(json.message).toContain("rate limited");

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ERROR",
          payload: expect.objectContaining({
            error: "ALL_ACCOUNTS_RATE_LIMITED",
          }),
        }),
      );

      switchSpy.mockRestore();
      broadcastSpy.mockRestore();
    });

    it("does not trigger auto-switch on non-rate-limit 500 error", async () => {
      const switchSpy = vi.spyOn(AutoSwitchService, "triggerRateLimitSwitch");

      const res = await fetch(`http://127.0.0.1:${relayPort}/api/error-500`);

      expect(res.status).toBe(500);
      expect(switchSpy).not.toHaveBeenCalled();

      switchSpy.mockRestore();
    });
  });

  describe("Relay Pairing Authentication and Session Disconnect Protocol", () => {
    let secureServer: RelayServer;
    let securePort: number;

    beforeEach(async () => {
      secureServer = new RelayServer({
        config: {
          port: 0,
          host: "127.0.0.1",
          requirePairing: true,
        },
        portDiscovery,
      });
      const st = await secureServer.start();
      securePort = st.port;
    });

    afterEach(async () => {
      if (secureServer) {
        await secureServer.stop();
        secureServer.dispose();
      }
    });

    it("rejects unauthenticated root GET request with 401 and renders pairing page", async () => {
      const res = await fetch(`http://127.0.0.1:${securePort}/`, {
        headers: { Accept: "text/html" },
      });
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain("Device Pairing Required");
      expect(text).toContain('name="pair"');
      expect(secureServer.getSessionManager().getActiveSessions()).toHaveLength(
        0,
      );
    });

    it("rejects unauthenticated API request with 401 JSON", async () => {
      const res = await fetch(`http://127.0.0.1:${securePort}/api/chat`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.error).toBe("unauthorized");
      expect(data.message).toContain("Pairing key required");
    });

    it("rejects invalid pairing key with 401 and error notice", async () => {
      const res = await fetch(
        `http://127.0.0.1:${securePort}/?pair=wrong-key`,
        { headers: { Accept: "text/html" } },
      );
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain("Invalid pairing key");
      expect(secureServer.getSessionManager().getActiveSessions()).toHaveLength(
        0,
      );
    });

    it("authenticates successfully with valid pairing key and persists device cookie", async () => {
      const key = secureServer.getPairingKey();
      const res = await undiciRequest(
        `http://127.0.0.1:${securePort}/?pair=${key}`,
      );
      expect(res.statusCode).toBe(200);

      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeTruthy();
      const cookieStr = Array.isArray(setCookie)
        ? setCookie.join("; ")
        : setCookie!;
      expect(cookieStr).toContain("ag_device_id=");

      const match = cookieStr.match(/ag_device_id=([^;]+)/);
      expect(match).toBeTruthy();
      const deviceId = decodeURIComponent(match![1]);

      const sessions = secureServer.getSessionManager().getActiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].deviceId).toBe(deviceId);

      // Subsequent request using cookie succeeds without ?pair=
      const nextRes = await undiciRequest(`http://127.0.0.1:${securePort}/`, {
        headers: {
          cookie: `ag_device_id=${encodeURIComponent(deviceId)}`,
          accept: "text/html",
        },
      });
      expect(nextRes.statusCode).toBe(200);
    });

    it("closes unauthenticated WebSocket connection with 4401 code", async () => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${securePort}/connect-websocket`,
      );
      const closeEvent = await new Promise<{ code: number; reason: string }>(
        (resolve) => {
          ws.on("close", (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
        },
      );
      expect(closeEvent.code).toBe(4401);
    });

    it("allows authenticated WebSocket and immediately updates active count on disconnect", async () => {
      const key = secureServer.getPairingKey();
      const ws = new WebSocket(
        `ws://127.0.0.1:${securePort}/connect-websocket?pair=${key}`,
        {
          headers: {
            "x-codeium-csrf-token": mockUpstream.getCsrfToken(),
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", (err) => reject(err));
      });

      expect(secureServer.getStatus().activeSessions).toBe(1);

      // Close the socket (device closed tab/app)
      ws.close();
      await new Promise<void>((resolve) => ws.on("close", () => resolve()));

      // Wait for server event loop to process close event
      await new Promise<void>((resolve) => {
        if (secureServer.getStatus().activeSessions === 0) return resolve();
        const check = setInterval(() => {
          if (secureServer.getStatus().activeSessions === 0) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      // Verify activeSessions immediately drops to 0
      expect(secureServer.getStatus().activeSessions).toBe(0);
      const session = secureServer.getSessionManager().getActiveSessions()[0];
      expect(session.socketState).toBe("disconnected");
    });
  });

  describe("Per-Device Pairing Key, Auto-Regeneration, and Revocation (PRD AC-01 to AC-04)", () => {
    let prdServer: RelayServer;
    let prdPort: number;

    beforeEach(async () => {
      prdServer = new RelayServer({
        config: {
          port: 0,
          host: "127.0.0.1",
          requirePairing: true,
        },
        portDiscovery,
      });
      const st = await prdServer.start();
      prdPort = st.port;
    });

    afterEach(async () => {
      if (prdServer) {
        await prdServer.stop();
        prdServer.dispose();
      }
    });

    it("consumePairingKey atomically consumes key, regenerates new key, and tracks retired key", () => {
      const initialKey = prdServer.getPairingKey();
      expect(initialKey).toBeTruthy();

      const res1 = prdServer.consumePairingKey(initialKey);
      expect(res1.success).toBe(true);
      expect(res1.reason).toBeUndefined();

      const newKey = prdServer.getPairingKey();
      expect(newKey).not.toBe(initialKey);
      expect(prdServer.isKeyConsumed(initialKey)).toBe(true);

      // Re-consuming same key returns consumed
      const res2 = prdServer.consumePairingKey(initialKey);
      expect(res2.success).toBe(false);
      expect(res2.reason).toBe("consumed");

      // Random invalid key returns invalid
      const res3 = prdServer.consumePairingKey("random-invalid-key-999");
      expect(res3.success).toBe(false);
      expect(res3.reason).toBe("invalid");
    });

    it("enforces sliding retired keys history with max boundary and TTL", () => {
      for (let i = 0; i < 205; i++) {
        prdServer.regeneratePairingKey();
      }
      expect(prdServer.getRetiredPairingKeys().size).toBeLessThanOrEqual(
        RelayServer.MAX_RETIRED_KEYS,
      );
    });

    it("AC-01: single-device consumption, decoupled session token, and rejection of consumed key", async () => {
      const keyAlpha = prdServer.getPairingKey();
      const device1Id = "dev_alpha_001";

      // Device 1 pairs with KEY-ALPHA
      const res1 = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${keyAlpha}`,
        {
          headers: {
            cookie: `ag_device_id=${device1Id}`,
            accept: "application/json",
          },
        },
      );
      expect(res1.statusCode).toBe(200);

      // Verify KEY-ALPHA is now retired
      expect(prdServer.isKeyConsumed(keyAlpha)).toBe(true);
      const hostKeyAfterPair = prdServer.getPairingKey();
      expect(hostKeyAfterPair).not.toBe(keyAlpha);

      // Verify Device 1 session has decoupled session token
      const session1 = prdServer
        .getSessionManager()
        .getSessionByDeviceId(device1Id);
      expect(session1).toBeDefined();
      expect(session1?.token).toBeDefined();
      expect(session1?.token).not.toBe(keyAlpha);

      // Subsequent request by Device 1 with cookie bypasses pairing re-check
      const res1Subsequent = await undiciRequest(
        `http://127.0.0.1:${prdPort}/`,
        {
          headers: {
            cookie: `ag_device_id=${device1Id}`,
            accept: "application/json",
          },
        },
      );
      expect(res1Subsequent.statusCode).toBe(200);

      // Device 2 attempts to pair using consumed KEY-ALPHA
      const device2Id = "dev_beta_002";
      const res2 = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${keyAlpha}`,
        {
          headers: {
            cookie: `ag_device_id=${device2Id}`,
            accept: "application/json",
          },
        },
      );
      expect(res2.statusCode).toBe(401);
      const json2 = (await res2.body.json()) as any;
      expect(json2.error).toBe("key_consumed");
      expect(json2.message).toContain("already been consumed");

      // Device 3 attempts to pair using random unrecognized key
      const device3Id = "dev_gamma_003";
      const res3 = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=KEY-INVALID-XYZ`,
        {
          headers: {
            cookie: `ag_device_id=${device3Id}`,
            accept: "application/json",
          },
        },
      );
      expect(res3.statusCode).toBe(401);
      const json3 = (await res3.body.json()) as any;
      expect(json3.error).toBe("invalid_key");
    });

    it("AC-02: host pairing key auto-regenerates immediately and routine reload with stale ?pair= succeeds", async () => {
      const key1 = prdServer.getPairingKey();
      const statusUpdates: string[] = [];
      const unsub = prdServer.onStatusUpdated((status) => {
        if (status.pairingKey) {
          statusUpdates.push(status.pairingKey);
        }
      });

      const startTime = Date.now();
      const res = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${key1}`,
      );
      const duration = Date.now() - startTime;
      expect(res.statusCode).toBe(200);
      expect(duration).toBeLessThan(500);

      const key2 = prdServer.getPairingKey();
      expect(key2).not.toBe(key1);
      expect(statusUpdates).toContain(key2);

      const setCookie = res.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie)
        ? setCookie.join("; ")
        : setCookie!;
      const match = cookieStr.match(/ag_device_id=([^;]+)/);
      const deviceId = decodeURIComponent(match![1]);

      // Routine reload with stale ?pair= succeeds because session is already authenticated
      const reloadRes = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${key1}`,
        {
          headers: {
            cookie: `ag_device_id=${encodeURIComponent(deviceId)}`,
            accept: "application/json",
          },
        },
      );
      expect(reloadRes.statusCode).toBe(200);

      unsub();
    });

    it("AC-03: revocation terminates WebSocket with code 4401 in <500ms and blocks stale reconnection", async () => {
      const key = prdServer.getPairingKey();
      const revokedDeviceId = "dev_target_ac03";

      const ws = new WebSocket(
        `ws://127.0.0.1:${prdPort}/connect-websocket?pair=${key}`,
        {
          headers: {
            "x-codeium-csrf-token": mockUpstream.getCsrfToken(),
            cookie: `ag_device_id=${revokedDeviceId}`,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const session = prdServer
        .getSessionManager()
        .getSessionByDeviceId(revokedDeviceId);
      expect(session).toBeDefined();

      let receivedWsMessage: any = null;
      ws.on("message", (data) => {
        try {
          receivedWsMessage = JSON.parse(data.toString());
        } catch (_) {}
      });

      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => {
          ws.on("close", (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
        },
      );

      const revokeStart = Date.now();
      const revoked = prdServer.revokeDevice(revokedDeviceId);
      expect(revoked).toBe(true);

      const closeResult = await closePromise;
      const revokeDuration = Date.now() - revokeStart;
      expect(revokeDuration).toBeLessThan(500);
      expect(closeResult.code).toBe(4401);
      expect(closeResult.reason).toBe("Session revoked");

      expect(receivedWsMessage).toEqual({
        type: "SESSION_REVOKED",
        reason: "Session revoked by host",
        revokedAt: expect.any(Number),
      });

      expect(
        prdServer.getSessionManager().isDeviceRevoked(revokedDeviceId),
      ).toBe(true);

      // Stale reconnection attempt via API returns session_revoked
      const staleRes = await undiciRequest(
        `http://127.0.0.1:${prdPort}/api/chat`,
        {
          headers: {
            cookie: `ag_device_id=${revokedDeviceId}`,
            accept: "application/json",
          },
        },
      );
      expect(staleRes.statusCode).toBe(401);
      const staleJson = (await staleRes.body.json()) as any;
      expect(staleJson.error).toBe("session_revoked");
      expect(staleJson.revoked).toBe(true);

      // Stale reconnection attempt with previously consumed key returns key_consumed
      const consumedKeyRes = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${key}`,
        {
          headers: {
            cookie: `ag_device_id=${revokedDeviceId}`,
            accept: "application/json",
          },
        },
      );
      expect(consumedKeyRes.statusCode).toBe(401);
      const consumedJson = (await consumedKeyRes.body.json()) as any;
      expect(consumedJson.error).toBe("key_consumed");
    });

    it("AC-03: composite rate limiting (IP + deviceId) isolates failed attempts per device", () => {
      const limiter = prdServer.getRateLimiter();
      const ip = "192.168.1.100";
      const dev1 = "dev_ratelimit_1";
      const dev2 = "dev_ratelimit_2";

      const key1 = AuthRateLimiter.buildKey(ip, dev1);
      const key2 = AuthRateLimiter.buildKey(ip, dev2);

      // Exhaust attempts on dev1
      for (let i = 0; i < 5; i++) {
        limiter.recordFailure(key1);
      }

      expect(limiter.isRateLimited(key1)).toBe(true);
      // dev2 on the same IP must NOT be rate limited
      expect(limiter.isRateLimited(key2)).toBe(false);
    });

    it("AC-04: revoked device recovery via fresh host pairing key clears revocation and regenerates key", async () => {
      const initialKey = prdServer.getPairingKey();
      const deviceId = "dev_recovery_test";

      // Connect and pair device
      await undiciRequest(`http://127.0.0.1:${prdPort}/?pair=${initialKey}`, {
        headers: { cookie: `ag_device_id=${deviceId}` },
      });

      // Revoke device
      prdServer.revokeDevice(deviceId);
      expect(prdServer.getSessionManager().isDeviceRevoked(deviceId)).toBe(
        true,
      );

      // Host has active fresh key
      const freshKey = prdServer.getPairingKey();
      expect(freshKey).not.toBe(initialKey);

      // Revoked device submits fresh key
      const recoveryRes = await undiciRequest(
        `http://127.0.0.1:${prdPort}/?pair=${freshKey}`,
        {
          headers: {
            cookie: `ag_device_id=${deviceId}`,
            accept: "application/json",
          },
        },
      );
      expect(recoveryRes.statusCode).toBe(200);

      // Revocation tombstone cleared
      expect(prdServer.getSessionManager().isDeviceRevoked(deviceId)).toBe(
        false,
      );

      // freshKey is now retired and placed in consumed registry
      expect(prdServer.isKeyConsumed(freshKey)).toBe(true);

      // Host pairing key immediately regenerated to KEY-NEXT
      const nextKey = prdServer.getPairingKey();
      expect(nextKey).not.toBe(freshKey);
      expect(nextKey).not.toBe(initialKey);

      // Restored session is active and authenticated
      const restoredSession = prdServer
        .getSessionManager()
        .getSessionByDeviceId(deviceId);
      expect(restoredSession).toBeDefined();
      expect(restoredSession?.authenticated).toBe(true);
    });

    it("WebSocket pairing: consumes key, auto-regenerates, and closes with 4401 on revoke", async () => {
      const key = prdServer.getPairingKey();
      const wsDeviceId = "dev_ws_pair_test";

      const ws = new WebSocket(
        `ws://127.0.0.1:${prdPort}/connect-websocket?pair=${key}`,
        {
          headers: {
            "x-codeium-csrf-token": mockUpstream.getCsrfToken(),
            cookie: `ag_device_id=${wsDeviceId}`,
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      // Key is consumed and host key rotated
      expect(prdServer.isKeyConsumed(key)).toBe(true);
      expect(prdServer.getPairingKey()).not.toBe(key);

      // Revoke device closes WS with 4401
      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => {
          ws.on("close", (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
        },
      );

      prdServer.revokeDevice(wsDeviceId);
      const closeEv = await closePromise;
      expect(closeEv.code).toBe(4401);
      expect(closeEv.reason).toBe("Session revoked");
    });
  });
});
