import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { ServiceTarget } from "../../shared/types";

const pathOverrides: Partial<Record<ServiceTarget, string>> = {};

export function setBinaryPathOverride(
  target: ServiceTarget,
  binaryPath: string,
): void {
  pathOverrides[target] = binaryPath;
}

export function clearBinaryPathOverrides(): void {
  for (const key of Object.keys(pathOverrides) as ServiceTarget[]) {
    delete pathOverrides[key];
  }
}

function checkPathExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function lookupInPath(binaryName: string): string | null {
  const isWindows = os.platform() === "win32";
  const cmd = isWindows ? `where.exe ${binaryName}` : `which ${binaryName}`;

  try {
    const result = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();

    const firstLine = result.split(/\r?\n/)[0];
    if (firstLine && checkPathExists(firstLine)) {
      return firstLine;
    }
  } catch {
    // Binary not in PATH
  }
  return null;
}

export function findServiceBinary(target: ServiceTarget): string | null {
  if (pathOverrides[target]) {
    return pathOverrides[target]!;
  }

  const platform = os.platform();
  const homeDir = os.homedir();

  if (target === "antigravity_daemon") {
    // 1. Try PATH
    const inPath = lookupInPath("agy") || lookupInPath("antigravity");
    if (inPath) return inPath;

    // 2. Platform-specific known directories
    if (platform === "darwin") {
      const candidates = [
        "/Applications/Antigravity.app/Contents/MacOS/Antigravity",
        "/Applications/Antigravity.app/Contents/Resources/app/bin/agy",
        path.join(homeDir, "Library/Application Support/Antigravity/bin/agy"),
        path.join(homeDir, ".antigravity/bin/agy"),
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    } else if (platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData/Local");
      const appData =
        process.env.APPDATA || path.join(homeDir, "AppData/Roaming");
      const candidates = [
        path.join(localAppData, "Programs/Antigravity/agy.exe"),
        path.join(appData, "Antigravity/bin/agy.exe"),
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    } else {
      const candidates = [
        path.join(homeDir, ".local/bin/agy"),
        "/usr/local/bin/agy",
        "/usr/bin/agy",
        "/opt/antigravity/bin/agy",
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    }
  } else if (target === "antigravity_ide") {
    // 1. Try PATH
    const inPath =
      lookupInPath("antigravity-ide") || lookupInPath("Antigravity IDE");
    if (inPath) return inPath;

    // 2. Platform-specific known directories
    if (platform === "darwin") {
      const candidates = [
        "/Applications/Antigravity IDE.app/Contents/MacOS/Electron",
        "/Applications/Antigravity IDE.app/Contents/MacOS/Antigravity IDE",
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    } else if (platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(homeDir, "AppData/Local");
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const candidates = [
        path.join(localAppData, "Programs/Antigravity IDE/Antigravity IDE.exe"),
        path.join(programFiles, "Antigravity IDE/Antigravity IDE.exe"),
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    } else {
      const candidates = [
        "/usr/bin/antigravity-ide",
        "/usr/local/bin/antigravity-ide",
        "/opt/antigravity-ide/antigravity-ide",
      ];
      for (const candidate of candidates) {
        if (checkPathExists(candidate)) return candidate;
      }
    }
  }

  return null;
}
