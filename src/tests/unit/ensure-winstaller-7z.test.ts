import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureWinstaller7z } from "../../../scripts/ensure-winstaller-7z.mjs";

describe("ensureWinstaller7z", () => {
  it("skips gracefully when vendor directory does not exist", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "winstaller-test-"));
    try {
      const res = ensureWinstaller7z(tmpDir, "x64");
      expect(res.status).toBe("skipped");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("copies 7z-x64 binaries to 7z.exe and 7z.dll when missing for x64", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "winstaller-test-"));
    const vendorDir = path.join(
      tmpDir,
      "node_modules/electron-winstaller/vendor",
    );
    fs.mkdirSync(vendorDir, { recursive: true });

    fs.writeFileSync(path.join(vendorDir, "7z-x64.exe"), "dummy-x64-exe");
    fs.writeFileSync(path.join(vendorDir, "7z-x64.dll"), "dummy-x64-dll");

    try {
      const res = ensureWinstaller7z(tmpDir, "x64");
      expect(res.status).toBe("ok");
      expect(res.exeCopied).toBe(true);
      expect(res.dllCopied).toBe(true);
      expect(fs.readFileSync(path.join(vendorDir, "7z.exe"), "utf-8")).toBe(
        "dummy-x64-exe",
      );
      expect(fs.readFileSync(path.join(vendorDir, "7z.dll"), "utf-8")).toBe(
        "dummy-x64-dll",
      );

      // Re-running does not re-copy when already present
      const res2 = ensureWinstaller7z(tmpDir, "x64");
      expect(res2.exeCopied).toBe(false);
      expect(res2.dllCopied).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("copies 7z-arm64 binaries to 7z.exe and 7z.dll for arm64 host", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "winstaller-test-"));
    const vendorDir = path.join(
      tmpDir,
      "node_modules/electron-winstaller/vendor",
    );
    fs.mkdirSync(vendorDir, { recursive: true });

    fs.writeFileSync(path.join(vendorDir, "7z-arm64.exe"), "dummy-arm64-exe");
    fs.writeFileSync(path.join(vendorDir, "7z-arm64.dll"), "dummy-arm64-dll");

    try {
      const res = ensureWinstaller7z(tmpDir, "arm64");
      expect(res.status).toBe("ok");
      expect(res.exeCopied).toBe(true);
      expect(res.dllCopied).toBe(true);
      expect(fs.readFileSync(path.join(vendorDir, "7z.exe"), "utf-8")).toBe(
        "dummy-arm64-exe",
      );
      expect(fs.readFileSync(path.join(vendorDir, "7z.dll"), "utf-8")).toBe(
        "dummy-arm64-dll",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
