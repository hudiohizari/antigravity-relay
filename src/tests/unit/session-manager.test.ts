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
      expect(manager.getSessionByDeviceId("unknown-device")).toBeUndefined();
    });

    it("should track and retrieve sessions by deviceId", () => {
      const session = manager.createSession({
        deviceId: "dev_custom_123",
        clientIp: "10.0.0.1",
        userAgent: "Chrome/120.0",
      });

      expect(session.deviceId).toBe("dev_custom_123");
      const byDevice = manager.getSessionByDeviceId("dev_custom_123");
      expect(byDevice).toEqual(session);
    });

    it("should remove device mapping when session is revoked", () => {
      const session = manager.createSession({
        deviceId: "dev_revoke_test",
      });

      expect(manager.getSessionByDeviceId("dev_revoke_test")).toBeDefined();
      manager.revokeSession(session.sessionId);
      expect(manager.getSessionByDeviceId("dev_revoke_test")).toBeUndefined();
    });

    it("should clear device mappings on reset", () => {
      manager.createSession({
        deviceId: "dev_clear_test",
      });
      expect(manager.getSessionByDeviceId("dev_clear_test")).toBeDefined();
      manager.clear();
      expect(manager.getSessionByDeviceId("dev_clear_test")).toBeUndefined();
    });

    it("should update session device mapping and clean up previous device ID", () => {
      const session = manager.createSession({
        deviceId: "dev_initial",
      });
      expect(manager.getSessionByDeviceId("dev_initial")).toEqual(session);

      manager.updateSessionDeviceId(session.sessionId, "dev_migrated");
      expect(manager.getSessionByDeviceId("dev_initial")).toBeUndefined();
      expect(manager.getSessionByDeviceId("dev_migrated")).toEqual(session);
      expect(session.deviceId).toBe("dev_migrated");
    });

    it("should update session token mapping and clean up previous token", () => {
      const session = manager.createSession({
        token: "token_old",
      });
      expect(manager.getSessionByToken("token_old")).toEqual(session);

      manager.updateSessionToken(session.sessionId, "token_new");
      expect(manager.getSessionByToken("token_old")).toBeUndefined();
      expect(manager.getSessionByToken("token_new")).toEqual(session);
      expect(session.token).toBe("token_new");
    });

    it("should clean up previous token and device ID when re-registering updated session", () => {
      const session = manager.createSession({
        token: "token_v1",
        deviceId: "dev_v1",
      });
      expect(manager.getSessionByToken("token_v1")).toEqual(session);
      expect(manager.getSessionByDeviceId("dev_v1")).toEqual(session);

      session.token = "token_v2";
      session.deviceId = "dev_v2";
      manager.registerSession(session);

      expect(manager.getSessionByToken("token_v1")).toBeUndefined();
      expect(manager.getSessionByToken("token_v2")).toEqual(session);
      expect(manager.getSessionByDeviceId("dev_v1")).toBeUndefined();
      expect(manager.getSessionByDeviceId("dev_v2")).toEqual(session);
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

    it("should guarantee unique session tokens across multiple sessions", () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const session = manager.createSession();
        expect(tokens.has(session.token)).toBe(false);
        tokens.add(session.token);
      }
      expect(tokens.size).toBe(50);
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

    it("should allow multi-socket binding per session without closing sibling sockets", () => {
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

      expect(socket1.close).not.toHaveBeenCalled();
      expect(socket2.close).not.toHaveBeenCalled();
      expect(manager.getSocketCount(session.sessionId)).toBe(2);
      expect(manager.getSockets(session.sessionId)).toContain(socket1);
      expect(manager.getSockets(session.sessionId)).toContain(socket2);
      expect(session.socketState).toBe("connected");
    });

    it("should unbind socket and mark session disconnected when all sockets unbind", () => {
      const session = manager.createSession();
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, mockSocket);
      manager.unbindSocket(session.sessionId, mockSocket);

      expect(manager.getSocket(session.sessionId)).toBeUndefined();
      expect(manager.getSocketCount(session.sessionId)).toBe(0);
      expect(session.socketState).toBe("disconnected");
    });

    it("should not disconnect session when a single tab unbinds if sibling sockets remain", () => {
      const session = manager.createSession();
      const oldSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };
      const newSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };

      manager.bindSocket(session.sessionId, oldSocket);
      manager.bindSocket(session.sessionId, newSocket);

      // Single tab unbind does not disconnect session
      manager.unbindSocket(session.sessionId, oldSocket);

      expect(manager.getSocketCount(session.sessionId)).toBe(1);
      expect(manager.getSockets(session.sessionId)).toContain(newSocket);
      expect(session.socketState).toBe("connected");

      // Session disconnects strictly when all sockets unbind
      manager.unbindSocket(session.sessionId, newSocket);
      expect(manager.getSocketCount(session.sessionId)).toBe(0);
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

    it("should close all sibling sockets in set with code 4401 on session revocation", () => {
      const session = manager.createSession({
        deviceId: "dev_multi_socket_revoke",
      });
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

      const revoked = manager.revokeSession(session.sessionId);
      expect(revoked).toBe(true);

      expect(socket1.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(socket2.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(manager.getSocketCount(session.sessionId)).toBe(0);
      expect(manager.isDeviceRevoked("dev_multi_socket_revoke")).toBe(true);
    });

    it("should record deviceId in tombstone cache and respect 24h TTL", () => {
      const session = manager.createSession({ deviceId: "dev_tombstone_ttl" });
      expect(manager.isDeviceRevoked("dev_tombstone_ttl")).toBe(false);

      manager.revokeSession(session.sessionId);
      expect(manager.isDeviceRevoked("dev_tombstone_ttl")).toBe(true);

      const record = manager.getDeviceRevocation("dev_tombstone_ttl");
      expect(record).toBeDefined();
      expect(record?.sessionId).toBe(session.sessionId);
      expect(record?.revokedAt).toBeLessThanOrEqual(Date.now());

      // Simulate expiry after 24h
      const DAY_MS = 24 * 60 * 60 * 1000;
      record!.revokedAt = Date.now() - (DAY_MS + 1000);
      expect(manager.isDeviceRevoked("dev_tombstone_ttl")).toBe(false);
    });

    it("should allow clearing device revocation tombstone", () => {
      const session = manager.createSession({
        deviceId: "dev_clear_tombstone",
      });
      manager.revokeSession(session.sessionId);
      expect(manager.isDeviceRevoked("dev_clear_tombstone")).toBe(true);

      manager.clearDeviceRevocation("dev_clear_tombstone");
      expect(manager.isDeviceRevoked("dev_clear_tombstone")).toBe(false);
    });

    it("should revoke device by deviceId, terminate sockets, store tombstone, and notify listeners", () => {
      const session = manager.createSession({
        deviceId: "dev_target_revoke_id",
      });
      const mockSocket: SocketLike = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      };
      manager.bindSocket(session.sessionId, mockSocket);

      const revokeListener = vi.fn();
      manager.onSessionRevoked(revokeListener);

      const revoked = manager.revokeDevice("dev_target_revoke_id");
      expect(revoked).toBe(true);
      expect(mockSocket.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(manager.getSession(session.sessionId)).toBeUndefined();
      expect(
        manager.getSessionByDeviceId("dev_target_revoke_id"),
      ).toBeUndefined();
      expect(manager.isDeviceRevoked("dev_target_revoke_id")).toBe(true);
      expect(revokeListener).toHaveBeenCalledWith(session.sessionId);
    });

    it("should store tombstone even when revoking a device without an active session", () => {
      expect(manager.isDeviceRevoked("dev_offline_revoke")).toBe(false);
      const result = manager.revokeDevice("dev_offline_revoke");
      expect(result).toBe(true);
      expect(manager.isDeviceRevoked("dev_offline_revoke")).toBe(true);
      const tombstone = manager.getDeviceRevocation("dev_offline_revoke");
      expect(tombstone).toBeDefined();
      expect(tombstone?.sessionId).toBe("");
    });

    it("should return false when revoking an empty deviceId", () => {
      expect(manager.revokeDevice("")).toBe(false);
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

    it("should cover session manager edge cases", () => {
      const defaultManager = new SessionManager();
      expect(defaultManager.getSockets("unknown")).toEqual([]);

      const s1 = manager.createSession({ token: "duplicate-token" });
      const s2 = manager.createSession({ token: "duplicate-token" });
      expect(s2.token).not.toBe("duplicate-token");

      expect(manager.getConnectedSessions()).toHaveLength(0);
      manager.setSessionSocketState(s1.sessionId, "connected");
      expect(manager.getConnectedSessions()).toHaveLength(1);

      expect(() => manager.unbindSocket("unknown-session")).not.toThrow();

      const mockSock = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
      } as any;
      manager.bindSocket(s1.sessionId, mockSock);
      expect(manager.getSocketCount(s1.sessionId)).toBe(1);
      manager.unbindSocket(s1.sessionId);
      expect(manager.getSocketCount(s1.sessionId)).toBe(0);

      const throwingSock = {
        readyState: 1,
        send: vi.fn().mockImplementation(() => {
          throw new Error("socket error");
        }),
        close: vi.fn().mockImplementation(() => {
          throw new Error("close error");
        }),
      } as any;
      manager.bindSocket(s2.sessionId, throwingSock);
      expect(() =>
        manager.closeSessionSocket(s2.sessionId, 4401, "revoked"),
      ).not.toThrow();

      expect(manager.isDeviceRevoked("")).toBe(false);
      expect(manager.revokeDevice("")).toBe(false);

      expect(manager.getRevokedDevices()).toBeInstanceOf(Map);

      expect(() => manager.updateSessionActivity("non-existent")).not.toThrow();
    });
  });
});
