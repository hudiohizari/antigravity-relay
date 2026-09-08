import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCode } from "@/modules/relay/components/QRCode";
import { generateQrMatrix } from "@/modules/relay/components/qr-generator";

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
});
