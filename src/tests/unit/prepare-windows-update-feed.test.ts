import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  parseArgs,
  prepareWindowsUpdateFeed,
} from "../../../scripts/prepare-windows-update-feed.mjs";

function writeTextFile(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

describe("prepareWindowsUpdateFeed", () => {
  describe("parseArgs", () => {
    it("parses CLI arguments correctly", () => {
      const parsed = parseArgs([
        "--source=custom-assets",
        "--output",
        "custom-feed",
        "--release-tag=v1.2.3",
        "--repository",
        "owner/repo",
      ]);

      expect(parsed.sourceDir).toBe("custom-assets");
      expect(parsed.outputDir).toBe("custom-feed");
      expect(parsed.releaseTag).toBe("v1.2.3");
      expect(parsed.repository).toBe("owner/repo");
    });
  });

  describe("feed generation", () => {
    it("writes per-arch RELEASES files that point to GitHub Release package assets and handles BOM", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "relay-update-feed-"));
      const sourceDir = path.join(rootDir, "release-assets");
      const outputDir = path.join(rootDir, "windows-update-feed");

      writeTextFile(
        path.join(sourceDir, "squirrel.windows/x64/RELEASES"),
        "\ufeffd7b597ce68a0bcbfd6413eaceda20a097a50fc26 antigravity_relay-0.0.1-full.nupkg 123 # comment\n",
      );
      writeTextFile(
        path.join(
          sourceDir,
          "squirrel.windows/x64/antigravity_relay-0.0.1-full.nupkg",
        ),
        "x64 package",
      );
      writeTextFile(
        path.join(sourceDir, "squirrel.windows/arm64/RELEASES"),
        "e4d909c290d0fb1ca068ffaddf22cbd0de474d54 antigravity_relay-0.0.1-arm64-full.nupkg 456\n",
      );
      writeTextFile(
        path.join(
          sourceDir,
          "squirrel.windows/arm64/antigravity_relay-0.0.1-arm64-full.nupkg",
        ),
        "arm64 package",
      );

      const result = prepareWindowsUpdateFeed({
        releaseTag: "v0.0.1",
        repository: "hudiohizari/antigravity-relay",
        sourceDir,
        outputDir,
      });

      expect(result).toEqual({
        x64: {
          releases: path.join(outputDir, "win32/x64/RELEASES"),
          packages: ["antigravity_relay-0.0.1-full.nupkg"],
        },
        arm64: {
          releases: path.join(outputDir, "win32/arm64/RELEASES"),
          packages: ["antigravity_relay-0.0.1-arm64-full.nupkg"],
        },
      });

      expect(existsSync(path.join(outputDir, "win32/x64/RELEASES"))).toBe(true);
      expect(existsSync(path.join(outputDir, "win32/arm64/RELEASES"))).toBe(
        true,
      );
      expect(
        existsSync(
          path.join(outputDir, "win32/x64/antigravity_relay-0.0.1-full.nupkg"),
        ),
      ).toBe(false);

      const x64Releases = readFileSync(
        path.join(outputDir, "win32/x64/RELEASES"),
        "utf8",
      );
      expect(x64Releases).toContain(
        "d7b597ce68a0bcbfd6413eaceda20a097a50fc26 https://github.com/hudiohizari/antigravity-relay/releases/download/v0.0.1/antigravity_relay-0.0.1-full.nupkg 123 # comment",
      );

      const arm64Releases = readFileSync(
        path.join(outputDir, "win32/arm64/RELEASES"),
        "utf8",
      );
      expect(arm64Releases).toContain(
        "e4d909c290d0fb1ca068ffaddf22cbd0de474d54 https://github.com/hudiohizari/antigravity-relay/releases/download/v0.0.1/antigravity_relay-0.0.1-arm64-full.nupkg 456",
      );
    });

    it("throws when missing release tag or repository", () => {
      expect(() =>
        prepareWindowsUpdateFeed({
          releaseTag: "",
          repository: "owner/repo",
        }),
      ).toThrow("Missing release tag for Windows update feed package URLs");

      expect(() =>
        prepareWindowsUpdateFeed({
          releaseTag: "v0.0.1",
          repository: "",
        }),
      ).toThrow(
        "Missing GitHub repository for Windows update feed package URLs",
      );
    });

    it("throws when RELEASES references non-matching packages", async () => {
      const rootDir = await mkdtemp(
        path.join(tmpdir(), "relay-update-feed-mismatch-"),
      );
      const sourceDir = path.join(rootDir, "release-assets");
      const outputDir = path.join(rootDir, "windows-update-feed");

      writeTextFile(
        path.join(sourceDir, "squirrel.windows/x64/RELEASES"),
        "d7b597ce68a0bcbfd6413eaceda20a097a50fc26 unknown-package-1.0.0-full.nupkg 123\n",
      );
      writeTextFile(
        path.join(
          sourceDir,
          "squirrel.windows/x64/antigravity_relay-0.0.1-full.nupkg",
        ),
        "x64 package",
      );
      writeTextFile(
        path.join(sourceDir, "squirrel.windows/arm64/RELEASES"),
        "e4d909c290d0fb1ca068ffaddf22cbd0de474d54 antigravity_relay-0.0.1-arm64-full.nupkg 456\n",
      );
      writeTextFile(
        path.join(
          sourceDir,
          "squirrel.windows/arm64/antigravity_relay-0.0.1-arm64-full.nupkg",
        ),
        "arm64 package",
      );

      expect(() =>
        prepareWindowsUpdateFeed({
          releaseTag: "v0.0.1",
          repository: "hudiohizari/antigravity-relay",
          sourceDir,
          outputDir,
        }),
      ).toThrow(
        "Windows RELEASES file does not reference any matching .nupkg package",
      );
    });
  });
});
