import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRouterClient } from "@orpc/server";
import type { DetectedExecutableResult } from "@/shared/platform/paths";

const {
  detectAntigravityExecutablePathMock,
  detectAllAntigravityExecutablePathsMock,
} = vi.hoisted(() => ({
  detectAntigravityExecutablePathMock:
    vi.fn<(...args: unknown[]) => Promise<DetectedExecutableResult>>(),
  detectAllAntigravityExecutablePathsMock:
    vi.fn<(...args: unknown[]) => Promise<DetectedExecutableResult[]>>(),
}));

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock("@/shared/platform/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/platform/paths")>();
  return {
    ...actual,
    detectAntigravityExecutablePath: detectAntigravityExecutablePathMock,
    detectAllAntigravityExecutablePaths:
      detectAllAntigravityExecutablePathsMock,
  };
});

import { systemHandler } from "@/modules/app-shell/ipc/system/handler";

describe("System Handler - Executable Detection Endpoints", () => {
  const client = createRouterClient(systemHandler);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("system.detectAntigravityExecutable", () => {
    it("defaults to app target and bypassConfig: true when input is omitted", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath:
          "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
        source: "filesystem",
        configuredPath: null,
        alreadySet: false,
        status: "detected",
      };
      detectAntigravityExecutablePathMock.mockResolvedValueOnce(mockResult);

      const result = await client.detectAntigravityExecutable();

      expect(detectAntigravityExecutablePathMock).toHaveBeenCalledWith("app", {
        bypassConfig: true,
      });
      expect(result).toEqual(mockResult);
    });

    it("passes explicit target: 'ide' and bypassConfig: true by default", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "ide",
        detectedPath:
          "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
        source: "filesystem",
        configuredPath: null,
        alreadySet: false,
        status: "detected",
      };
      detectAntigravityExecutablePathMock.mockResolvedValueOnce(mockResult);

      const result = await client.detectAntigravityExecutable({
        target: "ide",
      });

      expect(detectAntigravityExecutablePathMock).toHaveBeenCalledWith("ide", {
        bypassConfig: true,
      });
      expect(result).toEqual(mockResult);
    });

    it("passes explicit target: 'cli' and handles already_set status", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "cli",
        detectedPath: "/usr/local/bin/agy",
        source: "path",
        configuredPath: "/usr/local/bin/agy",
        alreadySet: true,
        status: "already_set",
      };
      detectAntigravityExecutablePathMock.mockResolvedValueOnce(mockResult);

      const result = await client.detectAntigravityExecutable({
        target: "cli",
        bypassConfig: true,
      });

      expect(detectAntigravityExecutablePathMock).toHaveBeenCalledWith("cli", {
        bypassConfig: true,
      });
      expect(result.status).toBe("already_set");
      expect(result.alreadySet).toBe(true);
      expect(result.source).toBe("path");
    });

    it("supports legacy target aliases 'classic' and 'agy'", async () => {
      detectAntigravityExecutablePathMock.mockResolvedValue({
        target: "app",
        detectedPath: null,
        source: "none",
        configuredPath: null,
        alreadySet: false,
        status: "not_found",
      });

      await client.detectAntigravityExecutable({
        target: "classic" as any,
      });
      expect(detectAntigravityExecutablePathMock).toHaveBeenLastCalledWith(
        "app",
        {
          bypassConfig: true,
        },
      );

      await client.detectAntigravityExecutable({
        target: "agy" as any,
      });
      expect(detectAntigravityExecutablePathMock).toHaveBeenLastCalledWith(
        "cli",
        {
          bypassConfig: true,
        },
      );
    });

    it("respects bypassConfig: false when explicitly provided", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath: "/custom/antigravity",
        source: "config",
        configuredPath: "/custom/antigravity",
        alreadySet: true,
        status: "already_set",
      };
      detectAntigravityExecutablePathMock.mockResolvedValueOnce(mockResult);

      const result = await client.detectAntigravityExecutable({
        target: "app",
        bypassConfig: false,
      });

      expect(detectAntigravityExecutablePathMock).toHaveBeenCalledWith("app", {
        bypassConfig: false,
      });
      expect(result.source).toBe("config");
      expect(result.alreadySet).toBe(true);
    });

    it("returns not_found status when no executable is discovered", async () => {
      const mockResult: DetectedExecutableResult = {
        target: "app",
        detectedPath: null,
        source: "none",
        configuredPath: null,
        alreadySet: false,
        status: "not_found",
      };
      detectAntigravityExecutablePathMock.mockResolvedValueOnce(mockResult);

      const result = await client.detectAntigravityExecutable({
        target: "app",
      });

      expect(result.detectedPath).toBeNull();
      expect(result.source).toBe("none");
      expect(result.status).toBe("not_found");
      expect(result.alreadySet).toBe(false);
    });
  });

  describe("system.detectAllAntigravityExecutables", () => {
    it("calls detectAllAntigravityExecutablePaths with bypassConfig: true by default", async () => {
      const mockResults: DetectedExecutableResult[] = [
        {
          target: "app",
          detectedPath:
            "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
          source: "filesystem",
          configuredPath: null,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "ide",
          detectedPath:
            "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
          source: "process",
          configuredPath: null,
          alreadySet: false,
          status: "detected",
        },
        {
          target: "cli",
          detectedPath: "/usr/local/bin/agy",
          source: "path",
          configuredPath: "/usr/local/bin/agy",
          alreadySet: true,
          status: "already_set",
        },
      ];
      detectAllAntigravityExecutablePathsMock.mockResolvedValueOnce(
        mockResults,
      );

      const results = await client.detectAllAntigravityExecutables();

      expect(detectAllAntigravityExecutablePathsMock).toHaveBeenCalledWith({
        bypassConfig: true,
      });
      expect(results).toHaveLength(3);
      expect(results).toEqual(mockResults);
    });

    it("passes bypassConfig: false when explicitly provided", async () => {
      detectAllAntigravityExecutablePathsMock.mockResolvedValueOnce([]);

      await client.detectAllAntigravityExecutables({ bypassConfig: false });

      expect(detectAllAntigravityExecutablePathsMock).toHaveBeenCalledWith({
        bypassConfig: false,
      });
    });
  });
});
