import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  consolidateReleaseAssets,
  mergeYamlManifests,
  parseYamlManifest,
  stringifyYamlManifest,
} from "../../../scripts/consolidate-release-assets.mjs";

describe("consolidate-release-assets", () => {
  describe("parseYamlManifest & stringifyYamlManifest", () => {
    it("correctly round-trips an electron-updater manifest with zero dependencies", () => {
      const raw = [
        "version: 0.0.4",
        "files:",
        "  - url: Antigravity.Relay-0.0.4-setup.exe",
        "    sha512: abc123==",
        "    size: 5000",
        "path: Antigravity.Relay-0.0.4-setup.exe",
        "sha512: abc123==",
        "releaseDate: 2026-09-10T12:00:00.000Z",
      ].join("\n");

      const parsed = parseYamlManifest(raw);
      expect(parsed.version).toBe("0.0.4");
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].url).toBe("Antigravity.Relay-0.0.4-setup.exe");
      expect(parsed.files[0].size).toBe(5000);
      expect(parsed.path).toBe("Antigravity.Relay-0.0.4-setup.exe");
      expect(parsed.sha512).toBe("abc123==");

      const formatted = stringifyYamlManifest(parsed);
      const reparsed = parseYamlManifest(formatted);
      expect(reparsed).toEqual(parsed);
    });

    it("preserves version strings like '1.0' without float coercion", () => {
      const raw = [
        "version: 1.0",
        "files:",
        "  - url: test.exe",
        "    size: 100",
        "    isAdminRightsRequired: true",
      ].join("\n");

      const parsed = parseYamlManifest(raw);
      expect(parsed.version).toBe("1.0");
      expect(typeof parsed.version).toBe("string");
      expect(parsed.files[0].size).toBe(100);
      expect(typeof parsed.files[0].size).toBe("number");
      expect(parsed.files[0].isAdminRightsRequired).toBe(true);
      expect(typeof parsed.files[0].isAdminRightsRequired).toBe("boolean");
    });
  });
  describe("mergeYamlManifests", () => {
    it("merges multiple YAML manifests combining files by unique url", () => {
      const yaml1 = yamlStringify({
        version: "0.0.3",
        files: [
          {
            url: "Antigravity.Relay-0.0.3-win32-x64-setup.exe",
            sha512: "hash-x64",
            size: 1000,
          },
        ],
        path: "Antigravity.Relay-0.0.3-win32-x64-setup.exe",
        sha512: "hash-x64",
        releaseDate: "2026-09-10T12:00:00.000Z",
      });

      const yaml2 = yamlStringify({
        version: "0.0.3",
        files: [
          {
            url: "Antigravity.Relay-0.0.3-win32-arm64-setup.exe",
            sha512: "hash-arm64",
            size: 1200,
          },
        ],
        path: "Antigravity.Relay-0.0.3-win32-arm64-setup.exe",
        sha512: "hash-arm64",
        releaseDate: "2026-09-10T12:05:00.000Z",
      });

      const merged = mergeYamlManifests(yaml1, yaml2);
      const parsed = yamlParse(merged);

      expect(parsed.version).toBe("0.0.3");
      expect(parsed.files).toHaveLength(2);
      expect(parsed.files[0].url).toBe(
        "Antigravity.Relay-0.0.3-win32-x64-setup.exe",
      );
      expect(parsed.files[1].url).toBe(
        "Antigravity.Relay-0.0.3-win32-arm64-setup.exe",
      );
      expect(parsed.releaseDate).toBe("2026-09-10T12:05:00.000Z");
    });

    it("returns new manifest when existing manifest is empty", () => {
      const yaml = yamlStringify({ version: "0.0.3", files: [] });
      expect(mergeYamlManifests("", yaml)).toBe(yaml);
    });
  });

  describe("consolidateReleaseAssets", () => {
    it("flattens nested release assets and merges multi-target YAML manifests without filename collisions", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "consolidate-test-"),
      );
      const sourceDir = path.join(tmpDir, "release-assets");
      const outputDir = path.join(tmpDir, "dist-release-assets");
      const legacyReleasesPath = path.join(
        tmpDir,
        "github-release-assets",
        "RELEASES",
      );

      // Create nested targets
      const winX64Dir = path.join(sourceDir, "make-win32-x64", "out", "make");
      const winArm64Dir = path.join(
        sourceDir,
        "make-win32-arm64",
        "out",
        "make",
      );
      const darwinX64Dir = path.join(
        sourceDir,
        "make-darwin-x64",
        "out",
        "make",
      );
      const darwinArm64Dir = path.join(
        sourceDir,
        "make-darwin-arm64",
        "out",
        "make",
      );

      fs.mkdirSync(winX64Dir, { recursive: true });
      fs.mkdirSync(winArm64Dir, { recursive: true });
      fs.mkdirSync(darwinX64Dir, { recursive: true });
      fs.mkdirSync(darwinArm64Dir, { recursive: true });
      fs.mkdirSync(path.dirname(legacyReleasesPath), { recursive: true });

      // Binary installers
      fs.writeFileSync(
        path.join(winX64Dir, "app-win32-x64-setup.exe"),
        "exe-x64",
      );
      fs.writeFileSync(
        path.join(winArm64Dir, "app-win32-arm64-setup.exe"),
        "exe-arm64",
      );
      fs.writeFileSync(
        path.join(darwinX64Dir, "app-darwin-x64.dmg"),
        "dmg-x64",
      );
      fs.writeFileSync(
        path.join(darwinArm64Dir, "app-darwin-arm64.dmg"),
        "dmg-arm64",
      );

      // Competing YAML manifests
      fs.writeFileSync(
        path.join(winX64Dir, "latest.yml"),
        yamlStringify({
          version: "0.0.3",
          files: [{ url: "app-win32-x64-setup.exe" }],
        }),
      );
      fs.writeFileSync(
        path.join(winArm64Dir, "latest.yml"),
        yamlStringify({
          version: "0.0.3",
          files: [{ url: "app-win32-arm64-setup.exe" }],
        }),
      );
      fs.writeFileSync(
        path.join(darwinX64Dir, "latest-mac.yml"),
        yamlStringify({
          version: "0.0.3",
          files: [{ url: "app-darwin-x64.zip" }],
        }),
      );
      fs.writeFileSync(
        path.join(darwinArm64Dir, "latest-mac.yml"),
        yamlStringify({
          version: "0.0.3",
          files: [{ url: "app-darwin-arm64.zip" }],
        }),
      );

      // Competing nested RELEASES (should be ignored in favor of legacyReleasesPath)
      fs.writeFileSync(path.join(winX64Dir, "RELEASES"), "ignored-x64");
      fs.writeFileSync(path.join(winArm64Dir, "RELEASES"), "ignored-arm64");
      fs.writeFileSync(legacyReleasesPath, "canonical-legacy-feed");

      try {
        const result = consolidateReleaseAssets({
          sourceDir,
          outputDir,
          legacyReleases: legacyReleasesPath,
        });

        expect(result.totalFiles).toBe(7);
        expect(result.files).toEqual([
          "RELEASES",
          "app-darwin-arm64.dmg",
          "app-darwin-x64.dmg",
          "app-win32-arm64-setup.exe",
          "app-win32-x64-setup.exe",
          "latest-mac.yml",
          "latest.yml",
        ]);

        // Verify merged latest.yml has both files
        const mergedLatest = yamlParse(
          fs.readFileSync(path.join(outputDir, "latest.yml"), "utf-8"),
        );
        expect(mergedLatest.files).toHaveLength(2);

        // Verify canonical RELEASES was copied
        expect(fs.readFileSync(path.join(outputDir, "RELEASES"), "utf-8")).toBe(
          "canonical-legacy-feed",
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
