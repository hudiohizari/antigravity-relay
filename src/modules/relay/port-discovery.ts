import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PortChangeEvent {
  oldPort: number | null;
  newPort: number;
}

export interface PortDiscoveryOptions {
  logPath?: string;
  pollIntervalMs?: number;
  debounceMs?: number;
  initialPort?: number | null;
}

export function getDefaultLogPath(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Logs/Antigravity/main.log");
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming");
    return path.join(appData, "Antigravity/logs/main.log");
  }
  return path.join(os.homedir(), ".config/Antigravity/logs/main.log");
}

export function parsePortFromLog(content: string): number | null {
  const regex =
    /(?:listening on https:\/\/127\.0\.0\.1:|Local:\s+https:\/\/127\.0\.0\.1:|Reloading all windows with URL:\s+https:\/\/127\.0\.0\.1:)(\d+)/gi;
  const matches = Array.from(content.matchAll(regex));
  if (matches.length === 0) {
    return null;
  }
  const lastMatch = matches[matches.length - 1];
  const port = parseInt(lastMatch[1], 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    return null;
  }
  return port;
}

export class PortDiscoveryService extends EventEmitter {
  private currentPort: number | null = null;
  private restarting = false;
  private readonly logPath: string;
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private dirWatcher: fs.FSWatcher | null = null;
  private isRunning = false;

  constructor(options?: PortDiscoveryOptions) {
    super();
    this.logPath = options?.logPath ?? getDefaultLogPath();
    this.pollIntervalMs = options?.pollIntervalMs ?? 1500;
    this.debounceMs = options?.debounceMs ?? 50;
    if (options?.initialPort !== undefined) {
      this.currentPort = options.initialPort;
    }
  }

  public getPort(): number | null {
    return this.currentPort;
  }

  public setPort(port: number | null): void {
    const oldPort = this.currentPort;
    this.currentPort = port;
    if (port !== null) {
      this.restarting = false;
      if (oldPort === null) {
        this.emit("port-discovered", port);
      }
      if (oldPort !== port) {
        this.emit("port-changed", { oldPort, newPort: port });
      }
    } else if (oldPort !== null) {
      this.emit("port-lost");
    }
  }

  public isDiscovered(): boolean {
    return this.currentPort !== null;
  }

  public isRestarting(): boolean {
    return this.restarting;
  }

  public setRestarting(restarting: boolean): void {
    const changed = this.restarting !== restarting;
    this.restarting = restarting;
    if (changed && restarting) {
      this.emit("restarting");
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }

  public async checkOnce(): Promise<number | null> {
    try {
      if (!fs.existsSync(this.logPath)) {
        return null;
      }

      const stats = await fs.promises.stat(this.logPath);
      let content: string;
      if (stats.size > 65536) {
        const buffer = Buffer.alloc(65536);
        const fd = await fs.promises.open(this.logPath, "r");
        try {
          await fd.read(buffer, 0, 65536, stats.size - 65536);
          content = buffer.toString("utf-8");
        } finally {
          await fd.close();
        }
      } else {
        content = await fs.promises.readFile(this.logPath, "utf-8");
      }

      const discoveredPort = parsePortFromLog(content);
      if (discoveredPort !== null) {
        this.handlePortFound(discoveredPort);
      }
      return discoveredPort;
    } catch {
      return null;
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    await this.checkOnce();
    this.setupWatchers();

    this.pollTimer = setInterval(async () => {
      await this.checkOnce();
      if (!this.fileWatcher && fs.existsSync(this.logPath)) {
        this.setupFileWatcher();
      }
    }, this.pollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.fileWatcher) {
      try {
        this.fileWatcher.close();
      } catch {
        // Ignore watcher close error
      }
      this.fileWatcher = null;
    }
    if (this.dirWatcher) {
      try {
        this.dirWatcher.close();
      } catch {
        // Ignore watcher close error
      }
      this.dirWatcher = null;
    }
  }

  public dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  private handlePortFound(newPort: number): void {
    if (this.currentPort === null) {
      this.currentPort = newPort;
      this.restarting = false;
      this.emit("port-discovered", newPort);
      this.emit("port-changed", { oldPort: null, newPort });
    } else if (this.currentPort !== newPort) {
      const oldPort = this.currentPort;
      this.currentPort = newPort;
      this.restarting = false;
      this.emit("port-changed", { oldPort, newPort });
    }
  }

  private setupWatchers(): void {
    if (fs.existsSync(this.logPath)) {
      this.setupFileWatcher();
    } else {
      const parentDir = path.dirname(this.logPath);
      if (fs.existsSync(parentDir)) {
        try {
          this.dirWatcher = fs.watch(parentDir, () => {
            if (fs.existsSync(this.logPath)) {
              if (this.dirWatcher) {
                this.dirWatcher.close();
                this.dirWatcher = null;
              }
              this.setupFileWatcher();
              this.scheduleCheck();
            }
          });
        } catch {
          // Fallback to polling
        }
      }
    }
  }

  private setupFileWatcher(): void {
    try {
      this.fileWatcher = fs.watch(this.logPath, () => {
        this.scheduleCheck();
      });
      this.fileWatcher.on("error", () => {
        if (this.fileWatcher) {
          try {
            this.fileWatcher.close();
          } catch {}
          this.fileWatcher = null;
        }
      });
    } catch {
      // Polling fallback
    }
  }

  private scheduleCheck(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null;
      await this.checkOnce();
    }, this.debounceMs);
  }
}
