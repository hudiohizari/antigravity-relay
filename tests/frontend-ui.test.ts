import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "../src/renderer/locales/en.json";
import id from "../src/renderer/locales/id.json";

describe("Frontend Copy Catalogs & Token Architecture", () => {
  describe("i18n Catalog Symmetry and Parity", () => {
    function getAllKeys(obj: Record<string, unknown>, prefix = ""): string[] {
      let keys: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          keys = keys.concat(
            getAllKeys(value as Record<string, unknown>, fullKey),
          );
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    const enKeys = getAllKeys(en as unknown as Record<string, unknown>).sort();
    const idKeys = getAllKeys(id as unknown as Record<string, unknown>).sort();

    it("should have identical key counts in English and Indonesian catalogs", () => {
      expect(enKeys.length).toBe(idKeys.length);
      expect(enKeys.length).toBeGreaterThanOrEqual(40);
    });

    it("should have 100% key parity between en.json and id.json", () => {
      expect(enKeys).toEqual(idKeys);
    });

    it("should have non-empty string values for all leaves in both catalogs", () => {
      for (const key of enKeys) {
        const resolve = (obj: Record<string, unknown>, p: string): unknown =>
          p
            .split(".")
            .reduce<unknown>(
              (acc, part) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string, unknown>)[part]
                  : undefined,
              obj,
            );

        const enVal = resolve(en as unknown as Record<string, unknown>, key);
        const idVal = resolve(id as unknown as Record<string, unknown>, key);

        expect(typeof enVal).toBe("string");
        expect((enVal as string).trim().length).toBeGreaterThan(0);
        expect(typeof idVal).toBe("string");
        expect((idVal as string).trim().length).toBeGreaterThan(0);
      }
    });

    it("should use standard hyphens or commas only and zero em/en dashes", () => {
      for (const key of enKeys) {
        const resolve = (obj: Record<string, unknown>, p: string): string =>
          p
            .split(".")
            .reduce<unknown>(
              (acc, part) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string, unknown>)[part]
                  : undefined,
              obj,
            ) as string;

        const enVal = resolve(en as unknown as Record<string, unknown>, key);
        const idVal = resolve(id as unknown as Record<string, unknown>, key);

        expect(enVal).not.toContain("—");
        expect(enVal).not.toContain("–");
        expect(idVal).not.toContain("—");
        expect(idVal).not.toContain("–");
      }
    });
  });

  describe("DTCG Design Tokens Verification", () => {
    const tokensCssPath = path.resolve(
      __dirname,
      "../src/renderer/styles/tokens.css",
    );
    const tokensContent = fs.readFileSync(tokensCssPath, "utf-8");

    it("should declare all required semantic background surfaces", () => {
      expect(tokensContent).toContain("--bg-canvas");
      expect(tokensContent).toContain("--bg-surface");
      expect(tokensContent).toContain("--bg-surface-elevated");
      expect(tokensContent).toContain("--bg-subtle");
    });

    it("should declare WCAG AA focus border token matching emerald", () => {
      expect(tokensContent).toContain(
        "--border-focus: var(--primitive-color-emerald-500)",
      );
      expect(tokensContent).toContain("--outline-focus-width: 2px");
      expect(tokensContent).toContain("--outline-focus-offset: 2px");
    });

    it("should enforce minimum 44px touch targets", () => {
      expect(tokensContent).toContain("--target-min-width: 44px");
      expect(tokensContent).toContain("--target-min-height: 44px");
      expect(tokensContent).toContain("--target-clearance: 8px");
    });

    it("should declare fluid typography clamp scales", () => {
      expect(tokensContent).toContain("--primitive-font-size-xs: clamp");
      expect(tokensContent).toContain("--primitive-font-size-base: clamp");
      expect(tokensContent).toContain("--primitive-font-size-2xl: clamp");
    });

    it("should declare macOS titlebar traffic lights clearance (min 76px)", () => {
      expect(tokensContent).toContain("--comp-titlebar-padding-left: 76px");
    });
  });

  describe("Anti-AI Slop & Clean Codebase Invariants", () => {
    const rendererDir = path.resolve(__dirname, "../src/renderer");

    function getFiles(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(getFiles(fullPath));
        } else {
          results.push(fullPath);
        }
      }
      return results;
    }

    const rendererFiles = getFiles(rendererDir);

    it("should contain zero workflow or task tracking metadata in source code", () => {
      const taskMetadataRegex = /(TASK-\d+|AC-\d+)/gi;

      for (const file of rendererFiles) {
        const content = fs.readFileSync(file, "utf-8");
        const matches = content.match(taskMetadataRegex);
        expect(
          matches,
          `File ${path.relative(rendererDir, file)} contains task tracking metadata: ${matches?.join(", ")}`,
        ).toBeNull();
      }
    });

    it("should contain zero inline style attributes (style=) in renderer components", () => {
      const componentFiles = rendererFiles.filter(
        (f) => f.endsWith(".tsx") || f.endsWith(".jsx"),
      );

      for (const file of componentFiles) {
        const content = fs.readFileSync(file, "utf-8");
        const inlineStyleRegex = /style\s*=\s*\{/g;
        const matches = content.match(inlineStyleRegex);
        expect(
          matches,
          `Component ${path.relative(rendererDir, file)} contains banned inline style="..."`,
        ).toBeNull();
      }
    });
  });
});
