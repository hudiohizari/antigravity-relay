import crypto from "node:crypto";
import { Session, SessionSocketState, BufferedMessage } from "./types";
import { generateSessionId, generateSessionToken } from "./relay-auth";

export interface SessionManagerOptions {
  maxBufferedCommands?: number;
  bufferTtlMs?: number;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class SessionManager {
  private readonly maxBufferedCommands: number;
  private readonly bufferTtlMs: number;

  private sessions: Map<string, Session> = new Map();
  private sessionsByToken: Map<string, string> = new Map();
  private sessionsByDeviceId: Map<string, string> = new Map();
  private sockets: Map<string, Set<SocketLike>> = new Map();
  private revokedDevices: Map<
    string,
    { revokedAt: number; sessionId: string }
  > = new Map();
  private messageBuffer: BufferedMessage[] = [];
  private revokeListeners: Set<(sessionId: string) => void> = new Set();

  constructor(options?: SessionManagerOptions) {
    this.maxBufferedCommands = options?.maxBufferedCommands ?? 100;
    this.bufferTtlMs = options?.bufferTtlMs ?? 60000;
  }

  public createSession(options?: {
    clientIp?: string;
    userAgent?: string;
    token?: string;
    sessionId?: string;
    deviceId?: string;
  }): Session {
    const sessionId = options?.sessionId ?? generateSessionId();
    let token = options?.token ?? generateSessionToken();
    while (this.sessionsByToken.has(token)) {
      token = generateSessionToken();
    }
    const now = Date.now();

    const session: Session = {
      sessionId,
      token,
      deviceId: options?.deviceId,
      clientIp: options?.clientIp ?? "127.0.0.1",
      userAgent: options?.userAgent ?? "AntigravityRemote/1.0",
      connectedAt: now,
      lastActiveAt: now,
      authenticated: true,
      socketState: "disconnected",
    };

    this.registerSession(session);
    return session;
  }

  public registerSession(session: Session): void {
    for (const [t, sId] of this.sessionsByToken.entries()) {
      if (sId === session.sessionId && t !== session.token) {
        this.sessionsByToken.delete(t);
      }
    }
    for (const [d, sId] of this.sessionsByDeviceId.entries()) {
      if (sId === session.sessionId && d !== session.deviceId) {
        this.sessionsByDeviceId.delete(d);
      }
    }
    this.sessions.set(session.sessionId, session);
    this.sessionsByToken.set(session.token, session.sessionId);
    if (session.deviceId) {
      this.sessionsByDeviceId.set(session.deviceId, session.sessionId);
    }
  }

  public getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  public getSessionByDeviceId(deviceId: string): Session | undefined {
    const sessionId = this.sessionsByDeviceId.get(deviceId);
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  public getSessionByToken(token: string): Session | undefined {
    const sessionId = this.sessionsByToken.get(token);
    if (!sessionId) {
      return undefined;
    }
    return this.sessions.get(sessionId);
  }

  public getActiveSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  public getConnectedSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.socketState === "connected",
    );
  }

