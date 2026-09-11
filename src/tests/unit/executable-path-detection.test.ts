import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateExecutableBinary,
  isSquirrelVersionedPath,
  resolveSquirrelRootLauncher,
  maskUserPath,
  getDarwinPossibleExecutablePaths,
  getLinuxPossibleExecutablePaths,
  getAntigravityExecutablePath,
  detectAntigravityExecutablePath,
  detectAllAntigravityExecutablePaths,
  refreshAllAntigravityProcessCaches,
  clearRunningProcessCache,
  runningProcessCache,
} from "@/shared/platform/paths";

describe("Executable Path Detection & Platform Heuristics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRunningProcessCache();
  });

  describe("validateExecutableBinary", () => {
    it("returns false for invalid or empty candidate paths", () => {
      expect(validateExecutableBinary("")).toBe(false);
      expect(validateExecutableBinary(null as any)).toBe(false);
      expect(validateExecutableBinary(undefined as any)).toBe(false);
    });

    it("returns false when candidate path does not exist on disk", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      expect(validateExecutableBinary("/non/existent/binary")).toBe(false);
    });

    it("returns false when candidate is a directory rather than a file", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => false,
      } as any);

      expect(validateExecutableBinary("/path/to/directory")).toBe(false);
    });

    it("returns false when candidate lacks execute permission on non-Windows platforms", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockImplementation(() => {
        const error = new Error("Permission denied") as any;
        error.code = "EACCES";
        throw error;
      });

      expect(
        validateExecutableBinary("/path/to/binary", { platform: "darwin" }),
      ).toBe(false);
      expect(
        validateExecutableBinary("/path/to/binary", { platform: "linux" }),
      ).toBe(false);
    });

    it("returns true when candidate is a valid executable file", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      expect(
        validateExecutableBinary(
          "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
          {
            platform: "darwin",
          },
        ),
      ).toBe(true);
    });

    it("skips X_OK check on Windows platform", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      const accessSpy = vi.spyOn(fs, "accessSync");

      expect(
        validateExecutableBinary("C:\\Programs\\antigravity\\antigravity.exe", {
          platform: "win32",
        }),
      ).toBe(true);
      expect(accessSpy).not.toHaveBeenCalled();
    });
  });

  describe("macOS false-positive prevention in getAntigravityExecutablePath", () => {
    it("returns empty string when Antigravity binary is not installed on macOS", () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const detected = getAntigravityExecutablePath("app", {
        platform: "darwin",
      });
      expect(detected).toBe("");
    });

    it("returns executable path when Antigravity app binary exists on macOS", () => {
      const validPath =
        "/Applications/Antigravity.app/Contents/MacOS/Antigravity";
      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === validPath,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const detected = getAntigravityExecutablePath("app", {
        platform: "darwin",
      });
      expect(detected).toBe(validPath);
    });

    it("detects user-home Applications on macOS", () => {
      const home = os.homedir();
      const userAppPath = path.posix.join(
        home,
        "Applications",
        "Antigravity.app",
        "Contents",
        "MacOS",
        "Antigravity",
      );
      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === userAppPath,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const detected = getAntigravityExecutablePath("app", {
        platform: "darwin",
      });
      expect(detected).toBe(userAppPath);
    });

    it("detects Antigravity IDE on macOS including hyphenated binary", () => {
      const ideHyphenPath =
        "/Applications/Antigravity IDE.app/Contents/MacOS/antigravity-ide";
      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === ideHyphenPath,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const detected = getAntigravityExecutablePath("ide", {
        platform: "darwin",
      });
      expect(detected).toBe(ideHyphenPath);
    });
  });

  describe("Squirrel root launcher prioritization", () => {
    it("identifies versioned Squirrel app-* directories", () => {
      expect(
        isSquirrelVersionedPath(
          "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\app-1.2.3\\antigravity.exe",
        ),
      ).toBe(true);
      expect(
        isSquirrelVersionedPath(
          "/mnt/c/Users/alice/AppData/Local/Programs/antigravity/app-2.0.1/antigravity.exe",
        ),
      ).toBe(true);
      expect(
        isSquirrelVersionedPath(
          "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\antigravity.exe",
        ),
      ).toBe(false);
    });

    it("resolves Squirrel versioned path to root launcher when root exists", () => {
      const versioned =
        "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\app-1.2.3\\antigravity.exe";
      const rootLauncher =
        "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\antigravity.exe";

      vi.spyOn(fs, "existsSync").mockImplementation(
        (candidate) => String(candidate) === rootLauncher,
      );

      const resolved = resolveSquirrelRootLauncher(versioned);
      expect(resolved).toBe(rootLauncher);
    });

    it("preserves candidate path if root launcher does not exist", () => {
      const versioned =
        "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\app-1.2.3\\antigravity.exe";

      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const resolved = resolveSquirrelRootLauncher(versioned);
      expect(resolved).toBe(versioned);
    });
  });

  describe("maskUserPath PII sanitization", () => {
    it("returns null for null, undefined, or non-string inputs", () => {
      expect(maskUserPath(null)).toBeNull();
      expect(maskUserPath(undefined)).toBeNull();
      expect(maskUserPath("")).toBeNull();
    });

    it("masks macOS user account paths", () => {
      expect(maskUserPath("/Users/alex/Applications/Antigravity.app")).toBe(
        "/Users/***/Applications/Antigravity.app",
      );
    });

    it("masks Linux home account paths", () => {
      expect(maskUserPath("/home/devon/.local/bin/agy")).toBe(
        "/home/***/.local/bin/agy",
      );
    });

    it("masks Windows user account paths with backslashes", () => {
      expect(
        maskUserPath(
          "C:\\Users\\Marcus\\AppData\\Local\\Programs\\antigravity\\antigravity.exe",
        ),
      ).toBe(
        "C:\\Users\\***\\AppData\\Local\\Programs\\antigravity\\antigravity.exe",
      );
    });

    it("masks Windows user account paths with forward slashes", () => {
      expect(
        maskUserPath(
          "C:/Users/Marcus/AppData/Local/Programs/antigravity/antigravity.exe",
        ),
      ).toBe("C:/Users/***/AppData/Local/Programs/antigravity/antigravity.exe");
    });

    it("masks WSL mapped user account paths", () => {
      expect(
        maskUserPath(
          "/mnt/c/Users/Devon/AppData/Local/Programs/antigravity/antigravity.exe",
        ),
      ).toBe(
        "/mnt/c/Users/***/AppData/Local/Programs/antigravity/antigravity.exe",
      );
    });
  });

  describe("detectAntigravityExecutablePath", () => {
    it("detects running process and sets source to 'process'", async () => {
      const runningPath =
        "/Applications/Antigravity.app/Contents/MacOS/Antigravity";
      runningProcessCache.set("app", {
        platform: "darwin",
        target: "app",
        checkedAt: Date.now(),
        processes: [
          {
            pid: 1234,
            name: "Antigravity",
            executablePath: runningPath,
            commandLine: runningPath,
          },
        ],
      });

      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === runningPath,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "darwin",
        skipProcessRefresh: true,
      });

      expect(result.detectedPath).toBe(runningPath);
      expect(result.source).toBe("process");
      expect(result.status).toBe("detected");
      expect(result.alreadySet).toBe(false);
    });

    it("resolves Squirrel root launcher when process is running from app-x.y.z", async () => {
      const versionedRunningPath =
        "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\app-1.0.0\\antigravity.exe";
      const rootLauncher =
        "C:\\Users\\alice\\AppData\\Local\\Programs\\antigravity\\antigravity.exe";

      runningProcessCache.set("app", {
        platform: "win32",
        target: "app",
        checkedAt: Date.now(),
        processes: [
          {
            pid: 5678,
            name: "antigravity.exe",
            executablePath: versionedRunningPath,
            commandLine: versionedRunningPath,
          },
        ],
      });

      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) =>
          String(target) === versionedRunningPath ||
          String(target) === rootLauncher,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "win32",
        skipProcessRefresh: true,
      });

      expect(result.detectedPath).toBe(rootLauncher);
      expect(result.source).toBe("process");
    });

    it("falls back to candidate filesystem paths when no process is running", async () => {
      const fsPath = "/usr/bin/antigravity";
      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === fsPath,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "linux",
        isWsl: false,
        skipProcessRefresh: true,
      });

      expect(result.detectedPath).toBe(fsPath);
      expect(result.source).toBe("filesystem");
      expect(result.status).toBe("detected");
    });

    it("falls back to system PATH when candidates do not exist", async () => {
      const originalPath = process.env.PATH;
      process.env.PATH = "/opt/custom/bin:/usr/bin";
      const customBinary = "/opt/custom/bin/antigravity";

      vi.spyOn(fs, "existsSync").mockImplementation(
        (target) => String(target) === customBinary,
      );
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "linux",
        isWsl: false,
        skipProcessRefresh: true,
      });

      expect(result.detectedPath).toBe(customBinary);
      expect(result.source).toBe("path");

      process.env.PATH = originalPath;
    });

    it("returns already_set status when detected path matches configured path", async () => {
      const agentConfigPath = path.join(
        os.homedir(),
        ".antigravity-relay",
        "gui_config.json",
      );
      const configuredBinary = "/usr/bin/antigravity";

      vi.spyOn(fs, "existsSync").mockImplementation((target) => {
        const norm = String(target);
        return norm === agentConfigPath || norm === configuredBinary;
      });
      vi.spyOn(fs, "readFileSync").mockImplementation((target) => {
        if (String(target) === agentConfigPath) {
          return JSON.stringify({
            antigravity_executable: configuredBinary,
          });
        }
        return "";
      });
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "linux",
        isWsl: false,
        skipProcessRefresh: true,
        bypassConfig: true,
      });

      expect(result.detectedPath).toBe(configuredBinary);
      expect(result.configuredPath).toBe(configuredBinary);
      expect(result.alreadySet).toBe(true);
      expect(result.status).toBe("already_set");
    });

    it("returns status not_found and null detectedPath when no binary exists", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "darwin",
        skipProcessRefresh: true,
      });

      expect(result.detectedPath).toBeNull();
      expect(result.source).toBe("none");
      expect(result.alreadySet).toBe(false);
      expect(result.status).toBe("not_found");
    });

    it("respects bypassConfig: false and returns config source", async () => {
      const agentConfigPath = path.join(
        os.homedir(),
        ".antigravity-relay",
        "gui_config.json",
      );
      const configuredBinary = "/opt/custom/antigravity";

      vi.spyOn(fs, "existsSync").mockImplementation((target) => {
        const norm = String(target);
        return norm === agentConfigPath || norm === configuredBinary;
      });
      vi.spyOn(fs, "readFileSync").mockImplementation((target) => {
        if (String(target) === agentConfigPath) {
          return JSON.stringify({
            antigravity_executable: configuredBinary,
          });
        }
        return "";
      });
      vi.spyOn(fs, "statSync").mockReturnValue({
        isFile: () => true,
      } as any);
      vi.spyOn(fs, "accessSync").mockReturnValue(undefined);

      const result = await detectAntigravityExecutablePath("app", {
        platform: "linux",
        isWsl: false,
        skipProcessRefresh: true,
        bypassConfig: false,
      });

      expect(result.detectedPath).toBe(configuredBinary);
      expect(result.source).toBe("config");
      expect(result.alreadySet).toBe(true);
      expect(result.status).toBe("already_set");
    });
  });

  describe("detectAllAntigravityExecutablePaths", () => {
    it("scans all 3 targets in a single operation and populates process caches", async () => {
      vi.spyOn(fs, "existsSync").mockReturnValue(false);

      const results = await detectAllAntigravityExecutablePaths({
        platform: "darwin",
        bypassConfig: true,
      });

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.target)).toEqual(["app", "ide", "cli"]);
      for (const r of results) {
        expect(r.status).toBe("not_found");
        expect(r.detectedPath).toBeNull();
        expect(r.source).toBe("none");
      }
    });
  });
});
