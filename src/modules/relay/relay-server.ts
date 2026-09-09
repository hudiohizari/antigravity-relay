import fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import crypto from "node:crypto";
import { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { Agent, request as undiciRequest } from "undici";
import WebSocket, { WebSocketServer, RawData } from "ws";
import {
  RelayConfig,
  RelayServerStatus,
  RemoteEvent,
  Session,
  UpstreamBridgeState,
  DEFAULT_RELAY_CONFIG,
} from "./types";
import { AuthRateLimiter } from "./relay-auth";
import { SessionManager } from "./session-manager";
import { UpstreamBridge } from "./upstream-bridge";
import { PortDiscoveryService } from "./port-discovery";

export interface RelayServerOptions {
  config?: Partial<RelayConfig>;
  sessionManager?: SessionManager;
  upstreamBridge?: UpstreamBridge;
  rateLimiter?: AuthRateLimiter;
  portDiscovery?: PortDiscoveryService;
  upstreamPort?: number;
}

interface ActiveWsPair {
  clientWs: WebSocket;
  upstreamWs: WebSocket;
  sessionId?: string;
}

function extractClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress?: string,
): string {
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const raw = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(",")[0];
    const trimmed = raw?.trim();
    if (trimmed) {
      return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
    }
  }
  if (remoteAddress) {
    return remoteAddress.startsWith("::ffff:")
      ? remoteAddress.slice(7)
      : remoteAddress;
  }
  return "127.0.0.1";
}

function extractUserAgent(
  headers: Record<string, string | string[] | undefined>,
): string {
  const ua = headers["user-agent"];
  if (Array.isArray(ua)) {
    return ua[0] || "AntigravityRemote/1.0";
  }
  return ua || "AntigravityRemote/1.0";
}

export function extractDeviceId(
  headers: Record<string, string | string[] | undefined>,
  query?: URLSearchParams | null,
): string | undefined {
  let cookieHeader: string | string[] | undefined;
  let headerDeviceId: string | string[] | undefined;

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "cookie") {
      cookieHeader = value;
    } else if (lower === "x-device-id") {
      headerDeviceId = value;
    }
  }

  const cookieStr = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;
  if (cookieStr) {
    const match = cookieStr.match(/(?:^|;\s*)ag_device_id=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }
  if (headerDeviceId) {
    return Array.isArray(headerDeviceId) ? headerDeviceId[0] : headerDeviceId;
  }
  if (query) {
    const queryDeviceId = query.get("deviceId") || query.get("device_id");
    if (queryDeviceId) {
      return queryDeviceId;
    }
  }
  return undefined;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "trailer",
]);

function safeClose(
  ws: WebSocket,
  code?: number,
  reason?: Buffer | string,
): void {
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    try {
      if (
        code &&
        code !== 1005 &&
        code !== 1006 &&
        code >= 1000 &&
        code <= 4999
      ) {
        ws.close(code, reason);
      } else {
        ws.close();
      }
    } catch {
      try {
        ws.terminate();
      } catch {
        // Suppress termination error
      }
    }
  }
}

