import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegacySafeStorageProvider,
  SafeStorageMasterKeyProvider,
  tryDecryptWithChromiumOscrypt,
} from "@/shared/security/key-providers/safe-storage-provider";
import { FileMasterKeyProvider } from "@/shared/security/key-providers/file-provider";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => {
      return fs.rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("legacy master-key providers", () => {
  it("leaves an existing legacy safeStorage file unchanged when safeStorage is unavailable", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agm-master-key-"),
    );
    temporaryDirectories.push(directory);
    const legacyPath = path.join(directory, ".mk");
    const original = Buffer.from([0, 255, 12, 42, 99, 1, 7]);
    await fs.writeFile(legacyPath, original);
    const provider = new LegacySafeStorageProvider(legacyPath, {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("not available");
      },
      decryptString: () => {
        throw new Error("not available");
      },
    });

    const result = await provider.read();
    const after = await fs.readFile(legacyPath);

    expect(result.status).toBe("unavailable");
    expect(after.equals(original)).toBe(true);
  });

  it("never overwrites a conflicting V2 compatibility key", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agm-master-key-"),
    );
    temporaryDirectories.push(directory);
    const keyPath = path.join(directory, "master-key.v2.file");
    const original = "11".repeat(32);
    await fs.writeFile(keyPath, original, "utf8");
    const provider = new FileMasterKeyProvider(keyPath);

    await expect(
      provider.write(Buffer.from("22".repeat(32), "hex")),
    ).rejects.toThrow("different master key");

    expect(await fs.readFile(keyPath, "utf8")).toBe(original);
  });

  it("reports a safeStorage slot read permission error as unavailable", async () => {
    const permissionError = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const readFileSpy = vi
      .spyOn(fs, "readFile")
      .mockRejectedValueOnce(permissionError);
    const provider = new LegacySafeStorageProvider("unreadable.mk", {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "11".repeat(32),
    });

    await expect(provider.read()).resolves.toEqual({
      status: "unavailable",
      source: "legacy-safeStorage",
      error: permissionError,
    });

    readFileSpy.mockRestore();
  });

  it("allows SafeStorageMasterKeyProvider to self-heal an unreadable slot with verified key", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agm-master-key-"),
    );
    temporaryDirectories.push(directory);
    const safePath = path.join(directory, "master-key.v2.safe");
    await fs.writeFile(safePath, Buffer.from("unreadable-garbage"));

    const provider = new SafeStorageMasterKeyProvider(safePath, {
      isEncryptionAvailable: () => true,
      encryptString: (val: string) => Buffer.from(`encrypted:${val}`),
      decryptString: () => {
        throw new Error("decryption failed");
      },
    });

    // Initial read is unavailable
    const initialRead = await provider.read();
    expect(initialRead.status).toBe("unavailable");

    // Healing write succeeds
    const newKey = Buffer.from("aa".repeat(32), "hex");
    await provider.write(newKey);

    const writtenContent = await fs.readFile(safePath, "utf8");
    expect(writtenContent).toBe(`encrypted:${newKey.toString("hex")}`);
  });

  it("rejects overwriting a different valid key in SafeStorageMasterKeyProvider", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agm-master-key-"),
    );
    temporaryDirectories.push(directory);
    const safePath = path.join(directory, "master-key.v2.safe");
    const existingKeyHex = "11".repeat(32);
    await fs.writeFile(safePath, Buffer.from("valid-encrypted-bytes"));

    const provider = new SafeStorageMasterKeyProvider(safePath, {
      isEncryptionAvailable: () => true,
      encryptString: (val: string) => Buffer.from(`encrypted:${val}`),
      decryptString: () => existingKeyHex,
    });

    const diffKey = Buffer.from("22".repeat(32), "hex");
    await expect(provider.write(diffKey)).rejects.toThrow(
      "contains a different master key",
    );
  });

  it("probes Keychain identities in sequence and decrypts macOS OSCrypt payload", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const rawKeyHex = "ab".repeat(32);
    const password = "mock-keychain-password";
    const salt = "saltysalt";
    const iterations = 1003;
    const derivedKey = crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      16,
      "sha1",
    );
    const iv = Buffer.alloc(16, " ");
    const cipher = crypto.createCipheriv("aes-128-cbc", derivedKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawKeyHex, "utf8"),
      cipher.final(),
    ]);
    const encryptedPayload = Buffer.concat([
      Buffer.from("v10", "utf8"),
      ciphertext,
    ]);

    const probedServices: string[] = [];
    const execSyncSpy = vi
      .spyOn(childProcess, "execSync")
      .mockImplementation((command: any) => {
        const cmd = String(command);
        const match = cmd.match(/-s "([^"]+)"/);
        if (match) {
          probedServices.push(match[1]);
        }
        if (cmd.includes('"Antigravity Relay Safe Storage"')) {
          return `${password}\n`;
        }
        throw new Error("Item not found");
      });

    try {
      const decrypted = tryDecryptWithChromiumOscrypt(encryptedPayload);
      expect(decrypted?.toString("hex")).toBe(rawKeyHex);
      expect(probedServices).toEqual(["Antigravity Relay Safe Storage"]);
    } finally {
      execSyncSpy.mockRestore();
    }
  });

  it("probes next Keychain identities when earlier items fail", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const rawKeyHex = "cd".repeat(32);
    const password = "dev-password";
    const salt = "saltysalt";
    const iterations = 1003;
    const derivedKey = crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      16,
      "sha1",
    );
    const iv = Buffer.alloc(16, " ");
    const cipher = crypto.createCipheriv("aes-128-cbc", derivedKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawKeyHex, "utf8"),
      cipher.final(),
    ]);
    const encryptedPayload = Buffer.concat([
      Buffer.from("v10", "utf8"),
      ciphertext,
    ]);

    const probedServices: string[] = [];
    const execSyncSpy = vi
      .spyOn(childProcess, "execSync")
      .mockImplementation((command: any) => {
        const cmd = String(command);
        const match = cmd.match(/-s "([^"]+)"/);
        if (match) {
          probedServices.push(match[1]);
        }
        if (cmd.includes('"Antigravity Relay Dev Safe Storage"')) {
          return `${password}\n`;
        }
        throw new Error("Item not found");
      });

    try {
      const decrypted = tryDecryptWithChromiumOscrypt(encryptedPayload);
      expect(decrypted?.toString("hex")).toBe(rawKeyHex);
      expect(probedServices).toEqual([
        "Antigravity Relay Safe Storage",
        "Antigravity Relay Dev Safe Storage",
      ]);
    } finally {
      execSyncSpy.mockRestore();
    }
  });

  it("probes Chromium Safe Storage if both production and dev safe storage items fail", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const rawKeyHex = "ef".repeat(32);
    const password = "chromium-password";
    const salt = "saltysalt";
    const iterations = 1003;
    const derivedKey = crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      16,
      "sha1",
    );
    const iv = Buffer.alloc(16, " ");
    const cipher = crypto.createCipheriv("aes-128-cbc", derivedKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawKeyHex, "utf8"),
      cipher.final(),
    ]);
    const encryptedPayload = Buffer.concat([
      Buffer.from("v10", "utf8"),
      ciphertext,
    ]);

    const probedServices: string[] = [];
    const execSyncSpy = vi
      .spyOn(childProcess, "execSync")
      .mockImplementation((command: any) => {
        const cmd = String(command);
        const match = cmd.match(/-s "([^"]+)"/);
        if (match) {
          probedServices.push(match[1]);
        }
        if (cmd.includes('"Chromium Safe Storage"')) {
          return `${password}\n`;
        }
        throw new Error("Item not found");
      });

    try {
      const decrypted = tryDecryptWithChromiumOscrypt(encryptedPayload);
      expect(decrypted?.toString("hex")).toBe(rawKeyHex);
      expect(probedServices).toEqual([
        "Antigravity Relay Safe Storage",
        "Antigravity Relay Dev Safe Storage",
        "Chromium Safe Storage",
      ]);
    } finally {
      execSyncSpy.mockRestore();
    }
  });

  it("SafeStorageMasterKeyProvider falls back to Chromium OSCrypt when decryptString fails", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "agm-master-key-"),
    );
    temporaryDirectories.push(directory);
    const safePath = path.join(directory, "master-key.v2.safe");

    const rawKeyHex = "12".repeat(32);
    const password = "prod-password";
    const salt = "saltysalt";
    const iterations = 1003;
    const derivedKey = crypto.pbkdf2Sync(
      password,
      salt,
      iterations,
      16,
      "sha1",
    );
    const iv = Buffer.alloc(16, " ");
    const cipher = crypto.createCipheriv("aes-128-cbc", derivedKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawKeyHex, "utf8"),
      cipher.final(),
    ]);
    const encryptedPayload = Buffer.concat([
      Buffer.from("v10", "utf8"),
      ciphertext,
    ]);
    await fs.writeFile(safePath, encryptedPayload);

    const execSyncSpy = vi
      .spyOn(childProcess, "execSync")
      .mockImplementation((command: any) => {
        const cmd = String(command);
        if (cmd.includes('"Antigravity Relay Safe Storage"')) {
          return `${password}\n`;
        }
        throw new Error("Item not found");
      });

    try {
      const provider = new SafeStorageMasterKeyProvider(safePath, {
        isEncryptionAvailable: () => true,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => {
          throw new Error("OS safeStorage decryption failed");
        },
      });

      const readResult = await provider.read();
      expect(readResult.status).toBe("available");
      if (readResult.status === "available") {
        expect(readResult.key.toString("hex")).toBe(rawKeyHex);
      }
    } finally {
      execSyncSpy.mockRestore();
    }
  });
});
