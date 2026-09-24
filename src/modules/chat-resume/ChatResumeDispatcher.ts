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
    signal?: AbortSignal;
  },
) => Promise<HttpResponse>;

export async function defaultHttpRequester(
  urlStr: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<HttpResponse> {
  const url = new URL(urlStr);
  const isHttps = url.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error("Request aborted"));
      return;
    }

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
        res.on("error", (err) => {
          cleanupSignal();
          reject(err);
        });
        res.on("end", () => {
          cleanupSignal();
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            data: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );

    const abortHandler = () => {
      req.destroy();
      reject(new Error("Request aborted"));
    };

    const cleanupSignal = () => {
      if (options?.signal) {
        options.signal.removeEventListener("abort", abortHandler);
      }
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }

    req.on("error", (err) => {
      cleanupSignal();
      reject(err);
    });

    req.on("timeout", () => {
      cleanupSignal();
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

export function isTransientConnectionError(
  errOrMessage: unknown,
  status?: number,
): boolean {
  if (status === 502 || status === 503) {
    return true;
  }
  const msg =
    errOrMessage instanceof Error
      ? `${errOrMessage.message} ${(errOrMessage as any).code ?? ""}`
      : String(errOrMessage ?? "");
  const transientPatterns = [
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "UND_ERR_CONNECT_TIMEOUT",
    "socket hang up",
    "socket hangup",
    "ETIMEDOUT",
    "ECONNABORTED",
    "Client network socket disconnected",
  ];
  return transientPatterns.some((p) =>
    msg.toLowerCase().includes(p.toLowerCase()),
  );
}

export function isValidProtoModelEnum(model?: unknown): boolean {
  return typeof model === "string" && /^MODEL_[A-Z0-9_]+$/.test(model.trim());
}

export function isValidModelName(name?: unknown): boolean {
  if (typeof name !== "string") {
    return false;
  }
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return false;
  }
  if (isValidProtoModelEnum(trimmed)) {
    return false;
  }
  const rejectedTokens =
    /^(?:and|the|or|with|model|none|null|undefined|\.\.\.|model_name|step_payload)$/i;
  if (rejectedTokens.test(trimmed)) {
    return false;
  }
  const validVendorPrefix =
    /^(?:claude|gemini|gpt|o[1-9]|deepseek|custom)[_\-\.][a-z0-9_\-\.]+$/i;
  const validHyphenated = /^[a-z0-9]+(?:-[a-z0-9]+)+$/i;
  return validVendorPrefix.test(trimmed) || validHyphenated.test(trimmed);
}

export interface NormalizedModelResult {
  enumModel?: string;
  modelName?: string;
}

export function normalizeModelToProtoEnum(
  rawModel?: string,
  modelNameOverride?: string,
): NormalizedModelResult {
  const validOverride =
    modelNameOverride && isValidModelName(modelNameOverride)
      ? modelNameOverride.trim()
      : undefined;

  if (
    !rawModel ||
    typeof rawModel !== "string" ||
    rawModel.trim().length === 0
  ) {
    return validOverride ? { modelName: validOverride } : {};
  }

  const trimmed = rawModel.trim();

  if (isValidProtoModelEnum(trimmed)) {
    return {
      enumModel: trimmed,
      ...(validOverride ? { modelName: validOverride } : {}),
    };
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("gemini")) {
    const rawValid = isValidModelName(trimmed) ? trimmed : undefined;
    return {
      enumModel: "MODEL_PLACEHOLDER_M318",
      ...(validOverride
        ? { modelName: validOverride }
        : rawValid
          ? { modelName: rawValid }
          : {}),
    };
  }

  const rawValid = isValidModelName(trimmed) ? trimmed : undefined;
  const finalName = validOverride ?? rawValid;
  return finalName ? { modelName: finalName } : {};
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
  private readonly handshakeStartTimes = new Map<
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

  public abortActiveHandshake(
    appTarget: AntigravityAppTarget,
    newPort?: number,
  ): boolean {
    const existing = this.activeHandshakes.get(appTarget);
    if (!existing) {
      return false;
    }
    const oldPort = this.activeHandshakePorts.get(appTarget);
    const startTime = this.handshakeStartTimes.get(appTarget) ?? Date.now();
    existing.abort();
    this.activeHandshakes.delete(appTarget);
    this.activeHandshakePorts.delete(appTarget);
    this.handshakeStartTimes.delete(appTarget);

    if (oldPort !== undefined && newPort !== undefined && oldPort !== newPort) {
      chatResumeEvents.recordHandshakePortSwitched({
        appTarget,
        oldPort,
        newPort,
        handshakeElapsedMs: Math.max(0, Date.now() - startTime),
      });
    }
    return true;
  }

  public notifyTargetRestarting(appTarget?: AntigravityAppTarget): void {
    let lastPort: number | null = null;
    if (appTarget && this.activeHandshakePorts.has(appTarget)) {
      lastPort = this.activeHandshakePorts.get(appTarget) ?? null;
    } else if (this.portDiscovery?.getPort()) {
      lastPort = this.portDiscovery.getPort();
    }

    if (appTarget) {
      this.waitingTargets.delete(appTarget);
      this.abortActiveHandshake(appTarget);
    } else {
      this.waitingTargets.clear();
      for (const target of Array.from(this.activeHandshakes.keys())) {
        this.abortActiveHandshake(target);
      }
    }

    if (this.portDiscovery) {
      this.portDiscovery.setPort(null);
      this.portDiscovery.setRestarting(true, lastPort);
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

  public async extractCsrfToken(
    port: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (signal?.aborted) {
      return null;
    }
    try {
      const res = await this.httpRequester(`https://127.0.0.1:${port}/`, {
        method: "GET",
        timeoutMs: 3000,
        signal,
      });

      if (res.status >= 200 && res.status < 400) {
        return extractCsrfTokenFromHtml(res.data);
      }
    } catch {
      if (signal?.aborted) {
        return null;
      }
      // Try HTTP fallback if HTTPS fails
      try {
        const resHttp = await this.httpRequester(`http://127.0.0.1:${port}/`, {
          method: "GET",
          timeoutMs: 3000,
          signal,
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
        csrfToken = await this.extractCsrfToken(port, options?.signal);
      }

      if (options?.signal?.aborted) {
        return { ready: false, csrfToken: null, error: "Handshake aborted" };
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
              signal: options?.signal,
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

      if (options?.signal?.aborted) {
        return { ready: false, csrfToken: null, error: "Handshake aborted" };
      }

      // Exponential backoff with abort sensitivity
      await new Promise<void>((resolve) => {
        let timer: NodeJS.Timeout | null = null;
        const onAbort = () => {
          if (timer) clearTimeout(timer);
          options?.signal?.removeEventListener("abort", onAbort);
          resolve();
        };

        options?.signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(() => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, backoffMs);
      });

      if (options?.signal?.aborted) {
        return { ready: false, csrfToken: null, error: "Handshake aborted" };
      }

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

      const promptText = snapshot.isInterrupted
        ? "Continue your previous response."
        : snapshot.promptPayload.prompt;
      const existingConfig =
        snapshot.promptPayload.cascadeConfig &&
        typeof snapshot.promptPayload.cascadeConfig === "object"
          ? (snapshot.promptPayload.cascadeConfig as Record<string, unknown>)
          : {};

      const existingPlanner =
        typeof existingConfig.plannerConfig === "object" &&
        existingConfig.plannerConfig !== null
          ? { ...(existingConfig.plannerConfig as Record<string, unknown>) }
          : {};

      const rawModel =
        snapshot.promptPayload.requestedModel ||
        (typeof (existingConfig.requestedModel as any)?.model === "string"
          ? (existingConfig.requestedModel as any).model
          : undefined) ||
        (typeof existingConfig.model === "string"
          ? existingConfig.model
          : undefined) ||
        (typeof existingPlanner.modelName === "string"
          ? existingPlanner.modelName
          : undefined);

      const modelNameHint =
        typeof existingPlanner.modelName === "string"
          ? existingPlanner.modelName
          : undefined;

      const { enumModel, modelName } = normalizeModelToProtoEnum(
        rawModel,
        modelNameHint,
      );

      const inheritedNative = !isValidProtoModelEnum(enumModel);
      chatResumeEvents.recordModelResolved({
        appTarget,
        resolvedEnum: isValidProtoModelEnum(enumModel) ? enumModel : undefined,
        modelName,
        inheritedNative,
      });

      const cascadeConfig: Record<string, unknown> = {
        ...existingConfig,
      };

      if (isValidProtoModelEnum(enumModel)) {
        const plannerConfig: Record<string, unknown> = {
          ...existingPlanner,
          requestedModel: {
            model: enumModel,
            choice: { case: "model", value: enumModel },
          },
          planModel: enumModel,
        };

        if (modelName) {
          plannerConfig.modelName = modelName;
        }

        cascadeConfig.plannerConfig = plannerConfig;
        cascadeConfig.requestedModel = {
          model: enumModel,
        };
      } else {
        // Safe Native Model Inheritance: OMIT requestedModel and planModel overrides
        delete cascadeConfig.requestedModel;
        delete existingPlanner.requestedModel;
        delete existingPlanner.planModel;

        if (modelName) {
          existingPlanner.modelName = modelName;
        }

        if (Object.keys(existingPlanner).length > 0) {
          cascadeConfig.plannerConfig = existingPlanner;
        } else {
          delete cascadeConfig.plannerConfig;
        }
      }

      const primaryRequestBody = JSON.stringify({
        cascadeId: snapshot.cascadeId,
        items: [
          {
            text: promptText,
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

      const isTransient = isTransientConnectionError(
        lastErrorBody,
        lastErrorStatus,
      );
      const retryCount = snapshot.retryCount ?? 0;
      const maxRetries = 3;
      const maxRetryTimeMs = 60_000;
      const withinRetryLimit =
        retryCount < maxRetries &&
        Date.now() - snapshot.capturedAt < maxRetryTimeMs;

      // Preserve snapshot in buffer on transient network drops during restart
      if (isTransient && withinRetryLimit && !isQuotaError) {
        this.buffer.revertToPending(resumptionId);

        logger.info(
          `Transient error during dispatch for ${resumptionId} (retry ${snapshot.retryCount ?? 1}/${maxRetries}): ${failureReason}. Preserving in buffer for port recovery.`,
        );

        chatResumeEvents.recordResumptionTransientRetry({
          resumptionId,
          appTarget,
          error: failureReason,
          retryCount: snapshot.retryCount ?? 1,
          status: "pending",
        });

        return {
          success: false,
          resumptionId,
          status: "failed",
          reason: failureReason,
          latencyMs: totalDurationMs,
        };
      }

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
    const pendingSnapshots = this.buffer.getAllPendingForTarget(appTarget);
    if (pendingSnapshots.length === 0) {
      return null;
    }

    if (options?.accountEmail) {
      for (const snap of pendingSnapshots) {
        snap.accountEmail = options.accountEmail;
      }
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
    if (this.activeHandshakes.has(appTarget)) {
      this.abortActiveHandshake(appTarget, port);
    }

    const controller = new AbortController();
    this.activeHandshakes.set(appTarget, controller);
    this.activeHandshakePorts.set(appTarget, port);
    this.handshakeStartTimes.set(appTarget, Date.now());

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

      if (!handshake.ready || !handshake.csrfToken) {
        const reason =
          handshake.error ?? "Language server readiness handshake failed";
        for (const snap of pendingSnapshots) {
          this.handleResumptionFailure(snap, reason, this.handshakeTimeoutMs);
        }
        return {
          success: false,
          resumptionId: pendingSnapshots[0]?.resumptionId ?? "",
          status: "failed",
          reason,
          latencyMs: this.handshakeTimeoutMs,
        };
      }

      const results = await Promise.all(
        pendingSnapshots.map((snap) =>
          this.dispatchSnapshot(snap, port, handshake.csrfToken!),
        ),
      );

      return results[0] ?? null;
    } finally {
      if (this.activeHandshakes.get(appTarget) === controller) {
        this.activeHandshakes.delete(appTarget);
        this.activeHandshakePorts.delete(appTarget);
        this.handshakeStartTimes.delete(appTarget);
      }
    }
  }

  private onPortDetected(port: number): void {
    const targets: AntigravityAppTarget[] = ["app", "ide", "classic"];
    for (const target of targets) {
      const currentHandshakePort = this.activeHandshakePorts.get(target);
      if (
        this.activeHandshakes.has(target) &&
        currentHandshakePort !== undefined
      ) {
        if (currentHandshakePort === port) {
          continue;
        }
        logger.info(
          `Port changed from ${currentHandshakePort} to ${port} while handshake active for ${target}; aborting and pivoting...`,
        );
        this.abortActiveHandshake(target, port);
      }

      if (this.waitingTargets.has(target)) {
        continue;
      }

      const pending = this.buffer.getAllPendingForTarget(target);
      if (pending.length > 0) {
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
