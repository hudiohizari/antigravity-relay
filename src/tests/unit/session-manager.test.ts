import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionManager, SocketLike } from "@/modules/relay/session-manager";

describe("SessionManager & Command Buffering", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      maxBufferedCommands: 5,
      bufferTtlMs: 200,
    });
  });

  describe("Session Lifecycle & Registration", () => {
    it("should create and track a new session with high entropy credentials", () => {
      const session = manager.createSession({
        clientIp: "192.168.1.50",
        userAgent: "MobileSafari/604.1",
      });

      expect(session.sessionId).toBeDefined();
      expect(session.token).toBeDefined();
      expect(session.clientIp).toBe("192.168.1.50");
      expect(session.userAgent).toBe("MobileSafari/604.1");
      expect(session.authenticated).toBe(true);
      expect(session.socketState).toBe("disconnected");

      const byId = manager.getSession(session.sessionId);
      expect(byId).toEqual(session);

      const byToken = manager.getSessionByToken(session.token);
      expect(byToken).toEqual(session);
    });

    it("should return undefined for unknown tokens or session IDs", () => {
      expect(manager.getSession("unknown-id")).toBeUndefined();
      expect(manager.getSessionByToken("unknown-token")).toBeUndefined();
    });

    it("should list all active sessions", () => {
      manager.createSession();
      manager.createSession();
      expect(manager.getActiveSessions()).toHaveLength(2);
    });

    it("should update session activity timestamp", async () => {
      const session = manager.createSession();
      const initialActive = session.lastActiveAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      manager.updateSessionActivity(session.sessionId);

      expect(session.lastActiveAt).toBeGreaterThan(initialActive);
    });

    it("should transition socket states", () => {
      const session = manager.createSession();
      expect(session.socketState).toBe("disconnected");

      manager.setSessionSocketState(session.sessionId, "connected");
      expect(session.socketState).toBe("connected");

      manager.setSessionSocketState(session.sessionId, "buffered");
      expect(session.socketState).toBe("buffered");
    });
  });

  describe("Socket Binding & Management", () => {
    it("should bind socket and transition state to connected", () => {
      const session = manager.createSession();
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, mockSocket);
      expect(manager.getSocket(session.sessionId)).toBe(mockSocket);
      expect(session.socketState).toBe("connected");
    });

    it("should close old socket when binding a new socket for the same session", () => {
      const session = manager.createSession();
      const socket1: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };
      const socket2: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, socket1);
      manager.bindSocket(session.sessionId, socket2);

      expect(socket1.close).toHaveBeenCalledWith(
        1000,
        "Superseded by new connection",
      );
      expect(manager.getSocket(session.sessionId)).toBe(socket2);
    });

    it("should unbind socket and mark session disconnected", () => {
      const session = manager.createSession();
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, mockSocket);
      manager.unbindSocket(session.sessionId);

      expect(manager.getSocket(session.sessionId)).toBeUndefined();
      expect(session.socketState).toBe("disconnected");
    });

    it("should close session socket gracefully", () => {
      const session = manager.createSession();
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, mockSocket);
      manager.closeSessionSocket(session.sessionId, 1001, "Going away");

      expect(mockSocket.close).toHaveBeenCalledWith(1001, "Going away");
      expect(manager.getSocket(session.sessionId)).toBeUndefined();
      expect(session.socketState).toBe("disconnected");
    });
  });

  describe("Session Revocation", () => {
    it("should revoke session, terminate socket, and notify listeners", () => {
      const session = manager.createSession();
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };
      manager.bindSocket(session.sessionId, mockSocket);

      const revokeListener = vi.fn();
      const unsub = manager.onSessionRevoked(revokeListener);

      const revoked = manager.revokeSession(session.sessionId);
      expect(revoked).toBe(true);

      expect(mockSocket.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(manager.getSession(session.sessionId)).toBeUndefined();
      expect(manager.getSessionByToken(session.token)).toBeUndefined();
      expect(revokeListener).toHaveBeenCalledWith(session.sessionId);

      unsub();
    });

    it("should return false when revoking a non-existent session", () => {
      expect(manager.revokeSession("missing-id")).toBe(false);
    });

    it("should suppress errors when socket.close throws or revoke listener throws", () => {
      const session = manager.createSession();
      const faultySocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn().mockImplementation(() => {
          throw new Error("Socket close exploded");
        }),
      };

      manager.bindSocket(session.sessionId, faultySocket);

      // Re-bind to trigger faultySocket.close error suppression
      const nextSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn().mockImplementation(() => {
          throw new Error("Second socket close exploded");
        }),
      };
      manager.bindSocket(session.sessionId, nextSocket);

      // Register throwing listener
      manager.onSessionRevoked(() => {
        throw new Error("Listener exploded");
      });

      expect(() => manager.revokeSession(session.sessionId)).not.toThrow();
    });
  });

  describe("FIFO Command Buffering & Backpressure", () => {
    it("should queue commands in FIFO order", () => {
      const session = manager.createSession();

      const r1 = manager.bufferMessage(session.sessionId, "PROMPT", {
        text: "first",
      });
      const r2 = manager.bufferMessage(session.sessionId, "APPROVE_ACTION", {
        id: "act-1",
      });

      expect(r1.buffered).toBe(true);
      expect(r2.buffered).toBe(true);
      expect(manager.getBufferedCount()).toBe(2);

      const messages = manager.getBufferedMessages();
      expect(messages[0].commandType).toBe("PROMPT");
      expect(messages[1].commandType).toBe("APPROVE_ACTION");
    });

    it("should reject commands when buffer capacity is reached", () => {
      const session = manager.createSession();

      for (let i = 0; i < 5; i++) {
        const res = manager.bufferMessage(session.sessionId, "PROMPT", {
          index: i,
        });
        expect(res.buffered).toBe(true);
      }

      const overflowRes = manager.bufferMessage(session.sessionId, "PROMPT", {
        index: 5,
      });
      expect(overflowRes.buffered).toBe(false);
      expect(overflowRes.error).toContain("BUFFER_FULL");
      expect(manager.getBufferedCount()).toBe(5);
    });

    it("should prune expired commands based on TTL", async () => {
      const session = manager.createSession();

      manager.bufferMessage(
        session.sessionId,
        "PROMPT",
        { text: "fast-expire" },
        50,
      );
      manager.bufferMessage(
        session.sessionId,
        "PROMPT",
        { text: "slow-expire" },
        1000,
      );

      expect(manager.getBufferedCount()).toBe(2);

      await new Promise((resolve) => setTimeout(resolve, 80));

      const expired = manager.pruneExpired();
      expect(expired).toHaveLength(1);
      expect(expired[0].payload).toEqual({ text: "fast-expire" });
      expect(expired[0].status).toBe("expired");

      expect(manager.getBufferedCount()).toBe(1);
      expect(manager.getBufferedMessages()[0].payload).toEqual({
        text: "slow-expire",
      });
    });

    it("should drain all active commands and mark them forwarded", () => {
      const session = manager.createSession();

      manager.bufferMessage(session.sessionId, "PROMPT", { text: "one" });
      manager.bufferMessage(session.sessionId, "PROMPT", { text: "two" });

      const drained = manager.drainMessages();
      expect(drained).toHaveLength(2);
      expect(drained[0].status).toBe("forwarded");
      expect(drained[1].status).toBe("forwarded");
      expect(manager.getBufferedCount()).toBe(0);
    });

    it("should clear all sessions and messages on reset", () => {
      const session = manager.createSession();
      manager.bufferMessage(session.sessionId, "PROMPT", { text: "msg" });

      manager.clear();
      expect(manager.getActiveSessions()).toHaveLength(0);
      expect(manager.getBufferedCount()).toBe(0);
    });
  });
});