export function generateAutoReloadScript(
  upstreamPort: number | null,
  upstreamEpoch: number,
): string {
  return `<script id="antigravity-relay-autoreload">
(function() {
  if (window.__antigravityRelayAutoReloadInjected) return;
  window.__antigravityRelayAutoReloadInjected = true;

  try {
    var deviceMatch = document.cookie.match(/(?:^|;\s*)ag_device_id=([^;]+)/);
    if (deviceMatch && deviceMatch[1]) {
      localStorage.setItem("ag_device_id", decodeURIComponent(deviceMatch[1].trim()));
    } else {
      var storedDeviceId = localStorage.getItem("ag_device_id");
      if (storedDeviceId) {
        document.cookie = "ag_device_id=" + encodeURIComponent(storedDeviceId) + "; path=/; max-age=31536000; SameSite=Lax";
      }
    }
  } catch (_) {}

  var initialPort = ${upstreamPort ?? "null"};
  var initialEpoch = ${upstreamEpoch};
  var reloading = false;

  function showBanner(msg) {
    try {
      var banner = document.getElementById("relay-reload-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "relay-reload-banner";
        banner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0f172a;color:#38bdf8;border:1px solid #0284c7;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 8px 20px rgba(0,0,0,0.4);display:flex;align-items:center;gap:8px;";
        document.body.appendChild(banner);
      }
      banner.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;"></span>' + msg;
    } catch (_) {}
  }

  function triggerReload() {
    if (reloading) return;
    reloading = true;
    showBanner("Antigravity restarting, reconnecting...");

    var check = function() {
      fetch("/health", { cache: "no-store" })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          var portChanged = data && data.upstreamPort && initialPort && data.upstreamPort !== initialPort;
          var epochChanged = data && typeof data.upstreamEpoch === "number" && data.upstreamEpoch > initialEpoch;
          var isHealthy = data && data.isRunning && data.upstreamPort && !data.isRestarting;

          if (isHealthy && (portChanged || epochChanged)) {
            window.location.reload();
          } else {
            setTimeout(check, 1000);
          }
        })
        .catch(function() {
          setTimeout(check, 1000);
        });
    };
    setTimeout(check, 500);
  }

  if (typeof window.WebSocket !== "undefined") {
    var OrigWS = window.WebSocket;
    class PatchedWS extends OrigWS {
      constructor(...args) {
        super(...args);
        this.addEventListener("close", function(event) {
          if (event.code === 1012 || event.code === 1006 || event.code === 1011) {
            triggerReload();
          }
        });
      }
    }
    window.WebSocket = PatchedWS;
  }

  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") {
      fetch("/health", { cache: "no-store" })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.upstreamPort && (data.upstreamPort !== initialPort || (typeof data.upstreamEpoch === "number" && data.upstreamEpoch > initialEpoch))) {
            triggerReload();
          }
        })
        .catch(function() {});
    }
  });

  setInterval(function() {
    if (reloading) return;
    fetch("/health", { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && data.upstreamPort && (data.upstreamPort !== initialPort || (typeof data.upstreamEpoch === "number" && data.upstreamEpoch > initialEpoch))) {
          triggerReload();
        }
      })
      .catch(function() {});
  }, 5000);
})();
</script>`;
}

export class RelayServer {
  private readonly config: RelayConfig;
  private readonly sessionManager: SessionManager;
  private readonly upstreamBridge: UpstreamBridge;
  private readonly rateLimiter: AuthRateLimiter;
  private readonly portDiscovery: PortDiscoveryService;
  private readonly upstreamDispatcher: Agent;

  private app: FastifyInstance | null = null;
  private wss: WebSocketServer | null = null;
  private upgradeHandler:
    ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private activeWsConnections: Set<ActiveWsPair> = new Set();

  private isRunning = false;
  private startedAt?: number;
  private upstreamEpoch = 0;
  private hasCustomUpstreamBridge = false;
  private statusListeners: Set<(status: RelayServerStatus) => void> = new Set();
  private unhookUpstream?: () => void;
  private unhookSessionRevoked?: () => void;
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
    this.hasCustomUpstreamBridge = !!options?.upstreamBridge;
    this.upstreamBridge =
      options?.upstreamBridge ??
      new UpstreamBridge({
        sessionManager: this.sessionManager,
        autoReconnect: false,
      });
    this.rateLimiter = options?.rateLimiter ?? new AuthRateLimiter();

    this.portDiscovery = options?.portDiscovery ?? new PortDiscoveryService();
    if (options?.upstreamPort !== undefined) {
      this.portDiscovery.setPort(options.upstreamPort);
    }

