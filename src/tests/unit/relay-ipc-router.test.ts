import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouterClient } from "@orpc/server";
import { relayRouter, tunnelRouter } from "@/modules/relay/ipc/router";
import { RelayController } from "@/modules/relay/relay-controller";
import type { RelayServerStatus, Session } from "@/modules/relay/types";
import type { TunnelStatus } from "@/modules/tunnel/types";

describe("Relay and Tunnel IPC Routers", () => {
  const mockSessionManager = {
    getActiveSessions: vi.fn(),
    revokeSession: vi.fn(),
    createSession: vi.fn(),
  };

  const mockRelayServer = {
    getStatus: vi.fn(),
    getSessionManager: vi.fn(() => mockSessionManager),
    revokeDevice: vi.fn(),
    getPairingKey: vi.fn(),
    regeneratePairingKey: vi.fn(),
  };

  const mockTunnelManager = {
    getStatus: vi.fn(),
    start: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
    getPublicUrl: vi.fn(),
    checkBinary: vi.fn(),
  };

  const mockController = {
    relayServer: mockRelayServer,
    tunnelManager: mockTunnelManager,
    startRelay: vi.fn(),
    stopRelay: vi.fn(),
    getLastStatus: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(RelayController, "getInstance").mockReturnValue(
      mockController as unknown as RelayController,
    );
  });

  describe("relayRouter", () => {
    const client = createRouterClient(relayRouter);

    it("getStatus returns relay server status", async () => {
      const status: RelayServerStatus = {
        isRunning: true,
        port: 4040,
        host: "0.0.0.0",
        activeSessions: 2,
        isBuffering: false,
        upstream: {
          state: "connected",
          targetHost: "127.0.0.1",
          targetPort: 4041,
          reconnectAttempts: 0,
          bufferedCommandCount: 0,
          flushedCommandCount: 0,
        },
      };
      mockRelayServer.getStatus.mockReturnValueOnce(status);

      const res = await client.getStatus();
      expect(res).toEqual(status);
      expect(mockRelayServer.getStatus).toHaveBeenCalledTimes(1);
    });

    it("start launches relay via controller with and without input", async () => {
      const status: RelayServerStatus = {
        isRunning: true,
        port: 5050,
        host: "127.0.0.1",
        activeSessions: 0,
        isBuffering: false,
        upstream: {
          state: "disconnected",
          targetHost: "127.0.0.1",
          targetPort: 4041,
          reconnectAttempts: 0,
          bufferedCommandCount: 0,
          flushedCommandCount: 0,
        },
      };
      mockController.startRelay.mockResolvedValueOnce(status);

      const resWithInput = await client.start({
        port: 5050,
        host: "127.0.0.1",
      });
      expect(resWithInput).toEqual(status);
      expect(mockController.startRelay).toHaveBeenCalledWith({
        port: 5050,
        host: "127.0.0.1",
      });

      mockController.startRelay.mockResolvedValueOnce(status);
      const resWithoutInput = await client.start();
      expect(resWithoutInput).toEqual(status);
      expect(mockController.startRelay).toHaveBeenCalledWith(undefined);
    });

    it("stop halts relay via controller", async () => {
      mockController.stopRelay.mockResolvedValueOnce(undefined);
      await client.stop();
      expect(mockController.stopRelay).toHaveBeenCalledTimes(1);
    });

    it("getSessions retrieves active sessions", async () => {
      const sessions: Session[] = [
        {
          sessionId: "s1",
          token: "tok1",
          clientIp: "127.0.0.1",
          userAgent: "test",
          connectedAt: 1000,
          lastActiveAt: 1000,
          authenticated: true,
          socketState: "connected",
        },
      ];
      mockSessionManager.getActiveSessions.mockReturnValueOnce(sessions);

      const res = await client.getSessions();
      expect(res).toEqual(sessions);
      expect(mockSessionManager.getActiveSessions).toHaveBeenCalledTimes(1);
    });

    it("revokeSession revokes by sessionId", async () => {
      mockSessionManager.revokeSession.mockReturnValueOnce(true);
      const res = await client.revokeSession({ sessionId: "s1" });
      expect(res).toBe(true);
      expect(mockSessionManager.revokeSession).toHaveBeenCalledWith("s1");
    });

    it("revokeDevice revokes device by deviceId", async () => {
      mockRelayServer.revokeDevice.mockReturnValueOnce(true);
      const res = await client.revokeDevice({ deviceId: "d1" });
      expect(res).toBe(true);
      expect(mockRelayServer.revokeDevice).toHaveBeenCalledWith("d1");
    });

    it("createPairingToken generates new token and session", async () => {
      mockSessionManager.createSession.mockReturnValueOnce({
        sessionId: "sess-new",
        token: "tok-new",
      });

      const res = await client.createPairingToken();
      expect(res).toEqual({
        sessionId: "sess-new",
        token: "tok-new",
      });
      expect(mockSessionManager.createSession).toHaveBeenCalledTimes(1);
    });

    it("getPairingKey and regeneratePairingKey retrieve and cycle keys", async () => {
      mockRelayServer.getPairingKey.mockReturnValueOnce("key-123");
      mockRelayServer.regeneratePairingKey.mockReturnValueOnce("key-456");

      expect(await client.getPairingKey()).toBe("key-123");
      expect(await client.regeneratePairingKey()).toBe("key-456");
      expect(mockRelayServer.getPairingKey).toHaveBeenCalledTimes(1);
      expect(mockRelayServer.regeneratePairingKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("tunnelRouter", () => {
    const client = createRouterClient(tunnelRouter);

    it("getStatus returns tunnel status", async () => {
      const status: TunnelStatus = {
        state: "connected",
        publicUrl: "https://test.cloudflare.com",
        pid: 12345,
        startedAt: 1000,
        reconnectAttempts: 0,
        isBinaryInstalled: true,
        binaryPath: "/usr/local/bin/cloudflared",
        platform: "darwin",
      };
      mockTunnelManager.getStatus.mockReturnValueOnce(status);

      const res = await client.getStatus();
      expect(res).toEqual(status);
      expect(mockTunnelManager.getStatus).toHaveBeenCalledTimes(1);
    });

    it("start initiates tunnel with and without input", async () => {
      const status: TunnelStatus = {
        state: "connected",
        publicUrl: "https://test.cloudflare.com",
        pid: 12345,
        startedAt: 1000,
        reconnectAttempts: 0,
        isBinaryInstalled: true,
        binaryPath: "/usr/local/bin/cloudflared",
        platform: "darwin",
      };
      mockTunnelManager.start.mockResolvedValueOnce(status);

      const resWithInput = await client.start({
        targetPort: 4040,
        customDomain: "demo.tunnel.com",
        namedTunnelToken: "tok-tunnel",
      });
      expect(resWithInput).toEqual(status);
      expect(mockTunnelManager.start).toHaveBeenCalledWith({
        targetPort: 4040,
        customDomain: "demo.tunnel.com",
        namedTunnelToken: "tok-tunnel",
      });

      mockTunnelManager.start.mockResolvedValueOnce(status);
      const resWithoutInput = await client.start();
      expect(resWithoutInput).toEqual(status);
      expect(mockTunnelManager.start).toHaveBeenCalledWith(undefined);
    });

    it("restart restarts tunnel with and without input", async () => {
      const status: TunnelStatus = {
        state: "connected",
        publicUrl: "https://test.cloudflare.com",
        pid: 12345,
        startedAt: 1000,
        reconnectAttempts: 0,
        isBinaryInstalled: true,
        binaryPath: "/usr/local/bin/cloudflared",
        platform: "darwin",
      };
      mockTunnelManager.restart.mockResolvedValueOnce(status);

      const res = await client.restart({ targetPort: 8080 });
      expect(res).toEqual(status);
      expect(mockTunnelManager.restart).toHaveBeenCalledWith({
        targetPort: 8080,
      });

      mockTunnelManager.restart.mockResolvedValueOnce(status);
      const res2 = await client.restart();
      expect(res2).toEqual(status);
      expect(mockTunnelManager.restart).toHaveBeenCalledWith(undefined);
    });

    it("stop terminates tunnel", async () => {
      mockTunnelManager.stop.mockResolvedValueOnce(undefined);
      await client.stop();
      expect(mockTunnelManager.stop).toHaveBeenCalledTimes(1);
    });

    it("getUrl returns public URL", async () => {
      mockTunnelManager.getPublicUrl.mockReturnValueOnce("https://public.url");
      const res = await client.getUrl();
      expect(res).toEqual({ publicUrl: "https://public.url" });

      mockTunnelManager.getPublicUrl.mockReturnValueOnce(null);
      const resNull = await client.getUrl();
      expect(resNull).toEqual({ publicUrl: null });
    });

    it("checkBinary verifies cloudflared binary with and without options", async () => {
      const binaryInfo = {
        isInstalled: true,
        binaryPath: "/usr/local/bin/cloudflared",
        platform: "darwin" as const,
      };
      mockTunnelManager.checkBinary.mockResolvedValueOnce(binaryInfo);

      const res = await client.checkBinary({ forceRefresh: true });
      expect(res).toEqual(binaryInfo);
      expect(mockTunnelManager.checkBinary).toHaveBeenCalledWith(true);

      mockTunnelManager.checkBinary.mockResolvedValueOnce(binaryInfo);
      const resWithout = await client.checkBinary();
      expect(resWithout).toEqual(binaryInfo);
      expect(mockTunnelManager.checkBinary).toHaveBeenCalledWith(undefined);
    });
  });
});
