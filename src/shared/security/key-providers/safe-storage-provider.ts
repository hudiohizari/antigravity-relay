import crypto from "node:crypto";
import childProcess from "node:child_process";
import fs from "fs/promises";
import type {
  KeyReadResult,
  MasterKeyProvider,
} from "@/shared/security/master-key-manager";

const MASTER_KEY_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function tryDecryptWithChromiumOscrypt(
  encryptedKey: Buffer,
): Buffer | null {
  if (process.platform !== "darwin" || encryptedKey.length <= 3) {
    return null;
  }
  const header = encryptedKey.subarray(0, 3).toString("utf8");
  if (header !== "v10") {
    return null;
  }

  const services = [
    "Antigravity Relay Safe Storage",
    "Antigravity Relay Dev Safe Storage",
    "Chromium Safe Storage",
  ];
  for (const service of services) {
    try {
      const password = (
        childProcess.execSync(
          `security find-generic-password -s "${service}" -w`,
          {
            timeout: 1000,
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
          },
        ) as string
      ).trim();
      if (!password) {
        continue;
      }

      const salt = "saltysalt";
      const iterations = 1003;
      const key = crypto.pbkdf2Sync(password, salt, iterations, 16, "sha1");
      const iv = Buffer.alloc(16, " ");
      const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
      let decrypted = decipher.update(encryptedKey.subarray(3));
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      const decryptedStr = decrypted.toString("utf8");
      if (MASTER_KEY_HEX_PATTERN.test(decryptedStr)) {
        return Buffer.from(decryptedStr, "hex");
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function readKeyFile(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export class SafeStorageMasterKeyProvider implements MasterKeyProvider {
  readonly source = "safeStorage" as const;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  async read(): Promise<KeyReadResult> {
    let encryptedKey: Buffer | null;
    try {
      encryptedKey = await readKeyFile(this.filePath);
    } catch (error) {
      return { status: "unavailable", source: this.source, error };
    }

    if (!encryptedKey) {
      return { status: "missing", source: this.source };
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      const fallbackKey = tryDecryptWithChromiumOscrypt(encryptedKey);
      if (fallbackKey) {
        return { status: "available", source: this.source, key: fallbackKey };
      }
      return {
        status: "unavailable",
        source: this.source,
        error: new Error("safeStorage is unavailable"),
      };
    }

    try {
      const decryptedKey = this.safeStorage.decryptString(encryptedKey);
      if (!MASTER_KEY_HEX_PATTERN.test(decryptedKey)) {
        return {
          status: "corrupt",
          source: this.source,
          error: new Error("V2 safeStorage key has an invalid format"),
        };
      }

      return {
        status: "available",
        source: this.source,
        key: Buffer.from(decryptedKey, "hex"),
      };
    } catch (error) {
      const fallbackKey = tryDecryptWithChromiumOscrypt(encryptedKey);
      if (fallbackKey) {
        return { status: "available", source: this.source, key: fallbackKey };
      }
      return { status: "unavailable", source: this.source, error };
    }
  }

  async write(key: Buffer): Promise<void> {
    const existing = await this.read();
    if (existing.status === "available") {
      if (existing.key.equals(key)) {
        return;
      }

      throw new Error("V2 safeStorage slot contains a different master key");
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage is unavailable");
    }

    const encryptedKey = this.safeStorage.encryptString(key.toString("hex"));
    try {
      await fs.writeFile(this.filePath, encryptedKey, { mode: 0o600 });
    } catch (error) {
      throw new Error("Failed to write V2 safeStorage key", { cause: error });
    }
  }
}

/**
 * Reads the historical `.mk` safeStorage format without ever modifying it.
 */
export class LegacySafeStorageProvider implements MasterKeyProvider {
  readonly source = "legacy-safeStorage" as const;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  async read(): Promise<KeyReadResult> {
    let encryptedKey: Buffer | null;
    try {
      encryptedKey = await readKeyFile(this.filePath);
    } catch (error) {
      return { status: "unavailable", source: this.source, error };
    }

    if (!encryptedKey) {
      return { status: "missing", source: this.source };
    }

    if (MASTER_KEY_HEX_PATTERN.test(encryptedKey.toString("utf8"))) {
      return { status: "missing", source: this.source };
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
      return {
        status: "unavailable",
        source: this.source,
        error: new Error("safeStorage is unavailable"),
      };
    }

    try {
      const decryptedKey = this.safeStorage.decryptString(encryptedKey);
      if (!MASTER_KEY_HEX_PATTERN.test(decryptedKey)) {
        return {
          status: "corrupt",
          source: this.source,
          error: new Error("Legacy safeStorage key has an invalid format"),
        };
      }

      return {
        status: "available",
        source: this.source,
        key: Buffer.from(decryptedKey, "hex"),
      };
    } catch (error) {
      return { status: "unavailable", source: this.source, error };
    }
  }
}
