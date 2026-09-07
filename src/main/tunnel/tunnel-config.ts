import fs from "node:fs";
import path from "node:path";
import { TunnelConfig, DEFAULT_TUNNEL_CONFIG } from "./types";

export interface TunnelConfigStoreOptions {
  configPath?: string;
  initialConfig?: Partial<TunnelConfig>;
}

export class TunnelConfigStore {
  private config: TunnelConfig;
  private readonly configPath?: string;

  constructor(options?: TunnelConfigStoreOptions) {
    this.configPath = options?.configPath;
    this.config = {
      ...DEFAULT_TUNNEL_CONFIG,
      ...options?.initialConfig,
    };

    if (this.configPath && fs.existsSync(this.configPath)) {
      this.loadFromDisk();
    }
  }

  public getConfig(): TunnelConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<TunnelConfig>): TunnelConfig {
    if (updates.targetPort !== undefined) {
      if (
        !Number.isInteger(updates.targetPort) ||
        updates.targetPort < 1 ||
        updates.targetPort > 65535
      ) {
        throw new Error(
          "Invalid targetPort: must be an integer between 1 and 65535",
        );
      }
    }

    if (updates.maxRetries !== undefined) {
      if (!Number.isInteger(updates.maxRetries) || updates.maxRetries < 0) {
        throw new Error("Invalid maxRetries: must be a non-negative integer");
      }
    }

    if (updates.retryBackoffMs !== undefined) {
      if (updates.retryBackoffMs < 100) {
        throw new Error("Invalid retryBackoffMs: must be at least 100ms");
      }
    }

    this.config = {
      ...this.config,
      ...updates,
    };

    if (this.configPath) {
      this.saveToDisk();
    }

    return this.getConfig();
  }

  public resetToDefault(): TunnelConfig {
    this.config = { ...DEFAULT_TUNNEL_CONFIG };
    if (this.configPath) {
      this.saveToDisk();
    }
    return this.getConfig();
  }

  private loadFromDisk(): void {
    try {
      const raw = fs.readFileSync(this.configPath!, "utf-8");
      const parsed = JSON.parse(raw);
      this.config = {
        ...DEFAULT_TUNNEL_CONFIG,
        ...parsed,
      };
    } catch {
      // Use defaults if file is unreadable or malformed
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.configPath!);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.configPath!,
        JSON.stringify(this.config, null, 2),
        "utf-8",
      );
    } catch {
      // Suppress disk write error
    }
  }
}
