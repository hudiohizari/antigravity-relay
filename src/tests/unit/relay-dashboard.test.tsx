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
      if (key === "sessions.deviceIPhone") return "iPhone";
      if (key === "sessions.deviceAndroid") return "Android Device";
      if (params?.port) return `Port: ${params.port}`;
      if (params?.count) return `${params.count} queued commands`;
      if (key === "sessions.revokeAriaLabel" && params?.device)
        return `Revoke session for ${params.device} on ${params?.ip}`;
      if (key === "sessions.confirmRevokeMessage" && params?.device)
        return `Session for ${params.device}`;
      if (
        key === "sessions.activeCountRatio" &&
        params?.active &&
        params?.total
      )
        return `${params.active} of ${params.total} active`;
      if (key === "sessions.activeCountAria" && params?.count && params?.total)
        return `${params.count} active sessions out of ${params.total} registered`;
      if (key === "sessions.deviceIdTooltip" && params?.id)
        return `Device ID: ${params.id} (click to copy)`;
      if (key === "sessions.copyDeviceIdAria" && params?.id)
        return `Copy device ID ${params.id}`;
      if (key === "tunnel.installCommandLabel" && params?.platform)
        return `Recommended installation command for ${params.platform}:`;
      if (key === "tunnel.binaryDetectedSuccess" && params?.path)
        return `cloudflared CLI found at ${params.path}`;
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
  restartTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  getTunnelUrl: vi.fn(),
  checkTunnelBinary: vi.fn(),
  getPairingKey: vi.fn(),
  regeneratePairingKey: vi.fn(),
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
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    vi.mocked(relayActions.getTunnelUrl).mockResolvedValue(
      "https://test-subdomain.trycloudflare.com",
    );

    vi.mocked(relayActions.restartTunnel).mockResolvedValue({
      state: "connected",
      pid: 12346,
      publicUrl: "https://test-subdomain.trycloudflare.com",
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

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
        deviceId: "dev_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
    expect(pairingInput.value).toContain("useWebSocket=true");

    expect(screen.queryByText("pairing.wifiAdvisory")).toBeNull();
  });

  it("falls back to Local Wi-Fi mode badge, LAN URL, and advisory banner when tunnel is stopped", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
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
      expect(pairingInput.value).toContain("useWebSocket=true");
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
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
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
      expect(pairingInput.value).toContain("useWebSocket=true");
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

  it("calls regeneratePairingKey when Regenerate button is clicked", async () => {
    vi.mocked(relayActions.regeneratePairingKey).mockResolvedValue(
      "new-secret-key-999",
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const regenButton = await screen.findByRole("button", {
      name: /pairing\.regenerateToken/i,
    });
    expect(regenButton).toBeDefined();

    await waitFor(() => {
      expect(regenButton.hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(regenButton);

    await waitFor(() => {
      expect(relayActions.regeneratePairingKey).toHaveBeenCalled();
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

  it("renders dual restart and stop buttons when tunnel is connected", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const restartBtn = await screen.findByRole("button", {
      name: "tunnel.restartTunnel",
    });
    const stopBtn = await screen.findByRole("button", {
      name: "tunnel.stop",
    });

    expect(restartBtn).toBeDefined();
    expect(stopBtn).toBeDefined();
    expect(restartBtn.hasAttribute("disabled")).toBe(false);
    expect(stopBtn.hasAttribute("disabled")).toBe(false);
  });

  it("triggers restart tunnel action with target port when restart button is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const restartBtn = await screen.findByRole("button", {
      name: "tunnel.restartTunnel",
    });
    fireEvent.click(restartBtn);

    await waitFor(() => {
      expect(relayActions.restartTunnel).toHaveBeenCalledWith({
        targetPort: 4040,
      });
    });
  });

  it("triggers stop tunnel action without relaunching when stop button is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const stopBtn = await screen.findByRole("button", {
      name: "tunnel.stop",
    });
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(relayActions.stopTunnel).toHaveBeenCalled();
      expect(relayActions.restartTunnel).not.toHaveBeenCalled();
    });
  });

  it("disables restart button while enabling stop button when tunnel is starting", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "starting",
      publicUrl: null,
      pid: 12345,
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const restartBtn = await screen.findByRole("button", {
      name: "tunnel.restartTunnel",
    });
    const stopBtn = await screen.findByRole("button", {
      name: "tunnel.stop",
    });

    expect(restartBtn.hasAttribute("disabled")).toBe(true);
    expect(stopBtn.hasAttribute("disabled")).toBe(false);
  });

  it("renders start tunnel button when tunnel is stopped and triggers start action", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByRole("button", { name: "tunnel.restartTunnel" }),
    ).toBeNull();
    const startBtn = await screen.findByRole("button", {
      name: "tunnel.start",
    });
    expect(startBtn).toBeDefined();

    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(relayActions.startTunnel).toHaveBeenCalledWith({
        targetPort: 4040,
      });
    });
  });

  it("renders socket connection state badge and handles session revoke confirmation", async () => {
    vi.mocked(relayActions.revokeRelaySession).mockResolvedValue(true);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("sessions.statusConnected")).toBeDefined();

    const revokeBtn = screen.getByRole("button", {
      name: /Revoke session for iPhone/,
    });
    fireEvent.click(revokeBtn);

    // Confirmation dialog should open
    expect(
      await screen.findByText("sessions.confirmRevokeTitle"),
    ).toBeDefined();

    const confirmBtn = screen.getByRole("button", {
      name: "sessions.confirmRevokeAction",
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(relayActions.revokeRelaySession).toHaveBeenCalledWith(
        "test-session-1",
      );
    });
  });

  it("closes revocation dialog without revoking session when cancel button is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const revokeBtn = await screen.findByRole("button", {
      name: /Revoke session for iPhone/,
    });
    fireEvent.click(revokeBtn);

    expect(
      await screen.findByText("sessions.confirmRevokeTitle"),
    ).toBeDefined();

    const cancelBtn = screen.getByRole("button", {
      name: "action.cancel",
    });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText("sessions.confirmRevokeTitle")).toBeNull();
      expect(relayActions.revokeRelaySession).not.toHaveBeenCalled();
    });
  });

  it("renders shortened Device ID chip and copies full ID to clipboard with feedback toast", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    // dev_a1b2c3d4-e5f6-7890-abcd-ef1234567890 should be shortened to dev_a1b2...7890
    const deviceIdChip = await screen.findByRole("button", {
      name: /Copy device ID dev_a1b2c3d4-e5f6-7890-abcd-ef1234567890/,
    });
    expect(deviceIdChip).toBeDefined();
    expect(deviceIdChip.textContent).toContain("dev_a1b2...7890");

    fireEvent.click(deviceIdChip);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "dev_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "sessions.title",
          description: "sessions.deviceIdCopied",
        }),
      );
    });
  });

  it("evaluates session as Connected when socket is connected", async () => {
    vi.mocked(relayActions.getRelaySessions).mockResolvedValue([
      {
        sessionId: "session-socket-active",
        token: "secret-token-active",
        clientIp: "192.168.1.60",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        connectedAt: Date.now() - 60000,
        lastActiveAt: Date.now() - 10000,
        authenticated: true,
        socketState: "connected",
        deviceId: "dev_11223344",
      },
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const activeBadge = await screen.findByText("sessions.statusConnected");
    expect(activeBadge).toBeDefined();
    expect(screen.queryByText("sessions.statusDisconnected")).toBeNull();
  });

  it("evaluates session as Disconnected immediately when socket is disconnected", async () => {
    vi.mocked(relayActions.getRelaySessions).mockResolvedValue([
      {
        sessionId: "session-disconnected",
        token: "secret-token-disconnected",
        clientIp: "192.168.1.70",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        connectedAt: Date.now() - 120000,
        lastActiveAt: Date.now() - 5000, // 5s ago
        authenticated: true,
        socketState: "disconnected",
        deviceId: "dev_99887766",
      },
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const disconnectedBadge = await screen.findByText(
      "sessions.statusDisconnected",
    );
    expect(disconnectedBadge).toBeDefined();
    expect(screen.queryByText("sessions.statusConnected")).toBeNull();
  });

  it("renders ratio counter badge in card header when both active and disconnected sessions exist", async () => {
    vi.mocked(relayActions.getRelaySessions).mockResolvedValue([
      {
        sessionId: "session-active",
        token: "token-1",
        clientIp: "192.168.1.80",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        connectedAt: Date.now() - 30000,
        lastActiveAt: Date.now() - 2000,
        authenticated: true,
        socketState: "connected",
      },
      {
        sessionId: "session-stale",
        token: "token-2",
        clientIp: "192.168.1.81",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        connectedAt: Date.now() - 120000,
        lastActiveAt: Date.now() - 60000,
        authenticated: true,
        socketState: "disconnected",
      },
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    // 1 of 2 active should be rendered in the header badge
    const ratioBadge = await screen.findByText("1 of 2 active");
    expect(ratioBadge).toBeDefined();
  });

  it("renders amber status badge, missing binary alert banner, and disabled Start Tunnel button when binary is not installed", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });
    vi.mocked(relayActions.getTunnelUrl).mockResolvedValue(null);

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    // Amber status badge in Quick Tunnel header
    const notInstalledBadge = await screen.findByText(
      "tunnel.notInstalledBadge",
    );
    expect(notInstalledBadge).toBeDefined();
    const badgeContainer = notInstalledBadge.closest(".border-amber-300");
    expect(badgeContainer?.className).toContain("bg-amber-500/15");
    expect(badgeContainer?.className).toContain("text-amber-600");

    // Missing binary alert banner region
    const alertRegion = screen.getByRole("region", {
      name: "tunnel.missingBannerTitle",
    });
    expect(alertRegion).toBeDefined();
    expect(screen.getByText("tunnel.missingBannerDesc")).toBeDefined();

    // macOS recommended install command and copy button
    expect(
      screen.getByText(
        "Recommended installation command for macOS (Homebrew):",
      ),
    ).toBeDefined();
    expect(screen.getByText("brew install cloudflared")).toBeDefined();

    // Official documentation link
    const docsLink = screen.getByRole("link", {
      name: "tunnel.officialDocs",
    });
    expect(docsLink).toBeDefined();
    expect(docsLink.getAttribute("href")).toBe(
      "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    );

    // Start Tunnel button disabled with aria attributes
    const startBtn = screen.getByRole("button", { name: "tunnel.start" });
    expect(startBtn.hasAttribute("disabled")).toBe(true);
    expect(startBtn.getAttribute("aria-disabled")).toBe("true");
    expect(startBtn.getAttribute("aria-describedby")).toBe(
      "cf-binary-missing-notice",
    );
    expect(startBtn.getAttribute("title")).toBe("tunnel.startDisabledReason");

    // Clicking disabled start button does not invoke startTunnel
    fireEvent.click(startBtn);
    expect(relayActions.startTunnel).not.toHaveBeenCalled();
  });

  it("renders platform-tailored installation commands for Windows and Linux", async () => {
    // Windows platform test
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "win32",
    });

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "Recommended installation command for Windows (Winget):",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("winget install --id Cloudflare.cloudflared"),
    ).toBeDefined();
    unmount();

    // Linux platform test
    const linuxQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "linux",
    });

    render(
      <QueryClientProvider client={linuxQueryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText(
        "Recommended installation command for Linux (APT / Snap):",
      ),
    ).toBeDefined();
    expect(screen.getByText("sudo apt install cloudflared")).toBeDefined();
  });

  it("copies install command to clipboard and displays feedback when Copy button is clicked", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    await screen.findByText("brew install cloudflared");

    const copyBtn = screen.getByRole("button", { name: "tunnel.copyCommand" });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "brew install cloudflared",
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "tunnel.title",
          description: "tunnel.commandCopied",
        }),
      );
    });
  });

  it("triggers checkTunnelBinary and displays success toast when Check Again discovers binary", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    vi.mocked(relayActions.checkTunnelBinary).mockResolvedValue({
      isInstalled: true,
      binaryPath: "/opt/homebrew/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const checkAgainBtn = await screen.findByRole("button", {
      name: "tunnel.checkAgain",
    });
    fireEvent.click(checkAgainBtn);

    await waitFor(() => {
      expect(relayActions.checkTunnelBinary).toHaveBeenCalledWith(true);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "tunnel.title",
          description: "cloudflared CLI found at /opt/homebrew/bin/cloudflared",
        }),
      );
    });
  });

  it("triggers checkTunnelBinary and displays warning toast when Check Again reveals binary is still missing", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    vi.mocked(relayActions.checkTunnelBinary).mockResolvedValue({
      isInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const checkAgainBtn = await screen.findByRole("button", {
      name: "tunnel.checkAgain",
    });
    fireEvent.click(checkAgainBtn);

    await waitFor(() => {
      expect(relayActions.checkTunnelBinary).toHaveBeenCalledWith(true);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "tunnel.title",
          description: "tunnel.binaryStillMissing",
          variant: "destructive",
        }),
      );
    });
  });

  it("handles error during Check Again and shows error toast", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      publicUrl: null,
      pid: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    vi.mocked(relayActions.checkTunnelBinary).mockRejectedValue(
      new Error("IPC binary probe timeout"),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RelayDashboard />
      </QueryClientProvider>,
    );

    const checkAgainBtn = await screen.findByRole("button", {
      name: "tunnel.checkAgain",
    });
    fireEvent.click(checkAgainBtn);

    await waitFor(() => {
      expect(relayActions.checkTunnelBinary).toHaveBeenCalledWith(true);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "common.error",
          description: "IPC binary probe timeout",
          variant: "destructive",
        }),
      );
    });
  });
});
