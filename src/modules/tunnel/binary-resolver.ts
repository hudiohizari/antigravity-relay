import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type SupportedPlatform = "darwin" | "win32" | "linux";

export interface BinaryResolutionResult {
  isInstalled: boolean;
  binaryPath: string | null;
  platform: SupportedPlatform;
  error?: string;
}

export interface ResolveOptions {
  binaryPath?: string;
  forceRefresh?: boolean;
}

export interface BinaryResolverOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  cacheTtlMs?: number;
  homedir?: string;
  statSync?: (filePath: string) => { isFile: () => boolean };
  accessSync?: (filePath: string, mode?: number) => void;
  stat?: (filePath: string) => Promise<{ isFile: () => boolean }>;
  access?: (filePath: string, mode?: number) => Promise<void>;
}

interface CacheEntry {
  result: BinaryResolutionResult;
  timestamp: number;
  key: string;
}

export function resolvePlatform(
  platform: NodeJS.Platform = process.platform,
): SupportedPlatform {
  if (platform === "darwin") return "darwin";
  if (platform === "win32") return "win32";
  return "linux";
}

export class BinaryResolver {
  public readonly platform: SupportedPlatform;
  private readonly rawPlatform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly cacheTtlMs: number;
  private readonly homedir: string;

  private readonly statSyncFn: (filePath: string) => { isFile: () => boolean };
  private readonly accessSyncFn: (filePath: string, mode?: number) => void;
  private readonly statAsyncFn: (
    filePath: string,
  ) => Promise<{ isFile: () => boolean }>;
  private readonly accessAsyncFn: (
    filePath: string,
    mode?: number,
  ) => Promise<void>;

  private cache: CacheEntry | null = null;

  constructor(options?: BinaryResolverOptions) {
    this.rawPlatform = options?.platform ?? process.platform;
    this.platform = resolvePlatform(this.rawPlatform);
    this.env = options?.env ?? process.env;
    this.cacheTtlMs = options?.cacheTtlMs ?? 5000;
    this.homedir = options?.homedir ?? os.homedir();

    this.statSyncFn = options?.statSync ?? fs.statSync;
    this.accessSyncFn = options?.accessSync ?? fs.accessSync;
    this.statAsyncFn = options?.stat ?? fs.promises.stat;
    this.accessAsyncFn = options?.access ?? fs.promises.access;
  }

  private get pathUtil(): typeof path.posix | typeof path.win32 {
    return this.platform === "win32" ? path.win32 : path.posix;
  }

