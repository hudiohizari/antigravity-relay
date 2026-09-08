import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  AppSettingsSchema,
  PartialAppSettings,
  PersistedSettingsData,
  EncryptedFieldEnvelope,
} from "./types";
import { StoreTamperException } from "../account-store/types";
import { deriveMasterKey, generateSalt } from "../account-store/master-key";

const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;

export interface SettingsStoreOptions {
  storePath: string;
  machineId?: string;
}

export class SettingsStore {
  private readonly storePath: string;
  private readonly machineId?: string;
  private cachedSettings: AppSettings | null = null;
  private writeLock: Promise<void> = Promise.resolve();
  private readonly emitter = new EventEmitter();

  constructor(options: SettingsStoreOptions) {
    if (!options.storePath) {
      throw new Error("Store path must be specified");
    }
    this.storePath = path.resolve(options.storePath);
    this.machineId = options.machineId;
  }

  public getStorePath(): string {
    return this.storePath;
  }

  public onSettingsUpdated(
    listener: (settings: AppSettings) => void,
  ): () => void {
    this.emitter.on("updated", listener);
    return () => {
      this.emitter.off("updated", listener);
    };
  }

  private encryptField(plaintext: string): EncryptedFieldEnvelope {
    const salt = generateSalt(16);
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const key = deriveMasterKey(salt, this.machineId);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let ciphertext = cipher.update(plaintext, "utf8", "hex");
    ciphertext += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return {
      cipher: "aes-256-gcm",
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      ciphertext,
      salt: salt.toString("hex"),
    };
  }

  private decryptField(envelope: EncryptedFieldEnvelope): string {
    if (
      !envelope ||
      envelope.cipher !== "aes-256-gcm" ||
      !envelope.iv ||
      !envelope.authTag ||
      !envelope.ciphertext ||
      !envelope.salt
    ) {
      throw new Error("Invalid encrypted field envelope");
    }

    const salt = Buffer.from(envelope.salt, "hex");
    const iv = Buffer.from(envelope.iv, "hex");
    const authTag = Buffer.from(envelope.authTag, "hex");

    if (iv.length !== GCM_IV_LENGTH || authTag.length !== GCM_AUTH_TAG_LENGTH) {
      throw new Error("Invalid IV or auth tag length");
    }

    const key = deriveMasterKey(salt, this.machineId);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(envelope.ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  private isEncryptedEnvelope(value: unknown): value is EncryptedFieldEnvelope {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as EncryptedFieldEnvelope).cipher === "aes-256-gcm"
    );
  }

  private async handleCorruptedFile(_reason: string): Promise<string> {
    const timestamp = Date.now();
    const backupPath = `${this.storePath}.corrupted.${timestamp}`;
    try {
      if (fs.existsSync(this.storePath)) {
        await fs.promises.rename(this.storePath, backupPath);
      }
    } catch {
      // Ignore rename error if file disappeared
    }
    return backupPath;
  }