  public updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
    }
  }

  public updateSessionToken(sessionId: string, newToken: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.token !== newToken) {
        this.sessionsByToken.delete(session.token);
        session.token = newToken;
        this.sessionsByToken.set(newToken, sessionId);
      }
      session.lastActiveAt = Date.now();
    }
  }

  public updateSessionDeviceId(sessionId: string, newDeviceId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.deviceId && session.deviceId !== newDeviceId) {
        this.sessionsByDeviceId.delete(session.deviceId);
      }
      session.deviceId = newDeviceId;
      this.sessionsByDeviceId.set(newDeviceId, sessionId);
      session.lastActiveAt = Date.now();
    }
  }

  public setSessionSocketState(
    sessionId: string,
    state: SessionSocketState,
  ): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.socketState = state;
      if (state === "connected") {
        session.lastActiveAt = Date.now();
      }
    }
  }

  public bindSocket(sessionId: string, socket: SocketLike): void {
    let socketSet = this.sockets.get(sessionId);
    if (!socketSet) {
      socketSet = new Set<SocketLike>();
      this.sockets.set(sessionId, socketSet);
    }
    socketSet.add(socket);
    this.setSessionSocketState(sessionId, "connected");
  }

  public getSocket(sessionId: string): SocketLike | undefined {
    const socketSet = this.sockets.get(sessionId);
    if (!socketSet || socketSet.size === 0) {
      return undefined;
    }
    return socketSet.values().next().value;
  }

  public getSockets(sessionId: string): SocketLike[] {
    const socketSet = this.sockets.get(sessionId);
    return socketSet ? Array.from(socketSet) : [];
  }

  public getSocketCount(sessionId: string): number {
    return this.sockets.get(sessionId)?.size ?? 0;
  }

  public unbindSocket(sessionId: string, socket?: SocketLike): void {
    const socketSet = this.sockets.get(sessionId);
    if (!socketSet) {
      return;
    }

    if (socket) {
      socketSet.delete(socket);
      if (socketSet.size === 0) {
        this.sockets.delete(sessionId);
        this.setSessionSocketState(sessionId, "disconnected");
      }
    } else {
      this.sockets.delete(sessionId);
      this.setSessionSocketState(sessionId, "disconnected");
    }
  }

  public closeSessionSocket(
    sessionId: string,
    code = 1000,
    reason = "Session terminated",
  ): void {
    const socketSet = this.sockets.get(sessionId);
    if (socketSet) {
      for (const socket of socketSet) {
        try {
          if (code === 4401 && socket.readyState === 1) {
            socket.send(
              JSON.stringify({
                type: "SESSION_REVOKED",
                reason: "Session revoked by host",
                revokedAt: Date.now(),
              }),
            );
          }
        } catch {
          // Suppress send error
        }
        try {
          socket.close(code, reason);
        } catch {
          // Suppress socket error
        }
      }
      this.sockets.delete(sessionId);
    }
    this.setSessionSocketState(sessionId, "disconnected");
  }

  public isDeviceRevoked(deviceId: string): boolean {
    if (!deviceId) {
      return false;
    }
    const record = this.revokedDevices.get(deviceId);
    if (!record) {
      return false;
    }
    if (Date.now() - record.revokedAt > 24 * 60 * 60 * 1000) {
      this.revokedDevices.delete(deviceId);
      return false;
    }
    return true;
  }

  public clearDeviceRevocation(deviceId: string): void {
    this.revokedDevices.delete(deviceId);
  }

  public getDeviceRevocation(
    deviceId: string,
  ): { revokedAt: number; sessionId: string } | undefined {
    return this.revokedDevices.get(deviceId);
  }

  public getRevokedDevices(): Map<
    string,
    { revokedAt: number; sessionId: string }
  > {
    return this.revokedDevices;
  }

  public revokeDevice(deviceId: string): boolean {
    if (!deviceId) {
      return false;
    }
    const session = this.getSessionByDeviceId(deviceId);
    const sessionId = session?.sessionId ?? "";
    this.revokedDevices.set(deviceId, {
      revokedAt: Date.now(),
      sessionId,
    });
    if (session) {
      this.revokeSession(session.sessionId);
    }
    for (const s of Array.from(this.sessions.values())) {
      if (s.deviceId === deviceId) {
        this.revokeSession(s.sessionId);
      }
    }
    return true;
  }

  public revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.deviceId) {
      this.revokedDevices.set(session.deviceId, {
        revokedAt: Date.now(),
        sessionId: session.sessionId,
      });
    }

    this.closeSessionSocket(sessionId, 4401, "Session revoked");
    this.sessionsByToken.delete(session.token);
    if (session.deviceId) {
      this.sessionsByDeviceId.delete(session.deviceId);
    }
    this.sessions.delete(sessionId);

    // Remove any buffered messages from this session
    this.messageBuffer = this.messageBuffer.filter(
      (m) => m.sessionId !== sessionId,
    );

    for (const listener of this.revokeListeners) {
      try {
        listener(sessionId);
      } catch {
        // Suppress listener error
      }
    }

    return true;
  }

  public onSessionRevoked(callback: (sessionId: string) => void): () => void {
    this.revokeListeners.add(callback);
    return () => {
      this.revokeListeners.delete(callback);
    };
  }

  // --- FIFO Message Buffer Operations ---

  public bufferMessage(
    sessionId: string,
    commandType: string,
    payload: Record<string, unknown>,
    ttlMs?: number,
  ): { buffered: boolean; message?: BufferedMessage; error?: string } {
    this.pruneExpired();

    if (this.messageBuffer.length >= this.maxBufferedCommands) {
      return {
        buffered: false,
        error: `BUFFER_FULL: Command buffer has reached maximum capacity of ${this.maxBufferedCommands}`,
      };
    }

    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.bufferTtlMs;
    const message: BufferedMessage = {
      id: crypto.randomUUID(),
      sessionId,
      commandType,
      payload,
      queuedAt: now,
      expiresAt: now + effectiveTtl,
      status: "queued",
    };

    this.messageBuffer.push(message);
    return {
      buffered: true,
      message,
    };
  }

  public pruneExpired(): BufferedMessage[] {
    const now = Date.now();
    const active: BufferedMessage[] = [];
    const expired: BufferedMessage[] = [];

    for (const msg of this.messageBuffer) {
      if (now > msg.expiresAt) {
        msg.status = "expired";
        expired.push(msg);
      } else {
        active.push(msg);
      }
    }

    this.messageBuffer = active;
    return expired;
  }

  public drainMessages(): BufferedMessage[] {
    this.pruneExpired();
    const valid = this.messageBuffer;
    for (const msg of valid) {
      msg.status = "forwarded";
    }
    this.messageBuffer = [];
    return valid;
  }

  public getBufferedCount(): number {
    const now = Date.now();
    return this.messageBuffer.filter((m) => now <= m.expiresAt).length;
  }

  public getBufferedMessages(): BufferedMessage[] {
    const now = Date.now();
    return this.messageBuffer.filter((m) => now <= m.expiresAt);
  }

  public clear(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSessionSocket(sessionId);
    }
    this.sessions.clear();
    this.sessionsByToken.clear();
    this.sessionsByDeviceId.clear();
    this.sockets.clear();
    this.revokedDevices.clear();
    this.messageBuffer = [];
  }
}
