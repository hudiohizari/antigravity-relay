import { WebSocket } from "ws";
import {
  UpstreamBridgeState,
  UpstreamBridgeStatus,
  BufferedMessage,
} from "./types";
import { SessionManager } from "./session-manager";
import { SwitchFlow } from "../switcher/switch-flow";
import { SwitchResult } from "../switcher/types";

export interface UpstreamTransport {
  connect(url: string): Promise<void>;
  send(data: string): Promise<void> | void;
  close(code?: number, reason?: string): Promise<void> | void;
  isReady(): boolean;
  onMessage(callback: (data: string) => void): void;
  onClose(callback: (code: number, reason: string) => void): void;
  onError(callback: (err: Error) => void): void;
}

export class DefaultWebSocketTransport implements UpstreamTransport {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<(data: string) => void> = new Set();
  private closeHandlers: Set<(code: number, reason: string) => void> =
    new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();

  public async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        const openHandler = () => {
          cleanup();
          resolve();
        };

        const errorHandler = (err: Error) => {
          cleanup();
          reject(err);
        };

        const cleanup = () => {
          if (this.ws) {
            this.ws.removeListener("open", openHandler);
            this.ws.removeListener("error", errorHandler);
          }
        };

        this.ws.once("open", openHandler);
        this.ws.once("error", errorHandler);

        this.ws.on("message", (data) => {
          const text = data.toString();
          for (const handler of this.messageHandlers) {
            handler(text);
          }
        });

        this.ws.on("close", (code, reason) => {
          for (const handler of this.closeHandlers) {
            handler(code, reason.toString());
          }
        });

        this.ws.on("error", (err) => {
          for (const handler of this.errorHandlers) {
            handler(err);
          }
        });
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  public send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Upstream WebSocket is not open");
    }
    this.ws.send(data);
  }

  public close(code = 1000, reason = "Normal closure"): void {
    if (this.ws) {
      try {
        this.ws.close(code, reason);
      } catch {
        // Suppress close error
      }
      this.ws = null;
    }
  }

  public isReady(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public onMessage(callback: (data: string) => void): void {
    this.messageHandlers.add(callback);
  }

  public onClose(callback: (code: number, reason: string) => void): void {
    this.closeHandlers.add(callback);
  }

  public onError(callback: (err: Error) => void): void {
    this.errorHandlers.add(callback);
  }
}

export interface UpstreamBridgeOptions {
  sessionManager: SessionManager;
  targetHost?: string;
  targetPort?: number;
  autoReconnect?: boolean;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  transportFactory?: () => UpstreamTransport;
}

export class UpstreamBridge {
  private readonly sessionManager: SessionManager;
  private targetHost: string;
  private targetPort: number;
  private readonly autoReconnect: boolean;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly transportFactory: () => UpstreamTransport;

  private transport: UpstreamTransport | null = null;
  private state: UpstreamBridgeState = "disconnected";
  private buffering = false;
  private reconnectAttempts = 0;
  private flushedCommandCount = 0;
  private lastHeartbeatAt?: number;
  private lastError?: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isDisposed = false;

  private stateListeners: Set<(status: UpstreamBridgeStatus) => void> =
    new Set();
  private messageListeners: Set<(data: unknown) => void> = new Set();
  private bufferingAlertListeners: Set<(reason: string) => void> = new Set();
  private swapResumedListeners: Set<() => void> = new Set();

  constructor(options: UpstreamBridgeOptions) {
    this.sessionManager = options.sessionManager;
    this.targetHost = options.targetHost ?? "127.0.0.1";
    this.targetPort = options.targetPort ?? 4041;
    this.autoReconnect = options.autoReconnect ?? true;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 10000;
    this.transportFactory =
      options.transportFactory ?? (() => new DefaultWebSocketTransport());
  }

