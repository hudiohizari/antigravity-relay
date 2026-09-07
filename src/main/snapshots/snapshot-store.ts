import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EncryptedStoreEnvelope } from "../../shared/types";
import { AccountStore } from "../account-store/account-store";
import { StoreTamperException } from "../account-store/types";
import { deriveMasterKey, generateSalt } from "../account-store/master-key";
import { AutoSwitchService } from "../switcher/auto-switch.service";
import { AutoSwitchConfig } from "../switcher/types";
import { AccountSnapshot, SnapshotMetadata } from "./types";

export interface SnapshotStoreOptions {
  snapshotsDir: string;
  accountStore: AccountStore;
  autoSwitchService?: AutoSwitchService;
  machineId?: string;
}

const GCM_IV_LENGTH = 12; // 96 bits
const GCM_AUTH_TAG_LENGTH = 16; // 128 bits
const CURRENT_SCHEMA_VERSION = 1;

export class SnapshotStore {
  private readonly snapshotsDir: string;
  private readonly accountStore: AccountStore;
  private readonly autoSwitchService?: AutoSwitchService;
  private readonly machineId?: string;

  constructor(options: SnapshotStoreOptions) {
    if (!options.snapshotsDir) {
      throw new Error("Snapshots directory must be specified");
    }
    this.snapshotsDir = path.resolve(options.snapshotsDir);
    this.accountStore = options.accountStore;
    this.autoSwitchService = options.autoSwitchService;
    this.machineId = options.machineId;
  }

  public getSnapshotsDir(): string {
    return this.snapshotsDir;
  }

  private async ensureDirectory(): Promise<void> {
    if (!fs.existsSync(this.snapshotsDir)) {
      await fs.promises.mkdir(this.snapshotsDir, { recursive: true });
    }
  }

  private getSnapshotFilePath(id: string): string {
    return path.join(this.snapshotsDir, `${id}.enc.json`);
  }

  private async encryptPayload(
    plaintext: string,
  ): Promise<EncryptedStoreEnvelope> {
    const salt = generateSalt(16);
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const key = deriveMasterKey(salt, this.machineId);

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let ciphertext = cipher.update(plaintext, "utf8", "hex");
    ciphertext += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return {
      version: CURRENT_SCHEMA_VERSION,
      cipher: "aes-256-gcm",
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      ciphertext,
      salt: salt.toString("hex"),
      updatedAt: Date.now(),
    };
  }

