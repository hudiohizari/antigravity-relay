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
  ChatResumptionStatusPayload,
  InFlightChatSnapshot,
} from "./types";

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 45_000; // 45 seconds
export const DEFAULT_INITIAL_BACKOFF_MS = 200; // 200 ms
export const DEFAULT_MAX_BACKOFF_MS = 2_000; // 2 seconds
export const DEFAULT_FALLBACK_MODEL = "MODEL_PLACEHOLDER_M318"; // Gemini 3.8 Flash (High)

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
  status: "resumed" | "model_fallback" | "failed";
  reason?: string;
  latencyMs: number;
}

export class ChatResumeDispatcher {
  private readonly buffer: SessionContinuityBuffer;
  private readonly portDiscovery?: PortDiscoveryService;
  private readonly httpRequester: HttpRequester;
  private readonly handshakeTimeoutMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly defaultFallbackModel: string;
  private readonly inFlightDispatches = new Set<string>();

  constructor(options?: ChatResumeDispatcherOptions) {
    this.buffer = options?.buffer ?? sessionContinuityBuffer;
    this.portDiscovery = options?.portDiscovery;
    this.httpRequester = options?.httpRequester ?? defaultHttpRequester;
    this.handshakeTimeoutMs =
      options?.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.initialBackoffMs =
      options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.defaultFallbackModel =
      options?.defaultFallbackModel ?? DEFAULT_FALLBACK_MODEL;

    if (this.portDiscovery) {
      this.bindPortDiscovery(this.portDiscovery);
    }
  }

  public bindPortDiscovery(portDiscovery: PortDiscoveryService): void {
    portDiscovery.on("port-discovered", (port: number) => {
      this.onPortDetected(port);
    });
    portDiscovery.on("port-changed", ({ newPort }: { newPort: number }) => {
      this.onPortDetected(newPort);
    });
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
            `https://127.0.0.1:${port}/GetAuthStatus`,
            `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetAuthStatus`,
          ];

          for (const endpoint of authEndpoints) {
            const probeRes = await this.httpRequester(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-codeium-csrf-token": csrfToken,
              },
              body: "{}",
              timeoutMs: 3000,
            });

            if (probeRes.status === 200) {
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

    this.inFlightDispatches.add(resumptionId);

    try {
      const endpoints = [
        `https://127.0.0.1:${port}/SendUserCascadeMessage`,
        `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`,
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
              "x-codeium-csrf-token": csrfToken,
            },
            body: primaryRequestBody,
            timeoutMs: 5000,
          });

          if (res.status === 200) {
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

      // Resumption failed: save draft scratch fallback and emit failure
      const totalDurationMs = Date.now() - startTime;
      const failureReason =
        lastErrorBody || `Language server returned HTTP ${lastErrorStatus}`;

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
    if (!snapshot) {
      return null;
    }

    if (options?.accountEmail) {
      snapshot.accountEmail = options.accountEmail;
    }

    const port = options?.explicitPort ?? this.portDiscovery?.getPort();
    if (!port) {
      logger.info(
        `Port not immediately available for target ${appTarget}, awaiting discovery`,
      );
      return null;
    }

    const handshake = await this.performReadinessHandshake(port, {
      timeoutMs: options?.timeoutMs ?? this.handshakeTimeoutMs,
    });

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

    return this.dispatchSnapshot(snapshot, port, handshake.csrfToken);
  }

  private onPortDetected(port: number): void {
    const targets: AntigravityAppTarget[] = ["app", "ide", "classic"];
    for (const target of targets) {
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

    // Evict failed snapshot
    this.buffer.consume(snapshot.resumptionId);

    chatResumeEvents.recordSessionResumeFailed({
      resumptionId: snapshot.resumptionId,
      appTarget: snapshot.appTarget,
      reason,
      durationMs,
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
