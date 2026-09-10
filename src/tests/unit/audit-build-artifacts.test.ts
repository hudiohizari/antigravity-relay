import crypto from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  auditBuildArtifacts,
  formatAuditReport,
  parseArgs,
} from "../../../scripts/audit-build-artifacts.mjs";

function writeBinaryFile(
  filePath: string,
  sizeBytes: number,
  contentSeed = "a",
) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const buffer = Buffer.alloc(sizeBytes, contentSeed);
  writeFileSync(filePath, buffer);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function writeTextFile(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

describe("audit-build-artifacts", () => {
  describe("parseArgs", () => {
    it("parses both --key=val and --key val formats", () => {
      const parsed = parseArgs([
        "--platform=win32",
        "--arch",
        "arm64",
        "--root-dir=/tmp/test",
        "--min-size-mb",
        "5",
        "--max-size-mb=100",
        "--max-asar-mb=80",
      ]);

      expect(parsed.platform).toBe("win32");
      expect(parsed.arch).toBe("arm64");
      expect(parsed.rootDir).toBe("/tmp/test");
      expect(parsed.minSizeMiB).toBe(5);
      expect(parsed.maxSizeMiB).toBe(100);
      expect(parsed.maxAsarMiB).toBe(80);
    });
  });

  describe("Windows target auditing", () => {
    it("passes when all Windows artifacts, ASAR, unpacked native modules, and checksums are valid", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "audit-win32-pass-"));
      const makeDir = path.join(rootDir, "out/make/squirrel.windows/x64");
      const packDir = path.join(rootDir, "out/Antigravity Relay-win32-x64");

      const exePath = path.join(
        makeDir,
        "Antigravity.Relay-0.0.1-win32-x64-setup.exe",
      );
      const nupkgPath = path.join(
        makeDir,
        "antigravity_relay-0.0.1-full.nupkg",
      );
      const releasesPath = path.join(makeDir, "RELEASES");
      const ymlPath = path.join(makeDir, "latest.yml");
      const checksumPath = path.join(makeDir, "sha256sums-windows-x64.txt");

      // Write mock binaries (e.g. 15 MiB each)
      const exeHash = writeBinaryFile(exePath, 15 * 1024 * 1024, "x");
      const nupkgHash = writeBinaryFile(nupkgPath, 12 * 1024 * 1024, "y");
      writeTextFile(
        releasesPath,
        "hash antigravity_relay-0.0.1-full.nupkg 123\n",
      );
      writeTextFile(ymlPath, "version: 0.0.1\n");
      writeTextFile(
        checksumPath,
        `${exeHash}  Antigravity.Relay-0.0.1-win32-x64-setup.exe\n${nupkgHash}  antigravity_relay-0.0.1-full.nupkg\n`,
      );

      // Packaged app.asar and unpacked modules
      const asarPath = path.join(packDir, "resources/app.asar");
      writeBinaryFile(asarPath, 2 * 1024 * 1024, "a");
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/better-sqlite3/package.json",
        ),
        "{}",
      );
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/keytar/package.json",
        ),
        "{}",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "win32",
        arch: "x64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(formatAuditReport(result)).toContain("SUCCESS (PASS)");
    });

    it("fails when Windows setup.exe is missing", async () => {
      const rootDir = await mkdtemp(
        path.join(tmpdir(), "audit-win32-missing-exe-"),
      );
      const makeDir = path.join(rootDir, "out/make/squirrel.windows/x64");
      const packDir = path.join(rootDir, "out/Antigravity Relay-win32-x64");

      writeBinaryFile(
        path.join(makeDir, "antigravity_relay-0.0.1-full.nupkg"),
        12 * 1024 * 1024,
      );
      writeTextFile(path.join(makeDir, "RELEASES"), "content\n");
      writeTextFile(path.join(makeDir, "latest.yml"), "version: 0.0.1\n");
      writeTextFile(
        path.join(makeDir, "sha256sums-windows-x64.txt"),
        "fakehash file.exe\n",
      );
      writeBinaryFile(path.join(packDir, "resources/app.asar"), 1024);
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/better-sqlite3/test",
        ),
        "ok",
      );
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/keytar/test",
        ),
        "ok",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "win32",
        arch: "x64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(false);
      expect(
        result.errors.some((err: string) =>
          err.includes(
            "Missing expected installer file: Windows setup executable",
          ),
        ),
      ).toBe(true);
    });
  });

  describe("macOS target auditing", () => {
    it("passes for valid macOS DMG, ZIP, latest-mac.yml and checksums", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "audit-darwin-pass-"));
      const makeDir = path.join(rootDir, "out/make");
      const packDir = path.join(rootDir, "out/Antigravity Relay-darwin-arm64");

      const dmgPath = path.join(makeDir, "Antigravity.Relay_0.0.1_arm64.dmg");
      const zipPath = path.join(makeDir, "Antigravity.Relay_0.0.1_arm64.zip");
      const ymlPath = path.join(makeDir, "latest-mac.yml");
      const checksumPath = path.join(makeDir, "sha256sums-mac-arm64.txt");

      const dmgHash = writeBinaryFile(dmgPath, 20 * 1024 * 1024, "d");
      const zipHash = writeBinaryFile(zipPath, 25 * 1024 * 1024, "z");
      writeTextFile(ymlPath, "version: 0.0.1\n");
      writeTextFile(
        checksumPath,
        `${dmgHash}  Antigravity.Relay_0.0.1_arm64.dmg\n${zipHash}  Antigravity.Relay_0.0.1_arm64.zip\n`,
      );

      // Packaged app on macOS
      const asarPath = path.join(
        packDir,
        "Antigravity Relay.app/Contents/Resources/app.asar",
      );
      writeBinaryFile(asarPath, 5 * 1024 * 1024, "a");
      writeTextFile(
        path.join(
          packDir,
          "Antigravity Relay.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/package.json",
        ),
        "{}",
      );
      writeTextFile(
        path.join(
          packDir,
          "Antigravity Relay.app/Contents/Resources/app.asar.unpacked/node_modules/keytar/package.json",
        ),
        "{}",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "darwin",
        arch: "arm64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when macOS ZIP size is under the 10 MiB minimum budget", async () => {
      const rootDir = await mkdtemp(
        path.join(tmpdir(), "audit-darwin-under-size-"),
      );
      const makeDir = path.join(rootDir, "out/make");
      const packDir = path.join(rootDir, "out/Antigravity Relay-darwin-arm64");

      const dmgPath = path.join(makeDir, "Antigravity.Relay_0.0.1_arm64.dmg");
      const zipPath = path.join(makeDir, "Antigravity.Relay_0.0.1_arm64.zip");
      const ymlPath = path.join(makeDir, "latest-mac.yml");
      const checksumPath = path.join(makeDir, "sha256sums-mac-arm64.txt");

      writeBinaryFile(dmgPath, 20 * 1024 * 1024);
      // Small zip: only 2 MiB, below 10 MiB budget
      writeBinaryFile(zipPath, 2 * 1024 * 1024);
      writeTextFile(ymlPath, "version: 0.0.1\n");
      writeTextFile(checksumPath, "dummy hash\n");

      const asarPath = path.join(
        packDir,
        "Antigravity Relay.app/Contents/Resources/app.asar",
      );
      writeBinaryFile(asarPath, 5 * 1024 * 1024);
      writeTextFile(
        path.join(
          packDir,
          "Antigravity Relay.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/pkg",
        ),
        "{}",
      );
      writeTextFile(
        path.join(
          packDir,
          "Antigravity Relay.app/Contents/Resources/app.asar.unpacked/node_modules/keytar/pkg",
        ),
        "{}",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "darwin",
        arch: "arm64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(false);
      expect(
        result.errors.some((err: string) =>
          err.includes("below minimum required 10 MiB"),
        ),
      ).toBe(true);
    });
  });

  describe("Linux target auditing & Checksum verification", () => {
    it("detects checksum mismatch between manifest and actual binary", async () => {
      const rootDir = await mkdtemp(
        path.join(tmpdir(), "audit-linux-hash-mismatch-"),
      );
      const makeDir = path.join(rootDir, "out/make");
      const packDir = path.join(rootDir, "out/Antigravity Relay-linux-x64");

      const debPath = path.join(makeDir, "antigravity-relay_0.0.1_amd64.deb");
      const rpmPath = path.join(
        makeDir,
        "antigravity-relay-0.0.1-1.x86_64.rpm",
      );
      const ymlPath = path.join(makeDir, "latest-linux.yml");
      const checksumPath = path.join(makeDir, "sha256sums-linux-amd64.txt");

      writeBinaryFile(debPath, 15 * 1024 * 1024, "d");
      writeBinaryFile(rpmPath, 16 * 1024 * 1024, "r");
      writeTextFile(ymlPath, "version: 0.0.1\n");

      // Intentional corrupt hash in manifest
      writeTextFile(
        checksumPath,
        `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  antigravity-relay_0.0.1_amd64.deb\n`,
      );

      writeBinaryFile(path.join(packDir, "resources/app.asar"), 1024);
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/better-sqlite3/test",
        ),
        "ok",
      );
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/keytar/test",
        ),
        "ok",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "linux",
        arch: "x64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(false);
      expect(
        result.errors.some((err: string) =>
          err.includes(
            "Checksum mismatch for antigravity-relay_0.0.1_amd64.deb",
          ),
        ),
      ).toBe(true);
    });
  });

  describe("ASAR unpack & development leak security checks", () => {
    it("fails when native module keytar is missing from app.asar.unpacked", async () => {
      const rootDir = await mkdtemp(
        path.join(tmpdir(), "audit-missing-native-"),
      );
      const makeDir = path.join(rootDir, "out/make");
      const packDir = path.join(rootDir, "out/Antigravity Relay-linux-x64");

      const debPath = path.join(makeDir, "antigravity-relay_0.0.1_amd64.deb");
      const rpmPath = path.join(
        makeDir,
        "antigravity-relay-0.0.1-1.x86_64.rpm",
      );
      const debHash = writeBinaryFile(debPath, 15 * 1024 * 1024, "d");
      const rpmHash = writeBinaryFile(rpmPath, 15 * 1024 * 1024, "r");

      writeTextFile(path.join(makeDir, "latest-linux.yml"), "version: 0.0.1\n");
      writeTextFile(
        path.join(makeDir, "sha256sums-linux-amd64.txt"),
        `${debHash}  antigravity-relay_0.0.1_amd64.deb\n${rpmHash}  antigravity-relay-0.0.1-1.x86_64.rpm\n`,
      );

      writeBinaryFile(path.join(packDir, "resources/app.asar"), 1024);
      // Only unpack better-sqlite3, omit keytar!
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/better-sqlite3/test",
        ),
        "ok",
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "linux",
        arch: "x64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(false);
      expect(
        result.errors.some((err: string) =>
          err.includes("Required native module 'keytar' not unpacked"),
        ),
      ).toBe(true);
    });

    it("fails when .env or source-map files leak into the packaged app directory", async () => {
      const rootDir = await mkdtemp(path.join(tmpdir(), "audit-leak-check-"));
      const makeDir = path.join(rootDir, "out/make");
      const packDir = path.join(rootDir, "out/Antigravity Relay-linux-x64");

      const debPath = path.join(makeDir, "antigravity-relay_0.0.1_amd64.deb");
      const rpmPath = path.join(
        makeDir,
        "antigravity-relay-0.0.1-1.x86_64.rpm",
      );
      const debHash = writeBinaryFile(debPath, 15 * 1024 * 1024, "d");
      const rpmHash = writeBinaryFile(rpmPath, 15 * 1024 * 1024, "r");

      writeTextFile(path.join(makeDir, "latest-linux.yml"), "version: 0.0.1\n");
      writeTextFile(
        path.join(makeDir, "sha256sums-linux-amd64.txt"),
        `${debHash}  antigravity-relay_0.0.1_amd64.deb\n${rpmHash}  antigravity-relay-0.0.1-1.x86_64.rpm\n`,
      );

      writeBinaryFile(path.join(packDir, "resources/app.asar"), 1024);
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/better-sqlite3/test",
        ),
        "ok",
      );
      writeTextFile(
        path.join(
          packDir,
          "resources/app.asar.unpacked/node_modules/keytar/test",
        ),
        "ok",
      );

      // Leaked sensitive files!
      writeTextFile(
        path.join(packDir, "resources/.env.production"),
        "SECRET_TOKEN=abc",
      );
      writeTextFile(
        path.join(packDir, "resources/app.js.map"),
        '{"version":3}',
      );

      const result = auditBuildArtifacts({
        rootDir,
        platform: "linux",
        arch: "x64",
        minSizeMiB: 10,
        maxSizeMiB: 250,
      });

      expect(result.ok).toBe(false);
      expect(
        result.errors.some((err: string) =>
          err.includes("Environment file (.env) leaked"),
        ),
      ).toBe(true);
      expect(
        result.errors.some((err: string) =>
          err.includes("Source map file (*.map) leaked"),
        ),
      ).toBe(true);
    });
  });
});