  private decryptPayload(
    envelope: EncryptedStoreEnvelope,
    filePath: string,
  ): string {
    if (
      !envelope ||
      envelope.version !== CURRENT_SCHEMA_VERSION ||
      envelope.cipher !== "aes-256-gcm" ||
      !envelope.iv ||
      !envelope.authTag ||
      !envelope.ciphertext ||
      !envelope.salt
    ) {
      throw new StoreTamperException(
        "Invalid or unrecognized snapshot envelope structure",
        filePath,
      );
    }

    try {
      const salt = Buffer.from(envelope.salt, "hex");
      const iv = Buffer.from(envelope.iv, "hex");
      const authTag = Buffer.from(envelope.authTag, "hex");

      if (
        iv.length !== GCM_IV_LENGTH ||
        authTag.length !== GCM_AUTH_TAG_LENGTH
      ) {
        throw new Error("Invalid IV or auth tag byte length");
      }

      const key = deriveMasterKey(salt, this.machineId);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(envelope.ciphertext, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (err) {
      throw new StoreTamperException(
        `Snapshot decryption failed: ${(err as Error).message}`,
        filePath,
      );
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await this.ensureDirectory();
    const randomSuffix = crypto.randomBytes(4).toString("hex");
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`;

    const handle = await fs.promises.open(tempPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.promises.rename(tempPath, filePath);
  }

  public async createSnapshot(params: {
    name: string;
    description?: string;
    config?: AutoSwitchConfig;
  }): Promise<SnapshotMetadata> {
    if (!params.name || !params.name.trim()) {
      throw new Error("Snapshot name cannot be empty");
    }

    await this.ensureDirectory();

    const storeData = await this.accountStore.load();
    const id = crypto.randomUUID();
    const now = Date.now();
    const accounts = { ...storeData.accounts };
    const accountCount = Object.keys(accounts).length;
    const activeAccountId = storeData.activeAccountId;
    const activeAccountEmail =
      activeAccountId && accounts[activeAccountId]
        ? accounts[activeAccountId].email
        : undefined;

    const autoSwitchConfig =
      params.config ??
      (this.autoSwitchService ? this.autoSwitchService.getConfig() : undefined);

    const snapshot: AccountSnapshot = {
      id,
      name: params.name.trim(),
      description: params.description?.trim(),
      createdAt: now,
      accountCount,
      activeAccountId,
      accounts,
      autoSwitchConfig,
    };

    const envelope = await this.encryptPayload(JSON.stringify(snapshot));
    const filePath = this.getSnapshotFilePath(id);
    await this.atomicWrite(filePath, JSON.stringify(envelope, null, 2));

    const stat = await fs.promises.stat(filePath);

    return {
      id,
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt,
      accountCount,
      activeAccountEmail,
      sizeBytes: stat.size,
    };
  }

  public async getSnapshot(id: string): Promise<AccountSnapshot | null> {
    const filePath = this.getSnapshotFilePath(id);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = await fs.promises.readFile(filePath, "utf8");
    let envelope: EncryptedStoreEnvelope;
    try {
      envelope = JSON.parse(fileContent) as EncryptedStoreEnvelope;
    } catch {
      throw new StoreTamperException(
        "Malformed JSON in snapshot file",
        filePath,
      );
    }

    const decrypted = this.decryptPayload(envelope, filePath);
    return JSON.parse(decrypted) as AccountSnapshot;
  }

  public async listSnapshots(): Promise<SnapshotMetadata[]> {
    await this.ensureDirectory();
    const files = await fs.promises.readdir(this.snapshotsDir);
    const snapshotFiles = files.filter((f) => f.endsWith(".enc.json"));
    const metadataList: SnapshotMetadata[] = [];

    for (const file of snapshotFiles) {
      const filePath = path.join(this.snapshotsDir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        const fileContent = await fs.promises.readFile(filePath, "utf8");
        const envelope = JSON.parse(fileContent) as EncryptedStoreEnvelope;
        const decrypted = this.decryptPayload(envelope, filePath);
        const snapshot = JSON.parse(decrypted) as AccountSnapshot;

        const activeEmail =
          snapshot.activeAccountId &&
          snapshot.accounts[snapshot.activeAccountId]
            ? snapshot.accounts[snapshot.activeAccountId].email
            : undefined;

        metadataList.push({
          id: snapshot.id,
          name: snapshot.name,
          description: snapshot.description,
          createdAt: snapshot.createdAt,
          accountCount: snapshot.accountCount,
          activeAccountEmail: activeEmail,
          sizeBytes: stat.size,
        });
      } catch (err) {
        if (err instanceof StoreTamperException) {
          throw err;
        }
        throw new StoreTamperException(
          `Failed to read snapshot ${file}: ${(err as Error).message}`,
          filePath,
        );
      }
    }

    // Sort newest first
    metadataList.sort((a, b) => b.createdAt - a.createdAt);
    return metadataList;
  }

  public async restoreSnapshot(
    id: string,
  ): Promise<{ success: boolean; accountCount: number }> {
    const snapshot = await this.getSnapshot(id);
    if (!snapshot) {
      throw new Error(`Snapshot not found with ID ${id}`);
    }

    // Restore accounts in AccountStore
    await this.accountStore.restoreAccounts(
      snapshot.accounts,
      snapshot.activeAccountId,
    );

    // If snapshot has auto-switch config and service is present, restore it
    if (snapshot.autoSwitchConfig && this.autoSwitchService) {
      this.autoSwitchService.setConfig(snapshot.autoSwitchConfig);
    }

    return {
      success: true,
      accountCount: snapshot.accountCount,
    };
  }

  public async deleteSnapshot(id: string): Promise<boolean> {
    const filePath = this.getSnapshotFilePath(id);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    await fs.promises.unlink(filePath);
    return true;
  }
}
