import fs from "fs";
import os from "os";
import path from "path";

export interface AgyCliPathDetectionOptions {
  bypassConfig?: boolean;
  configuredPath?: string | null;
  exists?: (candidatePath: string) => boolean;
  homeDirectory?: string;
  pathEnvironment?: string;
  platform?: NodeJS.Platform;
}

/**
 * Locate the agy executable using the same precedence as the upstream implementation.
 *
 * A forced detection intentionally excludes the configured path so the Detect action
 * cannot return a stale-but-existing selection.
 */
export function detectAgyCliExecutablePath(
  options: AgyCliPathDetectionOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const executableName = platform === "win32" ? "agy.exe" : "agy";
  const exists =
    options.exists ?? ((candidatePath: string) => fs.existsSync(candidatePath));

  if (!options.bypassConfig) {
    const configuredPath = options.configuredPath?.trim();
    if (configuredPath && exists(configuredPath)) {
      return configuredPath;
    }
  }

  const homeDirectory = options.homeDirectory ?? os.homedir();
  const userLocalPath = pathApi.join(
    homeDirectory,
    ".local",
    "bin",
    executableName,
  );
  if (exists(userLocalPath)) {
    return userLocalPath;
  }

  const userGeminiCliPath = pathApi.join(
    homeDirectory,
    ".gemini",
    "antigravity-cli",
    "bin",
    executableName,
  );
  if (exists(userGeminiCliPath)) {
    return userGeminiCliPath;
  }

  const pathEnvironment = options.pathEnvironment ?? process.env.PATH;
  if (pathEnvironment) {
    for (const directory of pathEnvironment.split(pathApi.delimiter)) {
      if (!directory) {
        continue;
      }

      const candidatePath = pathApi.join(directory, executableName);
      if (exists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  const fallbackCandidatePaths =
    platform === "win32"
      ? [
          path.win32.join(
            process.env.LOCALAPPDATA ||
              path.win32.join(homeDirectory, "AppData", "Local"),
            "Programs",
            "antigravity-cli",
            executableName,
          ),
          path.win32.join(
            homeDirectory,
            ".gemini",
            "antigravity-cli",
            "bin",
            executableName,
          ),
          path.win32.join(
            process.env.ProgramFiles || "C:\\Program Files",
            "Antigravity CLI",
            executableName,
          ),
          path.win32.join(
            process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
            "Antigravity CLI",
            executableName,
          ),
        ]
      : [
          path.posix.join("/opt", "homebrew", "bin", executableName),
          path.posix.join("/usr", "local", "bin", executableName),
          path.posix.join(homeDirectory, ".cargo", "bin", executableName),
          path.posix.join("/usr", "bin", executableName),
        ];

  for (const candidatePath of fallbackCandidatePaths) {
    if (exists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}
