import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelayDashboard } from "@/modules/relay/components/RelayDashboard";
import { QRCode } from "@/modules/relay/components/QRCode";
import * as relayActions from "@/modules/relay/actions/relay";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params?.port) return `Port: ${params.port}`;
      if (params?.count) return `${params.count} queued commands`;
      if (params?.device) return `Session for ${params.device}`;
      return key;
    },
  }),
}));

// Mock ipc manager
vi.mock("@/ipc/manager", () => ({
  ipc: {
    client: {
      system: {
        get_local_ips: vi
          .fn()
          .mockResolvedValue([
            { address: "192.168.1.100", name: "en0", isRecommended: true },
          ]),
      },
    },
  },
}));

// Mock relay actions
vi.mock("@/modules/relay/actions/relay", () => ({
  getRelayStatus: vi.fn(),
  startRelay: vi.fn(),
  stopRelay: vi.fn(),
  getRelaySessions: vi.fn(),
  revokeRelaySession: vi.fn(),
  getTunnelStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  getTunnelUrl: vi.fn(),
}));

describe("RelayDashboard Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "127.0.0.1",
      activeSessions: 1,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4040,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
      startedAt: Date.now() - 60000,
    });

    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "connected",
      pid: 12345,
      publicUrl: "https://test-subdomain.trycloudflare.com",
      startedAt: Date.now() - 30000,
      reconnectAttempts: 0,
    });

    vi.mocked(relayActions.getTunnelUrl).mockResolvedValue(
      "https://test-subdomain.trycloudflare.com",
    );

    vi.mocked(relayActions.getRelaySessions).mockResolvedValue([
      {
        sessionId: "test-session-1",
        token: "secret-token-1",
        clientIp: "192.168.1.50",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        connectedAt: Date.now() - 30000,
        lastActiveAt: Date.now() - 5000,
        authenticated: true,
        socketState: "connected",
      },
    ]);
  });

  it("renders QRCode component with SVG element", () => {
    const { container } = render(
      <QRCode
        value="https://test.trycloudflare.com/relay-ui/?pair=abc"
        size={180}
      />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("width")).toBe("180");
    expect(svg?.getAttribute("height")).toBe("180");
  });

  it("renders RelayDashboard with server status, tunnel, pairing, and sessions", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    expect(screen.getByText("remote.title")).toBeDefined();
    expect(screen.getByText("relay.title")).toBeDefined();
    expect(screen.getByText("tunnel.title")).toBeDefined();
    expect(screen.getAllByText("pairing.title").length).toBeGreaterThan(0);
    expect(screen.getByText("sessions.title")).toBeDefined();

    // Verify session table device appears
    const sessionDevice = await screen.findByText("iPhone");
    expect(sessionDevice).toBeDefined();

    // Verify client IP appears
    const clientIp = await screen.findByText("192.168.1.50");
    expect(clientIp).toBeDefined();
  });
});
