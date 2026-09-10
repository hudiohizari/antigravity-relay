import { describe, it, expect } from "vitest";
import {
  generatePairingHtml,
  generateRevokedHtml,
  resolveRelayViewLanguage,
  translateRelayErrorMessage,
} from "@/modules/relay/relay-server";

describe("Relay Web Views Localization", () => {
  describe("resolveRelayViewLanguage", () => {
    it("defaults to en when no parameters provided", () => {
      expect(resolveRelayViewLanguage()).toBe("en");
      expect(resolveRelayViewLanguage(null, null)).toBe("en");
      expect(resolveRelayViewLanguage("", "")).toBe("en");
    });

    it("resolves id from Accept-Language header", () => {
      expect(
        resolveRelayViewLanguage("id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"),
      ).toBe("id");
      expect(resolveRelayViewLanguage("id")).toBe("id");
    });

    it("resolves en from Accept-Language header", () => {
      expect(resolveRelayViewLanguage("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
      expect(resolveRelayViewLanguage("en")).toBe("en");
    });

    it("resolves id or en from query parameter with case-insensitivity", () => {
      expect(resolveRelayViewLanguage(null, "id")).toBe("id");
      expect(resolveRelayViewLanguage(null, "ID")).toBe("id");
      expect(resolveRelayViewLanguage(null, "id-ID")).toBe("id");
      expect(resolveRelayViewLanguage(null, "en")).toBe("en");
      expect(resolveRelayViewLanguage(null, "EN")).toBe("en");
    });

    it("prioritizes query parameter over Accept-Language header", () => {
      expect(resolveRelayViewLanguage("id-ID,id;q=0.9", "en")).toBe("en");
      expect(resolveRelayViewLanguage("en-US,en;q=0.9", "id")).toBe("id");
    });
  });

  describe("translateRelayErrorMessage", () => {
    it("returns original message when lang is en", () => {
      const msg =
        "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.";
      expect(translateRelayErrorMessage(msg, "en")).toBe(msg);
    });

    it("translates consumed key error to Indonesian when lang is id", () => {
      const msg =
        "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.";
      expect(translateRelayErrorMessage(msg, "id")).toBe(
        "Kunci pemasangan ini telah digunakan oleh perangkat lain. Silakan minta kunci baru dari host desktop.",
      );
    });

    it("translates invalid key error to Indonesian when lang is id", () => {
      const msg = "Invalid pairing key. Check desktop dashboard.";
      expect(translateRelayErrorMessage(msg, "id")).toBe(
        "Kunci pemasangan tidak valid. Periksa dashboard desktop.",
      );
    });

    it("returns unrecognized error messages unchanged", () => {
      expect(translateRelayErrorMessage("Custom unknown error", "id")).toBe(
        "Custom unknown error",
      );
      expect(translateRelayErrorMessage(undefined, "id")).toBeUndefined();
    });
  });

  describe("generatePairingHtml", () => {
    it("renders default English pairing page", () => {
      const html = generatePairingHtml();
      expect(html).toContain('<html lang="en">');
      expect(html).toContain(
        "<title>Antigravity Relay - Pairing Required</title>",
      );
      expect(html).toContain("<h1>Device Pairing Required</h1>");
      expect(html).toContain(
        "<p>To access Antigravity Relay, enter the pairing key from your desktop dashboard.</p>",
      );
      expect(html).toContain('<label for="pair">Pairing Key</label>');
      expect(html).toContain('placeholder="Enter pairing key..."');
      expect(html).toContain('<button type="submit">Pair Device</button>');
    });

    it("renders localized Indonesian pairing page", () => {
      const html = generatePairingHtml(undefined, "id");
      expect(html).toContain('<html lang="id">');
      expect(html).toContain(
        "<title>Antigravity Relay - Pemasangan Diperlukan</title>",
      );
      expect(html).toContain("<h1>Pemasangan Perangkat Diperlukan</h1>");
      expect(html).toContain(
        "<p>Untuk mengakses Antigravity Relay, masukkan kunci pemasangan dari dashboard desktop Anda.</p>",
      );
      expect(html).toContain('<label for="pair">Kunci Pemasangan</label>');
      expect(html).toContain('placeholder="Masukkan kunci pemasangan..."');
      expect(html).toContain(
        '<button type="submit">Pasangkan Perangkat</button>',
      );
    });

    it("renders error block when provided", () => {
      const html = generatePairingHtml("Error testing", "id");
      expect(html).toContain("Error testing");
      expect(html).toContain("rgba(239,68,68,0.12)");
    });
  });

  describe("generateRevokedHtml", () => {
    it("renders default English revoked page", () => {
      const html = generateRevokedHtml();
      expect(html).toContain('<html lang="en">');
      expect(html).toContain(
        "<title>Session Revoked - Antigravity Relay</title>",
      );
      expect(html).toContain("Disconnected by Host");
      expect(html).toContain(
        '<h1 id="revoked-heading">Access Revoked by Host</h1>',
      );
      expect(html).toContain(
        '<p id="revoked-desc">Session Revoked: Access was revoked by the desktop host. Please enter a valid pairing key to re-establish your connection.</p>',
      );
      expect(html).toContain('<label for="pair">New Pairing Key</label>');
      expect(html).toContain('placeholder="Enter fresh pairing key"');
      expect(html).toContain("<span>Connect</span>");
      expect(html).toContain("<span>Connecting...</span>");
    });

    it("renders localized Indonesian revoked page", () => {
      const html = generateRevokedHtml(undefined, "id");
      expect(html).toContain('<html lang="id">');
      expect(html).toContain("<title>Sesi Dicabut - Antigravity Relay</title>");
      expect(html).toContain("Terputus oleh Host");
      expect(html).toContain(
        '<h1 id="revoked-heading">Akses Dicabut oleh Host</h1>',
      );
      expect(html).toContain(
        '<p id="revoked-desc">Sesi Dicabut: Akses telah dicabut oleh host desktop. Masukkan kunci pemasangan yang valid untuk menghubungkan kembali.</p>',
      );
      expect(html).toContain('<label for="pair">Kunci Pemasangan Baru</label>');
      expect(html).toContain('placeholder="Masukkan kunci pemasangan baru"');
      expect(html).toContain("<span>Hubungkan</span>");
      expect(html).toContain("<span>Menghubungkan...</span>");
    });

    it("renders error block when provided in Indonesian", () => {
      const error = translateRelayErrorMessage(
        "Invalid pairing key. Check desktop dashboard.",
        "id",
      );
      const html = generateRevokedHtml(error, "id");
      expect(html).toContain(
        "Kunci pemasangan tidak valid. Periksa dashboard desktop.",
      );
      expect(html).toContain('role="alert"');
    });
  });
});
