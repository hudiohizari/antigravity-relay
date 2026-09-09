import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRelayStatus,
  startRelay,
  stopRelay,
  getRelaySessions,
  revokeRelaySession,
  createPairingToken,
  getTunnelStatus,
  startTunnel,
  restartTunnel,
  stopTunnel,
  getTunnelUrl,
  checkTunnelBinary,
} from "@/modules/relay/actions/relay";
import { ipc } from "@/ipc/manager";
import type { TunnelStatus } from "@/modules/tunnel/types";

vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      relay: {
        getStatus: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        getSessions: vi.fn(),
        revokeSession: vi.fn(),
        createPairingToken: vi.fn(),
      },
      tunnel: {
        getStatus: vi.fn(),
        start: vi.fn(),
        restart: vi.fn(),
        stop: vi.fn(),
        getUrl: vi.fn(),
        checkBinary: vi.fn(),
      },
    },
  },
}));

describe("Relay and Tunnel Client Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getRelayStatus on ipc client", async () => {
    const mockStatus = { isRunning: true } as any;
    vi.mocked(ipc.client.relay.getStatus).mockResolvedValueOnce(mockStatus);

    const result = await getRelayStatus();
    expect(result).toBe(mockStatus);
    expect(ipc.client.relay.getStatus).toHaveBeenCalledTimes(1);
  });

  it("calls startRelay and stopRelay on ipc client", async () => {
    const mockStatus = { isRunning: true } as any;
    vi.mocked(ipc.client.relay.start).mockResolvedValueOnce(mockStatus);
    vi.mocked(ipc.client.relay.stop).mockResolvedValueOnce(undefined);

    const result = await startRelay({ port: 4040, host: "0.0.0.0" });
    expect(result).toBe(mockStatus);
    expect(ipc.client.relay.start).toHaveBeenCalledWith({
      port: 4040,
      host: "0.0.0.0",
    });

    await stopRelay();
    expect(ipc.client.relay.stop).toHaveBeenCalledTimes(1);
  });

  it("manages relay sessions and pairing token", async () => {
    vi.mocked(ipc.client.relay.getSessions).mockResolvedValueOnce([]);
    vi.mocked(ipc.client.relay.revokeSession).mockResolvedValueOnce(true);
    vi.mocked(ipc.client.relay.createPairingToken).mockResolvedValueOnce({
      sessionId: "s1",
      token: "tok1",
    });

    const sessions = await getRelaySessions();
    expect(sessions).toEqual([]);

    const revoked = await revokeRelaySession("s1");
    expect(revoked).toBe(true);
    expect(ipc.client.relay.revokeSession).toHaveBeenCalledWith({
      sessionId: "s1",
    });

    const tokenRes = await createPairingToken();
    expect(tokenRes).toEqual({ sessionId: "s1", token: "tok1" });
  });

  it("calls getTunnelStatus, startTunnel, restartTunnel, and stopTunnel on ipc client", async () => {
    const mockStatus: TunnelStatus = {
      state: "connected",
      publicUrl: "https://test.trycloudflare.com",
      pid: 1234,
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    };

    vi.mocked(ipc.client.tunnel.getStatus).mockResolvedValueOnce(mockStatus);
    vi.mocked(ipc.client.tunnel.start).mockResolvedValueOnce(mockStatus);
    vi.mocked(ipc.client.tunnel.restart).mockResolvedValueOnce(mockStatus);
    vi.mocked(ipc.client.tunnel.stop).mockResolvedValueOnce(undefined);

    expect(await getTunnelStatus()).toEqual(mockStatus);
    expect(
      await startTunnel({ targetPort: 4040, customDomain: "test.dev" }),
    ).toEqual(mockStatus);
    expect(ipc.client.tunnel.start).toHaveBeenCalledWith({
      targetPort: 4040,
      customDomain: "test.dev",
    });

    expect(await restartTunnel({ targetPort: 5050 })).toEqual(mockStatus);
    expect(ipc.client.tunnel.restart).toHaveBeenCalledWith({
      targetPort: 5050,
    });

    await stopTunnel();
    expect(ipc.client.tunnel.stop).toHaveBeenCalledTimes(1);
  });

  it("extracts publicUrl from getTunnelUrl", async () => {
    vi.mocked(ipc.client.tunnel.getUrl).mockResolvedValueOnce({
      publicUrl: "https://url.trycloudflare.com",
    });

    const url = await getTunnelUrl();
    expect(url).toBe("https://url.trycloudflare.com");
  });

  it("calls checkTunnelBinary with forceRefresh true, false, and undefined", async () => {
    const mockBinaryResult = {
      isInstalled: true,
      binaryPath: "/opt/homebrew/bin/cloudflared",
      platform: "darwin" as const,
    };

    vi.mocked(ipc.client.tunnel.checkBinary).mockResolvedValue(
      mockBinaryResult,
    );

    // Call with forceRefresh = true
    const res1 = await checkTunnelBinary(true);
    expect(res1).toEqual(mockBinaryResult);
    expect(ipc.client.tunnel.checkBinary).toHaveBeenCalledWith({
      forceRefresh: true,
    });

    // Call with forceRefresh = false
    const res2 = await checkTunnelBinary(false);
    expect(res2).toEqual(mockBinaryResult);
    expect(ipc.client.tunnel.checkBinary).toHaveBeenCalledWith({
      forceRefresh: false,
    });

    // Call with forceRefresh undefined
    const res3 = await checkTunnelBinary();
    expect(res3).toEqual(mockBinaryResult);
    expect(ipc.client.tunnel.checkBinary).toHaveBeenCalledWith(undefined);
  });
});
