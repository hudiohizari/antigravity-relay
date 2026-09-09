import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import {
  BinaryResolver,
  resolvePlatform,
} from "@/modules/tunnel/binary-resolver";

describe("BinaryResolver", () => {
  describe("Platform Resolution", () => {
    it("maps darwin, win32, and defaults others to linux", () => {
      expect(resolvePlatform("darwin")).toBe("darwin");
      expect(resolvePlatform("win32")).toBe("win32");
      expect(resolvePlatform("linux")).toBe("linux");
      expect(resolvePlatform("freebsd")).toBe("linux");
      expect(resolvePlatform("sunos")).toBe("linux");
    });
  });

  describe("Directory Resolution and Candidate Search", () => {
    it("provides standard darwin fallback paths including Homebrew and user bin", () => {
      const resolver = new BinaryResolver({
        platform: "darwin",
        homedir: "/Users/testuser",
        env: { PATH: "" },
      });

      const fallbacks = resolver.getFallbackDirectories();
      expect(fallbacks).toContain("/opt/homebrew/bin");
      expect(fallbacks).toContain("/usr/local/bin");
      expect(fallbacks).toContain("/usr/bin");
      expect(fallbacks).toContain("/Users/testuser/bin");
    });

    it("provides standard linux fallback paths including snap bin", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "" },
      });

      const fallbacks = resolver.getFallbackDirectories();
      expect(fallbacks).toContain("/usr/local/bin");
      expect(fallbacks).toContain("/usr/bin");
      expect(fallbacks).toContain("/bin");
      expect(fallbacks).toContain("/snap/bin");
    });

    it("provides standard win32 fallback paths including ProgramFiles and LocalAppData", () => {
      const resolver = new BinaryResolver({
        platform: "win32",
        env: {
          ProgramFiles: "C:\\Program Files",
          LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
        },
      });

      const fallbacks = resolver.getFallbackDirectories();
      expect(fallbacks).toContain("C:\\Program Files\\cloudflared");
      expect(fallbacks).toContain(
        "C:\\Users\\testuser\\AppData\\Local\\Programs\\cloudflared",
      );
      expect(fallbacks).toContain("C:\\Program Files (x86)\\cloudflared");
    });

    it("resolves darwin Homebrew binary when PATH is stripped by GUI desktop environment", () => {
      const existingFiles = new Set(["/opt/homebrew/bin/cloudflared"]);

      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/bin:/bin" },
        statSync: (p) => {
          if (existingFiles.has(p)) {
            return { isFile: () => true };
          }
          throw new Error("File not found");
        },
        accessSync: (p) => {
          if (!existingFiles.has(p)) {
            throw new Error("Cannot execute");
          }
        },
      });

      const result = resolver.resolveSync();
      expect(result.isInstalled).toBe(true);
      expect(result.binaryPath).toBe("/opt/homebrew/bin/cloudflared");
      expect(result.platform).toBe("darwin");
    });

    it("resolves windows binary with .exe extension from PATHEXT", () => {
      const targetBinary = "C:\\Program Files\\cloudflared\\cloudflared.exe";
      const existingFiles = new Set([targetBinary]);

      const resolver = new BinaryResolver({
        platform: "win32",
        env: {
          PATH: "C:\\Windows\\system32",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          ProgramFiles: "C:\\Program Files",
          LOCALAPPDATA: "C:\\Users\\testuser\\AppData\\Local",
        },
        statSync: (p) => {
          if (existingFiles.has(p)) {
            return { isFile: () => true };
          }
          throw new Error("File not found");
        },
        accessSync: (p) => {
          if (!existingFiles.has(p)) {
            throw new Error("Cannot access");
          }
        },
      });

      const result = resolver.resolveSync();
      expect(result.isInstalled).toBe(true);
      expect(result.binaryPath).toBe(targetBinary);
      expect(result.platform).toBe("win32");
    });

    it("returns not installed result when executable is not found in any candidate directory", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/usr/bin:/bin" },
        statSync: () => {
          throw new Error("File not found");
        },
        accessSync: () => {
          throw new Error("Cannot access");
        },
      });

      const result = resolver.resolveSync();
      expect(result.isInstalled).toBe(false);
      expect(result.binaryPath).toBeNull();
      expect(result.platform).toBe("linux");
      expect(result.error).toBeDefined();
    });
  });

  describe("TTL In-Memory Caching and Invalidation", () => {
    it("caches lookup result for 5000ms avoiding repeated filesystem checks", () => {
      let statCalls = 0;
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        cacheTtlMs: 5000,
        statSync: (p) => {
          statCalls++;
          if (p === "/usr/local/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        accessSync: () => {},
      });

      const firstResult = resolver.resolveSync();
      expect(firstResult.isInstalled).toBe(true);
      const initialCallCount = statCalls;
      expect(initialCallCount).toBeGreaterThan(0);

      // Subsequent call within TTL returns cached result with zero additional stat calls
      const secondResult = resolver.resolveSync();
      expect(secondResult).toBe(firstResult);
      expect(statCalls).toBe(initialCallCount);
    });

    it("invalidates cache and re-scans filesystem when forceRefresh is requested", () => {
      let statCalls = 0;
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        cacheTtlMs: 5000,
        statSync: (p) => {
          statCalls++;
          if (p === "/usr/local/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        accessSync: () => {},
      });

      resolver.resolveSync();
      const initialCallCount = statCalls;

      const refreshed = resolver.resolveSync({ forceRefresh: true });
      expect(refreshed.isInstalled).toBe(true);
      expect(statCalls).toBeGreaterThan(initialCallCount);
    });

    it("re-scans filesystem after TTL has expired", () => {
      let statCalls = 0;
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        cacheTtlMs: 50,
        statSync: (p) => {
          statCalls++;
          if (p === "/usr/local/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        accessSync: () => {},
      });

      resolver.resolveSync();
      const initialCount = statCalls;

      // Fast forward past cache TTL
      const originalNow = Date.now;
      try {
        let mockedTime = originalNow();
        Date.now = () => mockedTime;
        mockedTime += 60;

        resolver.resolveSync();
        expect(statCalls).toBeGreaterThan(initialCount);
      } finally {
        Date.now = originalNow;
      }
    });

    it("clears cache and allows manual cache reset", () => {
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });

      resolver.resolveSync();
      expect(resolver.getCachedResult()).not.toBeNull();

      resolver.clearCache();
      expect(resolver.getCachedResult()).toBeNull();
    });
  });

  describe("Custom binaryPath Evaluation and Validation", () => {
    it("validates valid custom absolute executable binary path", () => {
      const customPath = "/opt/custom/bin/cloudflared";
      const resolver = new BinaryResolver({
        platform: "darwin",
        statSync: (p) => {
          if (p === customPath) return { isFile: () => true };
          throw new Error("File not found");
        },
        accessSync: (p) => {
          if (p !== customPath) throw new Error("No execute permission");
        },
      });

      const result = resolver.resolveSync({ binaryPath: customPath });
      expect(result.isInstalled).toBe(true);
      expect(result.binaryPath).toBe(customPath);
      expect(result.error).toBeUndefined();
    });

    it("rejects custom binary path when it is a directory instead of a regular file", () => {
      const customPath = "/opt/custom/bin/cloudflared-dir";
      const resolver = new BinaryResolver({
        platform: "darwin",
        statSync: () => ({ isFile: () => false }),
        accessSync: () => {},
      });

      const result = resolver.resolveSync({ binaryPath: customPath });
      expect(result.isInstalled).toBe(false);
      expect(result.binaryPath).toBeNull();
      expect(result.error).toContain("not a valid executable");
    });

    it("rejects custom binary path when execute permission is denied", () => {
      const customPath = "/opt/custom/bin/cloudflared-noexec";
      const resolver = new BinaryResolver({
        platform: "darwin",
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {
          throw new Error("EACCES: permission denied");
        },
      });

      const result = resolver.resolveSync({ binaryPath: customPath });
      expect(result.isInstalled).toBe(false);
      expect(result.binaryPath).toBeNull();
      expect(result.error).toContain("not a valid executable");
    });

    it("searches candidate directories when custom binary name is not a path", () => {
      const existing = "/opt/homebrew/bin/my-cloudflared";
      const resolver = new BinaryResolver({
        platform: "darwin",
        statSync: (p) => {
          if (p === existing) return { isFile: () => true };
          throw new Error("Not found");
        },
        accessSync: (p) => {
          if (p !== existing) throw new Error("Cannot execute");
        },
      });

      const result = resolver.resolveSync({ binaryPath: "my-cloudflared" });
      expect(result.isInstalled).toBe(true);
      expect(result.binaryPath).toBe(existing);
    });
  });

  describe("Asynchronous Resolution", () => {
    it("asynchronously resolves executable binary with matching results", async () => {
      const expectedPath = "/usr/local/bin/cloudflared";
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        stat: async (p) => {
          if (p === expectedPath) return { isFile: () => true };
          throw new Error("File not found");
        },
        access: async (p) => {
          if (p !== expectedPath) throw new Error("No execute permission");
        },
      });

      const result = await resolver.resolve();
      expect(result.isInstalled).toBe(true);
      expect(result.binaryPath).toBe(expectedPath);
    });

    it("asynchronously rejects non-executable custom path", async () => {
      const resolver = new BinaryResolver({
        platform: "darwin",
        stat: async () => ({ isFile: () => true }),
        access: async () => {
          throw new Error("EACCES");
        },
      });

      const result = await resolver.resolve({
        binaryPath: "/custom/non-exec",
      });
      expect(result.isInstalled).toBe(false);
      expect(result.binaryPath).toBeNull();
    });
  });

  describe("Environment Augmentation Helper", () => {
    it("prepends fallback directories and resolved binary directory to child process PATH", () => {
      const resolver = new BinaryResolver({
        platform: "darwin",
        homedir: "/Users/testuser",
        env: { PATH: "/usr/bin:/bin" },
        statSync: (p) => {
          if (p === "/opt/homebrew/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        accessSync: () => {},
      });

      resolver.resolveSync();
      const augmentedEnv = resolver.getAugmentedEnv({ PATH: "/usr/bin:/bin" });

      expect(augmentedEnv.PATH).toBeDefined();
      const paths = (augmentedEnv.PATH || "").split(":");
      expect(paths).toContain("/opt/homebrew/bin");
      expect(paths).toContain("/usr/local/bin");
      expect(paths).toContain("/usr/bin");
      expect(paths).toContain("/bin");
      // Prepending places resolved/fallback paths before original GUI PATH
      expect(paths.indexOf("/opt/homebrew/bin")).toBeLessThan(
        paths.indexOf("/usr/bin"),
      );
    });

    it("preserves custom env variables when augmenting PATH", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/bin" },
      });

      const augmentedEnv = resolver.getAugmentedEnv({
        PATH: "/usr/bin",
        CUSTOM_VAR: "antigravity",
      });

      expect(augmentedEnv.CUSTOM_VAR).toBe("antigravity");
      expect(augmentedEnv.PATH).toContain("/usr/local/bin");
      expect(augmentedEnv.PATH).toContain("/usr/bin");
    });

    it("augments PATH on win32 with semicolon delimiter and handles case-insensitive Path", () => {
      const resolver = new BinaryResolver({
        platform: "win32",
        homedir: "C:\\Users\\user",
        env: {
          Path: "C:\\Windows;C:\\Windows\\System32",
          ProgramFiles: "C:\\Program Files",
          LOCALAPPDATA: "C:\\Users\\user\\AppData\\Local",
        },
      });

      const augmented = resolver.getAugmentedEnv();
      expect(augmented.Path).toBeDefined();
      expect(augmented.Path).toContain(";");
      expect(augmented.Path).toContain("C:\\Program Files\\cloudflared");
    });

    it("augments PATH when env has no PATH variable at all", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: {},
      });

      const augmented = resolver.getAugmentedEnv({});
      expect(augmented.PATH).toBeDefined();
      expect(augmented.PATH).toContain("/usr/bin");
    });

    it("adds cached binary directory to augmented PATH if not in existing or fallback dirs", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });

      resolver.resolveSync({ binaryPath: "/custom/special-bin/cloudflared" });
      const augmented = resolver.getAugmentedEnv({ PATH: "/bin" });
      expect(augmented.PATH).toContain("/custom/special-bin");
    });

    it("does not duplicate cached binary directory if it is already in existing PATH", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/custom/special-bin:/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });

      resolver.resolveSync({ binaryPath: "/custom/special-bin/cloudflared" });
      const augmented = resolver.getAugmentedEnv({
        PATH: "/custom/special-bin:/bin",
      });
      const segments = (augmented.PATH || "")
        .split(":")
        .filter((s) => s === "/custom/special-bin");
      expect(segments).toHaveLength(1);
    });
  });

  describe("Additional Edge Cases & 100% Branch Coverage", () => {
    it("uses default platform when resolvePlatform is called with no args", () => {
      const result = resolvePlatform();
      expect(["darwin", "win32", "linux"]).toContain(result);
    });

    it("uses default paths on win32 when environment variables are missing", () => {
      const resolver = new BinaryResolver({
        platform: "win32",
        homedir: "C:\\Users\\defaultuser",
        env: {},
      });

      const fallbacks = resolver.getFallbackDirectories();
      expect(fallbacks).toContain("C:\\Program Files\\cloudflared");
      expect(fallbacks).toContain(
        "C:\\Users\\defaultuser\\AppData\\Local\\Programs\\cloudflared",
      );
    });

    it("uses default PATHEXT on win32 when PATHEXT is not defined", () => {
      const resolver = new BinaryResolver({
        platform: "win32",
        env: {
          PATH: "C:\\bin",
          ProgramFiles: "C:\\Program Files",
        },
      });
      const candidates = (resolver as any).getSearchCandidates("cloudflared");
      expect(candidates.some((c: string) => c.endsWith(".exe"))).toBe(true);
    });

    it("returns null from getCachedResult when cache has expired", () => {
      const resolver = new BinaryResolver({
        cacheTtlMs: 10,
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });
      resolver.resolveSync();
      expect(resolver.getCachedResult()).not.toBeNull();

      const originalNow = Date.now;
      try {
        let mocked = originalNow();
        Date.now = () => mocked;
        mocked += 20;
        expect(resolver.getCachedResult()).toBeNull();
      } finally {
        Date.now = originalNow;
      }
    });

    it("caches async resolve() result and reuses within TTL, bypasses on forceRefresh", async () => {
      let statCalls = 0;
      const resolver = new BinaryResolver({
        cacheTtlMs: 5000,
        stat: async () => {
          statCalls++;
          return { isFile: () => true };
        },
        access: async () => {},
      });

      const first = await resolver.resolve();
      expect(first.isInstalled).toBe(true);
      expect(statCalls).toBeGreaterThan(0);

      const second = await resolver.resolve();
      expect(second).toBe(first);

      const refreshed = await resolver.resolve({ forceRefresh: true });
      expect(refreshed.isInstalled).toBe(true);
      expect(statCalls).toBeGreaterThan(1);
    });

    it("returns not installed when custom binary name is not found in candidate dirs (sync)", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        statSync: () => {
          throw new Error("ENOENT");
        },
        accessSync: () => {},
      });

      const res = resolver.resolveSync({
        binaryPath: "nonexistent-cloudflared",
      });
      expect(res.isInstalled).toBe(false);
      expect(res.binaryPath).toBeNull();
      expect(res.error).toContain("not found in PATH");
    });

    it("returns not installed when custom binary name is not found in candidate dirs (async)", async () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        stat: async () => {
          throw new Error("ENOENT");
        },
        access: async () => {},
      });

      const res = await resolver.resolve({
        binaryPath: "nonexistent-cloudflared",
      });
      expect(res.isInstalled).toBe(false);
      expect(res.binaryPath).toBeNull();
      expect(res.error).toContain("not found in PATH");
    });

    it("returns installed when custom binary name is found in candidate dirs (async)", async () => {
      const foundPath = "/usr/local/bin/my-cloudflared";
      const resolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        stat: async (p) => {
          if (p === foundPath) return { isFile: () => true };
          throw new Error("ENOENT");
        },
        access: async (p) => {
          if (p !== foundPath) throw new Error("EACCES");
        },
      });

      const res = await resolver.resolve({ binaryPath: "my-cloudflared" });
      expect(res.isInstalled).toBe(true);
      expect(res.binaryPath).toBe(foundPath);
    });

    it("returns not installed when default binary is not found anywhere (async)", async () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: { PATH: "/usr/bin" },
        stat: async () => {
          throw new Error("ENOENT");
        },
        access: async () => {},
      });

      const res = await resolver.resolve();
      expect(res.isInstalled).toBe(false);
      expect(res.binaryPath).toBeNull();
      expect(res.error).toContain(
        "cloudflared binary not found in PATH or fallback directories",
      );
    });

    it("resolves valid path-like custom binary path asynchronously", async () => {
      const customPath = "/custom/opt/bin/cloudflared";
      const resolver = new BinaryResolver({
        platform: "linux",
        stat: async (p) => {
          if (p === customPath) return { isFile: () => true };
          throw new Error("ENOENT");
        },
        access: async (p) => {
          if (p !== customPath) throw new Error("EACCES");
        },
      });

      const res = await resolver.resolve({ binaryPath: customPath });
      expect(res.isInstalled).toBe(true);
      expect(res.binaryPath).toBe(customPath);
    });

    it("rejects path-like custom binary when stat returns isFile false asynchronously", async () => {
      const customPath = "/custom/opt/bin/directory-not-file";
      const resolver = new BinaryResolver({
        platform: "linux",
        stat: async () => ({ isFile: () => false }),
        access: async () => {},
      });

      const res = await resolver.resolve({ binaryPath: customPath });
      expect(res.isInstalled).toBe(false);
      expect(res.binaryPath).toBeNull();
      expect(res.error).toContain("not a valid executable");
    });

    it("returns false for isExecutableAsync when stat throws", async () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        stat: async () => {
          throw new Error("Stat failed");
        },
      });

      const res = await (resolver as any).isExecutableAsync("/nonexistent");
      expect(res).toBe(false);
    });

    it("returns false for isExecutableSync when stat throws", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        statSync: () => {
          throw new Error("Stat failed");
        },
      });

      const res = (resolver as any).isExecutableSync("/nonexistent");
      expect(res).toBe(false);
    });

    it("searches candidates when env has no PATH variable", () => {
      const resolver = new BinaryResolver({
        platform: "linux",
        env: {},
        statSync: () => {
          throw new Error("ENOENT");
        },
        accessSync: () => {},
      });
      const candidates = (resolver as any).getSearchCandidates("cloudflared");
      expect(candidates.length).toBeGreaterThan(0);
    });
  });
});
