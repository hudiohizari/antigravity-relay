import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelayDashboard } from "@/modules/relay/components/RelayDashboard";
import { QRCode } from "@/modules/relay/components/QRCode";
import * as relayActions from "@/modules/relay/actions/relay";

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
  }),
}));

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
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });

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
      <QRCode value="https://test.trycloudflare.com/?pair=abc" size={180} />,
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

  it("renders Cloudflare Tunnel mode badge and URL when tunnel is connected", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const modeBadge = await screen.findByText("pairing.modeTunnel");
    expect(modeBadge).toBeDefined();

    const pairingInput = screen.getByLabelText(
      "pairing.copyLink",
    ) as HTMLInputElement;
    expect(pairingInput.value).toContain(
      "https://test-subdomain.trycloudflare.com/?pair=",
    );

    expect(screen.queryByText("pairing.wifiAdvisory")).toBeNull();
  });

  it("falls back to Local Wi-Fi mode badge, LAN URL, and advisory banner when tunnel is stopped", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
    });
    vi.mocked(relayActions.getTunnelUrl).mockResolvedValue(null);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const modeBadge = await screen.findByText("pairing.modeWifi");
    expect(modeBadge).toBeDefined();

    const advisory = await screen.findByText("pairing.wifiAdvisory");
    expect(advisory).toBeDefined();
    expect(await screen.findByText("(192.168.1.100)")).toBeDefined();

    await waitFor(() => {
      const pairingInput = screen.getByLabelText(
        "pairing.copyLink",
      ) as HTMLInputElement;
      expect(pairingInput.value).toContain("http://192.168.1.100:4040/?pair=");
    });
  });

  it("falls back to Local Wi-Fi when tunnel state is error", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "error",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      lastError: "cloudflared binary not found",
    });
    vi.mocked(relayActions.getTunnelUrl).mockResolvedValue(null);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const modeBadge = await screen.findByText("pairing.modeWifi");
    expect(modeBadge).toBeDefined();

    await waitFor(() => {
      const pairingInput = screen.getByLabelText(
        "pairing.copyLink",
      ) as HTMLInputElement;
      expect(pairingInput.value).toContain("http://192.168.1.100:4040/?pair=");
    });
  });

  it("copies pairing link to clipboard and triggers feedback toast when Copy Link is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    await screen.findByText("pairing.modeTunnel");

    const copyButtons = screen.getAllByText("pairing.copyLink");
    const copyButton = copyButtons[copyButtons.length - 1];
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          "https://test-subdomain.trycloudflare.com/?pair=",
        ),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "pairing.linkCopied",
        }),
      );
    });
  });

  it("greys out and disables QR pairing when relay server is stopped/inactive", async () => {
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: false,
      port: 4040,
      host: "0.0.0.0",
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
    });

    const testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={testQueryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    // Verify badge and overlay show inactive
    const inactiveElements = await screen.findAllByText(
      "pairing.serverInactive",
    );
    expect(inactiveElements.length).toBeGreaterThanOrEqual(1);

    // Verify inactive overlay text is shown
    expect(screen.getByText("pairing.startServerToPair")).toBeDefined();

    // Verify input and copy buttons are disabled
    const pairingInput = screen.getByLabelText(
      "pairing.copyLink",
    ) as HTMLInputElement;
    expect(pairingInput.disabled).toBe(true);

    const copyButtons = screen.getAllByText("pairing.copyLink");
    const copyButton = copyButtons[copyButtons.length - 1].closest("button");
    expect(copyButton?.disabled).toBe(true);
  });
});
