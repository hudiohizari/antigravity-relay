import fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import {
  RelayConfig,
  RelayServerStatus,
  RemoteEvent,
  DEFAULT_RELAY_CONFIG,
} from "./types";
import {
  AuthRateLimiter,
  extractTokenFromHeader,
  extractTokenFromQuery,
} from "./relay-auth";
import { SessionManager } from "./session-manager";
import { UpstreamBridge } from "./upstream-bridge";

export interface RelayServerOptions {
  config?: Partial<RelayConfig>;
  sessionManager?: SessionManager;
  upstreamBridge?: UpstreamBridge;
  rateLimiter?: AuthRateLimiter;
}

export function resolveStaticDir(configuredDir?: string): string | null {
  const candidates: string[] = [];

  if (configuredDir) {
    candidates.push(configuredDir);
    if (!path.isAbsolute(configuredDir)) {
      candidates.push(path.resolve(process.cwd(), configuredDir));
    }
  }

  // Relative to current file location (__dirname)
  candidates.push(path.resolve(__dirname, "../../relay-ui"));
  candidates.push(path.resolve(__dirname, "../relay-ui"));
  candidates.push(path.resolve(__dirname, "../../../src/relay-ui"));
  candidates.push(path.resolve(__dirname, "../../src/relay-ui"));
  candidates.push(path.resolve(__dirname, "../src/relay-ui"));

  // Relative to process working directory
  candidates.push(path.resolve(process.cwd(), "src/relay-ui"));
  candidates.push(path.resolve(process.cwd(), "relay-ui"));

  // Electron resources path
  const resourcesPath = (process as unknown as { resourcesPath?: string })
    .resourcesPath;
  if (typeof resourcesPath === "string") {
    candidates.push(path.resolve(resourcesPath, "relay-ui"));
    candidates.push(path.resolve(resourcesPath, "src/relay-ui"));
    candidates.push(
      path.resolve(resourcesPath, "app.asar.unpacked/src/relay-ui"),
    );
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore error and continue
    }
  }

  return null;
}

export class RelayServer {
  private readonly config: RelayConfig;
  private readonly sessionManager: SessionManager;
  private readonly upstreamBridge: UpstreamBridge;
  private readonly rateLimiter: AuthRateLimiter;

