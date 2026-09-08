import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import {
  UpstreamBridge,
  UpstreamTransport,
  DefaultWebSocketTransport,
} from "@/modules/relay/upstream-bridge";
import { SessionManager } from "@/modules/relay/session-manager";

class MockUpstreamTransport implements UpstreamTransport {
  public isConnected = false;
  public sentMessages: string[] = [];
  public messageHandlers: Set<(data: string) => void> = new Set();
  public closeHandlers: Set<(code: number, reason: string) => void> = new Set();
  public errorHandlers: Set<(err: Error) => void> = new Set();

  public async connect(_url: string): Promise<void> {
    this.isConnected = true;
  }

  public send(data: string): void {
    if (!this.isConnected) {
      throw new Error("Socket not open");
    }
    this.sentMessages.push(data);
  }

  public close(_code = 1000, reason = "Closed"): void {
    this.isConnected = false;
    for (const h of this.closeHandlers) {
      h(1000, reason);
    }
  }

  public isReady(): boolean {
    return this.isConnected;
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

  public simulateIncoming(text: string): void {
    for (const h of this.messageHandlers) {
      h(text);
    }
  }

  public simulateError(err: Error): void {
    for (const h of this.errorHandlers) {
      h(err);
    }
  }
}

describe("UpstreamBridge Coordinator & Swapping Buffering", () => {
  let sessionManager: SessionManager;
  let mockTransport: MockUpstreamTransport;
  let bridge: UpstreamBridge;

  beforeEach(() => {
    sessionManager = new SessionManager({
      maxBufferedCommands: 10,
      bufferTtlMs: 200,
    });
    mockTransport = new MockUpstreamTransport();
    bridge = new UpstreamBridge({
      sessionManager,
      autoReconnect: false,
      transportFactory: () => mockTransport,
    });
  });

  afterEach(() => {
    bridge.dispose();
  });

  describe("Connection Lifecycle", () => {
    it("should connect to upstream daemon and update status", async () => {
      const stateListener = vi.fn();
      bridge.onStateChange(stateListener);

      await bridge.connect();

      expect(bridge.isConnected()).toBe(true);
      expect(bridge.getStatus().state).toBe("connected");
      expect(stateListener).toHaveBeenCalledWith(
        expect.objectContaining({ state: "connected" }),
      );
    });

    it("should handle connection errors and enter buffering mode", async () => {
      const failingBridge = new UpstreamBridge({
        sessionManager,
        autoReconnect: false,
        transportFactory: () => ({
          connect: vi.fn().mockRejectedValue(new Error("Connection refused")),
          send: vi.fn(),
          close: vi.fn(),
          isReady: () => false,
          onMessage: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
        }),
      });

      await expect(failingBridge.connect()).rejects.toThrow(
        "Connection refused",
      );
      expect(failingBridge.getStatus().state).toBe("error");
      expect(failingBridge.isBuffering()).toBe(true);
      failingBridge.dispose();
    });

    it("should disconnect cleanly", async () => {
      await bridge.connect();
      await bridge.disconnect();

      expect(bridge.isConnected()).toBe(false);
      expect(bridge.getStatus().state).toBe("disconnected");
    });
  });

  describe("Buffering Mode & FIFO Drain During Account Swaps", () => {
    it("should enter buffering mode and emit alert when connection drops", async () => {
      await bridge.connect();

      const bufferingAlert = vi.fn();
      bridge.onBufferingAlert(bufferingAlert);

      // Simulate unexpected upstream connection closure
      mockTransport.close(1006, "Daemon terminated for account swap");

      expect(bridge.isBuffering()).toBe(true);
      expect(bufferingAlert).toHaveBeenCalledWith(
        "Daemon terminated for account swap",
      );
    });

    it("should buffer commands when disconnected or buffering", async () => {
      const session = sessionManager.createSession();

      bridge.enterBuffering("Account swap in progress");
      const result = await bridge.sendCommand(session.sessionId, "PROMPT", {
        text: "hello while swapping",
      });

      expect(result.forwarded).toBe(false);
      expect(result.buffered).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(sessionManager.getBufferedCount()).toBe(1);
    });

    it("should forward commands immediately when connected and not buffering", async () => {
      await bridge.connect();
      const session = sessionManager.createSession();

      const result = await bridge.sendCommand(
        session.sessionId,
        "APPROVE_ACTION",
        {
          actionId: "act-42",
        },
      );

      expect(result.forwarded).toBe(true);
      expect(result.buffered).toBe(false);
      expect(mockTransport.sentMessages).toHaveLength(1);

      const parsed = JSON.parse(mockTransport.sentMessages[0]);
      expect(parsed.type).toBe("APPROVE_ACTION");
      expect(parsed.payload).toEqual({ actionId: "act-42" });
    });

    it("should sequentially flush all buffered commands in FIFO order on reconnect", async () => {
      const session = sessionManager.createSession();

      // Buffer 3 commands during swap
      bridge.enterBuffering("Swapping accounts");
      await bridge.sendCommand(session.sessionId, "PROMPT", { index: 1 });
      await bridge.sendCommand(session.sessionId, "APPROVE_ACTION", {
        index: 2,
      });
      await bridge.sendCommand(session.sessionId, "PROMPT", { index: 3 });

      expect(sessionManager.getBufferedCount()).toBe(3);

      const swapResumed = vi.fn();
      bridge.onSwapResumed(swapResumed);

      // Relaunch daemon and reconnect
      const flushResult = await bridge.connect();

      expect(flushResult.flushed).toBe(3);
      expect(flushResult.expired).toBe(0);
      expect(bridge.isBuffering()).toBe(false);
      expect(swapResumed).toHaveBeenCalled();

      expect(mockTransport.sentMessages).toHaveLength(3);
      expect(JSON.parse(mockTransport.sentMessages[0]).payload).toEqual({
        index: 1,
      });
      expect(JSON.parse(mockTransport.sentMessages[1]).payload).toEqual({
        index: 2,
      });
      expect(JSON.parse(mockTransport.sentMessages[2]).payload).toEqual({
        index: 3,
      });
      expect(sessionManager.getBufferedCount()).toBe(0);
    });

    it("should discard expired commands during buffer flush", async () => {
      const session = sessionManager.createSession();
      bridge.enterBuffering("Long swap");

      sessionManager.bufferMessage(
        session.sessionId,
        "PROMPT",
        { text: "expired" },
        20,
      );
      sessionManager.bufferMessage(
        session.sessionId,
        "PROMPT",
        { text: "valid" },
        2000,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      const flushResult = await bridge.connect();

      expect(flushResult.flushed).toBe(1);
      expect(flushResult.expired).toBe(1);

      expect(mockTransport.sentMessages).toHaveLength(1);
      expect(JSON.parse(mockTransport.sentMessages[0]).payload).toEqual({
        text: "valid",
      });
    });
  });

  describe("SwitchFlow Hook Integration", () => {
    it("should hook into SwitchFlow start and complete events", async () => {
      let switchStartCallback: any;
      let switchCompleteCallback: any;

      const mockSwitchFlow = {
        onSwitchStart: vi.fn((cb) => {
          switchStartCallback = cb;
          return vi.fn();
        }),
        onSwitchEvent: vi.fn((cb) => {
          switchCompleteCallback = cb;
          return vi.fn();
        }),
      } as any;

      const unsub = bridge.hookSwitchFlow(mockSwitchFlow);
      expect(mockSwitchFlow.onSwitchStart).toHaveBeenCalled();
      expect(mockSwitchFlow.onSwitchEvent).toHaveBeenCalled();

      // Trigger switch start -> enters buffering
      expect(bridge.isBuffering()).toBe(false);
      switchStartCallback?.({
        targetAccountId: "acc-2",
        reason: "quota_depleted",
      });
      expect(bridge.isBuffering()).toBe(true);

      // Trigger switch completion -> reconnects and flushes
      const reconnectSpy = vi
        .spyOn(bridge, "reconnectAndFlush")
        .mockResolvedValue({
          flushed: 0,
          expired: 0,
        });

      switchCompleteCallback?.({ success: true });
      expect(reconnectSpy).toHaveBeenCalled();

      unsub();
    });
  });

  describe("Incoming Upstream Messages & Telemetry", () => {
    it("should receive messages from upstream transport and distribute to listeners", async () => {
      await bridge.connect();

      const messageListener = vi.fn();
      bridge.onMessage(messageListener);

      mockTransport.simulateIncoming(
        JSON.stringify({
          type: "AGENT_OUTPUT",
          payload: { text: "Processing code" },
        }),
      );

      expect(messageListener).toHaveBeenCalledWith({
        type: "AGENT_OUTPUT",
        payload: { text: "Processing code" },
      });
    });

    it("should handle upstream error events", async () => {
      await bridge.connect();
      mockTransport.simulateError(new Error("Socket internal error"));

      expect(bridge.getStatus().lastError).toBe("Socket internal error");
    });

    it("should update target host and port via setTarget", () => {
      bridge.setTarget("192.168.1.100", 5050);
      const status = bridge.getStatus();
      expect(status.targetHost).toBe("192.168.1.100");
      expect(status.targetPort).toBe(5050);
    });

    it("should suppress error in notifyStateChange when listener throws", async () => {
      bridge.onStateChange(() => {
        throw new Error("Broken state listener");
      });
      expect(() => (bridge as any).notifyStateChange()).not.toThrow();
    });

    it("should handle autoReconnect timer execution", async () => {
      const autoBridge = new UpstreamBridge({
        sessionManager,
        autoReconnect: true,
        initialBackoffMs: 10,
        maxBackoffMs: 50,
        transportFactory: () => mockTransport,
      });

      await autoBridge.connect();

      // Trigger close to schedule reconnect timer
      mockTransport.close(1006, "Unexpected drop");
      expect(autoBridge.getStatus().state).toBe("reconnecting");

      // Wait for reconnect timer to fire
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(autoBridge.getStatus().state).toBe("connected");

      autoBridge.dispose();
    });

    it("should return immediately if connect() is called after disposal", async () => {
      bridge.dispose();
      const result = await bridge.connect();
      expect(result).toEqual({ flushed: 0, expired: 0 });
    });

    it("should schedule reconnect when connect() fails and autoReconnect is enabled", async () => {
      const autoBridge = new UpstreamBridge({
        sessionManager,
        autoReconnect: true,
        initialBackoffMs: 20,
        transportFactory: () => {
          const t = new MockUpstreamTransport();
          t.connect = vi
            .fn()
            .mockRejectedValue(new Error("Connection refused"));
          return t;
        },
      });
      await expect(autoBridge.connect()).rejects.toThrow("Connection refused");
      expect(autoBridge.getStatus().state).toBe("reconnecting");
      autoBridge.dispose();
    });

    it("should suppress errors thrown by buffering alert listeners", () => {
      bridge.onBufferingAlert(() => {
        throw new Error("Alert listener exploded");
      });
      expect(() => bridge.enterBuffering("test reason")).not.toThrow();
    });

    it("should suppress error if transport.close throws during reconnectAndFlush and handle connect failure", async () => {
      await bridge.connect();
      if (mockTransport) {
        mockTransport.close = vi.fn().mockImplementation(() => {
          throw new Error("Close failed");
        });
      }
      const result = await bridge.reconnectAndFlush();
      expect(result.flushed).toBe(0);

      // Now test connect failure during reconnectAndFlush
      vi.spyOn(bridge, "connect").mockRejectedValueOnce(
        new Error("Reconnection failed"),
      );
      const failResult = await bridge.reconnectAndFlush();
      expect(failResult.flushed).toBe(0);
    });

    it("should abort buffer flush if message forwarding throws", async () => {
      await bridge.connect();
      bridge.enterBuffering("Testing flush abort");
      sessionManager.bufferMessage("s1", "TEST", { a: 1 });
      sessionManager.bufferMessage("s1", "TEST2", { a: 2 });

      vi.spyOn(mockTransport, "send").mockImplementationOnce(() => {
        throw new Error("Write pipe broken");
      });

      const res = await bridge.flushBuffer();
      expect(res.flushed).toBe(0);
    });

    it("should suppress errors thrown by swap resumed listeners", async () => {
      bridge.onSwapResumed(() => {
        throw new Error("Swap listener failed");
      });
      await expect(bridge.flushBuffer()).resolves.toBeDefined();
    });

    it("should return error from sendCommand if buffer reaches capacity while buffering", async () => {
      bridge.enterBuffering("Buffer full test");
      for (let i = 0; i < 10; i++) {
        sessionManager.bufferMessage("s1", "MSG", { idx: i });
      }

      const res = await bridge.sendCommand("s1", "OVERFLOW", { idx: 101 });
      expect(res.forwarded).toBe(false);
      expect(res.buffered).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("should enter buffering and buffer message if transport.send throws during sendCommand", async () => {
      await bridge.connect();
      vi.spyOn(mockTransport, "send").mockImplementationOnce(() => {
        throw new Error("Transport socket dead");
      });

      const res = await bridge.sendCommand("s1", "TEST_SEND", {
        data: "payload",
      });
      expect(res.forwarded).toBe(false);
      expect(res.buffered).toBe(true);
      expect(bridge.isBuffering()).toBe(true);
    });

    it("should enter buffering when hookSwitchFlow receives failed switch result", () => {
      const fakeSwitchFlow = {
        onSwitchStart: vi.fn(),
        onSwitchEvent: (cb: any) => {
          cb({ success: false, targetAccount: null });
          return vi.fn();
        },
      };
      bridge.hookSwitchFlow(fakeSwitchFlow as any);
      expect(bridge.isBuffering()).toBe(true);
    });

    it("should suppress error if transport.close throws during bridge dispose", async () => {
      await bridge.connect();
      mockTransport.close = vi.fn().mockImplementation(() => {
        throw new Error("Dispose close error");
      });
      expect(() => bridge.dispose()).not.toThrow();
    });

    it("should handle non-JSON messages and suppress listener errors", async () => {
      await bridge.connect();
      const throwingListener = vi.fn().mockImplementation(() => {
        throw new Error("Message handler error");
      });
      bridge.onMessage(throwingListener);

      // JSON message where listener throws
      mockTransport.simulateIncoming(JSON.stringify({ type: "TEST" }));
      expect(throwingListener).toHaveBeenCalledWith({ type: "TEST" });

      // Non-JSON string message
      const rawListener = vi.fn();
      bridge.onMessage(rawListener);
      mockTransport.simulateIncoming("plain text stream chunk");
      expect(rawListener).toHaveBeenCalledWith("plain text stream chunk");
    });

    it("should throw if forwardMessage is called when transport is not ready", async () => {
      const dummyMsg = {
        id: "m1",
        sessionId: "s1",
        commandType: "PROMPT",
        payload: {},
        queuedAt: Date.now(),
        expiresAt: Date.now() + 10000,
        status: "queued" as const,
      };
      await expect((bridge as any).forwardMessage(dummyMsg)).rejects.toThrow(
        "Cannot forward message: Upstream connection not ready",
      );
    });

    it("should allow unsubscribing from all listener types", () => {
      const stateListener = vi.fn();
      const unsubState = bridge.onStateChange(stateListener);
      expect((bridge as any).stateListeners.size).toBe(1);
      unsubState();
      expect((bridge as any).stateListeners.size).toBe(0);

      const msgListener = vi.fn();
      const unsubMsg = bridge.onMessage(msgListener);
      expect((bridge as any).messageListeners.size).toBe(1);
      unsubMsg();
      expect((bridge as any).messageListeners.size).toBe(0);

      const alertListener = vi.fn();
      const unsubAlert = bridge.onBufferingAlert(alertListener);
      expect((bridge as any).bufferingAlertListeners.size).toBe(1);
      unsubAlert();
      expect((bridge as any).bufferingAlertListeners.size).toBe(0);

      const swapListener = vi.fn();
      const unsubSwap = bridge.onSwapResumed(swapListener);
      expect((bridge as any).swapResumedListeners.size).toBe(1);
      unsubSwap();
      expect((bridge as any).swapResumedListeners.size).toBe(0);
    });
  });

  describe("DefaultWebSocketTransport", () => {
    let wss: WebSocketServer;
    let wsPort: number;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        wss = new WebSocketServer({ port: 0 }, () => {
          const addr = wss.address() as any;
          wsPort = addr.port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    });

    it("should connect, send messages, receive messages, and close", async () => {
      const transport = new DefaultWebSocketTransport();
      expect(transport.isReady()).toBe(false);

      let serverReceived = "";
      wss.on("connection", (socket) => {
        socket.on("message", (data) => {
          serverReceived = data.toString();
          socket.send("echo:" + serverReceived);
        });
      });

      const closeHandler = vi.fn();
      const errorHandler = vi.fn();
      transport.onClose(closeHandler);
      transport.onError(errorHandler);

      await transport.connect(`ws://127.0.0.1:${wsPort}`);
      expect(transport.isReady()).toBe(true);

      const receivedByClient: string[] = [];
      transport.onMessage((msg) => {
        receivedByClient.push(msg);
      });

      transport.send("hello-upstream");

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(serverReceived).toBe("hello-upstream");
      expect(receivedByClient[0]).toBe("echo:hello-upstream");

      // Trigger ws error event while connected
      (transport as any).ws.emit("error", new Error("Simulated stream error"));
      expect(errorHandler).toHaveBeenCalled();

      // Trigger ws close event while connected
      (transport as any).ws.emit("close", 1000, "Clean close");
      expect(closeHandler).toHaveBeenCalled();

      transport.close();
      expect(transport.isReady()).toBe(false);
    });

    it("should throw error when send() is called while not open", () => {
      const transport = new DefaultWebSocketTransport();
      expect(() => transport.send("fails")).toThrow(
        "Upstream WebSocket is not open",
      );
    });

    it("should reject connect() on unreachable address", async () => {
      const transport = new DefaultWebSocketTransport();
      await expect(transport.connect("ws://127.0.0.1:1")).rejects.toThrow();
    });

    it("should reject connect() when URL throws constructor error", async () => {
      const transport = new DefaultWebSocketTransport();
      await expect(transport.connect("invalid-url-scheme")).rejects.toThrow();
    });

    it("should suppress close error when ws.close throws", () => {
      const transport = new DefaultWebSocketTransport();
      (transport as any).ws = {
        close: () => {
          throw new Error("Close error");
        },
      };
      expect(() => transport.close()).not.toThrow();
    });
  });
});
