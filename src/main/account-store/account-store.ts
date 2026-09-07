import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AccountStoreData,
  GoogleAccount,
  TokenData,
  EncryptedStoreEnvelope,
  AccountStatus,
  QuotaData,
} from "../../shared/types";
import { StoreTamperException } from "./types";
import { deriveMasterKey, generateSalt } from "./master-key";

export interface AccountStoreOptions {
  storePath: string;
  machineId?: string;
}

const GCM_IV_LENGTH = 12; // 96 bits
const GCM_AUTH_TAG_LENGTH = 16; // 128 bits
const CURRENT_SCHEMA_VERSION = 1;

export class AccountStore {
  private readonly storePath: string;
  private readonly machineId?: string;
  private cachedData: AccountStoreData | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options: AccountStoreOptions) {
    if (!options.storePath) {
      throw new Error("Store path must be specified");
    }
    this.storePath = path.resolve(options.storePath);
    this.machineId = options.machineId;
  }

  public getStorePath(): string {
    return this.storePath;
  }

  private createEmptyStore(): AccountStoreData {
    return {
      version: CURRENT_SCHEMA_VERSION,
      activeAccountId: null,
      accounts: {},
    };
  }

  public async load(): Promise<AccountStoreData> {
    if (!fs.existsSync(this.storePath)) {
      this.cachedData = this.createEmptyStore();
      return this.cachedData;
    }

    let fileContent: string;
    try {
      fileContent = await fs.promises.readFile(this.storePath, "utf8");
    } catch (err) {
      throw new Error(
        `Failed to read account store file: ${(err as Error).message}`,
      );
    }

    let envelope: EncryptedStoreEnvelope;
    try {
      envelope = JSON.parse(fileContent) as EncryptedStoreEnvelope;
    } catch {
      await this.handleCorruptedFile("Malformed JSON envelope in store file");
      throw new StoreTamperException(
        "Store envelope is malformed or corrupted",
        this.storePath,
      );
    }

    if (
      !envelope ||
      envelope.version !== CURRENT_SCHEMA_VERSION ||
      envelope.cipher !== "aes-256-gcm" ||
      !envelope.iv ||
      !envelope.authTag ||
      !envelope.ciphertext ||
      !envelope.salt
    ) {
      await this.handleCorruptedFile(
        "Invalid envelope structure or unsupported cipher",
      );
      throw new StoreTamperException(
        "Invalid or unrecognized store envelope structure",
        this.storePath,
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

      const data = JSON.parse(decrypted) as AccountStoreData;
      this.cachedData = data;
      return data;
    } catch (err) {
      const errorMsg = (err as Error).message;
      const backupPath = await this.handleCorruptedFile(
        `Decryption or integrity verification failed: ${errorMsg}`,
      );
      throw new StoreTamperException(
        `Account store authentication failed. Data may have been tampered with or corrupted: ${errorMsg}`,
        backupPath,
      );
    }
  }

  private async handleCorruptedFile(_reason: string): Promise<string> {
    const timestamp = Date.now();
    const backupPath = `${this.storePath}.corrupted.${timestamp}`;
    try {
      if (fs.existsSync(this.storePath)) {
        await fs.promises.rename(this.storePath, backupPath);
      }
    } catch {
      // Ignore backup rename failures if source was missing
    }
    return backupPath;
  }

  public async save(data: AccountStoreData): Promise<void> {
    const operation = async () => {
      const salt = generateSalt(16);
      const iv = crypto.randomBytes(GCM_IV_LENGTH);
      const key = deriveMasterKey(salt, this.machineId);

      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const plaintext = JSON.stringify(data);

      let ciphertext = cipher.update(plaintext, "utf8", "hex");
      ciphertext += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      const envelope: EncryptedStoreEnvelope = {
        version: CURRENT_SCHEMA_VERSION,
        cipher: "aes-256-gcm",
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
        ciphertext,
        salt: salt.toString("hex"),
        updatedAt: Date.now(),
      };

      await this.atomicWrite(JSON.stringify(envelope, null, 2));
      this.cachedData = data;
    };

    // Chain onto write lock to guarantee atomic serialized saves
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

  private async ensureLoaded(): Promise<AccountStoreData> {
    if (this.cachedData) {
      return this.cachedData;
    }
    return this.load();
  }

  public async getAll(): Promise<GoogleAccount[]> {
    const data = await this.ensureLoaded();
    return Object.values(data.accounts);
  }

  public async get(id: string): Promise<GoogleAccount | null> {
    const data = await this.ensureLoaded();
    return data.accounts[id] || null;
  }

  public async getActive(): Promise<GoogleAccount | null> {
    const data = await this.ensureLoaded();
    if (!data.activeAccountId) {
      return null;
    }
    return data.accounts[data.activeAccountId] || null;
  }

  public async saveAccount(account: GoogleAccount): Promise<void> {
    const data = await this.ensureLoaded();
    const existing = data.accounts[account.id];
    const now = Date.now();

    data.accounts[account.id] = {
      ...account,
      createdAt: existing ? existing.createdAt : account.createdAt || now,
      updatedAt: now,
    };

    // If activeAccountId is not set and this is the first account, make it active
    if (!data.activeAccountId) {
      data.activeAccountId = account.id;
    }

    await this.save(data);
  }

  public async delete(id: string): Promise<boolean> {
    const data = await this.ensureLoaded();
    if (!data.accounts[id]) {
      return false;
    }

    delete data.accounts[id];

    if (data.activeAccountId === id) {
      const remainingIds = Object.keys(data.accounts);
      data.activeAccountId = remainingIds.length > 0 ? remainingIds[0] : null;
      data.lastSwappedAt = Date.now();
    }

    await this.save(data);
    return true;
  }

  public async setActive(id: string): Promise<boolean> {
    const data = await this.ensureLoaded();
    if (!data.accounts[id]) {
      return false;
    }

    data.activeAccountId = id;
    data.lastSwappedAt = Date.now();
    data.accounts[id].lastUsedAt = Date.now();

    await this.save(data);
    return true;
  }

  public async updateTokens(id: string, tokens: TokenData): Promise<boolean> {
    const data = await this.ensureLoaded();
    const account = data.accounts[id];
    if (!account) {
      return false;
    }

    account.tokens = {
      ...account.tokens,
      ...tokens,
    };
    account.status = "active";
    account.updatedAt = Date.now();

    await this.save(data);
    return true;
  }

  public async updateQuota(id: string, quota: QuotaData): Promise<boolean> {
    const data = await this.ensureLoaded();
    const account = data.accounts[id];
    if (!account) {
      return false;
    }

    account.quota = quota;
    account.updatedAt = Date.now();

    await this.save(data);
    return true;
  }

  public async updateStatus(
    id: string,
    status: AccountStatus,
  ): Promise<boolean> {
    const data = await this.ensureLoaded();
    const account = data.accounts[id];
    if (!account) {
      return false;
    }

    account.status = status;
    account.updatedAt = Date.now();

    await this.save(data);
    return true;
  }

  public async restoreAccounts(
    accounts: Record<string, GoogleAccount>,
    activeAccountId: string | null,
  ): Promise<void> {
    const data = await this.ensureLoaded();
    data.accounts = { ...accounts };
    data.activeAccountId = activeAccountId;
    data.lastSwappedAt = Date.now();

    await this.save(data);
  }

  public async getStoreData(): Promise<AccountStoreData> {
    return this.ensureLoaded();
  }
}
