import { describe, expect, it } from "vitest";
import { detectAgyCliExecutablePath } from "@/modules/antigravity-runtime/binary-patch/agyCliPathDetection";

function createExists(...existingPaths: string[]) {
  const paths = new Set(existingPaths);
  return (candidatePath: string) => paths.has(candidatePath);
}

describe("agy CLI path detection", () => {
  it("returns the configured executable before probing standard locations", () => {
    const configuredPath = "/configured/agy";

    expect(
      detectAgyCliExecutablePath({
        configuredPath,
        exists: createExists(configuredPath, "/home/user/.local/bin/agy"),
        homeDirectory: "/home/user",
        pathEnvironment: "/usr/local/bin:/usr/bin",
        platform: "linux",
      }),
    ).toBe(configuredPath);
  });

  it("truly bypasses the configured executable during a forced detection", () => {
    const localExecutablePath = "/home/user/.local/bin/agy";

    expect(
      detectAgyCliExecutablePath({
        bypassConfig: true,
        configuredPath: "/configured/agy",
        exists: createExists("/configured/agy", localExecutablePath),
        homeDirectory: "/home/user",
        pathEnvironment: "/usr/local/bin:/usr/bin",
        platform: "linux",
      }),
    ).toBe(localExecutablePath);
  });

  it("prefers the standard user-local executable over PATH", () => {
    const localExecutablePath = "/home/user/.local/bin/agy";

    expect(
      detectAgyCliExecutablePath({
        exists: createExists(localExecutablePath, "/usr/local/bin/agy"),
        homeDirectory: "/home/user",
        pathEnvironment: "/usr/local/bin:/usr/bin",
        platform: "linux",
      }),
    ).toBe(localExecutablePath);
  });

  it("finds the first executable in PATH when the user-local path is absent", () => {
    expect(
      detectAgyCliExecutablePath({
        exists: createExists("/opt/agy/bin/agy", "/usr/local/bin/agy"),
        homeDirectory: "/home/user",
        pathEnvironment: "/opt/agy/bin:/usr/local/bin:/usr/bin",
        platform: "linux",
      }),
    ).toBe("/opt/agy/bin/agy");
  });

  it("uses agy.exe and the Windows PATH delimiter on Windows", () => {
    expect(
      detectAgyCliExecutablePath({
        exists: createExists("D:\\Agy\\bin\\agy.exe"),
        homeDirectory: "C:\\Users\\test",
        pathEnvironment: "C:\\Tools;D:\\Agy\\bin;C:\\Windows",
        platform: "win32",
      }),
    ).toBe("D:\\Agy\\bin\\agy.exe");
  });

  it("detects npm agy.cmd shim on Windows in PATH", () => {
    expect(
      detectAgyCliExecutablePath({
        exists: createExists("C:\\Users\\test\\AppData\\Roaming\\npm\\agy.cmd"),
        homeDirectory: "C:\\Users\\test",
        pathEnvironment: "C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Windows",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\npm\\agy.cmd");
  });

  it("detects agy.bat on Windows in user local bin", () => {
    expect(
      detectAgyCliExecutablePath({
        exists: createExists("C:\\Users\\test\\.local\\bin\\agy.bat"),
        homeDirectory: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\.local\\bin\\agy.bat");
  });

  it("detects agy.cmd in fallback AppData npm directory on Windows", () => {
    const originalAppData = process.env.APPDATA;
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";

    expect(
      detectAgyCliExecutablePath({
        exists: createExists("C:\\Users\\test\\AppData\\Roaming\\npm\\agy.cmd"),
        homeDirectory: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\npm\\agy.cmd");

    process.env.APPDATA = originalAppData;
  });

  it("detects agy.cmd in fallback Yarn bin directory on Windows", () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";

    expect(
      detectAgyCliExecutablePath({
        exists: createExists(
          "C:\\Users\\test\\AppData\\Local\\Yarn\\bin\\agy.cmd",
        ),
        homeDirectory: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Local\\Yarn\\bin\\agy.cmd");

    process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it("detects Windows host AppData agy binary under WSL", () => {
    const wslHostCli =
      "/mnt/c/Users/Devon/AppData/Local/Programs/antigravity-cli/agy.exe";

    expect(
      detectAgyCliExecutablePath({
        exists: createExists(wslHostCli),
        homeDirectory: "/home/devon",
        platform: "linux",
        isWsl: true,
        windowsUser: "Devon",
      }),
    ).toBe(wslHostCli);
  });

  it("detects Windows host npm agy.cmd under WSL", () => {
    const wslNpmCli = "/mnt/c/Users/Devon/AppData/Roaming/npm/agy.cmd";

    expect(
      detectAgyCliExecutablePath({
        exists: createExists(wslNpmCli),
        homeDirectory: "/home/devon",
        platform: "linux",
        isWsl: true,
        windowsUser: "Devon",
      }),
    ).toBe(wslNpmCli);
  });

  it("returns null when no CLI executable can be found", () => {
    expect(
      detectAgyCliExecutablePath({
        exists: () => false,
        homeDirectory: "/home/user",
        pathEnvironment: "/usr/local/bin:/usr/bin",
        platform: "darwin",
      }),
    ).toBeNull();
  });
});
