import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SettingsStore } from "../src/main/settings/settings-store";
import { AppSettings, DEFAULT_APP_SETTINGS } from "../src/main/settings/types";
import { StoreTamperException } from "../src/main/account-store/types";

describe("SettingsStore", () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "antigravity-settings-test-"),
    );
    storePath = path.join(tempDir, "settings.json");
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("should throw when storePath is empty", () => {
    expect(() => new SettingsStore({ storePath: "" })).toThrow(
      "Store path must be specified",
    );
  });

  it("should return resolved absolute path from getStorePath", () => {
    const store = new SettingsStore({ storePath: "./relative/settings.json" });
    expect(store.getStorePath()).toBe(path.resolve("./relative/settings.json"));
  });

  it("should return default settings when store file does not exist", async () => {
    const store = new SettingsStore({ storePath });
    const settings = await store.get();

    expect(settings.version).toBe(1);
    expect(settings.theme).toBe("system");
    expect(settings.locale).toBe("en");
    expect(settings.launchOnStartup).toBe(false);
    expect(settings.minimizeToTrayOnClose).toBe(true);
    expect(settings.network.relayPort).toBe(4040);
    expect(settings.notifications.enabled).toBe(true);
    expect(settings.oauth.clientId).toBe(
      "antigravity-relay.apps.googleusercontent.com",
    );
    expect(settings.oauth.clientSecret).toBe("");
    expect(settings.oauth.isCustom).toBe(false);
  });

  it("should encrypt sensitive fields on disk and decrypt on load", async () => {
    const store = new SettingsStore({
      storePath,
      machineId: "test-machine-uuid-12345",
    });

    const initialSettings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      oauth: {
        clientId: "custom-client-id.apps.googleusercontent.com",
        clientSecret: "super-secret-oauth-value",
        isCustom: true,
      },
      network: {
        relayPort: 5050,
        relayHost: "127.0.0.1",
        cloudflareNamedToken: "secret-tunnel-jwt-token",
        tunnelToken: "secret-tunnel-jwt-token",
      },
      updatedAt: Date.now(),
    };

    await store.save(initialSettings);

    expect(fs.existsSync(storePath)).toBe(true);

    const rawContent = await fs.promises.readFile(storePath, "utf8");
    const parsedRaw = JSON.parse(rawContent);

    expect(parsedRaw.oauth.clientSecret).toBeDefined();
    expect(parsedRaw.oauth.clientSecret.cipher).toBe("aes-256-gcm");
    expect(parsedRaw.oauth.clientSecret.iv).toBeDefined();
    expect(parsedRaw.oauth.clientSecret.authTag).toBeDefined();
    expect(parsedRaw.oauth.clientSecret.ciphertext).toBeDefined();
    expect(parsedRaw.oauth.clientSecret.salt).toBeDefined();
    expect(rawContent).not.toContain("super-secret-oauth-value");

    expect(parsedRaw.network.cloudflareNamedToken.cipher).toBe("aes-256-gcm");
    expect(rawContent).not.toContain("secret-tunnel-jwt-token");

    expect(parsedRaw.oauth.clientId).toBe(
      "custom-client-id.apps.googleusercontent.com",
    );
    expect(parsedRaw.network.relayPort).toBe(5050);

    const storeReader = new SettingsStore({
      storePath,
      machineId: "test-machine-uuid-12345",
    });
    const loadedSettings = await storeReader.load();

    expect(loadedSettings.oauth.clientSecret).toBe("super-secret-oauth-value");
    expect(loadedSettings.network.cloudflareNamedToken).toBe(
      "secret-tunnel-jwt-token",
    );
    expect(loadedSettings.network.relayPort).toBe(5050);
  });

  it("should handle empty or undefined secrets without encryption envelopes", async () => {
    const store = new SettingsStore({ storePath });
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      oauth: {
        clientId: "test-id",
        clientSecret: "",
        isCustom: false,
      },
      network: {
        relayPort: 4040,
        relayHost: "127.0.0.1",
        cloudflareNamedToken: "",
      },
    };

    await store.save(settings);
    const rawContent = await fs.promises.readFile(storePath, "utf8");
    const parsedRaw = JSON.parse(rawContent);

    expect(parsedRaw.oauth.clientSecret).toBeUndefined();
    expect(parsedRaw.network.cloudflareNamedToken).toBeUndefined();

    const loaded = await store.load();
    expect(loaded.oauth.clientSecret).toBe("");
    expect(loaded.network.cloudflareNamedToken).toBe("");
  });

  it("should handle plaintext secrets in disk file as fallback", async () => {
    const rawJson = {
      version: 1,
      theme: "dark",
      locale: "id",
      launchOnStartup: true,
      minimizeToTrayOnClose: false,
      oauth: {
        clientId: "plain-client",
        clientSecret: "plain-secret-unencrypted",
        isCustom: true,
      },
      binaryPaths: {
        agyDaemonPath: "/usr/bin/agy",
        ideExecutablePath: "/usr/bin/code",
        autoDetected: false,
      },
      network: {
        relayPort: 8080,
        relayHost: "0.0.0.0",
        cloudflareNamedToken: "plain-token-unencrypted",
      },
      notifications: {
        enabled: false,
        notifyOnAutoSwitch: false,
        notifyOnRateLimit: false,
        notifyOnProcessCrash: false,
        debounceMs: 2000,
      },
      updatedAt: 123456789,
    };

    await fs.promises.writeFile(storePath, JSON.stringify(rawJson), "utf8");

    const store = new SettingsStore({ storePath });
    const loaded = await store.load();

    expect(loaded.theme).toBe("dark");
    expect(loaded.locale).toBe("id");
    expect(loaded.oauth.clientSecret).toBe("plain-secret-unencrypted");
    expect(loaded.network.cloudflareNamedToken).toBe("plain-token-unencrypted");
    expect(loaded.network.relayPort).toBe(8080);
    expect(loaded.notifications.enabled).toBe(false);
  });

  it("should update partial settings and notify listeners", async () => {
    const store = new SettingsStore({ storePath });
    await store.get();

    let eventPayload: AppSettings | null = null;
    const unsubscribe = store.onSettingsUpdated((updated) => {
      eventPayload = updated;
    });

    const result = await store.update({
      theme: "dark",
      network: {
        relayPort: 9000,
      },
      notifications: {
        notifyOnRateLimit: false,
      },
    });

    expect(result.theme).toBe("dark");
    expect(result.network.relayPort).toBe(9000);
    expect(result.notifications.notifyOnRateLimit).toBe(false);
    expect(result.notifications.notifyOnAutoSwitch).toBe(true);

    expect(eventPayload).not.toBeNull();
    expect(eventPayload!.theme).toBe("dark");

    unsubscribe();
    await store.update({ theme: "light" });
    expect(eventPayload!.theme).toBe("dark");
  });

  it("should reset settings to default values and persist", async () => {
    const store = new SettingsStore({ storePath });
    await store.update({
      theme: "dark",
      locale: "id",
      network: { relayPort: 7777 },
    });

    let notified = false;
    store.onSettingsUpdated(() => {
      notified = true;
    });

    const resetResult = await store.reset();

    expect(resetResult.theme).toBe("system");
    expect(resetResult.locale).toBe("en");
    expect(resetResult.network.relayPort).toBe(4040);
    expect(notified).toBe(true);

    const reloadedStore = new SettingsStore({ storePath });
    const reloaded = await reloadedStore.load();
    expect(reloaded.network.relayPort).toBe(4040);
  });

  it("should serialize concurrent saves without file corruption", async () => {
    const store = new SettingsStore({ storePath });

    const promises = Array.from({ length: 15 }, (_, i) =>
      store.update({
        network: {
          relayPort: 4000 + i,
        },
      }),
    );

    await Promise.all(promises);

    const latest = await store.get();
    expect(latest.network.relayPort).toBeGreaterThanOrEqual(4000);
    expect(latest.network.relayPort).toBeLessThanOrEqual(4014);

    const onDiskRaw = await fs.promises.readFile(storePath, "utf8");
    expect(() => JSON.parse(onDiskRaw)).not.toThrow();
  });

  it("should automatically create parent directory if missing", async () => {
    const deepStorePath = path.join(tempDir, "sub", "dir", "settings.json");
    const store = new SettingsStore({ storePath: deepStorePath });

    await store.save(DEFAULT_APP_SETTINGS);
    expect(fs.existsSync(deepStorePath)).toBe(true);
  });

  it("should reject corrupted JSON and create backup", async () => {
    await fs.promises.writeFile(storePath, "{ malformed json...", "utf8");

    const store = new SettingsStore({ storePath });

    await expect(store.load()).rejects.toThrow(StoreTamperException);

    const files = await fs.promises.readdir(tempDir);
    const corruptedBackups = files.filter((f) => f.includes(".corrupted."));
    expect(corruptedBackups.length).toBe(1);
  });

  it("should reject tampered ciphertext or authTag and create backup", async () => {
    const store = new SettingsStore({ storePath });
    await store.save({
      ...DEFAULT_APP_SETTINGS,
      oauth: {
        ...DEFAULT_APP_SETTINGS.oauth,
        clientSecret: "confidential-secret-key",
      },
    });

    const raw = JSON.parse(await fs.promises.readFile(storePath, "utf8"));
    // Tamper with the ciphertext
    raw.oauth.clientSecret.ciphertext =
      "ffff" + raw.oauth.clientSecret.ciphertext.slice(4);
    await fs.promises.writeFile(storePath, JSON.stringify(raw), "utf8");

    const reader = new SettingsStore({ storePath });
    await expect(reader.load()).rejects.toThrow(StoreTamperException);

    const files = await fs.promises.readdir(tempDir);
    const backups = files.filter((f) => f.includes(".corrupted."));
    expect(backups.length).toBe(1);
  });

  it("should reject invalid envelope structure in secret field", async () => {
    const raw = {
      version: 1,
      theme: "system",
      locale: "en",
      launchOnStartup: false,
      minimizeToTrayOnClose: true,
      oauth: {
        clientId: "test",
        clientSecret: {
          cipher: "aes-256-gcm",
          // missing iv, authTag, ciphertext, salt
        },
        isCustom: false,
      },
      binaryPaths: DEFAULT_APP_SETTINGS.binaryPaths,
      network: DEFAULT_APP_SETTINGS.network,
      notifications: DEFAULT_APP_SETTINGS.notifications,
      updatedAt: Date.now(),
    };

    await fs.promises.writeFile(storePath, JSON.stringify(raw), "utf8");

    const store = new SettingsStore({ storePath });
    await expect(store.load()).rejects.toThrow(StoreTamperException);
  });

  it("should reject invalid IV or authTag byte length in secret envelope", async () => {
    const raw = {
      version: 1,
      theme: "system",
      locale: "en",
      launchOnStartup: false,
      minimizeToTrayOnClose: true,
      oauth: {
        clientId: "test",
        clientSecret: {
          cipher: "aes-256-gcm",
          iv: "00", // too short (not 12 bytes = 24 hex)
          authTag: "00", // too short (not 16 bytes = 32 hex)
          ciphertext: "abcd",
          salt: "00112233445566778899aabbccddeeff",
        },
        isCustom: false,
      },
      binaryPaths: DEFAULT_APP_SETTINGS.binaryPaths,
      network: DEFAULT_APP_SETTINGS.network,
      notifications: DEFAULT_APP_SETTINGS.notifications,
      updatedAt: Date.now(),
    };

    await fs.promises.writeFile(storePath, JSON.stringify(raw), "utf8");

    const store = new SettingsStore({ storePath });
    await expect(store.load()).rejects.toThrow(StoreTamperException);
  });

  it("should return cached settings on subsequent get() calls", async () => {
    const store = new SettingsStore({ storePath });
    const first = await store.get();
    const second = await store.get();
    expect(first).toBe(second);
  });

  it("should throw error when reading settings file fails with fs error", async () => {
    const store = new SettingsStore({ storePath });
    await store.save(DEFAULT_APP_SETTINGS);
    vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
      new Error("EACCES: permission denied"),
    );
    await expect(store.load()).rejects.toThrow(
      "Failed to read settings file: EACCES: permission denied",
    );
  });

  it("should handle error during corrupted file backup rename gracefully", async () => {
    await fs.promises.writeFile(storePath, "not-json", "utf8");
    const store = new SettingsStore({ storePath });
    const spy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValueOnce(new Error("Rename locked"));
    const backup = await (store as any).handleCorruptedFile("test");
    expect(backup).toContain(".corrupted.");
    spy.mockRestore();
  });

  it("should apply default notification settings when partial notification object is saved", async () => {
    const raw = {
      version: 1,
      theme: "dark",
      locale: "en",
      launchOnStartup: false,
      minimizeToTrayOnClose: true,
      oauth: { clientId: "test-id", isCustom: false },
      binaryPaths: DEFAULT_APP_SETTINGS.binaryPaths,
      network: DEFAULT_APP_SETTINGS.network,
      notifications: {}, // empty notifications to exercise fallbacks
      updatedAt: Date.now(),
    };
    await fs.promises.writeFile(storePath, JSON.stringify(raw), "utf8");

    const store = new SettingsStore({ storePath });
    const loaded = await store.load();

    expect(loaded.notifications.enabled).toBe(true);
    expect(loaded.notifications.notifyOnAutoSwitch).toBe(true);
    expect(loaded.notifications.notifyOnRateLimit).toBe(true);
    expect(loaded.notifications.notifyOnProcessCrash).toBe(true);
    expect(loaded.notifications.debounceMs).toBe(5000);
  });

  it("should apply default settings for all missing sections when loading minimal persisted file", async () => {
    const raw = {
      version: 1,
    };
    await fs.promises.writeFile(storePath, JSON.stringify(raw), "utf8");

    const store = new SettingsStore({ storePath });
    const loaded = await store.load();

    expect(loaded.oauth.clientId).toBe(DEFAULT_APP_SETTINGS.oauth.clientId);
    expect(loaded.binaryPaths.agyDaemonPath).toBe(
      DEFAULT_APP_SETTINGS.binaryPaths.agyDaemonPath,
    );
    expect(loaded.binaryPaths.ideExecutablePath).toBe(
      DEFAULT_APP_SETTINGS.binaryPaths.ideExecutablePath,
    );
    expect(loaded.network.relayPort).toBe(
      DEFAULT_APP_SETTINGS.network.relayPort,
    );
    expect(loaded.network.relayHost).toBe(
      DEFAULT_APP_SETTINGS.network.relayHost,
    );
  });
});
