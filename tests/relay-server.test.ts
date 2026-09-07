import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import { RelayServer } from "../src/main/relay/relay-server";
import { SessionManager } from "../src/main/relay/session-manager";
import {
  UpstreamBridge,
  UpstreamTransport,
} from "../src/main/relay/upstream-bridge";

class MockUpstreamTransport implements UpstreamTransport {
  public isConnected = true;
  public sentMessages: string[] = [];
  public messageHandlers: Set<(data: string) => void> = new Set();
  public closeHandlers: Set<(code: number, reason: string) => void> = new Set();
  public errorHandlers: Set<(err: Error) => void> = new Set();

  public async connect(_url: string): Promise<void> {
    this.isConnected = true;
  }

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(): void {
    this.isConnected = false;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public onMessage(callback: (data: string) => void): void {
    this.messageHandlers.add(callback);
  }

  public onClose(callback: (code: number, reason: string) => void): void {
    this.closeHandlers.add(callback);
  }

  public onError(callback: (err: Error) => void): void {
    this.errorHandlers.add(callback);
  }
}

describe("Fastify Relay Server & WebSocket Companion Interface", () => {
  let server: RelayServer;
  let sessionManager: SessionManager;
  let upstreamBridge: UpstreamBridge;
  let mockTransport: MockUpstreamTransport;
  let testPort: number;

  beforeEach(() => {
    sessionManager = new SessionManager();
    mockTransport = new MockUpstreamTransport();
    upstreamBridge = new UpstreamBridge({
      sessionManager,
      autoReconnect: false,
      transportFactory: () => mockTransport,
    });

    server = new RelayServer({
      config: {
        port: 0,
        host: "127.0.0.1",
      },
      sessionManager,
      upstreamBridge,
    });
  });

  afterEach(async () => {
    await server.stop();
    server.dispose();
  });

  describe("HTTP Routes & Lifecycle", () => {
    it("should start Fastify server and respond to /health endpoint", async () => {
      const status = await server.start();
      testPort = status.port;
      expect(server.getStatus().isRunning).toBe(true);

      const res = await fetch(`http://127.0.0.1:${testPort}/health`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.status).toBe("healthy");
      expect(body.isRunning).toBe(true);
    });

    it("should serve status and active sessions via REST", async () => {
      sessionManager.createSession({ clientIp: "10.0.0.1" });
      const status = await server.start();
      testPort = status.port;

      const statusRes = await fetch(`http://127.0.0.1:${testPort}/api/status`);
      const statusBody = (await statusRes.json()) as any;
      expect(statusBody.success).toBe(true);
      expect(statusBody.data.activeSessions).toBe(1);

      const sessionsRes = await fetch(
        `http://127.0.0.1:${testPort}/api/sessions`,
      );
      const sessionsBody = (await sessionsRes.json()) as any;
      expect(sessionsBody.success).toBe(true);
      expect(sessionsBody.data).toHaveLength(1);
    });

    it("should revoke session via POST /api/sessions/revoke", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      const revokeRes = await fetch(
        `http://127.0.0.1:${testPort}/api/sessions/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
        },
      );

      const body = (await revokeRes.json()) as any;
      expect(body.success).toBe(true);
      expect(sessionManager.getSession(session.sessionId)).toBeUndefined();
    });

    it("should validate required payload on /api/sessions/revoke", async () => {
      const status = await server.start();
      testPort = status.port;

      const res = await fetch(
        `http://127.0.0.1:${testPort}/api/sessions/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
    });
  });

  describe("WebSocket Authentication & Communication", () => {
    it("should reject connection attempts without an auth token", async () => {
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
        ws.on("close", (code) => {
          expect(code).toBe(1008);
          resolve();
        });
      });
    });

    it("should reject connection attempts with an invalid token", async () => {
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=invalid-secret`,
        );
        ws.on("close", (code) => {
          expect(code).toBe(1008);
          resolve();
        });
      });
    });

    it("should establish pairing session via ?pair=<key>", async () => {
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?pair=quick-pair-key-123`,
        );
        ws.on("open", () => {
          expect(sessionManager.getActiveSessions()).toHaveLength(1);
          expect(sessionManager.getActiveSessions()[0].token).toBe(
            "quick-pair-key-123",
          );
          expect(sessionManager.getActiveSessions()[0].socketState).toBe(
            "connected",
          );
          ws.close();
          resolve();
        });
      });
    });

    it("should accept connection with valid session token and forward commands", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;
      await upstreamBridge.connect();

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("open", () => {
          expect(session.socketState).toBe("connected");

          // Send action approval command
          ws.send(
            JSON.stringify({
              type: "APPROVE_ACTION",
              payload: { actionId: "act-99" },
            }),
          );

          setTimeout(() => {
            expect(mockTransport.sentMessages).toHaveLength(1);
            const msg = JSON.parse(mockTransport.sentMessages[0]);
            expect(msg.type).toBe("APPROVE_ACTION");
            expect(msg.payload).toEqual({ actionId: "act-99" });
            ws.close();
            resolve();
          }, 50);
        });
      });
    });

    it("should buffer commands and respond with BUFFERED_ACK when upstream is buffering", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;
      upstreamBridge.enterBuffering("Account swap in progress");

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "BUFFERED_ACK") {
            expect(parsed.payload.status).toBe("queued");
            expect(parsed.payload.commandId).toBeDefined();
            expect(sessionManager.getBufferedCount()).toBe(1);
            ws.close();
            resolve();
          }
        });

        ws.on("open", () => {
          ws.send(
            JSON.stringify({
              type: "PROMPT",
              payload: { text: "Run tests" },
            }),
          );
        });
      });
    });

    it("should broadcast events to connected clients", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "AGENT_STATE") {
            expect(parsed.payload.status).toBe("thinking");
            ws.close();
            resolve();
          }
        });

        ws.on("open", () => {
          server.broadcastToClients({
            type: "AGENT_STATE",
            payload: { status: "thinking" },
            timestamp: Date.now(),
          });
        });
      });
    });

    it("should respond with ERROR payload on invalid JSON", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "ERROR") {
            expect(parsed.payload.error).toContain("Invalid JSON payload");
            ws.close();
            resolve();
          }
        });

        ws.on("open", () => {
          ws.send("NOT_JSON_DATA{{{");
        });
      });
    });

    it("should respond with ERROR payload when upstream sendCommand returns error", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      vi.spyOn(upstreamBridge, "sendCommand").mockResolvedValueOnce({
        forwarded: false,
        buffered: false,
        error: "BUFFER_FULL: Queue full",
      });

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "ERROR") {
            expect(parsed.payload.error).toBe("BUFFER_FULL: Queue full");
            ws.close();
            resolve();
          }
        });

        ws.on("open", () => {
          ws.send(
            JSON.stringify({ type: "PROMPT", payload: { text: "overflow" } }),
          );
        });
      });
    });

    it("should reject connection when IP is rate limited", async () => {
      const status = await server.start();
      testPort = status.port;

      // Exhaust rate limiter
      const rateLimiter = (server as any).rateLimiter;
      for (let i = 0; i < 6; i++) {
        rateLimiter.recordFailure("127.0.0.1");
      }

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=valid-or-not`,
        );
        ws.on("close", (code, reason) => {
          expect(code).toBe(1008);
          expect(reason.toString()).toContain("Authentication rate limited");
          resolve();
        });
      });
    });

    it("should handle start() when already running and stop() when stopped", async () => {
      const s1 = await server.start();
      const s2 = await server.start();
      expect(s1.isRunning).toBe(true);
      expect(s2.isRunning).toBe(true);

      await server.stop();
      await expect(server.stop()).resolves.toBeUndefined();
    });

    it("should distribute agent output received from upstream bridge", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );

        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "AGENT_OUTPUT") {
            expect(parsed.payload.text).toBe("Agent working");
            ws.close();
            resolve();
          }
        });

        ws.on("open", () => {
          // Trigger bridge message handler
          for (const handler of (mockTransport as any).messageHandlers) {
            handler(JSON.stringify({ text: "Agent working" }));
          }
        });
      });
    });

    it("should suppress listener callback errors on status updates", async () => {
      server.onStatusUpdated(() => {
        throw new Error("Broken status listener");
      });
      expect(() => (server as any).notifyStatusUpdated()).not.toThrow();
    });

    it("should distribute SWAP_RESUMED event to clients", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );
        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "SWAP_RESUMED") {
            ws.close();
            resolve();
          }
        });
        ws.on("open", () => {
          (upstreamBridge as any).swapResumedListeners.forEach((l: any) => l());
        });
      });
    });

    it("should distribute raw string agent output from upstream bridge", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );
        ws.on("message", (raw) => {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === "AGENT_OUTPUT") {
            expect(parsed.payload.text).toBe("Raw stream chunk");
            ws.close();
            resolve();
          }
        });
        ws.on("open", () => {
          (upstreamBridge as any).messageListeners.forEach((l: any) =>
            l("Raw stream chunk"),
          );
        });
      });
    });

    it("should suppress error when client socket.send throws on broadcast", async () => {
      const session = sessionManager.createSession();
      const faultySocket = {
        readyState: 1,
        send: vi.fn().mockImplementation(() => {
          throw new Error("Broken pipe");
        }),
      } as any;
      sessionManager.bindSocket(session.sessionId, faultySocket);

      expect(() => {
        server.broadcastToClients({
          type: "AGENT_STATE",
          payload: {},
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });

    it("should allow unsubscribing from status listener", () => {
      const listener = vi.fn();
      const unsub = server.onStatusUpdated(listener);
      (server as any).notifyStatusUpdated();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      (server as any).notifyStatusUpdated();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should apply host override when provided on start", async () => {
      const status = await server.start({ host: "127.0.0.1", port: 0 });
      expect(status.isRunning).toBe(true);
    });

    it("should authenticate websocket using sec-websocket-protocol header", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`, [
          session.token,
        ]);
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", reject);
      });
    });

    it("should handle client socket error event and unbind socket", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );
        ws.on("open", () => {
          const serverSocket = sessionManager.getSocket(session.sessionId);
          expect(serverSocket).toBeDefined();
          (serverSocket as any).emit("error", new Error("Client socket error"));
          expect(sessionManager.getSocket(session.sessionId)).toBeUndefined();
          ws.close();
          resolve();
        });
      });
    });

    it("should initialize with default config and support port overrides on start", async () => {
      const defaultServer = new RelayServer();
      expect(defaultServer.getStatus().port).toBe(4040);
      expect(defaultServer.getSessionManager()).toBeDefined();
      expect(defaultServer.getUpstreamBridge()).toBeDefined();
      defaultServer.dispose();

      const overrideServer = new RelayServer();
      const status = await overrideServer.start({ port: 5678 });
      expect(status.isRunning).toBe(true);
      expect(status.port).toBe(5678);
      await overrideServer.stop();
      overrideServer.dispose();
    });

    it("should suppress error if socket.send throws on initial buffering alert", async () => {
      const session = sessionManager.createSession();
      const status = await server.start();
      testPort = status.port;
      upstreamBridge.enterBuffering("Testing alert error");

      const origBind = sessionManager.bindSocket.bind(sessionManager);
      vi.spyOn(sessionManager, "bindSocket").mockImplementationOnce(
        (id: string, sock: any) => {
          origBind(id, sock);
          vi.spyOn(sock, "send").mockImplementationOnce(() => {
            throw new Error("Simulated send crash");
          });
        },
      );

      await new Promise<void>((resolve) => {
        const ws = new WebSocket(
          `ws://127.0.0.1:${testPort}/ws?token=${session.token}`,
        );
        ws.on("open", () => {
          ws.close();
          resolve();
        });
        ws.on("error", () => {
          resolve();
        });
      });
    });

    it("should suppress error if app.close throws during server stop", async () => {
      await server.start();
      vi.spyOn((server as any).app, "close").mockRejectedValueOnce(
        new Error("Failed to close"),
      );
      await expect(server.stop()).resolves.toBeUndefined();
      expect(server.getStatus().isRunning).toBe(false);
    });
  });
});
