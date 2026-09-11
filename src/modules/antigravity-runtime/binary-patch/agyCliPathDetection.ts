import fs from "fs";
import os from "os";
import path from "path";
import { getWindowsUser, isWsl } from "@/shared/platform/paths";

export const WINDOWS_AGY_EXTENSIONS = [
  "agy.cmd",
  "agy.exe",
  "agy.bat",
  "agy",
] as const;

export interface AgyCliPathDetectionOptions {
  bypassConfig?: boolean;
  configuredPath?: string | null;
  exists?: (candidatePath: string) => boolean;
  homeDirectory?: string;
  pathEnvironment?: string;
  platform?: NodeJS.Platform;
  isWsl?: boolean;
  windowsUser?: string;
}

/**
 * Locate the agy executable using standard candidate paths, package managers, and platform heuristics.
 *
 * A forced detection intentionally excludes the configured path so the Detect action
 * cannot return a stale-but-existing selection.
 */
export function detectAgyCliExecutablePath(
  options: AgyCliPathDetectionOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const isWslEnvironment =
    options.isWsl ?? (platform === "linux" && isWsl(platform));

  const defaultExists = (candidatePath: string): boolean => {
    try {
      if (!fs.existsSync(candidatePath)) return false;
      try {
        const stat = fs.statSync(candidatePath);
        if (stat && typeof stat.isFile === "function" && !stat.isFile()) {
          return false;
        }
      } catch (statErr: any) {
        if (statErr?.code !== "ENOENT") {
          return false;
        }
      }
      if (platform !== "win32") {
        try {
          fs.accessSync(candidatePath, fs.constants.X_OK);
        } catch (accessErr: any) {
          if (accessErr?.code !== "ENOENT") {
            return false;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  const exists = options.exists ?? defaultExists;

  if (!options.bypassConfig) {
    const configuredPath = options.configuredPath?.trim();
    if (configuredPath && exists(configuredPath)) {
      return configuredPath;
    }
  }

  const homeDirectory = options.homeDirectory ?? os.homedir();

  // 1. User-local ~/.local/bin
  if (platform === "win32") {
    for (const ext of WINDOWS_AGY_EXTENSIONS) {
      const candidate = path.win32.join(homeDirectory, ".local", "bin", ext);
      if (exists(candidate)) return candidate;
    }
  } else {
    const userLocalPath = path.posix.join(
      homeDirectory,
      ".local",
      "bin",
      "agy",
    );
    if (exists(userLocalPath)) return userLocalPath;
  }

  // 2. Gemini CLI directory ~/.gemini/antigravity-cli/bin
  if (platform === "win32") {
    for (const ext of WINDOWS_AGY_EXTENSIONS) {
      const candidate = path.win32.join(
        homeDirectory,
        ".gemini",
        "antigravity-cli",
        "bin",
        ext,
      );
      if (exists(candidate)) return candidate;
    }
  } else {
    const userGeminiCliPath = path.posix.join(
      homeDirectory,
      ".gemini",
      "antigravity-cli",
      "bin",
      "agy",
    );
    if (exists(userGeminiCliPath)) return userGeminiCliPath;
  }

  // 3. System PATH environment
  const pathEnvironment = options.pathEnvironment ?? process.env.PATH;
  if (pathEnvironment) {
    for (const directory of pathEnvironment.split(pathApi.delimiter)) {
      if (!directory) continue;
      if (platform === "win32") {
        for (const ext of WINDOWS_AGY_EXTENSIONS) {
          const candidatePath = path.win32.join(directory, ext);
          if (exists(candidatePath)) return candidatePath;
        }
      } else {
        const candidatePath = path.posix.join(directory, "agy");
        if (exists(candidatePath)) return candidatePath;
      }
    }
  }

  // 4. Platform-specific fallback search paths
  if (platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ||
      path.win32.join(homeDirectory, "AppData", "Local");
    const appData =
      process.env.APPDATA ||
      path.win32.join(homeDirectory, "AppData", "Roaming");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const winSearchDirs = [
      path.win32.join(localAppData, "Programs", "antigravity-cli"),
      path.win32.join(appData, "npm"),
      path.win32.join(localAppData, "Yarn", "bin"),
      path.win32.join(homeDirectory, ".gemini", "antigravity-cli", "bin"),
      path.win32.join(programFiles, "Antigravity CLI"),
      path.win32.join(programFilesX86, "Antigravity CLI"),
    ];

    for (const dir of winSearchDirs) {
      for (const ext of WINDOWS_AGY_EXTENSIONS) {
        const candidatePath = path.win32.join(dir, ext);
        if (exists(candidatePath)) return candidatePath;
      }
    }
  } else {
    // macOS / Linux / WSL POSIX candidate directories
    const posixCandidatePaths = [
      path.posix.join("/opt", "homebrew", "bin", "agy"),
      path.posix.join("/usr", "local", "bin", "agy"),
      path.posix.join(homeDirectory, ".cargo", "bin", "agy"),
      path.posix.join("/usr", "bin", "agy"),
    ];

    for (const candidatePath of posixCandidatePaths) {
      if (exists(candidatePath)) return candidatePath;
    }

    // 5. If WSL, inspect Windows host AppData and Program Files paths via getWindowsUser()
    if (isWslEnvironment) {
      const winUser = options.windowsUser ?? getWindowsUser();
      const wslHostDirs = [
        `/mnt/c/Users/${winUser}/AppData/Local/Programs/antigravity-cli`,
        `/mnt/c/Users/${winUser}/AppData/Roaming/npm`,
        `/mnt/c/Users/${winUser}/AppData/Local/Yarn/bin`,
        `/mnt/c/Program Files/Antigravity CLI`,
        `/mnt/c/Program Files (x86)/Antigravity CLI`,
      ];
      for (const dir of wslHostDirs) {
        for (const ext of WINDOWS_AGY_EXTENSIONS) {
          const candidatePath = path.posix.join(dir, ext);
          if (exists(candidatePath)) return candidatePath;
        }
      }
    }
  }

  return null;
}
