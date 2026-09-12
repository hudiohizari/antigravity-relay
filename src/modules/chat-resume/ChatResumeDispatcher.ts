import https from "node:https";
import http from "node:http";
import type { AntigravityAppTarget } from "@/shared/platform/antigravityAppTarget";
import type { PortDiscoveryService } from "@/modules/relay/port-discovery";
import { logger } from "@/shared/logging/logger";
import {
  sessionContinuityBuffer,
  SessionContinuityBuffer,
} from "./SessionContinuityBuffer";
import { chatResumeEvents } from "./telemetry";
import type {
  ChatResumptionStatus,
  ChatResumptionStatusPayload,
  InFlightChatSnapshot,
} from "./types";

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 45_000; // 45 seconds
export const DEFAULT_INITIAL_BACKOFF_MS = 200; // 200 ms
export const DEFAULT_MAX_BACKOFF_MS = 2_000; // 2 seconds

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: string;
}

export type HttpRequester = (
  url: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
) => Promise<HttpResponse>;

export async function defaultHttpRequester(
  urlStr: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
): Promise<HttpResponse> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: options?.method ?? "GET",
        headers: options?.headers,
        timeout: options?.timeoutMs ?? 5000,
        rejectUnauthorized: false, // Local Language Server uses self-signed TLS certificates
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            data: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(
        new Error(`Request timed out after ${options?.timeoutMs ?? 5000}ms`),
      );
    });

    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export function extractCsrfTokenFromHtml(html: string): string | null {
  // 1. Matches window.__APP_CONFIG__ = {csrfToken: "..."};
  const configMatch = html.match(/csrfToken["']?\s*:\s*["']([^"']+)["']/i);
  if (configMatch && configMatch[1]) {
    return configMatch[1];
  }

  // 2. Matches x-codeium-csrf-token in metadata or script
  const metaMatch = html.match(
    /name=["']csrf-token["']\s+content=["']([^"']+)["']/i,
  );
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }

  return null;
}

export interface ChatResumeDispatcherOptions {
  buffer?: SessionContinuityBuffer;
  portDiscovery?: PortDiscoveryService;
  httpRequester?: HttpRequester;
  handshakeTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  defaultFallbackModel?: string;
}

export interface DispatchResult {
  success: boolean;
  resumptionId: string;
  status: ChatResumptionStatus;
  reason?: string;
  latencyMs: number;
}

export class ChatResumeDispatcher {
  private readonly buffer: SessionContinuityBuffer;
  private portDiscovery?: PortDiscoveryService;
  private readonly httpRequester: HttpRequester;
  private readonly handshakeTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly inFlightDispatches = new Set<string>();
  private readonly activeHandshakes = new Map<
    AntigravityAppTarget,
    AbortController
  >();
  private readonly activeHandshakePorts = new Map<
    AntigravityAppTarget,
    number
  >();
  private readonly waitingTargets = new Set<AntigravityAppTarget>();

  constructor(options?: ChatResumeDispatcherOptions) {
    this.buffer = options?.buffer ?? sessionContinuityBuffer;
    this.portDiscovery = options?.portDiscovery;
    this.httpRequester = options?.httpRequester ?? defaultHttpRequester;
    this.handshakeTimeoutMs =
      options?.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.initialBackoffMs =
      options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

    if (this.portDiscovery) {
      this.bindPortDiscovery(this.portDiscovery);
    }
  }

  public notifyTargetRestarting(appTarget?: AntigravityAppTarget): void {
    if (appTarget) {
      this.waitingTargets.delete(appTarget);
      const active = this.activeHandshakes.get(appTarget);
      if (active) {
        active.abort();
        this.activeHandshakes.delete(appTarget);
        this.activeHandshakePorts.delete(appTarget);
      }
    } else {
      this.waitingTargets.clear();
      for (const controller of this.activeHandshakes.values()) {
        controller.abort();
      }
      this.activeHandshakes.clear();
      this.activeHandshakePorts.clear();
    }

    if (this.portDiscovery) {
      this.portDiscovery.setPort(null);
      this.portDiscovery.setRestarting(true);
    }
  }

  public async waitForPort(timeoutMs = 15_000): Promise<number | null> {
    const discovery = this.portDiscovery;
    if (!discovery) {
      return null;
    }

    const immediate = discovery.getPort();
    if (immediate && !discovery.isRestarting()) {
      return immediate;
    }

    const startTime = Date.now();
    return new Promise<number | null>((resolve) => {
      let resolved = false;
      let pollTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        if (pollTimer) clearInterval(pollTimer);
        discovery.off("port-discovered", onDiscovered);
        discovery.off("port-changed", onChanged);
      };

      const onDiscovered = (port: number) => {
        cleanup();
        resolve(port);
      };

      const onChanged = ({ newPort }: { newPort: number }) => {
        cleanup();
        resolve(newPort);
      };

      discovery.once("port-discovered", onDiscovered);
      discovery.once("port-changed", onChanged);

      pollTimer = setInterval(async () => {
        if (resolved) return;
        if (Date.now() - startTime >= timeoutMs) {
          cleanup();
          resolve(null);
          return;
        }

        try {
          const checked = await discovery.checkOnce();
          if (checked && !discovery.isRestarting()) {
            cleanup();
            resolve(checked);
          }
        } catch {
          // Suppress polling error
        }
      }, 500);

      discovery
        .checkOnce()
        .then((checked) => {
          if (checked && !resolved && !discovery.isRestarting()) {
            cleanup();
            resolve(checked);
          }
        })
        .catch(() => {});
    });
  }

  public bindPortDiscovery(portDiscovery: PortDiscoveryService): void {
    this.portDiscovery = portDiscovery;
    portDiscovery.on("port-discovered", (port: number) => {
      this.onPortDetected(port);
    });
    portDiscovery.on("port-changed", ({ newPort }: { newPort: number }) => {
      this.onPortDetected(newPort);
    });

    const currentPort = portDiscovery.getPort();
    if (currentPort && !portDiscovery.isRestarting()) {
      this.onPortDetected(currentPort);
    }
  }

  public async extractCsrfToken(port: number): Promise<string | null> {
    try {
      const res = await this.httpRequester(`https://127.0.0.1:${port}/`, {
        method: "GET",
        timeoutMs: 3000,
      });

      if (res.status >= 200 && res.status < 400) {
        return extractCsrfTokenFromHtml(res.data);
      }
    } catch {
      // Try HTTP fallback if HTTPS fails
      try {
        const resHttp = await this.httpRequester(`http://127.0.0.1:${port}/`, {
          method: "GET",
          timeoutMs: 3000,
        });
        if (resHttp.status >= 200 && resHttp.status < 400) {
          return extractCsrfTokenFromHtml(resHttp.data);
        }
      } catch {
        // Suppress initial extraction errors
      }
    }

    return null;
  }

  public async performReadinessHandshake(
    port: number,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ ready: boolean; csrfToken: string | null; error?: string }> {
    const timeoutMs = options?.timeoutMs ?? this.handshakeTimeoutMs;
    const startTime = Date.now();
    let backoffMs = this.initialBackoffMs;
    let csrfToken: string | null = null;

    logger.info(
      `Starting Connect-RPC readiness handshake on port ${port} (timeout: ${timeoutMs}ms)`,
    );

    while (Date.now() - startTime < timeoutMs) {
      if (options?.signal?.aborted) {
        return { ready: false, csrfToken: null, error: "Handshake aborted" };
      }

      // Step 1: Extract CSRF token if not yet obtained
      if (!csrfToken) {
        csrfToken = await this.extractCsrfToken(port);
      }

      if (csrfToken) {
        // Step 2: Probe /GetAuthStatus with CSRF token
        try {
          const authEndpoints = [
            `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetAuthStatus`,
            `https://127.0.0.1:${port}/GetAuthStatus`,
          ];

          for (const endpoint of authEndpoints) {
            if (options?.signal?.aborted) {
              return {
                ready: false,
                csrfToken: null,
                error: "Handshake aborted",
              };
            }

            const probeRes = await this.httpRequester(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Connect-Protocol-Version": "1",
                "x-codeium-csrf-token": csrfToken,
              },
              body: "{}",
              timeoutMs: 3000,
            });

            const contentType = String(probeRes.headers["content-type"] || "");
            const isHtml = contentType.toLowerCase().includes("text/html");

            if (probeRes.status === 200 && !isHtml) {
              logger.info(`Connect-RPC readiness confirmed on ${endpoint}`);
              return { ready: true, csrfToken };
            }
          }
        } catch {
          // Probe failed, continue backoff loop
        }
      }

      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(this.maxBackoffMs, backoffMs * 1.5);
    }

    return {
      ready: false,
      csrfToken,
      error: `Readiness handshake timed out after ${timeoutMs}ms on port ${port}`,
    };
  }

  public async dispatchSnapshot(
    snapshot: InFlightChatSnapshot,
    port: number,
    csrfToken: string,
  ): Promise<DispatchResult> {
    const startTime = Date.now();
    const { resumptionId, appTarget, accountEmail } = snapshot;

    // Singleflight safeguard
    if (this.inFlightDispatches.has(resumptionId)) {
      logger.warn(
        `Resumption already in flight for ${resumptionId}, ignoring duplicate call`,
      );
      return {
        success: false,
        resumptionId,
        status: "failed",
        reason: "duplicate_dispatch_in_flight",
        latencyMs: 0,
      };
    }

    // Atomic claim
    snapshot.status = "in_flight";
    this.inFlightDispatches.add(resumptionId);

    try {
      const endpoints = [
        `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`,
        `https://127.0.0.1:${port}/SendUserCascadeMessage`,
      ];

      const promptText = snapshot.promptPayload.prompt;
      const requestedModel = snapshot.promptPayload.requestedModel;
      let cascadeConfig: Record<string, unknown> = {};
      if (
        snapshot.promptPayload.cascadeConfig &&
        typeof snapshot.promptPayload.cascadeConfig === "object"
      ) {
        const raw = snapshot.promptPayload.cascadeConfig as Record<
          string,
          unknown
        >;
        if (raw.requestedModel || raw.planModel) {
          cascadeConfig = raw;
        } else if (raw.model) {
          cascadeConfig = { requestedModel: { model: raw.model } };
        } else if (requestedModel) {
          cascadeConfig = {
            requestedModel: {
              model: requestedModel,
            },
          };
        }
      } else if (requestedModel) {
        cascadeConfig = {
          requestedModel: {
            model: requestedModel,
          },
        };
      }

      const primaryRequestBody = JSON.stringify({
        cascadeId: snapshot.cascadeId,
        items: [
          {
            chunk: {
              case: "text",
              value: promptText,
            },
          },
        ],
        prompt: promptText,
        cascadeConfig,
        contextReferences: snapshot.promptPayload.contextReferences ?? [],
      });

      let dispatchSuccess = false;
      let lastErrorStatus = 0;
      let lastErrorBody = "";

      for (const endpoint of endpoints) {
        try {
          const res = await this.httpRequester(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Connect-Protocol-Version": "1",
              "x-codeium-csrf-token": csrfToken,
            },
            body: primaryRequestBody,
            timeoutMs: 5000,
          });

          const contentType = String(res.headers["content-type"] || "");
          const isHtml = contentType.toLowerCase().includes("text/html");

          if (res.status === 200 && !isHtml) {
            dispatchSuccess = true;
            break;
          }

          lastErrorStatus = res.status;
          lastErrorBody = res.data;

          // Only attempt alternative URL if endpoint was not found (404)
          if (res.status !== 404) {
            break;
          }
        } catch (err) {
          lastErrorBody = err instanceof Error ? err.message : String(err);
        }
      }

      // Success path
      if (dispatchSuccess) {
        const latencyMs = Date.now() - startTime;
        this.buffer.consume(resumptionId);

        const statusPayload: ChatResumptionStatusPayload = {
          status: "resumed",
          resumptionId,
          target: appTarget,
          accountEmail,
          resumptionLatencyMs: latencyMs,
        };

        chatResumeEvents.recordSessionAutoResumed({
          resumptionId,
          appTarget,
          resumptionLatencyMs: latencyMs,
          status: "success",
        });

        chatResumeEvents.emitResumptionStatus(statusPayload);

        return {
          success: true,
          resumptionId,
          status: "resumed",
          latencyMs,
        };
      }

      // Strict No-Downgrade failure path
      const totalDurationMs = Date.now() - startTime;
      const isQuotaError =
        lastErrorStatus === 403 ||
        lastErrorStatus === 429 ||
        /quota|exhausted|rate.?limit/i.test(lastErrorBody);

      const failureReason = isQuotaError
        ? "model_quota_restricted"
        : lastErrorBody || `Language server returned HTTP ${lastErrorStatus}`;

      this.handleResumptionFailure(snapshot, failureReason, totalDurationMs);

      return {
        success: false,
        resumptionId,
        status: "failed",
        reason: failureReason,
        latencyMs: totalDurationMs,
      };
    } finally {
      this.inFlightDispatches.delete(resumptionId);
    }
  }

  public async triggerResumptionForTarget(
    appTarget: AntigravityAppTarget,
    options?: {
      accountEmail?: string;
      explicitPort?: number;
      timeoutMs?: number;
    },
  ): Promise<DispatchResult | null> {
    const snapshot = this.buffer.getLatestForTarget(appTarget);
    if (!snapshot || snapshot.status !== "pending") {
      return null;
    }

    if (options?.accountEmail) {
      snapshot.accountEmail = options.accountEmail;
    }

    let port = options?.explicitPort ?? this.portDiscovery?.getPort();
    if (
      !port ||
      (this.portDiscovery?.isRestarting() && !options?.explicitPort)
    ) {
      logger.info(
        `Port not immediately available for target ${appTarget}, waiting for discovery...`,
      );
      this.waitingTargets.add(appTarget);
      try {
        port =
          (await this.waitForPort(
            options?.timeoutMs ?? this.handshakeTimeoutMs,
          )) ?? undefined;
      } finally {
        this.waitingTargets.delete(appTarget);
      }
    }

    if (!port) {
      logger.warn(
        `Port discovery timed out for target ${appTarget}, unable to resume session`,
      );
      return null;
    }

    // If a handshake is already active for this target on the exact same port, don't duplicate or abort!
    if (
      this.activeHandshakes.has(appTarget) &&
      this.activeHandshakePorts.get(appTarget) === port
    ) {
      return null;
    }

    // Abort existing handshake for this target if on a DIFFERENT port
    const existing = this.activeHandshakes.get(appTarget);
    if (existing) {
      existing.abort();
      this.activeHandshakes.delete(appTarget);
      this.activeHandshakePorts.delete(appTarget);
    }

    const controller = new AbortController();
    this.activeHandshakes.set(appTarget, controller);
    this.activeHandshakePorts.set(appTarget, port);

    try {
      const handshake = await this.performReadinessHandshake(port, {
        timeoutMs: options?.timeoutMs ?? this.handshakeTimeoutMs,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        logger.info(
          `Handshake aborted for target ${appTarget} on port ${port}`,
        );
        return null;
      }

      if (snapshot.status !== "pending") {
        return null;
      }

      if (!handshake.ready || !handshake.csrfToken) {
        const reason =
          handshake.error ?? "Language server readiness handshake failed";
        this.handleResumptionFailure(snapshot, reason, this.handshakeTimeoutMs);
        return {
          success: false,
          resumptionId: snapshot.resumptionId,
          status: "failed",
          reason,
          latencyMs: this.handshakeTimeoutMs,
        };
      }

      return await this.dispatchSnapshot(snapshot, port, handshake.csrfToken);
    } finally {
      if (this.activeHandshakes.get(appTarget) === controller) {
        this.activeHandshakes.delete(appTarget);
        this.activeHandshakePorts.delete(appTarget);
      }
    }
  }

  private onPortDetected(port: number): void {
    const targets: AntigravityAppTarget[] = ["app", "ide", "classic"];
    for (const target of targets) {
      if (
        this.waitingTargets.has(target) ||
        (this.activeHandshakes.has(target) &&
          this.activeHandshakePorts.get(target) === port)
      ) {
        continue;
      }

      const snapshot = this.buffer.getLatestForTarget(target);
      if (snapshot && snapshot.status === "pending") {
        this.triggerResumptionForTarget(target, { explicitPort: port }).catch(
          (err) => {
            logger.warn(
              `Autonomous resumption dispatch failed for target ${target}`,
              err,
            );
          },
        );
      }
    }
  }

  private handleResumptionFailure(
    snapshot: InFlightChatSnapshot,
    reason: string,
    durationMs: number,
  ): void {
    if (snapshot.status === "resumed") {
      return;
    }

    const promptText = snapshot.promptPayload.prompt;

    // Preserve unsent prompt in scratch memory
    if (promptText) {
      this.buffer.saveDraft({
        resumptionId: snapshot.resumptionId,
        prompt: promptText,
        appTarget: snapshot.appTarget,
        reason,
        accountEmail: snapshot.accountEmail,
      });
    }

    // Evict failed snapshot from buffer
    this.buffer.consume(snapshot.resumptionId);

    chatResumeEvents.recordSessionResumeFailed({
      resumptionId: snapshot.resumptionId,
      appTarget: snapshot.appTarget,
      reason,
      durationMs,
      preservedInScratch: true,
    });

    chatResumeEvents.emitResumptionStatus({
      status: "failed",
      resumptionId: snapshot.resumptionId,
      target: snapshot.appTarget,
      accountEmail: snapshot.accountEmail,
      reason,
      draftPrompt: promptText,
    });
  }
}

export const chatResumeDispatcher = new ChatResumeDispatcher();