  public getFallbackDirectories(): string[] {
    const p = this.pathUtil;
    if (this.platform === "darwin") {
      return [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        p.join(this.homedir, "bin"),
      ];
    }

    if (this.platform === "win32") {
      const programFiles = this.env.ProgramFiles || "C:\\Program Files";
      const localAppData =
        this.env.LOCALAPPDATA || p.join(this.homedir, "AppData", "Local");
      const programFilesX86 = this.env["ProgramFiles(x86)"];

      const dirs = [
        p.join(programFiles, "cloudflared"),
        p.join(localAppData, "Programs", "cloudflared"),
        p.join(localAppData, "Programs"),
      ];

      if (programFilesX86) {
        dirs.push(p.join(programFilesX86, "cloudflared"));
      }

      return dirs;
    }

    return ["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];
  }

  public getAugmentedEnv(
    baseEnv: NodeJS.ProcessEnv = this.env,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    const isWin = this.platform === "win32";
    const delimiter = isWin ? ";" : ":";
    const pathKey =
      Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const rawPath = env[pathKey] || "";
    const existingDirs = rawPath.split(delimiter).filter(Boolean);

    const fallbackDirs = this.getFallbackDirectories();
    const extraDirs: string[] = [];

    if (this.cache?.result?.binaryPath) {
      const binDir = this.pathUtil.dirname(this.cache.result.binaryPath);
      if (!existingDirs.includes(binDir)) {
        extraDirs.push(binDir);
      }
    }

    for (const dir of fallbackDirs) {
      if (!existingDirs.includes(dir) && !extraDirs.includes(dir)) {
        extraDirs.push(dir);
      }
    }

    const augmentedPath = [...extraDirs, ...existingDirs].join(delimiter);
    env[pathKey] = augmentedPath;
    return env;
  }

  public clearCache(): void {
    this.cache = null;
  }

  public getCachedResult(): BinaryResolutionResult | null {
    if (!this.cache) return null;
    const isExpired = Date.now() - this.cache.timestamp >= this.cacheTtlMs;
    return isExpired ? null : this.cache.result;
  }

  public resolveSync(options?: ResolveOptions): BinaryResolutionResult {
    const key = options?.binaryPath || "__default__";
    const forceRefresh = options?.forceRefresh ?? false;

    if (
      !forceRefresh &&
      this.cache &&
      this.cache.key === key &&
      Date.now() - this.cache.timestamp < this.cacheTtlMs
    ) {
      return this.cache.result;
    }

    const result = this.executeResolveSync(options?.binaryPath);
    this.cache = {
      result,
      timestamp: Date.now(),
      key,
    };
    return result;
  }

  public async resolve(
    options?: ResolveOptions,
  ): Promise<BinaryResolutionResult> {
    const key = options?.binaryPath || "__default__";
    const forceRefresh = options?.forceRefresh ?? false;

    if (
      !forceRefresh &&
      this.cache &&
      this.cache.key === key &&
      Date.now() - this.cache.timestamp < this.cacheTtlMs
    ) {
      return this.cache.result;
    }

    const result = await this.executeResolveAsync(options?.binaryPath);
    this.cache = {
      result,
      timestamp: Date.now(),
      key,
    };
    return result;
  }

  private isExecutableSync(filePath: string): boolean {
    try {
      const stat = this.statSyncFn(filePath);
      if (!stat.isFile()) return false;
      this.accessSyncFn(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async isExecutableAsync(filePath: string): Promise<boolean> {
    try {
      const stat = await this.statAsyncFn(filePath);
      if (!stat.isFile()) return false;
      await this.accessAsyncFn(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private getSearchCandidates(binaryName = "cloudflared"): string[] {
    const isWin = this.platform === "win32";
    const delimiter = isWin ? ";" : ":";
    const pathKey =
      Object.keys(this.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const rawPath = this.env[pathKey] || "";
    const pathDirs = rawPath.split(delimiter).filter(Boolean);
    const fallbackDirs = this.getFallbackDirectories();

    const uniqueDirs: string[] = [];
    for (const dir of [...pathDirs, ...fallbackDirs]) {
      if (dir && !uniqueDirs.includes(dir)) {
        uniqueDirs.push(dir);
      }
    }

    const candidates: string[] = [];
    const extensions = this.getExtensions();
    const p = this.pathUtil;

    for (const dir of uniqueDirs) {
      if (isWin) {
        for (const ext of extensions) {
          const candidate = ext
            ? p.join(dir, `${binaryName}${ext}`)
            : p.join(dir, binaryName);
          candidates.push(candidate);
        }
      } else {
        candidates.push(p.join(dir, binaryName));
      }
    }

    return candidates;
  }

  private getExtensions(): string[] {
    if (this.platform !== "win32") {
      return [""];
    }
    const pathext = this.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
    const exts = pathext
      .split(";")
      .filter(Boolean)
      .map((e) => e.toLowerCase());
    return [".exe", ...exts.filter((e) => e !== ".exe"), ""];
  }

  private executeResolveSync(
    customBinaryPath?: string,
  ): BinaryResolutionResult {
    const p = this.pathUtil;
    if (customBinaryPath) {
      const isPathLike =
        customBinaryPath.includes("/") ||
        customBinaryPath.includes("\\") ||
        p.isAbsolute(customBinaryPath);

      if (isPathLike) {
        const resolved = p.resolve(customBinaryPath);
        if (this.isExecutableSync(resolved)) {
          return {
            isInstalled: true,
            binaryPath: resolved,
            platform: this.platform,
          };
        }
        return {
          isInstalled: false,
          binaryPath: null,
          platform: this.platform,
          error: `Configured binaryPath is not a valid executable: ${customBinaryPath}`,
        };
      }

      const candidates = this.getSearchCandidates(customBinaryPath);
      for (const candidate of candidates) {
        if (this.isExecutableSync(candidate)) {
          return {
            isInstalled: true,
            binaryPath: candidate,
            platform: this.platform,
          };
        }
      }
      return {
        isInstalled: false,
        binaryPath: null,
        platform: this.platform,
        error: `Configured executable '${customBinaryPath}' not found in PATH or standard directories`,
      };
    }

    const candidates = this.getSearchCandidates("cloudflared");
    for (const candidate of candidates) {
      if (this.isExecutableSync(candidate)) {
        return {
          isInstalled: true,
          binaryPath: candidate,
          platform: this.platform,
        };
      }
    }

    return {
      isInstalled: false,
      binaryPath: null,
      platform: this.platform,
      error: "cloudflared binary not found in PATH or fallback directories",
    };
  }

  private async executeResolveAsync(
    customBinaryPath?: string,
  ): Promise<BinaryResolutionResult> {
    const p = this.pathUtil;
    if (customBinaryPath) {
      const isPathLike =
        customBinaryPath.includes("/") ||
        customBinaryPath.includes("\\") ||
        p.isAbsolute(customBinaryPath);

      if (isPathLike) {
        const resolved = p.resolve(customBinaryPath);
        if (await this.isExecutableAsync(resolved)) {
          return {
            isInstalled: true,
            binaryPath: resolved,
            platform: this.platform,
          };
        }
        return {
          isInstalled: false,
          binaryPath: null,
          platform: this.platform,
          error: `Configured binaryPath is not a valid executable: ${customBinaryPath}`,
        };
      }

      const candidates = this.getSearchCandidates(customBinaryPath);
      for (const candidate of candidates) {
        if (await this.isExecutableAsync(candidate)) {
          return {
            isInstalled: true,
            binaryPath: candidate,
            platform: this.platform,
          };
        }
      }
      return {
        isInstalled: false,
        binaryPath: null,
        platform: this.platform,
        error: `Configured executable '${customBinaryPath}' not found in PATH or standard directories`,
      };
    }

    const candidates = this.getSearchCandidates("cloudflared");
    for (const candidate of candidates) {
      if (await this.isExecutableAsync(candidate)) {
        return {
          isInstalled: true,
          binaryPath: candidate,
          platform: this.platform,
        };
      }
    }

    return {
      isInstalled: false,
      binaryPath: null,
      platform: this.platform,
      error: "cloudflared binary not found in PATH or fallback directories",
    };
  }
}