  public getStatus(): UpstreamBridgeStatus {
    return {
      state: this.state,
      targetHost: this.targetHost,
      targetPort: this.targetPort,
      lastHeartbeatAt: this.lastHeartbeatAt,
      reconnectAttempts: this.reconnectAttempts,
      bufferedCommandCount: this.sessionManager.getBufferedCount(),
      flushedCommandCount: this.flushedCommandCount,
      lastError: this.lastError,
    };
  }

  public isBuffering(): boolean {
    return this.buffering;
  }

  public isConnected(): boolean {
    return this.state === "connected" && (this.transport?.isReady() ?? false);
  }

  public setTarget(host: string, port: number): void {
    this.targetHost = host;
    this.targetPort = port;
  }

  public async connect(): Promise<{ flushed: number; expired: number }> {
    if (this.isDisposed) {
      return { flushed: 0, expired: 0 };
    }

    this.clearReconnectTimer();
    this.setState(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    try {
      const transport = this.transportFactory();
      this.bindTransportEvents(transport);

      const url = `ws://${this.targetHost}:${this.targetPort}`;
      await transport.connect(url);

      this.transport = transport;
      this.reconnectAttempts = 0;
      this.lastHeartbeatAt = Date.now();
      this.lastError = undefined;
      this.setState("connected");

      if (this.buffering) {
        return await this.flushBuffer();
      }
      return { flushed: 0, expired: 0 };
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.lastError = errorMessage;
      this.enterBuffering("Failed to connect to upstream daemon");
      this.setState("error");

      if (this.autoReconnect && !this.isDisposed) {
        this.scheduleReconnect();
      }
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    this.clearReconnectTimer();
    if (this.transport) {
      await this.transport.close(1000, "Normal disconnection");
      this.transport = null;
    }
    this.setState("disconnected");
  }

  public enterBuffering(reason = "Upstream connection unavailable"): void {
    const wasBuffering = this.buffering;
    this.buffering = true;

    if (!wasBuffering) {
      for (const listener of this.bufferingAlertListeners) {
        try {
          listener(reason);
        } catch {
          // Suppress error
        }
      }
    }
  }

  public async reconnectAndFlush(): Promise<{
    flushed: number;
    expired: number;
  }> {
    this.clearReconnectTimer();
    try {
      if (this.transport) {
        try {
          await this.transport.close(1000, "Resetting connection for swap");
        } catch {
          // Suppress close error
        }
        this.transport = null;
      }

      return await this.connect();
    } catch {
      return { flushed: 0, expired: this.sessionManager.pruneExpired().length };
    }
  }

  public async flushBuffer(): Promise<{ flushed: number; expired: number }> {
    const expiredCount = this.sessionManager.pruneExpired().length;
    const queued = this.sessionManager.drainMessages();
    let flushed = 0;

    for (const msg of queued) {
      try {
        await this.forwardMessage(msg);
        flushed += 1;
        this.flushedCommandCount += 1;
      } catch {
        // Stop flushing if forwarding fails
        break;
      }
    }

    this.buffering = false;
    for (const listener of this.swapResumedListeners) {
      try {
        listener();
      } catch {
        // Suppress error
      }
    }

    this.notifyStateChange();
    return { flushed, expired: expiredCount };
  }

  public async sendCommand(
    sessionId: string,
    commandType: string,
    payload: Record<string, unknown>,
  ): Promise<{
    forwarded: boolean;
    buffered: boolean;
    messageId?: string;
    error?: string;
  }> {
    if (this.buffering || !this.isConnected()) {
      const bufferResult = this.sessionManager.bufferMessage(
        sessionId,
        commandType,
        payload,
      );

      if (!bufferResult.buffered) {
        return {
          forwarded: false,
          buffered: false,
          error: bufferResult.error,
        };
      }

      return {
        forwarded: false,
        buffered: true,
        messageId: bufferResult.message?.id,
      };
    }

    try {
      const envelope = JSON.stringify({
        id: crypto.randomUUID(),
        sessionId,
        type: commandType,
        payload,
        timestamp: Date.now(),
      });
      await this.transport?.send(envelope);
      return { forwarded: true, buffered: false };
    } catch {
      this.enterBuffering("Write failure on upstream connection");
      const bufferResult = this.sessionManager.bufferMessage(
        sessionId,
        commandType,
        payload,
      );
      return {
        forwarded: false,
        buffered: bufferResult.buffered,
        messageId: bufferResult.message?.id,
        error: bufferResult.error,
      };
    }
  }

  public hookSwitchFlow(switchFlow: SwitchFlow): () => void {
    const unsubStart = (switchFlow as any).onSwitchStart?.(() => {
      this.enterBuffering("Account switch initiated");
    });

    const unsubComplete = switchFlow.onSwitchEvent((result: SwitchResult) => {
      if (result.success) {
        this.reconnectAndFlush().catch(() => {
          // Suppress reconnect error
        });
      } else {
        this.enterBuffering("Account switch failed");
      }
    });

    return () => {
      if (unsubStart) {
        unsubStart();
      }
      unsubComplete();
    };
  }

  public onStateChange(
    callback: (status: UpstreamBridgeStatus) => void,
  ): () => void {
    this.stateListeners.add(callback);
    return () => {
      this.stateListeners.delete(callback);
    };
  }

  public onMessage(callback: (data: unknown) => void): () => void {
    this.messageListeners.add(callback);
    return () => {
      this.messageListeners.delete(callback);
    };
  }

  public onBufferingAlert(callback: (reason: string) => void): () => void {
    this.bufferingAlertListeners.add(callback);
    return () => {
      this.bufferingAlertListeners.delete(callback);
    };
  }

  public onSwapResumed(callback: () => void): () => void {
    this.swapResumedListeners.add(callback);
    return () => {
      this.swapResumedListeners.delete(callback);
    };
  }

  public dispose(): void {
    this.isDisposed = true;
    this.clearReconnectTimer();
    if (this.transport) {
      try {
        this.transport.close(1000, "Bridge disposed");
      } catch {
        // Suppress close error
      }
      this.transport = null;
    }
    this.setState("disconnected");
    this.stateListeners.clear();
    this.messageListeners.clear();
    this.bufferingAlertListeners.clear();
    this.swapResumedListeners.clear();
  }

  // --- Private Helpers ---

  private bindTransportEvents(transport: UpstreamTransport): void {
    transport.onMessage((dataStr) => {
      this.lastHeartbeatAt = Date.now();
      try {
        const parsed = JSON.parse(dataStr);
        for (const listener of this.messageListeners) {
          try {
            listener(parsed);
          } catch {
            // Suppress error
          }
        }
      } catch {
        for (const listener of this.messageListeners) {
          try {
            listener(dataStr);
          } catch {
            // Suppress error
          }
        }
      }
    });

    transport.onClose((_code, reason) => {
      this.transport = null;
      this.enterBuffering(reason || "Upstream connection closed");
      this.setState("disconnected");

      if (this.autoReconnect && !this.isDisposed) {
        this.scheduleReconnect();
      }
    });

    transport.onError((err) => {
      this.lastError = err.message;
      this.enterBuffering(err.message);
      this.setState("error");
    });
  }

  private async forwardMessage(msg: BufferedMessage): Promise<void> {
    if (!this.transport || !this.transport.isReady()) {
      throw new Error("Cannot forward message: Upstream connection not ready");
    }
    const data = JSON.stringify({
      id: msg.id,
      sessionId: msg.sessionId,
      type: msg.commandType,
      payload: msg.payload,
      timestamp: msg.queuedAt,
    });
    await this.transport.send(data);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;

    const delay = Math.min(
      this.initialBackoffMs * Math.pow(2, this.reconnectAttempts - 1),
      this.maxBackoffMs,
    );

    this.setState("reconnecting");

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Next attempt will be scheduled if connect fails
      });
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(newState: UpstreamBridgeState): void {
    this.state = newState;
    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    const status = this.getStatus();
    for (const listener of this.stateListeners) {
      try {
        listener(status);
      } catch {
        // Suppress error
      }
    }
  }
}
