import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCode } from "@/modules/relay/components/QRCode";
import { generateQrMatrix } from "@/modules/relay/components/qr-generator";
import {
  generateAutoReloadScript,
  generateRevokedHtml,
  generatePairingHtml,
} from "@/modules/relay/relay-server";

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
    it("should render accessible SVG with role='img', width=180, height=180, and quiet zone", () => {
      const html = renderToStaticMarkup(
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

      // Tokens and Quiet Zone
      expect(html).toContain("var(--comp-qr-container-size,212px)");
      expect(html).toContain("var(--comp-qr-bg,#ffffff)");
      expect(html).toContain("var(--comp-qr-fg, #090d16)");

      // Vector path elements
      expect(html).toContain("<path d=");
      expect(html).toContain("h1v1h-1z");
    });

    it("should render fallback text when value is empty", () => {
      const html = renderToStaticMarkup(
        React.createElement(QRCode, {
          value: "",
          size: 180,
        }),
      );

      expect(html).toContain('role="img"');
      expect(html).toContain("No URL");
    });
  });

  describe("Session Revocation Client Script & In-Session Overlay", () => {
    describe("Script Generation & WebSocket 4401 Closure Interception", () => {
      it("generates client script with PatchedWS intercepting code 4401 and SESSION_REVOKED messages", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain("event.code === 4401");
        expect(script).toContain('data.type === "SESSION_REVOKED"');
        expect(script).toContain("window.__antigravitySessionRevoked = true");
        expect(script).toContain("PatchedWS extends OrigWS");
      });

      it("suppresses health polling and auto-reload loop when session is revoked", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain(
          "if (reloading || window.__antigravitySessionRevoked) return;",
        );
        expect(script).toContain("if (window.__antigravitySessionRevoked) {");
        expect(script).toContain("reloading = false;");
      });
    });

    describe("Shadow DOM Overlay Architecture & Accessibility Semantics", () => {
      it("mounts isolated Shadow DOM host and enforces ARIA alertdialog semantics", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('id = "antigravity-revocation-host"');
        expect(script).toContain('attachShadow({ mode: "open" })');
        expect(script).toContain('role", "alertdialog"');
        expect(script).toContain('aria-modal", "true"');
        expect(script).toContain('aria-labelledby", "overlay-title"');
        expect(script).toContain('aria-describedby", "overlay-desc"');
        expect(script).toContain('role="alert" aria-live="assertive"');
        expect(script).toContain('role="status" aria-live="polite"');
      });

      it("enforces keyboard focus trap cycling and prevents Escape key dismissal", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('e.key === "Escape"');
        expect(script).toContain("e.preventDefault()");
        expect(script).toContain("e.stopPropagation()");
        expect(script).toContain('e.key === "Tab"');
        expect(script).toContain("e.shiftKey");
      });

      it("locks and unlocks document and body scrolling during overlay lifecycle", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain(
          'document.documentElement.style.overflow = "hidden"',
        );
        expect(script).toContain(
          'document.documentElement.style.touchAction = "none"',
        );
        expect(script).toContain('document.body.style.overflow = "hidden"');
        expect(script).toContain('document.body.style.touchAction = "none"');
        expect(script).toContain(
          'document.documentElement.style.overflow = ""',
        );
        expect(script).toContain('document.body.style.overflow = ""');
      });
    });

    describe("Dual-Language Copy Catalog & Localization Coverage", () => {
      it("contains complete English copy catalog without missing keys", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('overlayTitle: "Access Revoked"');
        expect(script).toContain(
          'overlayMessage: "Your access was revoked by the desktop host. Enter a new pairing key to reconnect."',
        );
        expect(script).toContain('overlayBadge: "Disconnected by Host"');
        expect(script).toContain('repairButton: "Re-pair Device"');
        expect(script).toContain('repairButtonLoading: "Connecting..."');
        expect(script).toContain(
          'repairButtonAria: "Submit pairing key to re-pair this device"',
        );
        expect(script).toContain('pairingInputLabel: "Pairing Key"');
        expect(script).toContain(
          'pairingInputPlaceholder: "Enter pairing key"',
        );
        expect(script).toContain(
          'invalidKeyError: "Invalid pairing key. Please verify the key shown on your desktop dashboard."',
        );
        expect(script).toContain(
          'emptyKeyError: "Please enter a pairing key before submitting."',
        );
        expect(script).toContain(
          'rateLimitError: "Too many pairing attempts. Please wait."',
        );
        expect(script).toContain(
          'networkError: "Unable to reach the relay server. Please check your network connection."',
        );
        expect(script).toContain(
          'syncingSiblingTabs: "Device re-paired successfully. Synchronizing open tabs..."',
        );
      });

      it("contains complete Indonesian copy catalog matching localized specs", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('overlayTitle: "Akses Dicabut"');
        expect(script).toContain(
          'overlayMessage: "Akses Anda telah dicabut oleh host desktop. Masukkan kunci pairing baru untuk menyambung kembali."',
        );
        expect(script).toContain('overlayBadge: "Terputus oleh Host"');
        expect(script).toContain('repairButton: "Hubungkan Ulang Perangkat"');
        expect(script).toContain('repairButtonLoading: "Menyambungkan..."');
        expect(script).toContain(
          'repairButtonAria: "Kirim kunci pairing untuk menghubungkan ulang perangkat ini"',
        );
        expect(script).toContain('pairingInputLabel: "Kunci Pairing"');
        expect(script).toContain(
          'pairingInputPlaceholder: "Masukkan kunci pairing"',
        );
        expect(script).toContain(
          'invalidKeyError: "Kunci pairing tidak valid. Silakan periksa kunci yang ditampilkan di dashboard desktop Anda."',
        );
        expect(script).toContain(
          'emptyKeyError: "Silakan masukkan kunci pairing sebelum mengirimkan."',
        );
        expect(script).toContain(
          'rateLimitError: "Terlalu banyak percobaan pairing. Silakan tunggu."',
        );
        expect(script).toContain(
          'networkError: "Tidak dapat menjangkau server relay. Silakan periksa koneksi jaringan Anda."',
        );
        expect(script).toContain(
          'syncingSiblingTabs: "Perangkat berhasil dihubungkan ulang. Menyelaraskan tab yang terbuka..."',
        );
      });

      it("resolves language from navigator.language with Indonesian prefix detection", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain(
          'navigator.language || navigator.userLanguage || "en"',
        );
        expect(script).toContain('navLang.indexOf("id") === 0');
      });
    });

    describe("320px Responsive Viewport Styling & 5 Interactive States", () => {
      it("enforces 320px responsive container and backdrop scrim styling", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain("background: rgba(9, 13, 22, 0.88)");
        expect(script).toContain("backdrop-filter: blur(4px)");
        expect(script).toContain("padding: clamp(1rem, 5vw, 2rem)");
        expect(script).toContain("padding: clamp(1.25rem, 5vw, 2rem)");
        expect(script).toContain("max-width: 400px");
        expect(script).toContain("max-height: calc(100dvh - 32px)");
        expect(script).toContain("overflow-y: auto");
        expect(script).toContain("z-index: 2147483647");
      });

      it("enforces minimum 44px touch targets on input and button", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain("min-height: 44px");
        expect(script).toContain("padding: 0.75rem 1rem");
        expect(script).toContain("padding: 0.75rem");
      });

      it("specifies all 5 interactive states for input and submit button", () => {
        const script = generateAutoReloadScript(4040, 100);
        // Input: Default, Hover, Focus-Visible, Error, Disabled
        expect(script).toContain("background: #0d131f");
        expect(script).toContain("input:hover");
        expect(script).toContain("border-color: #6b7280");
        expect(script).toContain("input:focus-visible");
        expect(script).toContain(
          "box-shadow: 0 0 0 2px #090d16, 0 0 0 4px #3b82f6",
        );
        expect(script).toContain('input[aria-invalid="true"]');
        expect(script).toContain("background: rgba(239, 68, 68, 0.08)");
        expect(script).toContain("input:disabled");

        // Button: Default, Hover/Active, Focus-Visible, Error Motion, Disabled
        expect(script).toContain("background: #10b981");
        expect(script).toContain("color: #000000");
        expect(script).toContain("button:hover");
        expect(script).toContain("button:active");
        expect(script).toContain("transform: scale(0.98)");
        expect(script).toContain("button:focus-visible");
        expect(script).toContain("@keyframes form-shake");
        expect(script).toContain(".shake");
        expect(script).toContain("button:disabled");
      });
    });

    describe("Multi-Tab Synchronization & Inline Re-Pairing Flow", () => {
      it("configures BroadcastChannel and localStorage fallbacks", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain("BroadcastChannel(RELAY_CHANNEL)");
        expect(script).toContain('localStorage.setItem("ag_relay_revoked_at"');
        expect(script).toContain('localStorage.setItem("ag_relay_restored_at"');
        expect(script).toContain('event.key === "ag_relay_revoked_at"');
        expect(script).toContain('event.key === "ag_relay_restored_at"');
      });

      it("handles inline form submission for 200, 401, and 429 status codes", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('fetch("/?pair=" + encodeURIComponent(key)');
        expect(script).toContain("res.status === 200 || res.ok");
        expect(script).toContain("res.status === 429");
        expect(script).toContain("strings.rateLimitError");
        expect(script).toContain("strings.invalidKeyError");
        expect(script).toContain("strings.emptyKeyError");
        expect(script).toContain('data.error === "key_consumed"');
        expect(script).toContain('data.error === "session_revoked"');
        expect(script).toContain("strings.keyConsumedError");
        expect(script).toContain("strings.staleKeyError");
      });

      it("scrubs ?pair= and ?useWebSocket= parameters via history.replaceState on load", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('currentUrlParams.has("pair")');
        expect(script).toContain('currentUrlParams.has("useWebSocket")');
        expect(script).toContain('currentUrlParams.delete("pair")');
        expect(script).toContain('currentUrlParams.delete("useWebSocket")');
        expect(script).toContain(
          "window.history.replaceState({}, document.title, cleanPath)",
        );
      });

      it("triggers focus and select on pairing key input upon overlay mount", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain("input.focus()");
        expect(script).toContain('typeof input.select === "function"');
        expect(script).toContain("input.select()");
      });

      it("renders animated spinner in submit button during authentication", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain('class="animate-spin"');
        expect(script).toContain("@keyframes spin");
        expect(script).toContain("submitBtn.innerHTML = spinnerSvg");
      });

      it("listens to visibilitychange for waking background tabs", () => {
        const script = generateAutoReloadScript(4040, 100);
        expect(script).toContain(
          'document.addEventListener("visibilitychange"',
        );
        expect(script).toContain('document.visibilityState === "visible"');
        expect(script).toContain('localStorage.getItem("ag_relay_revoked_at")');
      });
    });

    describe("Standalone Revocation HTML Page (generateRevokedHtml)", () => {
      it("generates accessible standalone revocation page with 44px touch targets", () => {
        const html = generateRevokedHtml();
        expect(html).toContain('role="alertdialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toContain('id="revoked-heading"');
        expect(html).toContain('id="revoked-desc"');
        expect(html).toContain("Access Revoked by Host");
        expect(html).toContain("min-height: 44px");
      });

      it("embeds cross-tab synchronization listener in standalone revocation page", () => {
        const html = generateRevokedHtml();
        expect(html).toContain('new BroadcastChannel("antigravity-relay")');
        expect(html).toContain('ev.data.type === "SESSION_RESTORED"');
        expect(html).toContain('ev.key === "ag_relay_restored_at"');
      });

      it("embeds URL sanitization scrubbing ?pair= and ?useWebSocket= on page load", () => {
        const html = generateRevokedHtml();
        expect(html).toContain("window.history.replaceState");
        expect(html).toContain('params.delete("pair")');
        expect(html).toContain('params.delete("useWebSocket")');
      });

      it("embeds 5 interactive states and WCAG compliant emerald CTA styling", () => {
        const html = generateRevokedHtml();
        expect(html).toContain("background: #10b981");
        expect(html).toContain("button:hover { background: #059669; }");
        expect(html).toContain(
          "button:active { transform: scale(0.98); background: #047857; }",
        );
        expect(html).toContain("button:focus-visible");
        expect(html).toContain("button:disabled");
        expect(html).toContain("@keyframes form-shake");
        expect(html).toContain("@keyframes spin");
        expect(html).toContain(".animate-spin");
      });

      it("embeds focus trapping, Escape suppression, and autofocus select on mount", () => {
        const html = generateRevokedHtml();
        expect(html).toContain('e.key === "Escape"');
        expect(html).toContain('e.key === "Tab"');
        expect(html).toContain('typeof input.select === "function"');
      });

      it("renders custom error message block when provided", () => {
        const html = generateRevokedHtml(
          "Invalid pairing key. Check desktop dashboard.",
        );
        expect(html).toContain("Invalid pairing key. Check desktop dashboard.");
        expect(html).toContain("background:rgba(239,68,68,0.12)");
      });

      it("embeds mobile safe-area insets, viewport-fit=cover, and 16px font-size to prevent iOS zoom", () => {
        const html = generateRevokedHtml();
        expect(html).toContain("viewport-fit=cover");
        expect(html).toContain("env(safe-area-inset-top");
        expect(html).toContain("env(safe-area-inset-bottom");
        expect(html).toContain("font-size: 16px");
      });
    });

    describe("Standalone Pairing HTML Page (generatePairingHtml)", () => {
      it("embeds mobile viewport safety, 44px touch targets, safe-area insets, and branded icons", () => {
        const html = generatePairingHtml();
        expect(html).toContain("viewport-fit=cover");
        expect(html).toContain("min-height: 44px");
        expect(html).toContain("env(safe-area-inset-top");
        expect(html).toContain("env(safe-area-inset-bottom");
        expect(html).toContain("font-size: 16px");
        expect(html).toContain('href="/favicon.ico"');
        expect(html).toContain('href="/icon.png"');
        expect(html).toContain("Device Pairing Required");
      });
    });

    describe("Runtime Overlay Execution & DOM Simulation", () => {
      beforeEach(() => {
        document.body.innerHTML = "";
        const existingHost = document.getElementById(
          "antigravity-revocation-host",
        );
        if (existingHost) existingHost.remove();
        delete (window as any).__antigravityRelayAutoReloadInjected;
        delete (window as any).__antigravitySessionRevoked;

        const mockStorage: Record<string, string> = {};
        const storage = {
          getItem: (k: string) => mockStorage[k] ?? null,
          setItem: (k: string, v: string) => {
            mockStorage[k] = String(v);
          },
          removeItem: (k: string) => {
            delete mockStorage[k];
          },
          clear: () => {
            Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
          },
        };
        try {
          Object.defineProperty(window, "localStorage", {
            value: storage,
            writable: true,
            configurable: true,
          });
          Object.defineProperty(globalThis, "localStorage", {
            value: storage,
            writable: true,
            configurable: true,
          });
        } catch (_) {}
      });

      it("executes injected script, mounts Shadow DOM overlay, and handles form validation", async () => {
        class MockBaseWS extends EventTarget {
          close() {}
        }
        (window as any).WebSocket = MockBaseWS;

        const script = generateAutoReloadScript(4040, 100);
        const code = script.replace(/<script[^>]*>|<\/script>/g, "");
        new Function(code)();

        expect((window as any).__antigravitySessionRevoked).toBe(false);

        // Trigger a WebSocket close with 4401
        const WS = (window as any).WebSocket;
        const ws = new WS("ws://localhost:4040");
        const closeEv =
          typeof CloseEvent !== "undefined"
            ? new CloseEvent("close", {
                code: 4401,
                reason: "Session revoked by host",
              })
            : Object.assign(new Event("close"), {
                code: 4401,
                reason: "Session revoked by host",
              });
        ws.dispatchEvent(closeEv);

        expect((window as any).__antigravitySessionRevoked).toBe(true);

        const host = document.getElementById("antigravity-revocation-host");
        expect(host).not.toBeNull();
        const shadow = host?.shadowRoot;
        expect(shadow).not.toBeNull();

        // Check shadow elements
        const card = shadow?.getElementById("revocation-card");
        expect(card).not.toBeNull();
        const title = shadow?.getElementById("overlay-title");
        expect(title?.textContent).toBe("Access Revoked");

        // Verify empty submission triggers error
        const form = shadow?.getElementById("overlay-form") as HTMLFormElement;
        const errorBox = shadow?.getElementById("overlay-error");
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
        expect(errorBox?.style.display).toBe("block");
        expect(errorBox?.textContent).toBe(
          "Please enter a pairing key before submitting.",
        );

        // Verify Escape key does not dismiss dialog
        const overlay = shadow?.querySelector(".scrim");
        const escapeEvent = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });
        overlay?.dispatchEvent(escapeEvent);
        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(
          document.getElementById("antigravity-revocation-host"),
        ).not.toBeNull();
      });
    });
  });
});
