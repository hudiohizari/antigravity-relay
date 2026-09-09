import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import { SessionManager } from "@/modules/relay/session-manager";
import {
  AuthRateLimiter,
  extractTokenFromQuery,
  extractTokenFromHeader,
} from "@/modules/relay/relay-auth";
import { RelayController } from "@/modules/relay/relay-controller";
import { tunnelRouter } from "@/modules/relay/ipc/router";
import type { TunnelStatus } from "@/modules/tunnel/types";

describe("Relay Subsystems", () => {
  describe("SessionManager", () => {
    let sessionManager: SessionManager;

    beforeEach(() => {
      sessionManager = new SessionManager({
        maxBufferedCommands: 5,
        bufferTtlMs: 200,
      });
    });

    it("creates a valid session with token and sessionId", () => {
      const session = sessionManager.createSession({
        clientIp: "192.168.1.50",
        userAgent: "Mozilla/5.0 iPhone",
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBeTruthy();
      expect(session.token).toBeTruthy();
      expect(session.clientIp).toBe("192.168.1.50");
      expect(session.userAgent).toBe("Mozilla/5.0 iPhone");
      expect(session.connectedAt).toBeGreaterThan(0);
      expect(session.lastActiveAt).toBeGreaterThan(0);
      expect(session.socketState).toBe("disconnected");
    });

    it("retrieves session by token and by id", () => {
      const session = sessionManager.createSession();
      const foundByToken = sessionManager.getSessionByToken(session.token);
      const foundById = sessionManager.getSession(session.sessionId);

      expect(foundByToken).toBeDefined();
      expect(foundByToken?.sessionId).toBe(session.sessionId);
      expect(foundById).toBeDefined();
      expect(foundById?.token).toBe(session.token);
    });

    it("updates session activity with updateSessionActivity", async () => {
      const session = sessionManager.createSession();
      const initialActive = session.lastActiveAt;

      await new Promise((r) => setTimeout(r, 15));
      sessionManager.updateSessionActivity(session.sessionId);

      const updated = sessionManager.getSession(session.sessionId);
      expect(updated?.lastActiveAt).toBeGreaterThan(initialActive);
    });

    it("binds and unbinds socket with state changes", () => {
      const session = sessionManager.createSession();
      const mockSocket = {
        readyState: 1,
        send: () => {},
        close: () => {},
      };

      sessionManager.bindSocket(session.sessionId, mockSocket);
      expect(sessionManager.getSocket(session.sessionId)).toBe(mockSocket);
      expect(sessionManager.getSession(session.sessionId)?.socketState).toBe(
        "connected",
      );

      sessionManager.unbindSocket(session.sessionId);
      expect(sessionManager.getSocket(session.sessionId)).toBeUndefined();
      expect(sessionManager.getSession(session.sessionId)?.socketState).toBe(
        "disconnected",
      );
    });

    it("revokes session and cleans up sockets and buffers", () => {
      const session = sessionManager.createSession();
      sessionManager.bufferMessage(session.sessionId, "TEST_CMD", {
        foo: "bar",
      });
      expect(sessionManager.getActiveSessions().length).toBe(1);

      const revoked = sessionManager.revokeSession(session.sessionId);
      expect(revoked).toBe(true);
      expect(sessionManager.getActiveSessions().length).toBe(0);
      expect(sessionManager.getSession(session.sessionId)).toBeUndefined();
      expect(sessionManager.getSessionByToken(session.token)).toBeUndefined();
      expect(sessionManager.getBufferedMessages().length).toBe(0);
    });

    it("buffers messages and respects capacity and TTL", async () => {
      const session = sessionManager.createSession();

      for (let i = 0; i < 5; i++) {
        const res = sessionManager.bufferMessage(
          session.sessionId,
          `CMD_${i}`,
          { index: i },
        );
        expect(res.buffered).toBe(true);
      }

      // 6th message exceeds maxBufferedCommands (5)
      const overflowRes = sessionManager.bufferMessage(
        session.sessionId,
        "CMD_OVERFLOW",
        {},
      );
      expect(overflowRes.buffered).toBe(false);
      expect(overflowRes.error).toContain("BUFFER_FULL");

      // Wait for TTL (200ms) to expire
      await new Promise((r) => setTimeout(r, 220));
      const expired = sessionManager.pruneExpired();
      expect(expired.length).toBe(5);
      expect(sessionManager.getBufferedMessages().length).toBe(0);
    });
  });

  describe("AuthRateLimiter", () => {
    it("allows attempts within limit and blocks on exceeding", () => {
      const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 10000 });
      const ip = "10.0.0.1";

      expect(limiter.isRateLimited(ip)).toBe(false);
      limiter.recordFailure(ip);
      expect(limiter.isRateLimited(ip)).toBe(false);
      limiter.recordFailure(ip);
      expect(limiter.isRateLimited(ip)).toBe(false);
      limiter.recordFailure(ip);
      expect(limiter.isRateLimited(ip)).toBe(true);

      // Success resets
      limiter.recordSuccess(ip);
      expect(limiter.isRateLimited(ip)).toBe(false);
    });

    it("extracts token from authorization header", () => {
      expect(extractTokenFromHeader("Bearer my-secret-token")).toBe(
        "my-secret-token",
      );
      expect(extractTokenFromHeader("Bearer   spaced-token  ")).toBe(
        "spaced-token",
      );
      expect(extractTokenFromHeader("my-raw-token")).toBe("my-raw-token");
      expect(extractTokenFromHeader(undefined)).toBeNull();
    });

    it("extracts token and pair parameter from URL query string", () => {
      const query1 = extractTokenFromQuery("/?token=abc123xyz");
      expect(query1.token).toBe("abc123xyz");
      expect(query1.pair).toBeUndefined();

      const query2 = extractTokenFromQuery(
        "http://localhost:4040/?pair=my-pair-code",
      );
      expect(query2.pair).toBe("my-pair-code");

      const query3 = extractTokenFromQuery("/ws");
      expect(query3.token).toBeUndefined();
      expect(query3.pair).toBeUndefined();
    });
  });

  describe("RelayController", () => {
    it("provides singleton instance with relayServer and tunnelManager", () => {
      const instance1 = RelayController.getInstance();
      const instance2 = RelayController.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance1.relayServer).toBeDefined();
      expect(instance1.tunnelManager).toBeDefined();
    });
  });

  describe("IPC tunnelRouter and restart", () => {
    it("routes restart call through tunnelManager.restart", async () => {
      const client = createRouterClient(tunnelRouter);
      const controller = RelayController.getInstance();
      const mockStatus: TunnelStatus = {
        state: "connected",
        publicUrl: "https://ipc-restart.trycloudflare.com",
        pid: 77777,
        startedAt: Date.now(),
        reconnectAttempts: 0,
        protocol: "quic",
      };

      vi.spyOn(controller.tunnelManager, "restart").mockResolvedValueOnce(
        mockStatus,
      );

      const res = await client.restart({ targetPort: 8080 });
      expect(res).toEqual(mockStatus);
      expect(controller.tunnelManager.restart).toHaveBeenCalledWith({
        targetPort: 8080,
      });
    });
  });
});
