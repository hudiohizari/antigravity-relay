import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const originalPlatform = process.platform;

/**
 * The cases below pin Windows path semantics and touch the real filesystem, so
 * they only mean anything on Windows. Elsewhere `path.win32.join` turns the
 * fixture into one relative name full of backslashes: `mkdir -p` then creates a
 * single directory under the working tree instead of a nested path, the code
 * under test finds nothing, and the leftovers are never cleaned up because
 * `afterEach` removes the temp directory rather than the working tree.
 */
const itOnWindows = originalPlatform === "win32" ? it : it.skip;

const originalLocalAppData = process.env.LOCALAPPDATA;
const originalAppData = process.env.APPDATA;
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

describe("Antigravity client cache", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    setPlatform("win32");
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "antigravity-client-cache-"),
    );
    process.env.LOCALAPPDATA = path.join(tempDir, "Local");
    process.env.APPDATA = path.join(tempDir, "Roaming");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    process.env.LOCALAPPDATA = originalLocalAppData;
    process.env.APPDATA = originalAppData;
    process.env.XDG_CACHE_HOME = originalXdgCacheHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  itOnWindows(
    "lists existing Windows App cache paths in priority order",
    async () => {
      const localAppCache = path.win32.join(
        process.env.LOCALAPPDATA!,
        "Antigravity",
        "Cache",
      );
      const roamingAppCache = path.win32.join(
        process.env.APPDATA!,
        "Antigravity",
        "Cache",
      );
      fs.mkdirSync(localAppCache, { recursive: true });
      fs.mkdirSync(roamingAppCache, { recursive: true });
    },
  );

  it("preserves the Windows cache candidate priority order and excludes IDE cache", async () => {
    const { getAntigravityClientCachePaths } =
      await import("@/modules/antigravity-runtime/cache/antigravityClientCache");

    expect(getAntigravityClientCachePaths()).toEqual([
      path.win32.join(process.env.LOCALAPPDATA!, "Google", "Antigravity"),
      path.win32.join(process.env.LOCALAPPDATA!, "Antigravity", "Cache"),
      path.win32.join(process.env.APPDATA!, "Antigravity", "Cache"),
    ]);
    expect(
      getAntigravityClientCachePaths().some((p) =>
        p.includes("Antigravity IDE"),
      ),
    ).toBe(false);
  });

  it("preserves the Linux cache candidate priority order", async () => {
    setPlatform("linux");
    vi.spyOn(os, "homedir").mockReturnValue(tempDir);
    process.env.XDG_CACHE_HOME = path.join(tempDir, "xdg-cache");
    const { getAntigravityClientCachePaths } =
      await import("@/modules/antigravity-runtime/cache/antigravityClientCache");

    expect(getAntigravityClientCachePaths()).toEqual([
      path.posix.join(tempDir, ".cache", "Antigravity"),
      path.posix.join(tempDir, ".cache", "google-antigravity"),
      path.posix.join(tempDir, ".antigravity"),
      path.posix.join(process.env.XDG_CACHE_HOME, "Antigravity"),
      path.posix.join(process.env.XDG_CACHE_HOME, "google-antigravity"),
    ]);
  });

  it("preserves the macOS cache candidate priority order", async () => {
    setPlatform("darwin");
    vi.spyOn(os, "homedir").mockReturnValue(tempDir);
    const { getAntigravityClientCachePaths } =
      await import("@/modules/antigravity-runtime/cache/antigravityClientCache");

    expect(getAntigravityClientCachePaths()).toEqual([
      path.posix.join(
        tempDir,
        "Library",
        "HTTPStorages",
        "com.google.antigravity",
      ),
      path.posix.join(tempDir, "Library", "Caches", "com.google.antigravity"),
      path.posix.join(tempDir, ".antigravity"),
      path.posix.join(tempDir, ".config", "antigravity"),
    ]);
  });

  itOnWindows(
    "removes an existing cache directory and reports the freed bytes",
    async () => {
      const localAppCache = path.win32.join(
        process.env.LOCALAPPDATA!,
        "Antigravity",
        "Cache",
      );
      const nestedCache = path.win32.join(localAppCache, "Code Cache");
      fs.mkdirSync(nestedCache, { recursive: true });
      fs.writeFileSync(path.win32.join(localAppCache, "index"), "cache");
      fs.writeFileSync(path.win32.join(nestedCache, "entry"), "payload");

      const { clearAntigravityClientCache } =
        await import("@/modules/antigravity-runtime/cache/antigravityClientCache");
      const result = clearAntigravityClientCache();

      expect(result).toEqual({
        clearedPaths: [localAppCache],
        totalSizeFreed:
          Buffer.byteLength("cache") + Buffer.byteLength("payload"),
        errors: [],
      });
      expect(fs.existsSync(localAppCache)).toBe(false);
    },
  );

  itOnWindows(
    "continues clearing later paths when one cache directory fails",
    async () => {
      const localGoogleCache = path.win32.join(
        process.env.LOCALAPPDATA!,
        "Google",
        "Antigravity",
      );
      const localAppCache = path.win32.join(
        process.env.LOCALAPPDATA!,
        "Antigravity",
        "Cache",
      );
      fs.mkdirSync(localGoogleCache, { recursive: true });
      fs.mkdirSync(localAppCache, { recursive: true });
      fs.writeFileSync(path.win32.join(localGoogleCache, "locked"), "lock");
      fs.writeFileSync(path.win32.join(localAppCache, "entry"), "cache");

      const originalRmSync = fs.rmSync.bind(fs);
      vi.spyOn(fs, "rmSync").mockImplementation((targetPath, options) => {
        if (String(targetPath) === localGoogleCache) {
          throw new Error("locked");
        }
        originalRmSync(targetPath, options);
      });

      const { clearAntigravityClientCache } =
        await import("@/modules/antigravity-runtime/cache/antigravityClientCache");
      const result = clearAntigravityClientCache();

      expect(result).toEqual({
        clearedPaths: [localAppCache],
        totalSizeFreed: Buffer.byteLength("cache"),
        errors: [`Failed to remove ${localGoogleCache}: locked`],
      });
      expect(fs.existsSync(localGoogleCache)).toBe(true);
      expect(fs.existsSync(localAppCache)).toBe(false);
    },
  );
});