  private app: FastifyInstance | null = null;
  private isRunning = false;
  private startedAt?: number;
  private statusListeners: Set<(status: RelayServerStatus) => void> = new Set();
  private unhookUpstream?: () => void;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options?: RelayServerOptions) {
    this.config = {
      ...DEFAULT_RELAY_CONFIG,
      ...options?.config,
    };
    this.sessionManager =
      options?.sessionManager ??
      new SessionManager({
        maxBufferedCommands: this.config.maxBufferedCommands,
        bufferTtlMs: this.config.bufferTtlMs,
      });
    this.upstreamBridge =
      options?.upstreamBridge ??
      new UpstreamBridge({
        sessionManager: this.sessionManager,
      });
    this.rateLimiter = options?.rateLimiter ?? new AuthRateLimiter();

    this.wireUpstreamEvents();
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getUpstreamBridge(): UpstreamBridge {
    return this.upstreamBridge;
  }

  public getStatus(): RelayServerStatus {
    return {
      isRunning: this.isRunning,
      port: this.config.port,
      host: this.config.host,
      activeSessions: this.sessionManager.getActiveSessions().length,
      isBuffering: this.upstreamBridge.isBuffering(),
      upstream: this.upstreamBridge.getStatus(),
      startedAt: this.startedAt,
    };
  }

  public onStatusUpdated(
    callback: (status: RelayServerStatus) => void,
  ): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  public async start(overrides?: {
    port?: number;
    host?: string;
  }): Promise<RelayServerStatus> {
    if (this.isRunning) {
      return this.getStatus();
    }

    if (overrides?.port) {
      this.config.port = overrides.port;
    }
    if (overrides?.host) {
      this.config.host = overrides.host;
    }

    const app = fastify({
      logger: false,
      forceCloseConnections: true,
    });

    await app.register(fastifyCors, {
      origin: this.config.corsOrigins,
      credentials: true,
    });

    await app.register(fastifyWebsocket, {
      options: {
        maxPayload: 1048576, // 1MB
      },
    });

    // Static asset directory resolution
    const staticDir = resolveStaticDir(this.config.staticDir);

    if (staticDir) {
      await app.register(fastifyStatic, {
        root: staticDir,
        prefix: "/",
        decorateReply: false,
      });

      await app.register(fastifyStatic, {
        root: staticDir,
        prefix: "/relay-ui/",
        decorateReply: false,
        prefixAvoidTrailingSlash: true,
      });

      app.get("/relay-ui", async (_request, reply) => {
        const indexPath = path.join(staticDir, "index.html");
        try {
          if (fs.existsSync(indexPath)) {
            const html = await fs.promises.readFile(indexPath, "utf-8");
            return reply.type("text/html; charset=utf-8").send(html);
          }
        } catch {
          // Suppress file read error
        }
        return reply.status(404).send({ success: false, error: "Not found" });
      });
    }

    // Health check endpoint
    app.get("/health", async () => {
      return {
        success: true,
        status: "healthy",
        isRunning: this.isRunning,
        activeSessions: this.sessionManager.getActiveSessions().length,
        isBuffering: this.upstreamBridge.isBuffering(),
        upstream: this.upstreamBridge.getStatus(),
        timestamp: Date.now(),
      };
    });

    // Status endpoint
    app.get("/api/status", async () => {
      return {
        success: true,
        data: this.getStatus(),
      };
    });

    // Sessions endpoint
    app.get("/api/sessions", async () => {
      return {
        success: true,
        data: this.sessionManager.getActiveSessions(),
      };
    });

    // Revoke session endpoint
    app.post("/api/sessions/revoke", async (request, reply) => {
      const body = request.body as { sessionId?: string };
      if (!body?.sessionId) {
        return reply.status(400).send({
          success: false,
          error: "Missing required field: sessionId",
        });
      }
      const revoked = this.sessionManager.revokeSession(body.sessionId);
      return {
        success: revoked,
      };
    });

    // WebSocket route
    app.get("/ws", { websocket: true }, (socket, req) => {
      const ip =
        (req.headers["x-forwarded-for"] as string) || req.ip || "127.0.0.1";

      if (this.rateLimiter.isRateLimited(ip)) {
        socket.close(1008, "Authentication rate limited");
        return;
      }

      // Extract auth token
      const headerToken = extractTokenFromHeader(req.headers.authorization);
      const queryInfo = extractTokenFromQuery(req.url || "");
      const protoToken = req.headers["sec-websocket-protocol"]
        ? String(req.headers["sec-websocket-protocol"]).trim()
        : undefined;

      const token =
        headerToken || queryInfo.token || queryInfo.pair || protoToken;

      if (!token) {
        this.rateLimiter.recordFailure(ip);
        socket.close(1008, "Missing authentication token");
        return;
      }

      let session = this.sessionManager.getSessionByToken(token);

      // Support initial pairing exchange if token not yet associated
      if (!session && queryInfo.pair) {
        session = this.sessionManager.createSession({
          token: queryInfo.pair,
          clientIp: ip,
          userAgent:
            (req.headers["user-agent"] as string) || "AntigravityRemote/1.0",
        });
      }

      if (!session) {
        this.rateLimiter.recordFailure(ip);
        socket.close(1008, "Invalid session token");
        return;
      }

      this.rateLimiter.recordSuccess(ip);
      session.clientIp = ip;
      session.userAgent =
        (req.headers["user-agent"] as string) || session.userAgent;

      this.sessionManager.bindSocket(session.sessionId, socket);
      this.notifyStatusUpdated();

      // If upstream is currently buffering, alert the new connection immediately
      if (this.upstreamBridge.isBuffering()) {
        try {
          socket.send(
            JSON.stringify({
              type: "BUFFERING_ALERT",
              payload: { reason: "Upstream reconnecting" },
              timestamp: Date.now(),
            }),
          );
        } catch {
          // Suppress send error
        }
      }

      const safeSend = (payload: string): void => {
        try {
          socket.send(payload);
        } catch {
          // Suppress send error if client dropped connection
        }
      };

      socket.on("message", async (raw: Buffer | string) => {
        this.sessionManager.updateSessionActivity(session.sessionId);
        try {
          const rawStr = raw.toString().trim();
          if (rawStr.toUpperCase() === "PING") {
            safeSend(
              JSON.stringify({
                type: "PONG",
                payload: { timestamp: Date.now() },
                timestamp: Date.now(),
              }),
            );
            return;
          }

          const parsed = JSON.parse(rawStr);
          const rawType = parsed.type || "PROMPT";
          const commandType = String(rawType).toUpperCase();
          const payload = parsed.payload || {};

          if (commandType === "PING") {
            safeSend(
              JSON.stringify({
                type: "PONG",
                payload: { ...payload, timestamp: Date.now() },
                timestamp: Date.now(),
              }),
            );
            return;
          }

          const result = await this.upstreamBridge.sendCommand(
            session.sessionId,
            rawType,
            payload,
          );

          if (result.buffered) {
            safeSend(
              JSON.stringify({
                type: "BUFFERED_ACK",
                payload: {
                  commandId: result.messageId,
                  status: "queued",
                },
                timestamp: Date.now(),
              }),
            );
          } else if (result.error) {
            safeSend(
              JSON.stringify({
                type: "ERROR",
                payload: { error: result.error },
                timestamp: Date.now(),
              }),
            );
          }
        } catch {
          safeSend(
            JSON.stringify({
              type: "ERROR",
              payload: { error: "Invalid JSON payload" },
              timestamp: Date.now(),
            }),
          );
        }
      });

      socket.on("close", () => {
        this.sessionManager.unbindSocket(session.sessionId);
        this.notifyStatusUpdated();
      });

      socket.on("error", () => {
        this.sessionManager.unbindSocket(session.sessionId);
        this.notifyStatusUpdated();
      });
    });

    await app.listen({
      port: this.config.port,
      host: this.config.host,
    });

    const addr = app.server.address();
    if (addr && typeof addr === "object") {
      this.config.port = addr.port;
    }

    this.app = app;
    this.isRunning = true;
    this.startedAt = Date.now();
    this.startHeartbeat();

    // Attempt upstream connection in background
    this.upstreamBridge.connect().catch(() => {
      // Connect errors are handled by upstream bridge buffering
    });

    this.notifyStatusUpdated();
    return this.getStatus();
  }

  public async stop(): Promise<void> {
    if (!this.isRunning && !this.app) {
      return;
    }

    this.stopHeartbeat();
    this.isRunning = false;
    this.startedAt = undefined;

    // Disconnect all client sockets
    for (const session of this.sessionManager.getActiveSessions()) {
      this.sessionManager.closeSessionSocket(
        session.sessionId,
        1000,
        "Server stopping",
      );
    }

    // Disconnect upstream bridge
    await this.upstreamBridge.disconnect();

    if (this.app) {
      try {
        await this.app.close();
      } catch {
        // Suppress close error
      }
      this.app = null;
    }

    this.notifyStatusUpdated();
  }

  public broadcastToClients(event: RemoteEvent): void {
    const payload = JSON.stringify(event);
    for (const session of this.sessionManager.getActiveSessions()) {
      const socket = this.sessionManager.getSocket(session.sessionId);
      if (socket && socket.readyState === 1 /* OPEN */) {
        try {
          socket.send(payload);
        } catch {
          // Suppress socket error
        }
      }
    }
  }

  public dispose(): void {
    this.stopHeartbeat();
    if (this.unhookUpstream) {
      this.unhookUpstream();
      this.unhookUpstream = undefined;
    }
    this.upstreamBridge.dispose();
    this.statusListeners.clear();
  }

  public getApp(): FastifyInstance | null {
    return this.app;
  }

  public startHeartbeat(): void {
    this.stopHeartbeat();
    if (
      this.config.heartbeatIntervalMs &&
      this.config.heartbeatIntervalMs > 0
    ) {
      this.heartbeatTimer = setInterval(() => {
        this.broadcastHeartbeat();
      }, this.config.heartbeatIntervalMs);
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public broadcastHeartbeat(): void {
    const activeSessions = this.sessionManager.getActiveSessions();
    const payload = JSON.stringify({
      type: "HEARTBEAT",
      payload: {
        timestamp: Date.now(),
        isBuffering: this.upstreamBridge.isBuffering(),
        activeSessions: activeSessions.length,
      },
      timestamp: Date.now(),
    });

    for (const session of activeSessions) {
      const socket = this.sessionManager.getSocket(session.sessionId);
      if (socket) {
        if (socket.readyState === 1 /* OPEN */) {
          try {
            socket.send(payload);
          } catch {
            this.sessionManager.unbindSocket(session.sessionId);
          }
        } else if (socket.readyState === 2 || socket.readyState === 3) {
          this.sessionManager.unbindSocket(session.sessionId);
        }
      }
    }
  }

  // --- Private Helpers ---

  private wireUpstreamEvents(): void {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      this.upstreamBridge.onBufferingAlert((reason) => {
        this.broadcastToClients({
          type: "BUFFERING_ALERT",
          payload: { reason },
          timestamp: Date.now(),
        });
        this.notifyStatusUpdated();
      }),
    );

    unsubs.push(
      this.upstreamBridge.onSwapResumed(() => {
        this.broadcastToClients({
          type: "SWAP_RESUMED",
          payload: {},
          timestamp: Date.now(),
        });
        this.notifyStatusUpdated();
      }),
    );

    unsubs.push(
      this.upstreamBridge.onMessage((data) => {
        const payload =
          typeof data === "object" && data !== null
            ? (data as Record<string, unknown>)
            : { text: String(data) };
        this.broadcastToClients({
          type: "AGENT_OUTPUT",
          payload,
          timestamp: Date.now(),
        });
      }),
    );

    unsubs.push(
      this.upstreamBridge.onStateChange(() => {
        this.notifyStatusUpdated();
      }),
    );

    this.unhookUpstream = () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }

  private notifyStatusUpdated(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Suppress listener error
      }
    }
  }
}
