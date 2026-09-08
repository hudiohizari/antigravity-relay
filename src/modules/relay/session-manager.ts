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
  private sockets: Map<string, SocketLike> = new Map();
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
  }): Session {
    const sessionId = options?.sessionId ?? generateSessionId();
    const token = options?.token ?? generateSessionToken();
    const now = Date.now();

    const session: Session = {
      sessionId,
      token,
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
    this.sessions.set(session.sessionId, session);
    this.sessionsByToken.set(session.token, session.sessionId);
  }

  public getSession(sessionId: string): Session | undefined {
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

  public updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
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
      session.lastActiveAt = Date.now();
    }
  }

  public bindSocket(sessionId: string, socket: SocketLike): void {
    const existing = this.sockets.get(sessionId);
    if (existing && existing !== socket) {
      try {
        existing.close(1000, "Superseded by new connection");
      } catch {
        // Suppress close error
      }
    }
    this.sockets.set(sessionId, socket);
    this.setSessionSocketState(sessionId, "connected");
  }

  public getSocket(sessionId: string): SocketLike | undefined {
    return this.sockets.get(sessionId);
  }

  public unbindSocket(sessionId: string): void {
    this.sockets.delete(sessionId);
    this.setSessionSocketState(sessionId, "disconnected");
  }

  public closeSessionSocket(
    sessionId: string,
    code = 1000,
    reason = "Session terminated",
  ): void {
    const socket = this.sockets.get(sessionId);
    if (socket) {
      try {
        socket.close(code, reason);
      } catch {
        // Suppress socket error
      }
      this.sockets.delete(sessionId);
    }
    this.setSessionSocketState(sessionId, "disconnected");
  }

  public revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.closeSessionSocket(sessionId, 4401, "Session revoked");
    this.sessionsByToken.delete(session.token);
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
    this.sockets.clear();
    this.messageBuffer = [];
  }
}
