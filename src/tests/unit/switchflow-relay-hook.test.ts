import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  UpstreamBridge,
  UpstreamTransport,
  SwitchFlowNotifier,
  SwitchResult,
} from "@/modules/relay/upstream-bridge";
import { SessionManager } from "@/modules/relay/session-manager";

class MockUpstreamTransport implements UpstreamTransport {
  public isConnected = true;
  public sentMessages: string[] = [];
  public messageHandlers: Set<(data: string) => void> = new Set();
  public closeHandlers: Set<(code: number, reason: string) => void> = new Set();
  public errorHandlers: Set<(err: Error) => void> = new Set();

  public async connect(): Promise<void> {
    this.isConnected = true;
  }

  public send(data: string): void {
    if (!this.isConnected) {
      throw new Error("Cannot send: socket is not connected");
    }
    this.sentMessages.push(data);
  }

  public close(): void {
    this.isConnected = false;
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
}

class MockSwitchFlow implements SwitchFlowNotifier {
  private startListeners: Array<() => void> = [];
  private eventListeners: Array<(res: SwitchResult) => void> = [];

  public onSwitchStart(cb: () => void): () => void {
    this.startListeners.push(cb);
    return () => {
      this.startListeners = this.startListeners.filter((l) => l !== cb);
    };
  }

  public onSwitchEvent(cb: (res: SwitchResult) => void): () => void {
    this.eventListeners.push(cb);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== cb);
    };
  }

  public triggerStart(): void {
    for (const l of this.startListeners) l();
  }

  public triggerComplete(success: boolean, error?: string): void {
    for (const l of this.eventListeners) l({ success, error });
  }
}

describe("SwitchFlow and Relay UpstreamBridge Hook Integration", () => {
  let sessionManager: SessionManager;
  let mockTransport: MockUpstreamTransport;
  let bridge: UpstreamBridge;
  let switchFlow: MockSwitchFlow;

  beforeEach(() => {
    sessionManager = new SessionManager();
    mockTransport = new MockUpstreamTransport();
    bridge = new UpstreamBridge({
      sessionManager,
      autoReconnect: false,
      transportFactory: () => mockTransport,
    });

    switchFlow = new MockSwitchFlow();
    bridge.hookSwitchFlow(switchFlow);
  });

  afterEach(() => {
    bridge.dispose();
  });

  it("should enter buffering mode upon switch start and drain FIFO buffer upon switch completion", async () => {
    await bridge.connect();
    expect(bridge.isBuffering()).toBe(false);

    const session = sessionManager.createSession();

    // 1. Send command before switch (forwarded immediately)
    const res1 = await bridge.sendCommand(session.sessionId, "PROMPT", {
      text: "before switch",
    });
    expect(res1.forwarded).toBe(true);
    expect(mockTransport.sentMessages).toHaveLength(1);

    // 2. Trigger switch start
    switchFlow.triggerStart();

    // While switch executes, bridge enters buffering
    expect(bridge.isBuffering()).toBe(true);

    // 3. User sends two commands during the swap window
    const res2 = await bridge.sendCommand(session.sessionId, "PROMPT", {
      text: "during swap 1",
    });
    const res3 = await bridge.sendCommand(session.sessionId, "APPROVE_ACTION", {
      actionId: "act-101",
    });

    expect(res2.buffered).toBe(true);
    expect(res3.buffered).toBe(true);
    expect(sessionManager.getBufferedCount()).toBe(2);

    // 4. Trigger switch completion
    switchFlow.triggerComplete(true);

    // 5. Allow microtasks to resolve buffer flush
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(bridge.isBuffering()).toBe(false);
    expect(sessionManager.getBufferedCount()).toBe(0);

    // Transport should have all 3 messages in sequential FIFO order
    expect(mockTransport.sentMessages).toHaveLength(3);
    expect(JSON.parse(mockTransport.sentMessages[0]).payload).toEqual({
      text: "before switch",
    });
    expect(JSON.parse(mockTransport.sentMessages[1]).payload).toEqual({
      text: "during swap 1",
    });
    expect(JSON.parse(mockTransport.sentMessages[2]).payload).toEqual({
      actionId: "act-101",
    });
  });

  it("should stay in buffering mode if switch flow fails", async () => {
    await bridge.connect();
    switchFlow.triggerStart();
    expect(bridge.isBuffering()).toBe(true);

    switchFlow.triggerComplete(false, "Account credentials invalid");
    expect(bridge.isBuffering()).toBe(true);
  });
});
