import path from "path";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import findProcess, { type ProcessInfo } from "find-process";
import { z } from "zod";
import type {
  AntigravityAppTarget,
  CanonicalAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import {
  CanonicalAntigravityAppTargetSchema,
  resolveAntigravityAppTarget,
} from "@/shared/platform/antigravityAppTarget";
import { detectAgyCliExecutablePath } from "@/modules/antigravity-runtime/binary-patch/agyCliPathDetection";

export const ExecutableDetectionResultSchema = z.object({
  target: CanonicalAntigravityAppTargetSchema,
  detectedPath: z.string().nullable(),
  source: z.string(),
  configuredPath: z.string().nullable(),
  configuredPathExists: z.boolean().optional(),
  alreadySet: z.boolean(),
  status: z.enum(["detected", "already_set", "not_found"]),
});

export type ExecutableDetectionResult = z.infer<
  typeof ExecutableDetectionResultSchema
>;
export type DetectedExecutableResult = ExecutableDetectionResult;

type PathApi = Pick<
  typeof path,
  "dirname" | "join" | "normalize" | "resolve" | "basename"
>;

const AntigravityRelayConfigSchema = z.object({
  antigravity_executable: z.string().nullable().optional(),
  antigravity_ide_executable: z.string().nullable().optional(),
  antigravity_cli_executable: z.string().nullable().optional(),
  antigravity_args: z.array(z.string()).optional(),
  antigravity_ide_args: z.array(z.string()).optional(),
});

type AntigravityRelayConfig = z.infer<typeof AntigravityRelayConfigSchema>;

export interface PathResolutionOptions {
  platform?: NodeJS.Platform;
  isWsl?: boolean;
}

function getCurrentPlatform(options?: PathResolutionOptions): NodeJS.Platform {
  return options?.platform ?? process.platform;
}

function getCurrentPlatformPathApi(options?: PathResolutionOptions): PathApi {
  return getCurrentPlatform(options) === "win32" ? path.win32 : path.posix;
}

/**
 * Checks if the current platform is WSL.
 * @param {NodeJS.Platform} [platform] The platform to check, defaults to `process.platform`.
 * @returns {boolean} True if the current platform is WSL, false otherwise.
 */
export function isWsl(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  try {
    const version = fs.readFileSync("/proc/version", "utf-8").toLowerCase();
    return version.includes("microsoft") && version.includes("wsl");
  } catch {
    return false;
  }
}

function resolveIsWsl(options?: PathResolutionOptions): boolean {
  return options?.isWsl ?? isWsl(getCurrentPlatform(options));
}

let cachedWindowsUser: string | null = null;

export function clearCachedWindowsUser(): void {
  cachedWindowsUser = null;
}

/**
 * Gets the Windows username.
 * @returns {string} The Windows username.
 */
export function getWindowsUser(): string {
  if (cachedWindowsUser) {
    return cachedWindowsUser;
  }

  // Strategy 1: Try cmd.exe to get actual Windows username (most reliable for WSL)
  try {
    // We use execSync because this function needs to be synchronous
    // and it's usually called once or cached.
    const stdout = execSync(
      '/mnt/c/Windows/System32/cmd.exe /c "echo %USERNAME%"',
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    // Output might contain warnings about UNC paths, so we take the last line
    const lines = stdout.trim().split(/\r?\n/);
    const user = lines[lines.length - 1].trim();

    if (user) {
      cachedWindowsUser = user;
      return user;
    }
  } catch {
    // Ignore errors
  }

  // Strategy 2: Try to match current Linux username
  const linuxUser = os.userInfo().username;
  if (fs.existsSync(`/mnt/c/Users/${linuxUser}`)) {
    cachedWindowsUser = linuxUser;
    return linuxUser;
  }

  // Strategy 3: List users and pick first likely candidate
  try {
    const users = fs
      .readdirSync("/mnt/c/Users")
      .filter(
        (u) =>
          ![
            "Public",
            "Default",
            "Default User",
            "All Users",
            "desktop.ini",
          ].includes(u) &&
          fs.statSync(path.posix.join("/mnt/c/Users", u)).isDirectory(),
      );
    if (users.length > 0) {
      cachedWindowsUser = users[0];
      return users[0];
    }
  } catch {
    // Ignore errors when reading directory
  }

  return "User"; // Fallback
}

/**
 * Validates whether a candidate path points to an existing, executable binary file.
 * Wraps permission checks in try/catch to absorb EACCES/EPERM errors gracefully.
 */
export function validateExecutableBinary(
  candidatePath: string,
  options?: PathResolutionOptions,
): boolean {
  if (!candidatePath || typeof candidatePath !== "string") {
    return false;
  }
  try {
    if (!fs.existsSync(candidatePath)) {
      return false;
    }
    try {
      const stat = fs.statSync(candidatePath);
      if (stat && typeof stat.isFile === "function" && !stat.isFile()) {
        return false;
      }
    } catch (statErr: any) {
      if (statErr?.code === "ENOENT") {
        // mock test environment or transient race condition
      } else {
        return false;
      }
    }

    const platform = options?.platform ?? process.platform;
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
}

/**
 * Checks if a candidate path is inside a versioned Squirrel app subdirectory (e.g. app-1.2.3/).
 */
export function isSquirrelVersionedPath(candidatePath: string): boolean {
  if (!candidatePath || typeof candidatePath !== "string") {
    return false;
  }
  return /[\\/]app-\d[^\\/]*[\\/]/.test(candidatePath);
}

/**
 * Resolves a Squirrel root launcher path from a versioned app-x.y.z/ subdirectory path
 * if the root launcher exists in the parent directory.
 */
export function resolveSquirrelRootLauncher(candidatePath: string): string {
  if (!candidatePath || typeof candidatePath !== "string") {
    return candidatePath;
  }
  const match = candidatePath.match(/^(.*)[\\/]app-\d[^\\/]*[\\/]([^\\/]+)$/i);
  if (match) {
    const parentDir = match[1];
    const binaryName = match[2];
    const rootLauncher = path.win32.join(parentDir, binaryName);
    if (fs.existsSync(rootLauncher)) {
      return rootLauncher;
    }
  }
  return candidatePath;
}

/**
 * Sanitizes file paths for telemetry and logs, masking usernames to prevent PII leakage.
 */
export function maskUserPath(
  rawPath: string | null | undefined,
): string | null {
  if (!rawPath || typeof rawPath !== "string") {
    return null;
  }
  return rawPath
    .replace(/(Users[\\/])([^\\/]+)/gi, "$1***")
    .replace(/(home[\\/])([^\\/]+)/gi, "$1***");
}

function getAntigravityAppFolderName(
  target?: AntigravityAppTarget | null,
): string {
  return resolveAntigravityAppTarget(target) === "ide"
    ? "Antigravity IDE"
    : "Antigravity";
}

function appendUniquePath(
  paths: string[],
  targetPath: string | null | undefined,
): void {
  if (!targetPath || paths.includes(targetPath)) {
    return;
  }

  paths.push(targetPath);
}

function normalizeExecutablePath(
  executablePath: string,
  options?: PathResolutionOptions,
): string {
  let pathForComparison = executablePath;
  try {
    if (fs.existsSync(executablePath)) {
      pathForComparison = fs.realpathSync.native(executablePath);
    }
  } catch {
    pathForComparison = executablePath;
  }

  const pathApi = getCurrentPlatformPathApi(options);
  const normalizedPath = pathApi.normalize(pathForComparison).toLowerCase();

  if (getCurrentPlatform(options) === "win32") {
    return normalizedPath.replace(/\//g, "\\");
  }

  return normalizedPath;
}

function areExecutablePathsEquivalent(
  leftExecutablePath: string,
  rightExecutablePath: string,
  options?: PathResolutionOptions,
): boolean {
  const leftNormalized = normalizeExecutablePath(leftExecutablePath, options);
  const rightNormalized = normalizeExecutablePath(rightExecutablePath, options);

  if (getCurrentPlatform(options) === "darwin") {
    const leftAppIndex = leftNormalized.indexOf(".app");
    const rightAppIndex = rightNormalized.indexOf(".app");
    if (leftAppIndex >= 0 && rightAppIndex >= 0) {
      return (
        leftNormalized.slice(0, leftAppIndex + 4) ===
        rightNormalized.slice(0, rightAppIndex + 4)
      );
    }
  }

  return leftNormalized === rightNormalized;
}

function hasAntigravityIdeMarker(value: string): boolean {
  const normalizedValue = value.toLowerCase();
  return (
    normalizedValue.includes("antigravity ide") ||
    normalizedValue.includes("antigravity-ide")
  );
}

const ANTIGRAVITY_HELPER_PROCESS_NAME_PATTERNS = [
  "helper",
  "plugin",
  "renderer",
  "gpu",
  "crashpad",
  "utility",
  "audio",
  "sandbox",
  "language_server",
];

function isAntigravityHelperProcess(
  processName: string,
  commandLine: string,
): boolean {
  const normalizedProcessName = processName.toLowerCase();
  const normalizedCommandLine = commandLine.toLowerCase();

  if (
    normalizedCommandLine.includes("--type=") ||
    normalizedCommandLine.includes("crashpad")
  ) {
    return true;
  }

  return ANTIGRAVITY_HELPER_PROCESS_NAME_PATTERNS.some((pattern) =>
    normalizedProcessName.includes(pattern),
  );
}

export interface AntigravityProcessCandidate {
  name: string;
  commandLine: string;
  executablePath?: string;
}

export function isAgyProcessCandidate(
  processItem: AntigravityProcessCandidate,
  options?: PathResolutionOptions,
): boolean {
  const nameLower = processItem.name.toLowerCase();
  const configuredCliPath = getConfiguredAntigravityExecutablePath(
    "cli",
    false,
    options,
  );
  const commandExecutablePath =
    parseCommandLineArguments(processItem.commandLine)[0] || "";
  const commandBase = (
    commandExecutablePath.includes("\\")
      ? path.win32.basename(commandExecutablePath)
      : path.basename(commandExecutablePath)
  ).toLowerCase();
  const processExecutablePath = processItem.executablePath ?? "";

  return (
    nameLower === "agy" ||
    nameLower === "agy.exe" ||
    nameLower === "agy.cmd" ||
    commandBase === "agy" ||
    commandBase === "agy.exe" ||
    commandBase === "agy.cmd" ||
    (configuredCliPath !== null &&
      processExecutablePath !== "" &&
      areExecutablePathsEquivalent(
        configuredCliPath,
        processExecutablePath,
        options,
      )) ||
    (configuredCliPath !== null &&
      commandExecutablePath !== "" &&
      areExecutablePathsEquivalent(
        configuredCliPath,
        commandExecutablePath,
        options,
      ))
  );
}

export function isTargetAntigravityProcessCandidate(
  processItem: AntigravityProcessCandidate,
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  const normalizedTarget = resolveAntigravityAppTarget(target);
  const nameLower = processItem.name.toLowerCase();
  const cmdLower = processItem.commandLine.toLowerCase();
  const configuredClassicPath = getConfiguredAntigravityExecutablePath(
    "classic",
    false,
    options,
  );
  const configuredIdePath = getConfiguredAntigravityExecutablePath(
    "ide",
    false,
    options,
  );
  const strictConfiguredClassicPath = getConfiguredAntigravityExecutablePath(
    "classic",
    true,
    options,
  );
  const strictConfiguredIdePath = getConfiguredAntigravityExecutablePath(
    "ide",
    true,
    options,
  );
  const commandExecutablePath =
    parseCommandLineArguments(processItem.commandLine)[0] || "";
  const commandBase = (
    commandExecutablePath.includes("\\")
      ? path.win32.basename(commandExecutablePath)
      : path.basename(commandExecutablePath)
  ).toLowerCase();
  const processExecutablePath = processItem.executablePath ?? "";
  const executableIdentity = `${processItem.executablePath || ""} ${commandExecutablePath}`;
  const hasAntigravityProcessIdentity =
    nameLower.includes("antigravity") ||
    executableIdentity.toLowerCase().includes("antigravity");
  const matchesClassicPath =
    configuredClassicPath !== null &&
    processExecutablePath !== "" &&
    areExecutablePathsEquivalent(
      configuredClassicPath,
      processExecutablePath,
      options,
    );
  const matchesIdePath =
    configuredIdePath !== null &&
    processExecutablePath !== "" &&
    areExecutablePathsEquivalent(
      configuredIdePath,
      processExecutablePath,
      options,
    );
  const isIde =
    hasAntigravityIdeMarker(nameLower) ||
    hasAntigravityIdeMarker(executableIdentity) ||
    (hasAntigravityProcessIdentity && hasAntigravityIdeMarker(cmdLower)) ||
    matchesIdePath;

  if (isAntigravityHelperProcess(nameLower, cmdLower)) {
    return false;
  }

  const isAgyBinary = isAgyProcessCandidate(processItem, options);

  if (isAgyBinary) {
    return normalizedTarget === "cli" || normalizedTarget === ("agy" as any);
  }

  if (normalizedTarget === "cli" || normalizedTarget === ("agy" as any)) {
    return false;
  }

  if (
    nameLower.includes("relay") ||
    cmdLower.includes("relay") ||
    cmdLower.includes("antigravity-relay")
  ) {
    return false;
  }

  if (normalizedTarget === "ide") {
    if (matchesClassicPath) {
      return false;
    }
    if (strictConfiguredIdePath) {
      return matchesIdePath;
    }
    return isIde;
  }

  if (matchesIdePath) {
    return false;
  }
  if (strictConfiguredClassicPath) {
    return matchesClassicPath;
  }

  return (
    (nameLower.includes("antigravity") || cmdLower.includes("antigravity")) &&
    !isIde &&
    !nameLower.includes("manager") &&
    !cmdLower.includes("manager") &&
    !nameLower.includes("tools") &&
    !cmdLower.includes("tools")
  );
}

export function isConfiguredTargetExecutableProcessCandidate(
  processItem: AntigravityProcessCandidate,
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  const normalizedTarget = resolveAntigravityAppTarget(target);
  const executablePath = processItem.executablePath || "";
  if (!executablePath) {
    return false;
  }

  if (normalizedTarget === "cli") {
    const configuredCliPath = getConfiguredAntigravityExecutablePath(
      "cli",
      true,
      options,
    );
    return (
      configuredCliPath !== null &&
      areExecutablePathsEquivalent(configuredCliPath, executablePath, options)
    );
  }

  const configuredClassicPath = getConfiguredAntigravityExecutablePath(
    "classic",
    true,
    options,
  );
  const configuredIdePath = getConfiguredAntigravityExecutablePath(
    "ide",
    true,
    options,
  );
  const matchesClassicPath =
    configuredClassicPath !== null &&
    areExecutablePathsEquivalent(
      configuredClassicPath,
      executablePath,
      options,
    );
  const matchesIdePath =
    configuredIdePath !== null &&
    areExecutablePathsEquivalent(configuredIdePath, executablePath, options);

  if (normalizedTarget === "ide") {
    return matchesIdePath && !matchesClassicPath;
  }

  return matchesClassicPath && !matchesIdePath;
}

export function isTargetAntigravityExecutableProcessCandidate(
  processItem: AntigravityProcessCandidate,
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  const normalizedTarget = resolveAntigravityAppTarget(target);
  const oppositeTarget: AntigravityAppTarget =
    normalizedTarget === "ide" ? "classic" : "ide";
  const executablePath =
    processItem.executablePath ||
    resolveExecutablePathFromProcessInfo(null, processItem.commandLine);

  if (!executablePath) {
    return false;
  }

  const targetExecutablePath = getAntigravityExecutablePath(
    normalizedTarget,
    options,
  );
  if (!targetExecutablePath) {
    return false;
  }

  if (
    !areExecutablePathsEquivalent(targetExecutablePath, executablePath, options)
  ) {
    return false;
  }

  const oppositeExecutablePath = getAntigravityExecutablePath(
    oppositeTarget,
    options,
  );
  return !(
    oppositeExecutablePath &&
    areExecutablePathsEquivalent(
      oppositeExecutablePath,
      executablePath,
      options,
    )
  );
}

function parseCommandLineArguments(commandLine: string): string[] {
  const commandLineArguments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    const previous = index > 0 ? commandLine[index - 1] : "";

    if ((char === '"' || char === "'") && previous !== "\\") {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        commandLineArguments.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    commandLineArguments.push(current);
  }

  return commandLineArguments;
}

function extractUserDataDirectoryFromArgs(
  commandLineArguments: string[],
  options?: PathResolutionOptions,
): string | null {
  const pathApi = getCurrentPlatformPathApi(options);

  for (let index = 0; index < commandLineArguments.length; index += 1) {
    const argument = commandLineArguments[index];

    if (argument === "--user-data-dir" && commandLineArguments[index + 1]) {
      return pathApi.resolve(commandLineArguments[index + 1]);
    }

    if (argument.startsWith("--user-data-dir=")) {
      const userDataDir = argument.slice("--user-data-dir=".length);
      if (userDataDir) {
        return pathApi.resolve(userDataDir);
      }
    }
  }

  return null;
}

function resolveExecutablePathFromProcessInfo(
  executablePath: string | null | undefined,
  commandLine: string,
): string {
  if (executablePath) {
    return executablePath;
  }

  const executableCandidate = parseCommandLineArguments(commandLine)[0];
  if (!executableCandidate) {
    return "";
  }

  return executableCandidate;
}

export function readAntigravityRelayConfig(
  options?: PathResolutionOptions,
): AntigravityRelayConfig | null {
  const pathApi = getCurrentPlatformPathApi(options);
  const configPaths = [
    pathApi.join(getAgentDir(options), CONFIG_FILENAME),
    pathApi.join(getAppDataDir(undefined, options), CONFIG_FILENAME),
  ];

  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }

      const rawConfig: unknown = JSON.parse(
        fs.readFileSync(configPath, "utf-8"),
      );
      const parsedConfig = AntigravityRelayConfigSchema.safeParse(rawConfig);
      if (parsedConfig.success) {
        return parsedConfig.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export interface RunningAntigravityProcess {
  pid: number;
  name: string;
  executablePath: string;
  commandLine: string;
}

export interface RunningProcessCacheEntry {
  platform: NodeJS.Platform;
  target: CanonicalAntigravityAppTarget;
  checkedAt: number;
  processes: RunningAntigravityProcess[];
}

const PROCESS_SCAN_TIMEOUT_MS = 2500;
const PROCESS_SCAN_CACHE_MS = 60000;
const CONFIG_FILENAME = "gui_config.json";

export const runningProcessCache = new Map<
  CanonicalAntigravityAppTarget,
  RunningProcessCacheEntry
>();

export function clearRunningProcessCache(): void {
  runningProcessCache.clear();
}

interface RefreshProcessCacheOptions extends PathResolutionOptions {
  includeAllProcesses?: boolean;
}

function processInfoToRunningProcess(
  processInfo: ProcessInfo,
): RunningAntigravityProcess {
  const commandLine = processInfo.cmd || processInfo.name || "";
  return {
    pid: processInfo.pid,
    name: processInfo.name || "",
    executablePath: resolveExecutablePathFromProcessInfo(
      processInfo.bin,
      commandLine,
    ),
    commandLine,
  };
}

function getProcessSearchNames(
  target?: AntigravityAppTarget | null,
  includeAllProcesses = false,
): string[] {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const searchNames =
    resolvedTarget === "ide"
      ? ["Antigravity IDE", "antigravity-ide", "Antigravity", "antigravity"]
      : resolvedTarget === "cli"
        ? ["agy", "agy.exe"]
        : ["Antigravity", "antigravity"];

  if (includeAllProcesses) {
    searchNames.push("");
  }

  return searchNames;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("process_scan_timeout"));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export async function refreshAntigravityProcessCache(
  target?: AntigravityAppTarget | null,
  options: RefreshProcessCacheOptions = {},
): Promise<void> {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const processMap = new Map<number, RunningAntigravityProcess>();
  const searchNames = getProcessSearchNames(
    target,
    options.includeAllProcesses,
  );
  const startTime = Date.now();

  try {
    await withTimeout(
      (async () => {
        for (const searchName of searchNames) {
          const elapsed = Date.now() - startTime;
          const remaining = PROCESS_SCAN_TIMEOUT_MS - elapsed;
          if (remaining <= 0) {
            break;
          }

          try {
            const matches = await withTimeout(
              findProcess("name", searchName, {
                strict: false,
                logLevel: "error",
              }),
              remaining,
            );

            for (const processInfo of matches) {
              const runningProcess = processInfoToRunningProcess(processInfo);
              if (
                runningProcess.pid > 0 &&
                isTargetAntigravityProcessCandidate(
                  runningProcess,
                  target,
                  options,
                )
              ) {
                processMap.set(runningProcess.pid, runningProcess);
              }
            }
          } catch {
            // Process discovery is opportunistic. Standard and portable path fallbacks still apply.
          }
        }
      })(),
      PROCESS_SCAN_TIMEOUT_MS,
    );
  } catch {
    // Process discovery is opportunistic. Standard and portable path fallbacks still apply.
  }

  runningProcessCache.set(resolvedTarget, {
    platform: getCurrentPlatform(options),
    target: resolvedTarget,
    checkedAt: Date.now(),
    processes: Array.from(processMap.values()),
  });
}

const FAST_PROCESS_SCAN_TIMEOUT_MS = 1500;

/**
 * Performs a single-pass process inspection snapshot across all targets (app, ide, cli),
 * updating their respective runningProcessCache entries with a strict 1.5s timeout.
 */
export async function refreshAllAntigravityProcessCaches(
  options: RefreshProcessCacheOptions = {},
): Promise<void> {
  const currentPlatform = getCurrentPlatform(options);
  const searchNames = [
    "Antigravity IDE",
    "antigravity-ide",
    "Antigravity",
    "antigravity",
    "agy",
    "agy.exe",
  ];
  if (options.includeAllProcesses) {
    searchNames.push("");
  }

  const appProcesses = new Map<number, RunningAntigravityProcess>();
  const ideProcesses = new Map<number, RunningAntigravityProcess>();
  const cliProcesses = new Map<number, RunningAntigravityProcess>();
  const startTime = Date.now();

  try {
    await withTimeout(
      (async () => {
        for (const searchName of searchNames) {
          const elapsed = Date.now() - startTime;
          const remaining = FAST_PROCESS_SCAN_TIMEOUT_MS - elapsed;
          if (remaining <= 0) {
            break;
          }

          try {
            const matches = await withTimeout(
              findProcess("name", searchName, {
                strict: false,
                logLevel: "error",
              }),
              remaining,
            );

            for (const processInfo of matches) {
              const runningProcess = processInfoToRunningProcess(processInfo);
              if (runningProcess.pid <= 0) continue;

              if (
                isTargetAntigravityProcessCandidate(
                  runningProcess,
                  "ide",
                  options,
                )
              ) {
                ideProcesses.set(runningProcess.pid, runningProcess);
              }
              if (
                isTargetAntigravityProcessCandidate(
                  runningProcess,
                  "app",
                  options,
                )
              ) {
                appProcesses.set(runningProcess.pid, runningProcess);
              }
              if (
                isTargetAntigravityProcessCandidate(
                  runningProcess,
                  "cli",
                  options,
                )
              ) {
                cliProcesses.set(runningProcess.pid, runningProcess);
              }
            }
          } catch {
            // Process discovery is opportunistic. Standard and portable path fallbacks still apply.
          }
        }
      })(),
      FAST_PROCESS_SCAN_TIMEOUT_MS,
    );
  } catch {
    // Process discovery is opportunistic. Standard and portable path fallbacks still apply.
  }

  const now = Date.now();
  runningProcessCache.set("app", {
    platform: currentPlatform,
    target: "app",
    checkedAt: now,
    processes: Array.from(appProcesses.values()),
  });
  runningProcessCache.set("ide", {
    platform: currentPlatform,
    target: "ide",
    checkedAt: now,
    processes: Array.from(ideProcesses.values()),
  });
  runningProcessCache.set("cli", {
    platform: currentPlatform,
    target: "cli",
    checkedAt: now,
    processes: Array.from(cliProcesses.values()),
  });
}

export function getRunningAntigravityProcesses(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): RunningAntigravityProcess[] {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const now = Date.now();
  const currentPlatform = getCurrentPlatform(options);
  const entry = runningProcessCache.get(resolvedTarget);

  if (
    entry &&
    entry.platform === currentPlatform &&
    entry.target === resolvedTarget &&
    now - entry.checkedAt < PROCESS_SCAN_CACHE_MS
  ) {
    return entry.processes;
  }

  return [];
}

export function isAntigravityProcessRunning(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  return getRunningAntigravityProcesses(target, options).length > 0;
}

function getUserDataDirFromRunningProcess(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string | null {
  const configuredUserDataDir = extractUserDataDirectoryFromArgs(
    getConfiguredAntigravityArgs(target, options),
    options,
  );
  if (configuredUserDataDir && fs.existsSync(configuredUserDataDir)) {
    return configuredUserDataDir;
  }

  for (const commandLineArguments of getAntigravityArgsFromRunningProcess(
    target,
    options,
  )) {
    const userDataDir = extractUserDataDirectoryFromArgs(
      commandLineArguments,
      options,
    );
    if (userDataDir && fs.existsSync(userDataDir)) {
      return userDataDir;
    }
  }

  return null;
}

function getExecutablePathFromRunningProcess(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string | null {
  for (const processItem of getRunningAntigravityProcesses(target, options)) {
    if (
      processItem.executablePath &&
      fs.existsSync(processItem.executablePath)
    ) {
      return processItem.executablePath;
    }
  }

  return null;
}

export function getAntigravityArgsFromRunningProcess(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[][] {
  return getRunningAntigravityProcesses(target, options)
    .map((processItem) => parseCommandLineArguments(processItem.commandLine))
    .filter((commandLineArguments) => commandLineArguments.length > 0);
}

export function getAntigravityLaunchArgsFromRunningProcess(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[] {
  return (
    getAntigravityArgsFromRunningProcess(target, options)[0]?.slice(1) || []
  );
}

export function getConfiguredAntigravityArgs(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[] {
  const rawConfig = readAntigravityRelayConfig(options);
  const configKey =
    resolveAntigravityAppTarget(target) === "ide"
      ? "antigravity_ide_args"
      : "antigravity_args";
  const configuredArgs = rawConfig?.[configKey];

  return configuredArgs ?? [];
}

export function getConfiguredAntigravityExecutablePath(
  target?: AntigravityAppTarget | null,
  requireExists = true,
  options?: PathResolutionOptions,
): string | null {
  const rawConfig = readAntigravityRelayConfig(options);
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const configKey =
    resolvedTarget === "ide"
      ? "antigravity_ide_executable"
      : resolvedTarget === "cli"
        ? "antigravity_cli_executable"
        : "antigravity_executable";
  const configuredPath = rawConfig?.[configKey];

  const executablePath = configuredPath?.trim();
  if (!executablePath) {
    return null;
  }
  if (requireExists && !fs.existsSync(executablePath)) {
    return null;
  }

  return executablePath;
}

function pushUserDataDbPaths(
  paths: string[],
  userDataDir: string,
  pathApi: PathApi,
): void {
  appendUniquePath(
    paths,
    pathApi.join(userDataDir, "User", "globalStorage", "state.vscdb"),
  );
  appendUniquePath(paths, pathApi.join(userDataDir, "User", "state.vscdb"));
  appendUniquePath(paths, pathApi.join(userDataDir, "state.vscdb"));
}

function pushUserDataStoragePaths(
  paths: string[],
  userDataDir: string,
  pathApi: PathApi,
): void {
  appendUniquePath(
    paths,
    pathApi.join(userDataDir, "User", "globalStorage", "storage.json"),
  );
  appendUniquePath(paths, pathApi.join(userDataDir, "User", "storage.json"));
  appendUniquePath(paths, pathApi.join(userDataDir, "storage.json"));
}

function pushExistingUserDataDbPaths(
  paths: string[],
  userDataDir: string,
  pathApi: PathApi,
): void {
  const candidates: string[] = [];
  pushUserDataDbPaths(candidates, userDataDir, pathApi);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      appendUniquePath(paths, candidate);
    }
  }
}

function pushExistingUserDataStoragePaths(
  paths: string[],
  userDataDir: string,
  pathApi: PathApi,
): void {
  const candidates: string[] = [];
  pushUserDataStoragePaths(candidates, userDataDir, pathApi);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      appendUniquePath(paths, candidate);
    }
  }
}

function getPortableUserDataDir(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string | null {
  const executablePath = getAntigravityExecutablePath(target, options);
  if (!executablePath) {
    return null;
  }

  const pathApi = getCurrentPlatformPathApi(options);
  const userDataDir = pathApi.join(
    pathApi.dirname(executablePath),
    "data",
    "user-data",
  );

  if (getCurrentPlatform(options) !== "win32") {
    try {
      fs.accessSync(userDataDir, fs.constants.W_OK);
    } catch {
      return null;
    }
  }

  return userDataDir;
}

export function getAppDataDir(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const home = os.homedir();
  const folderName = getAntigravityAppFolderName(target);

  if (resolveIsWsl(options)) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/AppData/Roaming/${folderName}`;
  }

  switch (getCurrentPlatform(options)) {
    case "darwin":
      return path.posix.join(
        home,
        "Library",
        "Application Support",
        folderName,
      );
    case "win32":
      return path.win32.join(
        process.env.APPDATA || path.win32.join(home, "AppData", "Roaming"),
        folderName,
      );
    case "linux":
      return path.posix.join(home, ".config", folderName);
    default:
      return path.posix.join(home, ".antigravity");
  }
}

export function getAgentDir(options?: PathResolutionOptions): string {
  return getCurrentPlatformPathApi(options).join(
    os.homedir(),
    ".antigravity-relay",
  );
}

export function getAccountsFilePath(options?: PathResolutionOptions): string {
  return getCurrentPlatformPathApi(options).join(
    getAgentDir(options),
    "antigravity_accounts.json",
  );
}

export function getBackupsDir(options?: PathResolutionOptions): string {
  return getCurrentPlatformPathApi(options).join(
    getAgentDir(options),
    "backups",
  );
}

/** Directory holding proxy state that has to survive an app restart. */
export function getProxyStateDir(options?: PathResolutionOptions): string {
  return getCurrentPlatformPathApi(options).join(
    getAgentDir(options),
    "proxy-state",
  );
}

export function getCloudAccountsDbPath(
  options?: PathResolutionOptions,
): string {
  return getCurrentPlatformPathApi(options).join(
    getAgentDir(options),
    "cloud_accounts.db",
  );
}

export function getAntigravityConversationsDir(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli") {
    return "";
  }
  const subfolder =
    resolvedTarget === "ide" ? "antigravity-ide" : "antigravity";

  if (resolveIsWsl(options)) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/.gemini/${subfolder}/conversations`;
  }

  const home = os.homedir();
  if (getCurrentPlatform(options) === "win32") {
    return path.win32.join(home, ".gemini", subfolder, "conversations");
  }

  return path.posix.join(home, ".gemini", subfolder, "conversations");
}

export function getAntigravityBrainDir(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli") {
    return "";
  }
  const subfolder =
    resolvedTarget === "ide" ? "antigravity-ide" : "antigravity";

  if (resolveIsWsl(options)) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/.gemini/${subfolder}/brain`;
  }

  const home = os.homedir();
  if (getCurrentPlatform(options) === "win32") {
    return path.win32.join(home, ".gemini", subfolder, "brain");
  }

  return path.posix.join(home, ".gemini", subfolder, "brain");
}

export function getAntigravityAnnotationsDir(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli") {
    return "";
  }
  const subfolder =
    resolvedTarget === "ide" ? "antigravity-ide" : "antigravity";

  if (resolveIsWsl(options)) {
    const winUser = getWindowsUser();
    return `/mnt/c/Users/${winUser}/.gemini/${subfolder}/annotations`;
  }

  const home = os.homedir();
  if (getCurrentPlatform(options) === "win32") {
    return path.win32.join(home, ".gemini", subfolder, "annotations");
  }

  return path.posix.join(home, ".gemini", subfolder, "annotations");
}

export function getAntigravityConversationDbPaths(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[] {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli") {
    return [];
  }

  const dir = getAntigravityConversationsDir(target, options);
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }

  try {
    const pathApi = getCurrentPlatformPathApi(options);
    const entries = fs.readdirSync(dir);
    const dbFiles: Array<{ fullPath: string; mtimeMs: number }> = [];

    for (const entry of entries) {
      if (
        entry.endsWith(".db") &&
        !entry.endsWith("-wal") &&
        !entry.endsWith("-shm")
      ) {
        const fullPath = pathApi.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          let mtimeMs = stat.mtimeMs;
          const walPath = `${fullPath}-wal`;
          if (fs.existsSync(walPath)) {
            try {
              const walStat = fs.statSync(walPath);
              mtimeMs = Math.max(mtimeMs, walStat.mtimeMs);
            } catch {
              // Ignore wal stat errors
            }
          }
          dbFiles.push({ fullPath, mtimeMs });
        } catch {
          // Ignore transient file errors
        }
      }
    }

    dbFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const annotDir = getAntigravityAnnotationsDir(target, options);
    const hasAnnotDir = annotDir && fs.existsSync(annotDir);

    if (hasAnnotDir) {
      const topLevelFiles: string[] = [];
      for (const file of dbFiles) {
        const cascadeId = pathApi.basename(file.fullPath, ".db");
        const pbtxtPath = pathApi.join(annotDir, `${cascadeId}.pbtxt`);
        if (fs.existsSync(pbtxtPath)) {
          try {
            const content = fs.readFileSync(pbtxtPath, "utf-8");
            if (content.includes("title:")) {
              topLevelFiles.push(file.fullPath);
              if (topLevelFiles.length >= 10) {
                break;
              }
            }
          } catch {
            // Ignore read errors
          }
        }
      }

      if (topLevelFiles.length > 0) {
        return topLevelFiles;
      }
    }

    return dbFiles.slice(0, 10).map((f) => f.fullPath);
  } catch {
    return [];
  }
}

export function getAntigravityDbPaths(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[] {
  const appData = getAppDataDir(target, options);
  const paths: string[] = [];
  const home = os.homedir();
  const folderName = getAntigravityAppFolderName(target);
  const pathApi = getCurrentPlatformPathApi(options);
  const userDataDir = getUserDataDirFromRunningProcess(target, options);
  const portableUserDataDir = getPortableUserDataDir(target, options);

  if (userDataDir) {
    pushExistingUserDataDbPaths(paths, userDataDir, pathApi);
  }

  if (portableUserDataDir) {
    pushExistingUserDataDbPaths(paths, portableUserDataDir, pathApi);
  }

  if (resolveIsWsl(options)) {
    // Assume standard structure: AppData/Roaming/Antigravity/User/globalStorage/state.vscdb
    // appData is already resolved to Roaming/Antigravity in getAppDataDir()
    pushUserDataDbPaths(paths, appData, path.posix);
    return paths;
  }

  if (getCurrentPlatform(options) === "linux") {
    pushUserDataDbPaths(paths, appData, path.posix);
    return paths;
  }

  if (getCurrentPlatform(options) === "darwin") {
    // Standard path
    appendUniquePath(
      paths,
      path.posix.join(
        home,
        "Library",
        "Application Support",
        folderName,
        "User",
        "globalStorage",
        "state.vscdb",
      ),
    );
    // Fallback path
    appendUniquePath(
      paths,
      path.posix.join(
        home,
        "Library",
        "Application Support",
        folderName,
        "state.vscdb",
      ),
    );
    return paths;
  }

  // Windows
  // Standard path
  appendUniquePath(
    paths,
    path.win32.join(appData, "User", "globalStorage", "state.vscdb"),
  );
  // Fallback paths
  appendUniquePath(paths, path.win32.join(appData, "User", "state.vscdb"));
  appendUniquePath(paths, path.win32.join(appData, "state.vscdb"));

  return paths;
}

export function getAntigravityStoragePaths(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string[] {
  const appData = getAppDataDir(target, options);
  const paths: string[] = [];
  const home = os.homedir();
  const folderName = getAntigravityAppFolderName(target);
  const pathApi = getCurrentPlatformPathApi(options);
  const userDataDir = getUserDataDirFromRunningProcess(target, options);
  const portableUserDataDir = getPortableUserDataDir(target, options);

  if (userDataDir) {
    pushExistingUserDataStoragePaths(paths, userDataDir, pathApi);
  }

  if (portableUserDataDir) {
    pushExistingUserDataStoragePaths(paths, portableUserDataDir, pathApi);
  }

  if (resolveIsWsl(options)) {
    pushUserDataStoragePaths(paths, appData, path.posix);
    return paths;
  }

  if (getCurrentPlatform(options) === "linux") {
    pushUserDataStoragePaths(paths, appData, path.posix);
    return paths;
  }

  if (getCurrentPlatform(options) === "darwin") {
    appendUniquePath(
      paths,
      path.posix.join(
        home,
        "Library",
        "Application Support",
        folderName,
        "User",
        "globalStorage",
        "storage.json",
      ),
    );
    appendUniquePath(
      paths,
      path.posix.join(
        home,
        "Library",
        "Application Support",
        folderName,
        "storage.json",
      ),
    );
    return paths;
  }

  appendUniquePath(
    paths,
    path.win32.join(appData, "User", "globalStorage", "storage.json"),
  );
  appendUniquePath(paths, path.win32.join(appData, "User", "storage.json"));
  appendUniquePath(paths, path.win32.join(appData, "storage.json"));
  return paths;
}

export function getAntigravityStoragePath(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const paths = getAntigravityStoragePaths(target, options);
  return paths.length > 0 ? paths[0] : "";
}

/**
 * Whether the target has a storage.json on disk. Callers that rewrite storage.json use this to skip
 * a target whose desktop app was never installed, instead of failing with storage_json_not_found.
 */
export function hasAntigravityStorage(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli" || resolvedTarget === ("agy" as any)) {
    const home = os.homedir();
    const pathApi = getCurrentPlatformPathApi(options);
    const sessionDir = pathApi.join(home, ".gemini", "antigravity-cli");
    const tokenFile = pathApi.join(sessionDir, "antigravity-oauth-token");
    return fs.existsSync(tokenFile) || fs.existsSync(sessionDir);
  }

  if (
    getAntigravityStoragePaths(target, options).some((candidate) =>
      fs.existsSync(candidate),
    )
  ) {
    return true;
  }
  return getAntigravityDbPaths(target, options).some((candidate) =>
    fs.existsSync(candidate),
  );
}

// Keep for backward compatibility if needed, but prefer getAntigravityDbPaths
export function getAntigravityDbPath(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const paths = getAntigravityDbPaths(target, options);
  return paths.length > 0 ? paths[0] : "";
}

const lastKnownExecutablePathByTarget = new Map<AntigravityAppTarget, string>();

export function rememberRunningExecutablePath(
  target?: AntigravityAppTarget | null,
  executablePath?: string | null,
): void {
  if (!executablePath || typeof executablePath !== "string") {
    return;
  }
  const trimmed = executablePath.trim();
  if (!trimmed) {
    return;
  }
  const resolvedTarget = resolveAntigravityAppTarget(target);
  lastKnownExecutablePathByTarget.set(resolvedTarget, trimmed);
}

export function getLastKnownAntigravityExecutablePath(
  target?: AntigravityAppTarget | null,
): string | null {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  return lastKnownExecutablePathByTarget.get(resolvedTarget) ?? null;
}

export function clearLastKnownAntigravityExecutablePaths(): void {
  lastKnownExecutablePathByTarget.clear();
}

function getWindowsPossibleExecutablePaths(
  target: AntigravityAppTarget,
): string[] {
  const executableName = getAntigravityAppFolderName(target);
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 =
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const possiblePaths: string[] = [];

  if (localAppData) {
    possiblePaths.push(
      path.win32.join(
        localAppData,
        "Programs",
        executableName,
        `${executableName}.exe`,
      ),
      path.win32.join(
        localAppData,
        "Programs",
        "Google",
        executableName,
        `${executableName}.exe`,
      ),
      path.win32.join(
        localAppData,
        "Google",
        executableName,
        `${executableName}.exe`,
      ),
      path.win32.join(localAppData, executableName, `${executableName}.exe`),
    );

    if (target === "ide") {
      possiblePaths.push(
        path.win32.join(
          localAppData,
          "Programs",
          "antigravity-ide",
          "antigravity-ide.exe",
        ),
        path.win32.join(
          localAppData,
          "Programs",
          "antigravity-ide",
          "Antigravity IDE.exe",
        ),
        path.win32.join(
          localAppData,
          "Programs",
          "Google",
          "antigravity-ide",
          "antigravity-ide.exe",
        ),
        path.win32.join(
          localAppData,
          "Google",
          "antigravity-ide",
          "antigravity-ide.exe",
        ),
        path.win32.join(localAppData, "antigravity-ide", "antigravity-ide.exe"),
      );
    } else {
      possiblePaths.push(
        path.win32.join(
          localAppData,
          "Programs",
          "antigravity",
          "antigravity.exe",
        ),
        path.win32.join(
          localAppData,
          "Programs",
          "Google",
          "antigravity",
          "antigravity.exe",
        ),
        path.win32.join(
          localAppData,
          "Google",
          "antigravity",
          "antigravity.exe",
        ),
        path.win32.join(localAppData, "antigravity", "antigravity.exe"),
      );
    }
  }

  for (const pfRoot of [programFiles, programFilesX86]) {
    if (!pfRoot) continue;
    possiblePaths.push(
      path.win32.join(pfRoot, executableName, `${executableName}.exe`),
      path.win32.join(
        pfRoot,
        "Google",
        executableName,
        `${executableName}.exe`,
      ),
    );
    if (target === "ide") {
      possiblePaths.push(
        path.win32.join(pfRoot, "antigravity-ide", "antigravity-ide.exe"),
        path.win32.join(pfRoot, "antigravity-ide", "Antigravity IDE.exe"),
        path.win32.join(
          pfRoot,
          "Google",
          "antigravity-ide",
          "antigravity-ide.exe",
        ),
      );
    } else {
      possiblePaths.push(
        path.win32.join(pfRoot, "antigravity", "antigravity.exe"),
        path.win32.join(pfRoot, "Google", "antigravity", "antigravity.exe"),
      );
    }
  }

  return possiblePaths;
}

function getWindowsPathEnvironmentExecutable(
  target: AntigravityAppTarget,
): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const binaryNames =
    target === "ide"
      ? ["Antigravity IDE.exe", "antigravity-ide.exe", "antigravity-ide.cmd"]
      : ["Antigravity.exe", "antigravity.exe"];

  const pathDirs = pathValue.split(";");
  for (const dir of pathDirs) {
    const trimmedDir = dir.trim();
    if (!trimmedDir) {
      continue;
    }
    for (const binaryName of binaryNames) {
      const candidate = path.win32.join(trimmedDir, binaryName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getWslPossibleExecutablePaths(
  winUser: string,
  target: AntigravityAppTarget,
): string[] {
  const executableName = getAntigravityAppFolderName(target);
  const userBase = `/mnt/c/Users/${winUser}/AppData/Local`;
  const candidates: string[] = [
    `${userBase}/Programs/${executableName}/${executableName}.exe`,
    `${userBase}/Programs/Google/${executableName}/${executableName}.exe`,
    `${userBase}/Google/${executableName}/${executableName}.exe`,
    `${userBase}/${executableName}/${executableName}.exe`,
  ];

  if (target === "ide") {
    candidates.push(
      `${userBase}/Programs/antigravity-ide/antigravity-ide.exe`,
      `${userBase}/Programs/antigravity-ide/Antigravity IDE.exe`,
      `${userBase}/Programs/Google/antigravity-ide/antigravity-ide.exe`,
      `${userBase}/Google/antigravity-ide/antigravity-ide.exe`,
      `${userBase}/antigravity-ide/antigravity-ide.exe`,
    );
  } else {
    candidates.push(
      `${userBase}/Programs/antigravity/antigravity.exe`,
      `${userBase}/Programs/Google/antigravity/antigravity.exe`,
      `${userBase}/Google/antigravity/antigravity.exe`,
      `${userBase}/antigravity/antigravity.exe`,
    );
  }

  for (const pfRoot of ["/mnt/c/Program Files", "/mnt/c/Program Files (x86)"]) {
    candidates.push(
      `${pfRoot}/${executableName}/${executableName}.exe`,
      `${pfRoot}/Google/${executableName}/${executableName}.exe`,
    );
    if (target === "ide") {
      candidates.push(
        `${pfRoot}/antigravity-ide/antigravity-ide.exe`,
        `${pfRoot}/antigravity-ide/Antigravity IDE.exe`,
        `${pfRoot}/Google/antigravity-ide/antigravity-ide.exe`,
      );
    } else {
      candidates.push(
        `${pfRoot}/antigravity/antigravity.exe`,
        `${pfRoot}/Google/antigravity/antigravity.exe`,
      );
    }
  }

  return candidates;
}

export function getDarwinPossibleExecutablePaths(
  target: AntigravityAppTarget,
): string[] {
  const executableName = getAntigravityAppFolderName(target);
  const home = os.homedir();
  const candidates = [
    `/Applications/${executableName}.app/Contents/MacOS/${executableName}`,
    path.posix.join(
      home,
      "Applications",
      `${executableName}.app`,
      "Contents",
      "MacOS",
      executableName,
    ),
  ];
  if (resolveAntigravityAppTarget(target) === "ide") {
    candidates.push(
      "/Applications/Antigravity IDE.app/Contents/MacOS/antigravity-ide",
      path.posix.join(
        home,
        "Applications",
        "Antigravity IDE.app",
        "Contents",
        "MacOS",
        "antigravity-ide",
      ),
    );
  }
  return candidates;
}

export function getLinuxPossibleExecutablePaths(
  target: AntigravityAppTarget,
): string[] {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const home = os.homedir();
  if (resolvedTarget === "ide") {
    return [
      "/usr/bin/antigravity-ide",
      "/usr/local/bin/antigravity-ide",
      "/opt/Antigravity IDE/antigravity-ide",
      "/opt/antigravity-ide/antigravity-ide",
      path.posix.join(
        home,
        ".local",
        "share",
        "antigravity-ide",
        "antigravity-ide",
      ),
    ];
  }
  return [
    "/usr/bin/antigravity",
    "/usr/local/bin/antigravity",
    "/usr/share/antigravity/antigravity",
    "/opt/Antigravity/antigravity",
    "/opt/antigravity/antigravity",
    path.posix.join(home, ".local", "share", "antigravity", "antigravity"),
  ];
}

function getPosixPathEnvironmentExecutable(
  target: AntigravityAppTarget,
  options?: PathResolutionOptions,
): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const binaryNames =
    resolvedTarget === "ide"
      ? ["antigravity-ide", "Antigravity IDE"]
      : ["antigravity", "Antigravity"];

  const pathDirs = pathValue.split(":");
  for (const dir of pathDirs) {
    const trimmedDir = dir.trim();
    if (!trimmedDir) {
      continue;
    }
    for (const binaryName of binaryNames) {
      const candidate = path.posix.join(trimmedDir, binaryName);
      if (validateExecutableBinary(candidate, options)) {
        return candidate;
      }
    }
  }
  return null;
}

function isCandidateInPathEnv(
  candidatePath: string,
  options?: PathResolutionOptions,
): boolean {
  const pathEnv = process.env.PATH;
  if (!pathEnv || !candidatePath) {
    return false;
  }
  const platform = getCurrentPlatform(options);
  const delimiter = platform === "win32" ? ";" : ":";
  const pathApi = getCurrentPlatformPathApi(options);
  const candidateDir = pathApi.dirname(candidatePath).toLowerCase();
  return pathEnv
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => pathApi.normalize(dir).toLowerCase() === candidateDir);
}

export function getAntigravityExecutablePath(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): string {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  if (resolvedTarget === "cli" || resolvedTarget === ("agy" as any)) {
    const configuredPath =
      readAntigravityRelayConfig(options)?.antigravity_cli_executable ?? null;
    return (
      detectAgyCliExecutablePath({
        platform: getCurrentPlatform(options),
        configuredPath,
        isWsl: resolveIsWsl(options),
        windowsUser: getWindowsUser(),
      }) ?? ""
    );
  }
  const executableName = getAntigravityAppFolderName(target);
  let runningExecutablePath = getExecutablePathFromRunningProcess(
    target,
    options,
  );

  if (runningExecutablePath) {
    if (getCurrentPlatform(options) === "win32" || resolveIsWsl(options)) {
      runningExecutablePath = resolveSquirrelRootLauncher(
        runningExecutablePath,
      );
    }
    rememberRunningExecutablePath(resolvedTarget, runningExecutablePath);
    return runningExecutablePath;
  }

  const configuredExecutablePath = getConfiguredAntigravityExecutablePath(
    resolvedTarget,
    undefined,
    options,
  );
  if (configuredExecutablePath) {
    return configuredExecutablePath;
  }

  const lastKnownExecutablePath =
    getLastKnownAntigravityExecutablePath(resolvedTarget);
  if (lastKnownExecutablePath && fs.existsSync(lastKnownExecutablePath)) {
    return lastKnownExecutablePath;
  }

  if (resolveIsWsl(options)) {
    const winUser = getWindowsUser();
    const wslCandidates = getWslPossibleExecutablePaths(
      winUser,
      resolvedTarget,
    );
    for (const candidate of wslCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return `/mnt/c/Users/${winUser}/AppData/Local/Programs/${executableName}/${executableName}.exe`;
  }

  switch (getCurrentPlatform(options)) {
    case "darwin": {
      const candidates = getDarwinPossibleExecutablePaths(resolvedTarget);
      for (const candidate of candidates) {
        if (validateExecutableBinary(candidate, options)) {
          return candidate;
        }
      }
      return "";
    }
    case "win32": {
      const possiblePaths = getWindowsPossibleExecutablePaths(
        resolvedTarget,
      ).filter((c) => !isSquirrelVersionedPath(c));
      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          return possiblePath;
        }
      }

      const fromPath = getWindowsPathEnvironmentExecutable(resolvedTarget);
      if (fromPath) {
        return fromPath;
      }

      // No known path found; return empty string (caller must handle missing binary)
      return "";
    }
    case "linux": {
      const possibleLinuxPaths =
        getLinuxPossibleExecutablePaths(resolvedTarget);

      for (const possiblePath of possibleLinuxPaths) {
        if (validateExecutableBinary(possiblePath, options)) {
          return possiblePath;
        }
      }

      // Fallback: try `which antigravity` via path lookup
      const binaryName =
        resolvedTarget === "ide" ? "antigravity-ide" : "antigravity";
      const fromPath = process.env.PATH?.split(":")
        .map((dir) => path.posix.join(dir, binaryName))
        .find((possiblePath) =>
          validateExecutableBinary(possiblePath, options),
        );
      if (fromPath) {
        return fromPath;
      }

      // No known path found; return empty string (caller must handle missing binary)
      return "";
    }
    default:
      return "";
  }
}

export interface DetectExecutableOptions extends PathResolutionOptions {
  bypassConfig?: boolean;
  skipProcessRefresh?: boolean;
}

export async function detectAntigravityExecutablePath(
  target?: AntigravityAppTarget | null,
  options: DetectExecutableOptions = {},
): Promise<DetectedExecutableResult> {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const configuredPath = getConfiguredAntigravityExecutablePath(
    resolvedTarget,
    false,
    options,
  );
  const configuredPathExists = configuredPath
    ? validateExecutableBinary(configuredPath, options)
    : false;
  const bypassConfig = options.bypassConfig ?? true;

  // 1. If bypassConfig is false, check currently configured path
  if (!bypassConfig && configuredPath && configuredPathExists) {
    return {
      target: resolvedTarget,
      detectedPath: configuredPath,
      source: "config",
      configuredPath,
      configuredPathExists,
      alreadySet: true,
      status: "already_set",
    };
  }

  // 2. Refresh process cache if not skipped
  if (!options.skipProcessRefresh) {
    await refreshAntigravityProcessCache(resolvedTarget, options);
  }

  // 3. Inspect running processes
  let runningExecutablePath = getExecutablePathFromRunningProcess(
    resolvedTarget,
    options,
  );
  if (runningExecutablePath) {
    if (getCurrentPlatform(options) === "win32" || resolveIsWsl(options)) {
      runningExecutablePath = resolveSquirrelRootLauncher(
        runningExecutablePath,
      );
    }
    if (validateExecutableBinary(runningExecutablePath, options)) {
      rememberRunningExecutablePath(resolvedTarget, runningExecutablePath);
      const alreadySet =
        configuredPath !== null &&
        areExecutablePathsEquivalent(
          configuredPath,
          runningExecutablePath,
          options,
        );
      return {
        target: resolvedTarget,
        detectedPath: runningExecutablePath,
        source: "process",
        configuredPath,
        configuredPathExists,
        alreadySet,
        status: alreadySet ? "already_set" : "detected",
      };
    }
  }

  // 4. Candidate directories based on target and platform
  if (resolvedTarget === "cli") {
    const cliDetected = detectAgyCliExecutablePath({
      bypassConfig,
      configuredPath,
      platform: getCurrentPlatform(options),
      isWsl: resolveIsWsl(options),
      windowsUser: getWindowsUser(),
    });
    if (cliDetected && validateExecutableBinary(cliDetected, options)) {
      const alreadySet =
        configuredPath !== null &&
        areExecutablePathsEquivalent(configuredPath, cliDetected, options);
      const source = isCandidateInPathEnv(cliDetected, options)
        ? "path"
        : "filesystem";
      return {
        target: "cli",
        detectedPath: cliDetected,
        source,
        configuredPath,
        configuredPathExists,
        alreadySet,
        status: alreadySet ? "already_set" : "detected",
      };
    }
  } else {
    const candidates: string[] = [];
    if (resolveIsWsl(options)) {
      const winUser = getWindowsUser();
      candidates.push(
        ...getWslPossibleExecutablePaths(winUser, resolvedTarget),
      );
      candidates.push(...getLinuxPossibleExecutablePaths(resolvedTarget));
    } else {
      switch (getCurrentPlatform(options)) {
        case "darwin":
          candidates.push(...getDarwinPossibleExecutablePaths(resolvedTarget));
          break;
        case "win32":
          candidates.push(...getWindowsPossibleExecutablePaths(resolvedTarget));
          break;
        case "linux":
          candidates.push(...getLinuxPossibleExecutablePaths(resolvedTarget));
          break;
      }
    }

    const filteredCandidates = candidates.filter(
      (c) => !isSquirrelVersionedPath(c),
    );
    for (const candidate of filteredCandidates) {
      if (validateExecutableBinary(candidate, options)) {
        const alreadySet =
          configuredPath !== null &&
          areExecutablePathsEquivalent(configuredPath, candidate, options);
        return {
          target: resolvedTarget,
          detectedPath: candidate,
          source: "filesystem",
          configuredPath,
          configuredPathExists,
          alreadySet,
          status: alreadySet ? "already_set" : "detected",
        };
      }
    }

    // 5. System PATH lookup for desktop app and ide
    let pathCandidate: string | null = null;
    if (getCurrentPlatform(options) === "win32") {
      pathCandidate = getWindowsPathEnvironmentExecutable(resolvedTarget);
    } else {
      pathCandidate = getPosixPathEnvironmentExecutable(
        resolvedTarget,
        options,
      );
    }

    if (pathCandidate && validateExecutableBinary(pathCandidate, options)) {
      const alreadySet =
        configuredPath !== null &&
        areExecutablePathsEquivalent(configuredPath, pathCandidate, options);
      return {
        target: resolvedTarget,
        detectedPath: pathCandidate,
        source: "path",
        configuredPath,
        configuredPathExists,
        alreadySet,
        status: alreadySet ? "already_set" : "detected",
      };
    }
  }

  // 6. Not found
  return {
    target: resolvedTarget,
    detectedPath: null,
    source: "none",
    configuredPath,
    configuredPathExists,
    alreadySet: false,
    status: "not_found",
  };
}

export async function detectAllAntigravityExecutablePaths(
  options: DetectExecutableOptions = {},
): Promise<DetectedExecutableResult[]> {
  await refreshAllAntigravityProcessCaches(options);

  const targets: CanonicalAntigravityAppTarget[] = ["app", "ide", "cli"];
  const results: DetectedExecutableResult[] = [];

  for (const target of targets) {
    const result = await detectAntigravityExecutablePath(target, {
      ...options,
      skipProcessRefresh: true,
    });
    results.push(result);
  }

  return results;
}

const INSTALLATION_CACHE_TTL_MS = 30_000;

export interface InstallationStatusResult {
  target: AntigravityAppTarget;
  isInstalled: boolean;
  executablePath: string | null;
  checkedAt: number;
}

const binaryInstallationCache = new Map<string, InstallationStatusResult>();

export function clearBinaryInstallationCache(): void {
  binaryInstallationCache.clear();
}

export function getAntigravityTargetInstallationStatus(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): InstallationStatusResult {
  const resolvedTarget = resolveAntigravityAppTarget(target);
  const cacheKey = `${resolvedTarget}:${getCurrentPlatform(options)}`;
  const now = Date.now();
  const cached = binaryInstallationCache.get(cacheKey);
  if (cached && now - cached.checkedAt < INSTALLATION_CACHE_TTL_MS) {
    return cached;
  }

  const executablePath =
    getAntigravityExecutablePath(resolvedTarget, options) || null;
  const hasStorage = hasAntigravityStorage(resolvedTarget, options);
  const isBinaryInstalled = Boolean(
    (executablePath && fs.existsSync(executablePath)) || hasStorage,
  );

  const result: InstallationStatusResult = {
    target: resolvedTarget,
    isInstalled: isBinaryInstalled,
    executablePath,
    checkedAt: now,
  };
  binaryInstallationCache.set(cacheKey, result);
  return result;
}

export function isAntigravityTargetInstalled(
  target?: AntigravityAppTarget | null,
  options?: PathResolutionOptions,
): boolean {
  return getAntigravityTargetInstallationStatus(target, options).isInstalled;
}
