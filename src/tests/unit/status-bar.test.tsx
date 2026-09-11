import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "@/components/layout/StatusBar";
import * as processActions from "@/modules/antigravity-runtime/actions/process";
import * as relayActions from "@/modules/relay/actions/relay";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (key === "status.partial_running" && params) {
        return `${params.running}/${params.total} services running`;
      }
      return key;
    },
  }),
}));

vi.mock("@/modules/antigravity-runtime/actions/process", () => ({
  isProcessRunning: vi.fn(),
  getProcessStatus: vi.fn(),
  startAntigravity: vi.fn(),
  closeAntigravity: vi.fn(),
}));

vi.mock("@/modules/relay/actions/relay", () => ({
  getRelayStatus: vi.fn(),
  startRelay: vi.fn(),
  stopRelay: vi.fn(),
  getTunnelStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
}));

describe("StatusBar Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    vi.mocked(processActions.isProcessRunning).mockResolvedValue(false);
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: false,
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: false,
      port: 4040,
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
    });
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      pid: null,
      publicUrl: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });
  });

  it("renders all 5 services in strict order in dropdown menu when open", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("status.service_relay")).toBeDefined();
    expect(screen.getByText("status.service_tunnel")).toBeDefined();
    expect(screen.getByText("status.service_app")).toBeDefined();
    expect(screen.getByText("status.service_ide")).toBeDefined();
    expect(screen.getByText("status.service_cli")).toBeDefined();
  });

  it("renders distinct Services and Applications section labels with proper grouping", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("status.apps")).toBeDefined();
    const serviceHeaders = screen.getAllByText("status.services");
    expect(serviceHeaders.length).toBeGreaterThanOrEqual(2);
  });

  it("opens menu and renders all 5 services when DropdownMenuTrigger is clicked", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>,
    );

    const trigger = screen.getByLabelText("status.open_dashboard");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    expect(await screen.findByText("status.service_relay")).toBeDefined();
    expect(screen.getByText("status.service_tunnel")).toBeDefined();
    expect(screen.getByText("status.service_app")).toBeDefined();
    expect(screen.getByText("status.service_ide")).toBeDefined();
    expect(screen.getByText("status.service_cli")).toBeDefined();
  });

  it("calculates aggregate summary as all stopped when 0/5 services running", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>,
    );

    const summaries = await screen.findAllByText("status.all_stopped");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates aggregate summary as 1/5 when only classic is running", async () => {
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: target === "classic",
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>,
    );

    const summaries = await screen.findAllByText("1/5 services running");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates aggregate summary as 2/5 when classic and relay are running", async () => {
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: target === "classic",
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "127.0.0.1",
      activeSessions: 1,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4041,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>,
    );

    const summaries = await screen.findAllByText("2/5 services running");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("calculates aggregate summary as all running when 5/5 services running", async () => {
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: true,
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "127.0.0.1",
      activeSessions: 1,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4041,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
    });
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "connected",
      pid: 9999,
      publicUrl: "https://test.trycloudflare.com",
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>,
    );

    const summaries = await screen.findAllByText("status.all_running");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("triggers startRelay when toggling stopped relay service (index 0)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: "action.start" });
      expect(btns[0].hasAttribute("disabled")).toBe(false);
    });
    const startButtons = screen.getAllByRole("button", {
      name: "action.start",
    });
    fireEvent.click(startButtons[0]);

    await waitFor(() => {
      expect(relayActions.startRelay).toHaveBeenCalled();
    });
  });

  it("triggers stopRelay when toggling running relay service (index 0)", async () => {
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "127.0.0.1",
      activeSessions: 0,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4041,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const stopButton = await screen.findByRole("button", {
      name: "action.stop",
    });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(relayActions.stopRelay).toHaveBeenCalled();
    });
  });

  it("triggers startTunnel when toggling stopped tunnel service (index 1)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: "action.start" });
      expect(btns[1].hasAttribute("disabled")).toBe(false);
    });
    const startButtons = screen.getAllByRole("button", {
      name: "action.start",
    });
    fireEvent.click(startButtons[1]);

    await waitFor(() => {
      expect(relayActions.startTunnel).toHaveBeenCalledWith({
        targetPort: 4040,
      });
    });
  });

  it("triggers stopTunnel when toggling running tunnel service (index 1)", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "connected",
      pid: 12345,
      publicUrl: "https://test.trycloudflare.com",
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const stopButton = await screen.findByRole("button", {
      name: "action.stop",
    });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(relayActions.stopTunnel).toHaveBeenCalled();
    });
  });

  it("triggers startAntigravity when toggling stopped classic service (index 2)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: "action.start" });
      expect(btns[2].hasAttribute("disabled")).toBe(false);
    });
    const startButtons = screen.getAllByRole("button", {
      name: "action.start",
    });
    fireEvent.click(startButtons[2]);

    await waitFor(() => {
      expect(processActions.startAntigravity).toHaveBeenCalledWith("classic");
    });
  });

  it("triggers closeAntigravity when toggling running classic service (index 2)", async () => {
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: target === "classic",
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const stopButton = await screen.findByRole("button", {
      name: "action.stop",
    });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(processActions.closeAntigravity).toHaveBeenCalledWith("classic");
    });
  });

  it("triggers startAntigravity when toggling stopped ide service (index 3)", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: "action.start" });
      expect(btns[3].hasAttribute("disabled")).toBe(false);
    });
    const startButtons = screen.getAllByRole("button", {
      name: "action.start",
    });
    fireEvent.click(startButtons[3]);

    await waitFor(() => {
      expect(processActions.startAntigravity).toHaveBeenCalledWith("ide");
    });
  });

  it("disables start button for stopped CLI service (index 4) with guidance tooltip", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      const btns = screen.getAllByRole("button", { name: "action.start" });
      expect(btns[4]).toBeDefined();
    });
    const startButtons = screen.getAllByRole("button", {
      name: "action.start",
    });
    const cliStartButton = startButtons[4];
    expect(cliStartButton.hasAttribute("disabled")).toBe(true);
    expect(cliStartButton.getAttribute("aria-disabled")).toBe("true");
    expect(cliStartButton.getAttribute("title")).toBe(
      "status.tooltips.cliIdleGuidance",
    );

    fireEvent.click(cliStartButton);
    expect(processActions.startAntigravity).not.toHaveBeenCalledWith("agy");
  });

  it("allows stopping running CLI service (index 4)", async () => {
    vi.mocked(processActions.getProcessStatus).mockImplementation(
      async (target) => ({
        target: target || "classic",
        isRunning: target === "agy",
        isBinaryInstalled: true,
        executablePath: `/bin/${target || "classic"}`,
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const stopButton = await screen.findByRole("button", {
      name: "action.stop",
    });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(processActions.closeAntigravity).toHaveBeenCalledWith("agy");
    });
  });

  it("renders collapsed trigger button with open dashboard aria label", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar isCollapsed={true} />
      </QueryClientProvider>,
    );

    const trigger = screen.getByLabelText("status.open_dashboard");
    expect(trigger).toBeDefined();
  });

  it("renders active link under relay server when running", async () => {
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "0.0.0.0",
      activeSessions: 0,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4041,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const relayLink = await screen.findByRole("link", {
      name: /http:\/\/127\.0\.0\.1:4040/i,
    });
    expect(relayLink).toBeDefined();
    expect(relayLink.getAttribute("href")).toBe("http://127.0.0.1:4040");
  });

  it("renders only local Wi-Fi network address and not local device loopback when networkUrl is present", async () => {
    vi.mocked(relayActions.getRelayStatus).mockResolvedValue({
      isRunning: true,
      port: 4040,
      host: "0.0.0.0",
      localIp: "192.168.18.85",
      networkUrl: "http://192.168.18.85:4040",
      activeSessions: 0,
      isBuffering: false,
      upstream: {
        state: "connected",
        targetHost: "127.0.0.1",
        targetPort: 4041,
        reconnectAttempts: 0,
        bufferedCommandCount: 0,
        flushedCommandCount: 0,
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const wifiLink = await screen.findByRole("link", {
      name: /http:\/\/192\.168\.18\.85:4040/i,
    });
    expect(wifiLink).toBeDefined();
    expect(wifiLink.getAttribute("href")).toBe("http://192.168.18.85:4040");

    const localLink = screen.queryByRole("link", {
      name: /http:\/\/127\.0\.0\.1:4040/i,
    });
    expect(localLink).toBeNull();
  });

  it("renders active public link under tunnel when connected", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "connected",
      pid: 12345,
      publicUrl: "https://demo.trycloudflare.com",
      startedAt: Date.now(),
      reconnectAttempts: 0,
      isBinaryInstalled: true,
      binaryPath: "/usr/local/bin/cloudflared",
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const tunnelLink = await screen.findByRole("link", {
      name: /https:\/\/demo\.trycloudflare\.com/i,
    });
    expect(tunnelLink).toBeDefined();
    expect(tunnelLink.getAttribute("href")).toBe(
      "https://demo.trycloudflare.com",
    );
  });

  it("renders amber warning dot, icon, status label, and disabled toggle button when binary is not installed", async () => {
    vi.mocked(relayActions.getTunnelStatus).mockResolvedValue({
      state: "stopped",
      pid: null,
      publicUrl: null,
      startedAt: null,
      reconnectAttempts: 0,
      isBinaryInstalled: false,
      binaryPath: null,
      platform: "darwin",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar defaultOpen={true} />
      </QueryClientProvider>,
    );

    const notInstalledLabel = await screen.findByText(
      "status.not_installed_short",
    );
    expect(notInstalledLabel).toBeDefined();

    // Check amber status dot
    const statusDot = notInstalledLabel.previousElementSibling;
    expect(statusDot?.className).toContain("bg-amber-500");

    // Check service icon container
    const tunnelRow = notInstalledLabel.closest(".flex.min-h-\\[48px\\]");
    expect(tunnelRow).toBeDefined();
    const iconContainer = tunnelRow?.querySelector(".h-8.w-8");
    expect(iconContainer?.className).toContain("bg-amber-500/15");
    expect(iconContainer?.className).toContain("text-amber-600");

    // Check toggle button
    const toggleButton = tunnelRow?.querySelector("button");
    expect(toggleButton).toBeDefined();
    expect(toggleButton?.hasAttribute("disabled")).toBe(true);
    expect(toggleButton?.getAttribute("aria-disabled")).toBe("true");
    expect(toggleButton?.getAttribute("title")).toBe(
      "status.tooltips.tunnelNotInstalled",
    );

    // Clicking disabled button must not call startTunnel or stopTunnel
    if (toggleButton) {
      fireEvent.click(toggleButton);
    }
    expect(relayActions.startTunnel).not.toHaveBeenCalled();
    expect(relayActions.stopTunnel).not.toHaveBeenCalled();
  });
});
