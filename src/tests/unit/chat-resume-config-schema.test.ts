import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import { AppConfigSchema, DEFAULT_APP_CONFIG } from "@/modules/config/types";
import { ConfigManager } from "@/modules/config/ipc/manager";

describe("AppConfigSchema - Chat Resumption Configuration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults auto_resume_active_chat to true in DEFAULT_APP_CONFIG", () => {
    expect(DEFAULT_APP_CONFIG.auto_resume_active_chat).toBe(true);
  });

  it("applies default true when auto_resume_active_chat is omitted from config input", () => {
    const rawConfig = {
      language: "en",
      theme: "dark",
      auto_refresh: false,
      refresh_interval: 15,
      auto_sync: false,
      sync_interval: 5,
      auto_startup: false,
      proxy: {
        enabled: false,
        port: 8045,
        api_key: "key",
        auto_start: false,
        upstream_proxy: { enabled: false, url: "" },
        anthropic_mapping: {},
      },
    };

    const parsed = AppConfigSchema.parse(rawConfig);
    expect(parsed.auto_resume_active_chat).toBe(true);
  });

  it("preserves explicit false when user disables auto-resumption in settings", () => {
    const rawConfig = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: false,
    };

    const parsed = AppConfigSchema.parse(rawConfig);
    expect(parsed.auto_resume_active_chat).toBe(false);
  });

  it("ConfigManager.loadConfig() preserves auto_resume_active_chat setting from disk", () => {
    const configOnDisk = {
      ...DEFAULT_APP_CONFIG,
      auto_resume_active_chat: false,
    };

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(configOnDisk));

    const loaded = ConfigManager.loadConfig();
    expect(loaded.auto_resume_active_chat).toBe(false);
  });
});
