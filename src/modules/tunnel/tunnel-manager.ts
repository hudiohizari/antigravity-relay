import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  TunnelConfig,
  TunnelStatus,
  TunnelState,
  DEFAULT_TUNNEL_CONFIG,
} from "./types";

export interface ChildProcessLike extends EventEmitter {
  pid?: number;
  killed?: boolean;
  stdout?: EventEmitter | null;
  stderr?: EventEmitter | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnFunction = (
  command: string,
  args: string[],
  options?: Record<string, unknown>,
) => ChildProcessLike;

export interface TunnelManagerOptions {
  config?: Partial<TunnelConfig>;
  spawnFn?: SpawnFunction;
  escalationTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

export function isMissingBinaryError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "object") {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return true;
    }
  }
  const msg =
    typeof err === "string"
      ? err
      : (err as { message?: string }).message || String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("enoent") ||
    lower.includes("not found") ||
    lower.includes("executable missing")
  );
}

export class TunnelManager {
  private config: TunnelConfig;
  private readonly spawnFn: SpawnFunction;
  private readonly escalationTimeoutMs: number;
  private readonly connectionTimeoutMs: number;

  private state: TunnelState = "stopped";
  private publicUrl: string | null = null;
  private currentProcess: ChildProcessLike | null = null;
  private pid: number | null = null;
  private startedAt: number | null = null;
  private reconnectAttempts = 0;
  private lastError?: string;
  private isStopping = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private statusListeners: Set<(status: TunnelStatus) => void> = new Set();

  constructor(options?: TunnelManagerOptions) {
    this.config = {
      ...DEFAULT_TUNNEL_CONFIG,
      ...options?.config,
    };
    this.spawnFn =
      options?.spawnFn ??
      ((cmd, args, opts) =>
        spawn(cmd, args, opts as any) as unknown as ChildProcessLike);
    this.escalationTimeoutMs = options?.escalationTimeoutMs ?? 3000;
    this.connectionTimeoutMs = options?.connectionTimeoutMs ?? 5000;
  }

  public getStatus(): TunnelStatus {
    return {
      state: this.state,
      publicUrl: this.publicUrl,
      pid: this.pid,
      startedAt: this.startedAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
      protocol: "quic",
    };
  }

  public getPublicUrl(): string | null {
    return this.publicUrl;
  }