  public async load(): Promise<AppSettings> {
    if (!fs.existsSync(this.storePath)) {
      this.cachedSettings = {
        ...DEFAULT_APP_SETTINGS,
        updatedAt: Date.now(),
      };
      return this.cachedSettings;
    }

    let fileContent: string;
    try {
      fileContent = await fs.promises.readFile(this.storePath, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read settings file: ${(err as Error).message}`,
      );
    }

    let persisted: PersistedSettingsData;
    try {
      persisted = JSON.parse(fileContent);
    } catch {
      const backup = await this.handleCorruptedFile(
        "Malformed JSON in settings",
      );
      throw new StoreTamperException(
        "Settings store JSON is malformed or corrupted",
        backup,
      );
    }

    try {
      let clientSecret = "";
      if (this.isEncryptedEnvelope(persisted.oauth?.clientSecret)) {
        clientSecret = this.decryptField(persisted.oauth.clientSecret);
      } else if (typeof persisted.oauth?.clientSecret === "string") {
        clientSecret = persisted.oauth.clientSecret;
      }

      let cloudflareNamedToken = "";
      const rawCloudflare =
        persisted.network?.cloudflareNamedToken ||
        persisted.network?.tunnelToken;
      if (this.isEncryptedEnvelope(rawCloudflare)) {
        cloudflareNamedToken = this.decryptField(rawCloudflare);
      } else if (typeof rawCloudflare === "string") {
        cloudflareNamedToken = rawCloudflare;
      }

      const mergedSettings: AppSettings = {
        version: 1,
        theme: persisted.theme ?? DEFAULT_APP_SETTINGS.theme,
        locale: persisted.locale ?? DEFAULT_APP_SETTINGS.locale,
        launchOnStartup:
          persisted.launchOnStartup ?? DEFAULT_APP_SETTINGS.launchOnStartup,
        minimizeToTrayOnClose:
          persisted.minimizeToTrayOnClose ??
          DEFAULT_APP_SETTINGS.minimizeToTrayOnClose,
        oauth: {
          clientId:
            persisted.oauth?.clientId ?? DEFAULT_APP_SETTINGS.oauth.clientId,
          clientSecret,
          isCustom:
            persisted.oauth?.isCustom ?? DEFAULT_APP_SETTINGS.oauth.isCustom,
        },
        binaryPaths: {
          agyDaemonPath:
            persisted.binaryPaths?.agyDaemonPath ??
            DEFAULT_APP_SETTINGS.binaryPaths.agyDaemonPath,
          ideExecutablePath:
            persisted.binaryPaths?.ideExecutablePath ??
            DEFAULT_APP_SETTINGS.binaryPaths.ideExecutablePath,
          autoDetected:
            persisted.binaryPaths?.autoDetected ??
            DEFAULT_APP_SETTINGS.binaryPaths.autoDetected,
        },
        network: {
          relayPort:
            persisted.network?.relayPort ??
            DEFAULT_APP_SETTINGS.network.relayPort,
          relayHost:
            persisted.network?.relayHost ??
            DEFAULT_APP_SETTINGS.network.relayHost,
          cloudflareNamedToken,
          tunnelToken: cloudflareNamedToken,
        },
        notifications: {
          enabled:
            persisted.notifications?.enabled ??
            DEFAULT_APP_SETTINGS.notifications.enabled,
          notifyOnAutoSwitch:
            persisted.notifications?.notifyOnAutoSwitch ??
            DEFAULT_APP_SETTINGS.notifications.notifyOnAutoSwitch,
          notifyOnRateLimit:
            persisted.notifications?.notifyOnRateLimit ??
            DEFAULT_APP_SETTINGS.notifications.notifyOnRateLimit,
          notifyOnProcessCrash:
            persisted.notifications?.notifyOnProcessCrash ??
            DEFAULT_APP_SETTINGS.notifications.notifyOnProcessCrash,
          debounceMs:
            persisted.notifications?.debounceMs ??
            DEFAULT_APP_SETTINGS.notifications.debounceMs,
        },
        updatedAt: persisted.updatedAt ?? Date.now(),
      };

      const validated = AppSettingsSchema.parse(mergedSettings);
      this.cachedSettings = validated;
      return validated;
    } catch (err) {
      const errorMsg = (err as Error).message;
      const backupPath = await this.handleCorruptedFile(
        `Settings decryption or validation failed: ${errorMsg}`,
      );
      throw new StoreTamperException(
        `Settings integrity verification failed: ${errorMsg}`,
        backupPath,
      );
    }
  }

  public async get(): Promise<AppSettings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }
    return this.load();
  }

  public async save(settings: AppSettings): Promise<void> {
    const validated = AppSettingsSchema.parse(settings);

    const operation = async () => {
      let encryptedClientSecret: string | EncryptedFieldEnvelope | undefined;
      if (validated.oauth.clientSecret) {
        encryptedClientSecret = this.encryptField(validated.oauth.clientSecret);
      }

      let encryptedTunnelToken: string | EncryptedFieldEnvelope | undefined;
      const rawToken =
        validated.network.cloudflareNamedToken || validated.network.tunnelToken;
      if (rawToken) {
        encryptedTunnelToken = this.encryptField(rawToken);
      }

      const persisted: PersistedSettingsData = {
        version: 1,
        theme: validated.theme,
        locale: validated.locale,
        launchOnStartup: validated.launchOnStartup,
        minimizeToTrayOnClose: validated.minimizeToTrayOnClose,
        oauth: {
          clientId: validated.oauth.clientId,
          clientSecret: encryptedClientSecret,
          isCustom: validated.oauth.isCustom,
        },
        binaryPaths: { ...validated.binaryPaths },
        network: {
          relayPort: validated.network.relayPort,
          relayHost: validated.network.relayHost,
          cloudflareNamedToken: encryptedTunnelToken,
          tunnelToken: encryptedTunnelToken,
        },
        notifications: { ...validated.notifications },
        updatedAt: validated.updatedAt || Date.now(),
      };

      await this.atomicWrite(JSON.stringify(persisted, null, 2));
      this.cachedSettings = validated;
      this.emitter.emit("updated", validated);
    };

    this.writeLock = this.writeLock.then(operation, operation);
    await this.writeLock;
  }

  private async atomicWrite(content: string): Promise<void> {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const tempPath = `${this.storePath}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`;

    const handle = await fs.promises.open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.promises.rename(tempPath, this.storePath);
  }

  public async update(partial: PartialAppSettings): Promise<AppSettings> {
    const current = await this.get();

    const merged: AppSettings = {
      ...current,
      theme: partial.theme ?? current.theme,
      locale: partial.locale ?? current.locale,
      launchOnStartup: partial.launchOnStartup ?? current.launchOnStartup,
      minimizeToTrayOnClose:
        partial.minimizeToTrayOnClose ?? current.minimizeToTrayOnClose,
      oauth: {
        ...current.oauth,
        ...(partial.oauth || {}),
      },
      binaryPaths: {
        ...current.binaryPaths,
        ...(partial.binaryPaths || {}),
      },
      network: {
        ...current.network,
        ...(partial.network || {}),
      },
      notifications: {
        ...current.notifications,
        ...(partial.notifications || {}),
      },
      updatedAt: Date.now(),
    };

    await this.save(merged);
    return merged;
  }

  public async reset(): Promise<AppSettings> {
    const resetSettings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      updatedAt: Date.now(),
    };
    await this.save(resetSettings);
    return resetSettings;
  }
}