    // Scoped Agent for localhost upstream with self-signed certificate acceptance
    this.upstreamDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
      pipelining: 1,
      keepAliveTimeout: 30000,
    });

    this.wireUpstreamEvents();
    this.wirePortDiscoveryEvents();
    this.wireSessionEvents();
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getUpstreamBridge(): UpstreamBridge {
    return this.upstreamBridge;
  }

  public getPortDiscovery(): PortDiscoveryService {
    return this.portDiscovery;
  }

  public getStatus(): RelayServerStatus {
    const port = this.portDiscovery.getPort();
    const isRestarting = this.portDiscovery.isRestarting();
    const isBuffering = isRestarting || this.upstreamBridge.isBuffering();

    const bridgeStatus = this.upstreamBridge.getStatus();
    const upstreamState: UpstreamBridgeState = isRestarting
      ? "reconnecting"
      : port
        ? "connected"
        : this.hasCustomUpstreamBridge
          ? bridgeStatus.state
          : "disconnected";

    return {
      isRunning: this.isRunning,
      port: this.config.port,
      host: this.config.host,
      activeSessions: this.sessionManager.getActiveSessions().length,
      isBuffering,
      upstream: {
        ...bridgeStatus,
        state: upstreamState,
        targetHost: "127.0.0.1",
        targetPort: port ?? bridgeStatus.targetPort,
      },
      startedAt: this.startedAt,
      upstreamPort: port,
      upstreamEpoch: this.upstreamEpoch,
      isRestarting,
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

    await this.portDiscovery.start();

    const app = fastify({
      logger: false,
      forceCloseConnections: true,
    });

    await app.register(fastifyCors, {
      origin: this.config.corsOrigins,
      credentials: true,
    });

    // Content type parser for all media types allowing raw body forwarding
    app.addContentTypeParser("*", (_request, payload, done) => {
      done(null, payload);
    });

    // Non-proxied health check endpoint
    app.get("/health", async () => {
      const status = this.getStatus();
      return {
        success: true,
        status: "healthy",
        isRunning: this.isRunning,
        activeSessions: status.activeSessions,
        isBuffering: status.isBuffering,
        upstream: status.upstream,
        upstreamPort: status.upstreamPort,
        upstreamEpoch: this.upstreamEpoch,
        isRestarting: status.isRestarting,
        timestamp: Date.now(),
      };
    });

    // Non-proxied status endpoint
    app.get("/api/status", async () => {
      return {
        success: true,
        data: this.getStatus(),
      };
    });

    // Sessions endpoint (backward compatibility)
    app.get("/api/sessions", async () => {
      return {
        success: true,
        data: this.sessionManager.getActiveSessions(),
      };
    });

    // Revoke session endpoint (backward compatibility)
    app.post("/api/sessions/revoke", async (request, reply) => {
      let body = request.body as Record<string, unknown> | undefined;
      if (body && typeof (body as any).pipe === "function") {
        const chunks: Buffer[] = [];
        for await (const chunk of body as any) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          body = {};
        }
      }
      if (!body || typeof body.sessionId !== "string") {
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

    // Wildcard reverse proxy handler
    app.route({
      method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
      url: "/*",
      handler: async (request, reply) => {
        const clientIp = extractClientIp(
          request.headers,
          request.socket?.remoteAddress,
        );
        const userAgent = extractUserAgent(request.headers);

        const rawUrl = request.url || "/";
        const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
        const pairingToken = parsedUrl.searchParams.get("pair") || undefined;
        const token =
          pairingToken ||
          parsedUrl.searchParams.get("token") ||
          (request.headers["x-session-token"] as string | undefined);

        const originalDeviceId = extractDeviceId(
          request.headers,
          parsedUrl.searchParams,
        );
        let deviceId = originalDeviceId;

        const hasDeviceCookie = !!(
          request.headers["cookie"] &&
          /(?:^|;\s*)ag_device_id=/.test(String(request.headers["cookie"]))
        );

        if (!deviceId) {
          deviceId = `dev_${crypto.randomUUID()}`;
          reply.header(
            "Set-Cookie",
            `ag_device_id=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax`,
          );
        } else if (!hasDeviceCookie) {
          reply.header(
            "Set-Cookie",
            `ag_device_id=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax`,
          );
        }

        let session = deviceId
          ? this.sessionManager.getSessionByDeviceId(deviceId)
          : undefined;

        if (session) {
          session.clientIp = clientIp;
          session.userAgent = userAgent;
          if (token && session.token !== token) {
            this.sessionManager.updateSessionToken(session.sessionId, token);
          }
          this.sessionManager.updateSessionActivity(session.sessionId);
        } else if (token) {
          const existingByToken = this.sessionManager.getSessionByToken(token);
          if (existingByToken) {
            existingByToken.clientIp = clientIp;
            existingByToken.userAgent = userAgent;
            if (deviceId && !existingByToken.deviceId) {
              this.sessionManager.updateSessionDeviceId(
                existingByToken.sessionId,
                deviceId,
              );
            }
            this.sessionManager.updateSessionActivity(
              existingByToken.sessionId,
            );
            session = existingByToken;
          } else if (pairingToken) {
            session = this.sessionManager.createSession({
              clientIp,
              userAgent,
              token: pairingToken,
              deviceId,
            });
            this.notifyStatusUpdated();
          }
        } else if (
          parsedUrl.pathname === "/" ||
          parsedUrl.pathname === "/index.html"
        ) {
          if (!originalDeviceId) {
            const existing = this.sessionManager
              .getActiveSessions()
              .find(
                (s) => s.clientIp === clientIp && s.userAgent === userAgent,
              );
            if (existing) {
              if (!existing.deviceId && deviceId) {
                this.sessionManager.updateSessionDeviceId(
                  existing.sessionId,
                  deviceId,
                );
              }
              this.sessionManager.updateSessionActivity(existing.sessionId);
              session = existing;
            }
          }

          if (!session) {
            session = this.sessionManager.createSession({
              clientIp,
              userAgent,
              deviceId,
            });
            this.notifyStatusUpdated();
          }
        } else if (!originalDeviceId) {
          const existing = this.sessionManager
            .getActiveSessions()
            .find((s) => s.clientIp === clientIp && s.userAgent === userAgent);
          if (existing) {
            this.sessionManager.updateSessionActivity(existing.sessionId);
            session = existing;
          }
        }

        const port = this.portDiscovery.getPort();
        if (!port) {
          return reply.status(503).header("Retry-After", "2").send({
            error: "upstream_unavailable",
            retry_after_ms: 2000,
          });
        }

        if (this.portDiscovery.isRestarting()) {
          return reply.status(503).header("Retry-After", "2").send({
            error: "upstream_restarting",
            retry_after_ms: 2000,
          });
        }

        const upstreamUrl = `https://127.0.0.1:${port}${request.url}`;

        const upstreamHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined) continue;
          const lowerKey = key.toLowerCase();
          if (
            lowerKey === "host" ||
            lowerKey === "connection" ||
            lowerKey === "keep-alive" ||
            lowerKey === "transfer-encoding"
          ) {
            continue;
          }
          upstreamHeaders[lowerKey] = Array.isArray(value)
            ? value.join(", ")
            : value;
        }
        upstreamHeaders["host"] = `127.0.0.1:${port}`;

        const method = request.method.toUpperCase();
        const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
        let bodyStream: any = undefined;

        if (hasBody) {
          if (request.body !== undefined && request.body !== null) {
            if (
              Buffer.isBuffer(request.body) ||
              typeof request.body === "string"
            ) {
              bodyStream = request.body;
            } else if (
              typeof (request.body as any).pipe === "function" ||
              typeof (request.body as any)[Symbol.asyncIterator] === "function"
            ) {
              bodyStream = request.body;
            } else {
              bodyStream = JSON.stringify(request.body);
            }
          } else if (request.raw) {
            bodyStream = request.raw;
          }
        }

        const isPotentialHtml =
          method === "GET" &&
          (parsedUrl.pathname === "/" ||
            parsedUrl.pathname === "/index.html" ||
            parsedUrl.pathname.endsWith(".html") ||
            String(request.headers.accept || "").includes("text/html"));

        if (isPotentialHtml) {
          delete upstreamHeaders["accept-encoding"];
        }

        try {
          const upstreamRes = await undiciRequest(upstreamUrl, {
            method: method as any,
            headers: upstreamHeaders,
            body: bodyStream,
            dispatcher: this.upstreamDispatcher,
          });

          const contentType = String(
            upstreamRes.headers["content-type"] || "",
          ).toLowerCase();

          if (
            this.config.injectAutoReload !== false &&
            method === "GET" &&
            upstreamRes.statusCode === 200 &&
            contentType.includes("text/html")
          ) {
            const rawHtml = await upstreamRes.body.text();
            let finalHtml = rawHtml;
            if (!rawHtml.includes('id="antigravity-relay-autoreload"')) {
              const injectedScript = generateAutoReloadScript(
                port,
                this.upstreamEpoch,
              );
              if (finalHtml.includes("</body>")) {
                finalHtml = finalHtml.replace(
                  "</body>",
                  `${injectedScript}</body>`,
                );
              } else if (finalHtml.includes("</head>")) {
                finalHtml = finalHtml.replace(
                  "</head>",
                  `${injectedScript}</head>`,
                );
              } else {
                finalHtml = finalHtml + injectedScript;
              }
            }

            for (const [headerName, headerVal] of Object.entries(
              upstreamRes.headers,
            )) {
              if (headerVal === undefined) continue;
              const lower = headerName.toLowerCase();
              if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-length") {
                continue;
              }
              reply.header(headerName, headerVal);
            }

            return reply.status(upstreamRes.statusCode).send(finalHtml);
          }

          for (const [headerName, headerVal] of Object.entries(
            upstreamRes.headers,
          )) {
            if (headerVal === undefined) continue;
            const lower = headerName.toLowerCase();
            if (HOP_BY_HOP_HEADERS.has(lower)) continue;
            reply.header(headerName, headerVal);
          }

          return reply.status(upstreamRes.statusCode).send(upstreamRes.body);
        } catch {
          const isRestarting = this.portDiscovery.isRestarting();
          return reply
            .status(503)
            .header("Retry-After", "2")
            .send({
              error: isRestarting
                ? "upstream_restarting"
                : "upstream_unavailable",
              retry_after_ms: 2000,
            });
        }
      },
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

    this.setupWebSocketUpgradeHandler();

    if (this.hasCustomUpstreamBridge) {
      this.upstreamBridge.connect().catch(() => {
        // Connect errors handled by upstream bridge buffering
      });
    }

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

    this.portDiscovery.stop();

    for (const pair of this.activeWsConnections) {
      safeClose(pair.clientWs, 1000, "Server stopping");
      safeClose(pair.upstreamWs, 1000, "Server stopping");
    }
    this.activeWsConnections.clear();

    if (this.upgradeHandler && this.app?.server) {
      this.app.server.off("upgrade", this.upgradeHandler);
      this.upgradeHandler = null;
    }

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // Suppress websocket server close error
      }
      this.wss = null;
    }

    for (const session of this.sessionManager.getActiveSessions()) {
      this.sessionManager.closeSessionSocket(
        session.sessionId,
        1000,
        "Server stopping",
      );
    }

    await this.upstreamBridge.disconnect();

    if (this.app) {
      try {
        await this.app.close();
      } catch {
        // Suppress fastify close error
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
          // Suppress socket send error
        }
      }
    }
  }

  public dispose(): void {
    this.stopHeartbeat();
    this.portDiscovery.dispose();
    try {
      this.upstreamDispatcher.destroy();
    } catch {
      // Suppress agent destroy error
    }
    if (this.unhookUpstream) {
      this.unhookUpstream();
      this.unhookUpstream = undefined;
    }
    if (this.unhookSessionRevoked) {
      this.unhookSessionRevoked();
      this.unhookSessionRevoked = undefined;
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

  private setupWebSocketUpgradeHandler(): void {
    if (!this.app?.server) {
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });

    this.upgradeHandler = (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => {
      const parsedUrl = req.url ? new URL(req.url, "http://127.0.0.1") : null;
      const pathname = parsedUrl?.pathname ?? "";

      if (pathname === "/connect-websocket" || pathname === "/ws") {
        const port = this.portDiscovery.getPort();
        if (!port || this.portDiscovery.isRestarting()) {
          const reason = this.portDiscovery.isRestarting()
            ? "upstream_restarting"
            : "upstream_unavailable";
          const body = JSON.stringify({ error: reason, retry_after_ms: 2000 });
          socket.write(
            `HTTP/1.1 503 Service Unavailable\r\n` +
              `Content-Type: application/json\r\n` +
              `Retry-After: 2\r\n` +
              `Content-Length: ${Buffer.byteLength(body)}\r\n` +
              `Connection: close\r\n` +
              `\r\n` +
              body,
          );
          socket.destroy();
          return;
        }

        this.wss?.handleUpgrade(req, socket, head, (clientWs) => {
          this.bridgeWebSocket(clientWs, req, port);
        });
        return;
      }

      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };

    this.app.server.on("upgrade", this.upgradeHandler);
  }

  private bridgeWebSocket(
    clientWs: WebSocket,
    req: IncomingMessage,
    upstreamPort: number,
  ): void {
    const clientIp = extractClientIp(req.headers, req.socket?.remoteAddress);
    const userAgent = extractUserAgent(req.headers);

    const parsedUrl = req.url ? new URL(req.url, "http://127.0.0.1") : null;
    const token =
      parsedUrl?.searchParams.get("pair") ||
      parsedUrl?.searchParams.get("token") ||
      (req.headers["x-session-token"] as string | undefined);
    const originalDeviceId = extractDeviceId(
      req.headers as any,
      parsedUrl?.searchParams,
    );
    let deviceId = originalDeviceId;

    let session: Session | undefined;
    if (deviceId) {
      session = this.sessionManager.getSessionByDeviceId(deviceId);
    }
    if (!session && token) {
      session = this.sessionManager.getSessionByToken(token);
    }

    if (!session) {
      if (!deviceId) {
        const existing = this.sessionManager
          .getActiveSessions()
          .find(
            (s) =>
              s.clientIp === clientIp &&
              s.userAgent === userAgent &&
              s.socketState === "disconnected",
          );
        if (existing) {
          session = existing;
          if (token && session.token !== token) {
            this.sessionManager.updateSessionToken(session.sessionId, token);
          }
        }
      }

      if (!session) {
        if (!deviceId) {
          deviceId = `dev_${crypto.randomUUID()}`;
        }
        session = this.sessionManager.createSession({
          clientIp,
          userAgent,
          token: token || undefined,
          deviceId,
        });
      }
    } else {
      session.clientIp = clientIp;
      session.userAgent = userAgent;
      if (deviceId && !session.deviceId) {
        this.sessionManager.updateSessionDeviceId(session.sessionId, deviceId);
      }
      if (token && session.token !== token) {
        this.sessionManager.updateSessionToken(session.sessionId, token);
      }
    }

    const sessionId = session.sessionId;
    this.sessionManager.bindSocket(sessionId, clientWs);
    this.notifyStatusUpdated();

    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const lowerKey = key.toLowerCase();
      if (
        [
          "host",
          "upgrade",
          "connection",
          "sec-websocket-key",
          "sec-websocket-version",
          "sec-websocket-extensions",
        ].includes(lowerKey)
      ) {
        continue;
      }
      forwardHeaders[lowerKey] = Array.isArray(value)
        ? value.join(", ")
        : value;
    }
    forwardHeaders["host"] = `127.0.0.1:${upstreamPort}`;

    const upstreamUrl = `wss://127.0.0.1:${upstreamPort}${req.url || "/connect-websocket"}`;
    const upstreamWs = new WebSocket(upstreamUrl, {
      headers: forwardHeaders,
      rejectUnauthorized: false,
    });

    const pair: ActiveWsPair = { clientWs, upstreamWs, sessionId };
    this.activeWsConnections.add(pair);

    const pendingMessages: Array<{ data: RawData; isBinary: boolean }> = [];
    let isUpstreamOpen = false;

    upstreamWs.on("open", () => {
      isUpstreamOpen = true;
      for (const msg of pendingMessages) {
        try {
          upstreamWs.send(msg.data, { binary: msg.isBinary });
        } catch {
          // Suppress send error
        }
      }
      pendingMessages.length = 0;
    });

    clientWs.on("message", (data: RawData, isBinary: boolean) => {
      this.sessionManager.updateSessionActivity(sessionId);
      if (isUpstreamOpen && upstreamWs.readyState === WebSocket.OPEN) {
        try {
          upstreamWs.send(data, { binary: isBinary });
        } catch {
          // Suppress send error
        }
      } else if (upstreamWs.readyState === WebSocket.CONNECTING) {
        pendingMessages.push({ data, isBinary });
      }
    });

    upstreamWs.on("message", (data: RawData, isBinary: boolean) => {
      this.sessionManager.updateSessionActivity(sessionId);
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(data, { binary: isBinary });
        } catch {
          // Suppress send error
        }
      }
    });

    clientWs.on("close", (code: number, reason: Buffer) => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(upstreamWs, code, reason);
      this.notifyStatusUpdated();
    });

    upstreamWs.on("close", (code: number, reason: Buffer) => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(clientWs, code, reason);
      this.notifyStatusUpdated();
    });

    clientWs.on("error", () => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(upstreamWs);
      this.notifyStatusUpdated();
    });

    upstreamWs.on("error", () => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(clientWs, 1011, "Upstream connection error");
      this.notifyStatusUpdated();
    });
  }

  private handlePortChanged(_oldPort: number | null, _newPort: number): void {
    this.upstreamEpoch++;
    if (!this.hasCustomUpstreamBridge) {
      this.upstreamBridge.flushBuffer().catch(() => {});
    }
    for (const pair of this.activeWsConnections) {
      if (pair.sessionId) {
        this.sessionManager.unbindSocket(pair.sessionId);
      }
      safeClose(pair.clientWs, 1012, "Service Restart");
      safeClose(pair.upstreamWs, 1012, "Service Restart");
    }
    this.activeWsConnections.clear();
    this.notifyStatusUpdated();
  }

  private handleRestarting(): void {
    this.upstreamEpoch++;
    if (!this.hasCustomUpstreamBridge) {
      this.upstreamBridge.enterBuffering("Antigravity restarting");
    }
    for (const pair of this.activeWsConnections) {
      if (pair.sessionId) {
        this.sessionManager.unbindSocket(pair.sessionId);
      }
      safeClose(pair.clientWs, 1012, "Service Restart");
      safeClose(pair.upstreamWs, 1012, "Service Restart");
    }
    this.activeWsConnections.clear();
    this.notifyStatusUpdated();
  }

  private wireSessionEvents(): void {
    this.unhookSessionRevoked = this.sessionManager.onSessionRevoked(
      (revokedSessionId) => {
        for (const pair of this.activeWsConnections) {
          if (pair.sessionId === revokedSessionId) {
            safeClose(pair.clientWs, 4401, "Session revoked");
            safeClose(pair.upstreamWs, 4401, "Session revoked");
            this.activeWsConnections.delete(pair);
          }
        }
        this.notifyStatusUpdated();
      },
    );
  }

  private wirePortDiscoveryEvents(): void {
    this.portDiscovery.on("port-discovered", () => {
      if (!this.hasCustomUpstreamBridge) {
        this.upstreamBridge.flushBuffer().catch(() => {});
      }
      this.notifyStatusUpdated();
    });

    this.portDiscovery.on("port-changed", ({ oldPort, newPort }) => {
      this.handlePortChanged(oldPort, newPort);
    });

    this.portDiscovery.on("restarting", () => {
      this.handleRestarting();
    });
  }

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