  public onStatusUpdated(callback: (status: TunnelStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  public async start(overrides?: Partial<TunnelConfig>): Promise<TunnelStatus> {
    if (this.state === "connected" && this.currentProcess) {
      return this.getStatus();
    }

    if (overrides) {
      this.config = { ...this.config, ...overrides };
    }

    this.isStopping = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();

    return this.launchSubprocess();
  }

  public async restart(
    overrides?: Partial<TunnelConfig>,
  ): Promise<TunnelStatus> {
    await this.stop();
    return this.start(overrides);
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();

    if (!this.currentProcess) {
      this.transitionState("stopped");
      this.publicUrl = null;
      this.pid = null;
      this.startedAt = null;
      return;
    }

    const proc = this.currentProcess;
    this.currentProcess = null;

    await new Promise<void>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          this.transitionState("stopped");
          this.publicUrl = null;
          this.pid = null;
          this.startedAt = null;
          resolve();
        }
      };

      const escalationTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Suppress error
        }
        finish();
      }, this.escalationTimeoutMs);

      proc.once("exit", () => {
        clearTimeout(escalationTimer);
        finish();
      });

      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(escalationTimer);
        finish();
      }
    });
  }

  public extractUrl(output: string): string | null {
    // trycloudflare URL regex
    const quickRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g;
    const match = quickRegex.exec(output);
    if (match) {
      return match[0];
    }

    // Custom vanity domain regex if configured
    if (this.config.customDomain) {
      const customPattern = new RegExp(
        `https?:\\/\\/${this.config.customDomain.replace(".", "\\.")}[^\\s]*`,
        "i",
      );
      const customMatch = customPattern.exec(output);
      if (customMatch) {
        return customMatch[0];
      }
    }

    return null;
  }

  // --- Private Subprocess Management ---

  private async launchSubprocess(): Promise<TunnelStatus> {
    this.transitionState(
      this.reconnectAttempts > 0 ? "reconnecting" : "starting",
    );

    const binary = this.config.binaryPath || "cloudflared";
    const args: string[] = [];

    if (this.config.namedTunnelToken) {
      args.push("tunnel", "run", "--token", this.config.namedTunnelToken);
    } else {
      args.push(
        "tunnel",
        "--url",
        `http://127.0.0.1:${this.config.targetPort}`,
        "--no-autoupdate",
      );
    }

    try {
      const proc = this.spawnFn(binary, args, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.currentProcess = proc;
      this.pid = proc.pid ?? null;
      this.startedAt = Date.now();

      proc.stdout?.on("data", (chunk: Buffer | string) => {
        this.handleProcessOutput(chunk.toString());
      });

      proc.stderr?.on("data", (chunk: Buffer | string) => {
        this.handleProcessOutput(chunk.toString());
      });

      proc.on("error", (err: Error) => {
        this.handleProcessFailure(err);
      });

      proc.on("exit", (code: number | null, signal: string | null) => {
        this.handleProcessExit(code, signal);
      });

      // Await URL acquisition or failure
      return await this.waitForConnection();
    } catch (err) {
      this.handleProcessFailure(err);
      return this.getStatus();
    }
  }

  private handleProcessOutput(text: string): void {
    const url = this.extractUrl(text);
    if (url && this.state !== "connected") {
      this.publicUrl = url;
      this.reconnectAttempts = 0;
      this.lastError = undefined;
      this.transitionState("connected");
    }
  }

  private handleProcessFailure(error: unknown): void {
    if (this.isStopping) {
      this.lastError =
        typeof error === "string"
          ? error
          : (error as Error)?.message || String(error);
      return;
    }

    this.currentProcess = null;
    this.pid = null;

    if (isMissingBinaryError(error)) {
      this.clearReconnectTimer();
      this.lastError = "cloudflared executable not found in PATH";
      this.transitionState("error");
      return;
    }

    const errorMessage =
      typeof error === "string"
        ? error
        : (error as Error)?.message || String(error);
    this.lastError = errorMessage;

    if (
      this.config.autoRestart &&
      this.reconnectAttempts < this.config.maxRetries
    ) {
      this.scheduleReconnect();
    } else {
      this.transitionState("error");
    }
  }

  private handleProcessExit(code: number | null, _signal: string | null): void {
    if (this.isStopping) {
      this.transitionState("stopped");
      this.currentProcess = null;
      this.pid = null;
      return;
    }

    if (
      this.state === "error" &&
      this.lastError === "cloudflared executable not found in PATH"
    ) {
      this.currentProcess = null;
      this.pid = null;
      return;
    }

    this.currentProcess = null;
    this.pid = null;

    if (code !== 0) {
      this.lastError = `Process exited with code ${code}`;
    }

    if (
      this.config.autoRestart &&
      this.reconnectAttempts < this.config.maxRetries
    ) {
      this.scheduleReconnect();
    } else {
      this.transitionState("error");
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;

    const delay = Math.min(
      this.config.retryBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      30000,
    );

    this.transitionState("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.launchSubprocess().catch(() => {
        // Suppress failure, will retry or transition to error
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private waitForConnection(
    timeoutMs = this.connectionTimeoutMs,
  ): Promise<TunnelStatus> {
    return new Promise((resolve) => {
      if (
        this.state === "connected" ||
        this.state === "error" ||
        this.state === "stopped"
      ) {
        return resolve(this.getStatus());
      }

      const timer = setTimeout(() => {
        cleanup();
        resolve(this.getStatus());
      }, timeoutMs);

      const onStatus = (status: TunnelStatus) => {
        if (
          status.state === "connected" ||
          status.state === "error" ||
          status.state === "stopped"
        ) {
          cleanup();
          resolve(status);
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.statusListeners.delete(onStatus);
      };

      this.statusListeners.add(onStatus);
    });
  }

  private transitionState(newState: TunnelState): void {
    this.state = newState;
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
