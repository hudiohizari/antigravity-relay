import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/renderer/locales/i18n";
import { QRCode } from "../src/renderer/components/QRCode";
import { generateQrMatrix } from "../src/renderer/components/qr-generator";
import { RemoteControl } from "../src/renderer/pages/RemoteControl";
import type {
  RelayServerStatus,
  TunnelStatus,
  Session,
} from "../src/shared/types";

describe("Remote Tethering Frontend Architecture & Components", () => {
  describe("QR Code Generator Matrix & Function Patterns", () => {
    it("should generate valid square matrix with correct dimensions for short and long URLs", () => {
      const shortUrl = "http://127.0.0.1:4040";
      const shortMatrix = generateQrMatrix(shortUrl);
      expect(shortMatrix.length).toBeGreaterThanOrEqual(21);
      expect(shortMatrix[0].length).toBe(shortMatrix.length);

      const longUrl =
        "https://random-subdomain-429.trycloudflare.com/?pair=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const longMatrix = generateQrMatrix(longUrl);
      expect(longMatrix.length).toBeGreaterThanOrEqual(41);
      expect(longMatrix[0].length).toBe(longMatrix.length);
    });

    it("should place 7x7 finder patterns with concentric squares at top-left, top-right, and bottom-left", () => {
      const matrix = generateQrMatrix("https://trycloudflare.com");
      const size = matrix.length;

      const checkFinder = (startRow: number, startCol: number) => {
        // Outer 7x7 border should be all black
        for (let i = 0; i < 7; i++) {
          expect(matrix[startRow][startCol + i]).toBe(true);
          expect(matrix[startRow + 6][startCol + i]).toBe(true);
          expect(matrix[startRow + i][startCol]).toBe(true);
          expect(matrix[startRow + i][startCol + 6]).toBe(true);
        }
        // Inner 5x5 border should be white
        for (let i = 1; i < 6; i++) {
          expect(matrix[startRow + 1][startCol + i]).toBe(false);
          expect(matrix[startRow + 5][startCol + i]).toBe(false);
          expect(matrix[startRow + i][startCol + 1]).toBe(false);
          expect(matrix[startRow + i][startCol + 5]).toBe(false);
        }
        // Center 3x3 should be black
        for (let r = 2; r <= 4; r++) {
          for (let c = 2; c <= 4; c++) {
            expect(matrix[startRow + r][startCol + c]).toBe(true);
          }
        }
      };

      // Top-left
      checkFinder(0, 0);
      // Top-right
      checkFinder(0, size - 7);
      // Bottom-left
      checkFinder(size - 7, 0);
    });

    it("should place alternating timing patterns on row 6 and column 6", () => {
      const matrix = generateQrMatrix("https://antigravity-relay.dev");
      const size = matrix.length;

      // Horizontal timing pattern
      for (let c = 8; c < size - 8; c++) {
        expect(matrix[6][c]).toBe(c % 2 === 0);
      }
      // Vertical timing pattern
      for (let r = 8; r < size - 8; r++) {
        expect(matrix[r][6]).toBe(r % 2 === 0);
      }
    });
  });

  describe("QRCode SVG Component Accessibility & Design Tokens", () => {
    function renderWithI18n(element: React.ReactElement): string {
      return renderToStaticMarkup(
        React.createElement(I18nProvider, {
          defaultLocale: "en",
          children: element,
        }),
      );
    }

    it("should render accessible SVG with role='img', width=180, height=180, and quiet zone", () => {
      const html = renderWithI18n(
        React.createElement(QRCode, {
          value: "https://trycloudflare.com/?pair=test-pairing-token",
          size: 180,
          title: "Remote Pairing QR Code",
          description:
            "Scan with your smartphone camera to tether mobile remote control.",
        }),
      );

      // Accessibility semantics
      expect(html).toContain('role="img"');
      expect(html).toContain('width="180"');
      expect(html).toContain('height="180"');
      expect(html).toContain("<title");
      expect(html).toContain("Remote Pairing QR Code");
      expect(html).toContain("<desc");
      expect(html).toContain(
        "Scan with your smartphone camera to tether mobile remote control.",
      );

      // DTCG tokens and Quiet Zone
      expect(html).toContain("var(--comp-qr-container-size,212px)");
      expect(html).toContain("var(--comp-qr-bg, #ffffff)");
      expect(html).toContain("var(--comp-qr-fg, #090d16)");

      // Vector path elements
      expect(html).toContain("<path d=");
      expect(html).toContain("h1v1h-1z");
    });

    it("should render fallback text when value is empty", () => {
      const html = renderWithI18n(
        React.createElement(QRCode, {
          value: "",
          size: 180,
        }),
      );

      expect(html).toContain('role="img"');
      expect(html).toContain("No URL");
    });
  });

  describe("RemoteControl Page Dashboard & Telemetry", () => {
    const mockRelayStatus: RelayServerStatus = {
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
        flushedCommandCount: 42,
      },
    };

    const mockTunnelStatus: TunnelStatus = {
      state: "connected",
      publicUrl: "https://subdomain-712.trycloudflare.com",
      pid: 58210,
      startedAt: Date.now() - 120000,
      reconnectAttempts: 0,
    };

    const mockSessions: Session[] = [
      {
        sessionId: "sess-abc-123",
        token: "tok-123",
        clientIp: "192.168.1.142",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        connectedAt: Date.now() - 2538000, // 42m 18s ago
        lastActiveAt: Date.now() - 3000, // 3s ago
        authenticated: true,
        socketState: "connected",
      },
    ];

    beforeEach(() => {
      (globalThis as any).window = {
        electronAPI: {
          getRelayStatus: vi.fn().mockResolvedValue(mockRelayStatus),
          startRelay: vi
            .fn()
            .mockResolvedValue({ success: true, data: mockRelayStatus }),
          stopRelay: vi.fn().mockResolvedValue({ success: true }),
          getRelaySessions: vi.fn().mockResolvedValue(mockSessions),
          revokeRelaySession: vi.fn().mockResolvedValue({ success: true }),
          onRelayStatusUpdated: vi.fn().mockReturnValue(() => {}),

          getTunnelStatus: vi.fn().mockResolvedValue(mockTunnelStatus),
          startTunnel: vi
            .fn()
            .mockResolvedValue({ success: true, data: mockTunnelStatus }),
          stopTunnel: vi.fn().mockResolvedValue({ success: true }),
          getTunnelUrl: vi
            .fn()
            .mockResolvedValue({ publicUrl: mockTunnelStatus.publicUrl }),
          onTunnelStatusUpdated: vi.fn().mockReturnValue(() => {}),
        },
      };
    });

    afterEach(() => {
      delete (globalThis as any).window;
    });

    function renderWithI18n(element: React.ReactElement): string {
      return renderToStaticMarkup(
        React.createElement(I18nProvider, {
          defaultLocale: "en",
          children: element,
        }),
      );
    }

    it("should render RemoteControl dashboard with relay server controls and telemetry", () => {
      const html = renderWithI18n(
        React.createElement(RemoteControl, {
          relayStatusOverride: mockRelayStatus,
          tunnelStatusOverride: mockTunnelStatus,
          sessionsOverride: mockSessions,
        }),
      );

      // Header titles
      expect(html).toContain("Remote Control &amp; Mobile Tethering");
      expect(html).toContain("Local Relay Server");
      expect(html).toContain("Cloudflare Quick Tunnel");
      expect(html).toContain("Mobile Pairing &amp; QR Access");

      // Relay toggle switch
      expect(html).toContain('role="switch"');
      expect(html).toContain("Command Buffer");

      // Cloudflare URL card and copy action
      expect(html).toContain("Public Tunnel URL");
      expect(html).toContain("Restart Tunnel");
      expect(html).toContain("Copy Tunnel URL");

      // Pairing instructions and token
      expect(html).toContain("Scan with phone camera to connect");
      expect(html).toContain("Regenerate Pairing Key");
    });

    it("should render connected mobile sessions table and device telemetry", () => {
      const html = renderWithI18n(
        React.createElement(RemoteControl, {
          relayStatusOverride: mockRelayStatus,
          tunnelStatusOverride: mockTunnelStatus,
          sessionsOverride: mockSessions,
        }),
      );

      expect(html).toContain("Connected Phone Sessions");
      expect(html).toContain("Device / Client");
      expect(html).toContain("IP Address");
      expect(html).toContain("Connected For");
      expect(html).toContain("Last Active");
      expect(html).toContain("Actions");

      // Parsed user-agent device name
      expect(html).toContain("iPhone");
      expect(html).toContain("Safari");
      expect(html).toContain("192.168.1.142");
      expect(html).toContain("Revoke");
    });

    it("should render empty state when no sessions are connected", () => {
      const html = renderWithI18n(
        React.createElement(RemoteControl, {
          relayStatusOverride: { ...mockRelayStatus, activeSessions: 0 },
          tunnelStatusOverride: mockTunnelStatus,
          sessionsOverride: [],
        }),
      );

      expect(html).toContain("No connected mobile devices");
      expect(html).toContain(
        "Scan the pairing QR code above with your smartphone",
      );
    });

    it("should render upstream daemon status with connected and buffering tokens", () => {
      const htmlConnected = renderWithI18n(
        React.createElement(RemoteControl, {
          relayStatusOverride: mockRelayStatus,
          tunnelStatusOverride: mockTunnelStatus,
          sessionsOverride: mockSessions,
        }),
      );
      expect(htmlConnected).toContain("Connected to Daemon");
      expect(htmlConnected).toContain("var(--status-upstream-connected");

      // Buffering state
      const bufferingStatus: RelayServerStatus = {
        ...mockRelayStatus,
        isBuffering: true,
        upstream: {
          ...mockRelayStatus.upstream,
          bufferedCommandCount: 3,
        },
      };

      const htmlBuffering = renderWithI18n(
        React.createElement(RemoteControl, {
          relayStatusOverride: bufferingStatus,
          tunnelStatusOverride: mockTunnelStatus,
          sessionsOverride: mockSessions,
        }),
      );
      expect(htmlBuffering).toContain("Buffering (Daemon Restarting)");
      expect(htmlBuffering).toContain("var(--status-upstream-buffering");
      expect(htmlBuffering).toContain("3 queued commands");
    });
  });
});
