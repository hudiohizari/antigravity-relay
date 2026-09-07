import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { AccountStore } from "../src/main/account-store/account-store";
import {
  deriveMasterKey,
  generateSalt,
  getSystemHardwareId,
  resetHardwareIdCache,
} from "../src/main/account-store/master-key";
import { StoreTamperException } from "../src/main/account-store/types";
import { GoogleAccount, TokenData } from "../src/shared/types";

describe("Master Key Derivation", () => {
  beforeEach(() => {
    resetHardwareIdCache();
  });

  it("should derive a 32-byte key using PBKDF2", () => {
    const salt = generateSalt(16);
    const key = deriveMasterKey(salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("should generate deterministic keys for the same salt and identifier", () => {
    const salt = generateSalt(16);
    const id = "test-machine-id-12345";
    const key1 = deriveMasterKey(salt, id);
    const key2 = deriveMasterKey(salt, id);
    expect(key1.equals(key2)).toBe(true);
  });

  it("should generate different keys for different salts or identifiers", () => {
    const salt1 = generateSalt(16);
    const salt2 = generateSalt(16);
    const key1 = deriveMasterKey(salt1, "machine-a");
    const key2 = deriveMasterKey(salt2, "machine-a");
    const key3 = deriveMasterKey(salt1, "machine-b");
    expect(key1.equals(key2)).toBe(false);
    expect(key1.equals(key3)).toBe(false);
  });

  it("should reject invalid or short salts", () => {
    expect(() => deriveMasterKey(Buffer.from("too-short"))).toThrow(
      "Salt must be a Buffer of at least 16 bytes",
    );
    expect(() => deriveMasterKey("not-a-buffer" as unknown as Buffer)).toThrow(
      "Salt must be a Buffer of at least 16 bytes",
    );
  });

  it("should resolve system hardware identifier and cache it", () => {
    const id1 = getSystemHardwareId();
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);

    const id2 = getSystemHardwareId();
    expect(id1).toBe(id2);
  });

  it("should fall through on darwin when ioreg output does not contain uuid", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(childProcess, "execSync").mockReturnValue("not matching output");

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should resolve hardware id on linux platform when machine-id exists", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      String(p).includes("machine-id"),
    );
    vi.spyOn(fs, "readFileSync").mockImplementation((p) => {
      if (String(p).includes("machine-id")) return "linux-machine-id-abc\n";
      return "";
    });

    const id = getSystemHardwareId();
    expect(id).toBe("linux-machine-id-abc");

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should fall through on linux when machine-id is empty", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(fs, "existsSync").mockImplementation((p) =>
      String(p).includes("machine-id"),
    );
    vi.spyOn(fs, "readFileSync").mockReturnValue("   \n");

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should resolve hardware id on win32 platform using reg query", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("win32");
    vi.spyOn(childProcess, "execSync").mockReturnValue(
      "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\n    MachineGuid    REG_SZ    d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a\n",
    );

    const id = getSystemHardwareId();
    expect(id).toBe("d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a");

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should fall through on darwin when execSync throws", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    vi.spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("ioreg failed");
    });

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should fall through on linux when readFileSync throws", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("EACCES");
    });

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should fall through on win32 when execSync throws", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("win32");
    vi.spyOn(childProcess, "execSync").mockImplementation(() => {
      throw new Error("reg failed");
    });

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should fall through on win32 when reg query output does not match", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("win32");

    const fallbackId = getSystemHardwareId();
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should cover fallback platform fingerprint when commands fail", () => {
    resetHardwareIdCache();
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("unknown" as NodeJS.Platform);

    const fallbackId = getSystemHardwareId();
    expect(typeof fallbackId).toBe("string");
    expect(fallbackId.length).toBe(64);

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });
});

describe("Account Store Persistence and Integrity", () => {
  let tempDir: string;
  let storeFile: string;
  let store: AccountStore;

  const mockTokens: TokenData = {
    access_token: "mock-access-token-12345",
    refresh_token: "mock-refresh-token-67890",
    expires_in: 3600,
    expiry_timestamp: Date.now() + 3600_000,
    token_type: "Bearer",
    scope: "openid email profile",
    id_token: "mock-id-token",
  };

  const mockAccount: GoogleAccount = {
    id: "user-google-1",
    email: "developer@example.com",
    avatarUrl: "https://example.com/photo.jpg",
    status: "active",
    tokens: mockTokens,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "account-store-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    store = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup error ignored
    }
  });

  it("should return the resolved store path", () => {
    expect(store.getStorePath()).toBe(path.resolve(storeFile));
  });

  it("should throw when reading store file encounters an IO error", async () => {
    fs.writeFileSync(storeFile, "some content");
    vi.spyOn(fs.promises, "readFile").mockRejectedValueOnce(
      new Error("Permission denied"),
    );
    await expect(store.load()).rejects.toThrow(
      "Failed to read account store file: Permission denied",
    );
    vi.restoreAllMocks();
  });

  it("should throw when storePath is empty", () => {
    expect(() => new AccountStore({ storePath: "" })).toThrow(
      "Store path must be specified",
    );
  });

  it("should return initial empty store when file does not exist", async () => {
    const data = await store.load();
    expect(data.version).toBe(1);
    expect(data.activeAccountId).toBeNull();
    expect(data.accounts).toEqual({});
  });

  it("should encrypt accounts and contain zero plaintext tokens on disk", async () => {
    await store.saveAccount(mockAccount);

    expect(fs.existsSync(storeFile)).toBe(true);
    const rawContent = fs.readFileSync(storeFile, "utf8");

    // Verify plaintext is absent from physical disk file
    expect(rawContent).not.toContain(mockAccount.email);
    expect(rawContent).not.toContain(mockTokens.access_token);
    expect(rawContent).not.toContain(mockTokens.refresh_token);

    // Verify envelope format
    const envelope = JSON.parse(rawContent);
    expect(envelope.version).toBe(1);
    expect(envelope.cipher).toBe("aes-256-gcm");
    expect(typeof envelope.iv).toBe("string");
    expect(typeof envelope.authTag).toBe("string");
    expect(typeof envelope.ciphertext).toBe("string");
    expect(typeof envelope.salt).toBe("string");
    expect(envelope.iv.length).toBe(24); // 12 bytes hex
    expect(envelope.authTag.length).toBe(32); // 16 bytes hex

    // Reload with new store instance
    const reloadedStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });
    const loadedAccounts = await reloadedStore.getAll();
    expect(loadedAccounts.length).toBe(1);
    expect(loadedAccounts[0].email).toBe(mockAccount.email);
    expect(loadedAccounts[0].tokens.access_token).toBe(mockTokens.access_token);
  });

  it("should reject tampered ciphertext and backup damaged file", async () => {
    await store.saveAccount(mockAccount);

    const rawContent = fs.readFileSync(storeFile, "utf8");
    const envelope = JSON.parse(rawContent);

    // Flip a byte in the ciphertext
    const ciphertextBuf = Buffer.from(envelope.ciphertext, "hex");
    ciphertextBuf[0] ^= 0xff;
    envelope.ciphertext = ciphertextBuf.toString("hex");
    fs.writeFileSync(storeFile, JSON.stringify(envelope));

    const badStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });

    await expect(badStore.load()).rejects.toThrow(StoreTamperException);

    // Original file should be moved to .corrupted.<timestamp>
    const files = fs.readdirSync(tempDir);
    const corruptedBackup = files.find((f) => f.includes(".corrupted."));
    expect(corruptedBackup).toBeDefined();
  });

  it("should reject tampered authTag", async () => {
    await store.saveAccount(mockAccount);

    const rawContent = fs.readFileSync(storeFile, "utf8");
    const envelope = JSON.parse(rawContent);

    // Corrupt auth tag
    const tagBuf = Buffer.from(envelope.authTag, "hex");
    tagBuf[tagBuf.length - 1] ^= 0xaa;
    envelope.authTag = tagBuf.toString("hex");
    fs.writeFileSync(storeFile, JSON.stringify(envelope));

    const badStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });

    await expect(badStore.load()).rejects.toThrow(StoreTamperException);
  });

  it("should reject malformed JSON file content", async () => {
    fs.writeFileSync(storeFile, "Not valid json {{{");

    const badStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });

    await expect(badStore.load()).rejects.toThrow(StoreTamperException);
  });

  it("should reject invalid envelope fields or unsupported cipher", async () => {
    fs.writeFileSync(
      storeFile,
      JSON.stringify({
        version: 99,
        cipher: "des",
      }),
    );

    const badStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });

    await expect(badStore.load()).rejects.toThrow(StoreTamperException);
  });

  it("should reject wrong IV or authTag byte length", async () => {
    fs.writeFileSync(
      storeFile,
      JSON.stringify({
        version: 1,
        cipher: "aes-256-gcm",
        iv: "010203", // too short
        authTag: "010203",
        ciphertext: "deadbeef",
        salt: crypto.randomBytes(16).toString("hex"),
        updatedAt: Date.now(),
      }),
    );

    const badStore = new AccountStore({
      storePath: storeFile,
      machineId: "fixed-test-machine-id",
    });

    await expect(badStore.load()).rejects.toThrow(StoreTamperException);
  });

  it("should perform complete CRUD operations seamlessly", async () => {
    // 1. Initial empty
    expect(await store.getAll()).toEqual([]);
    expect(await store.get("missing-id")).toBeNull();
    expect(await store.getActive()).toBeNull();

    // 2. Add first account (becomes active automatically)
    await store.saveAccount(mockAccount);
    const active = await store.getActive();
    expect(active).not.toBeNull();
    expect(active?.id).toBe(mockAccount.id);

    // 3. Add second account
    const secondAccount: GoogleAccount = {
      id: "user-google-2",
      email: "team@example.com",
      status: "active",
      tokens: { ...mockTokens, access_token: "token-2" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.saveAccount(secondAccount);

    const all = await store.getAll();
    expect(all.length).toBe(2);

    // 4. Set active account
    const switchRes = await store.setActive("user-google-2");
    expect(switchRes).toBe(true);
    const currentActive = await store.getActive();
    expect(currentActive?.id).toBe("user-google-2");

    // Fail to set unknown account active
    const failedSwitch = await store.setActive("non-existent");
    expect(failedSwitch).toBe(false);

    // 5. Update tokens
    const updatedRes = await store.updateTokens("user-google-1", {
      ...mockTokens,
      access_token: "new-refreshed-token",
    });
    expect(updatedRes).toBe(true);

    const refreshed = await store.get("user-google-1");
    expect(refreshed?.tokens.access_token).toBe("new-refreshed-token");

    // Fail update on non-existent account
    const failedUpdate = await store.updateTokens("non-existent", mockTokens);
    expect(failedUpdate).toBe(false);

    // 6. Delete account
    // Deleting active account selects remaining account
    const deleteActiveRes = await store.delete("user-google-2");
    expect(deleteActiveRes).toBe(true);

    const postDeleteActive = await store.getActive();
    expect(postDeleteActive?.id).toBe("user-google-1");

    // Delete remaining account
    await store.delete("user-google-1");
    expect(await store.getActive()).toBeNull();
    expect(await store.getAll()).toEqual([]);

    // Delete non-existent
    expect(await store.delete("user-google-1")).toBe(false);
  });

  it("should automatically create parent directory if missing on atomic write", async () => {
    const nestedFile = path.join(
      tempDir,
      "nested",
      "deep",
      "accounts.enc.json",
    );
    const nestedStore = new AccountStore({
      storePath: nestedFile,
      machineId: "fixed-test-machine-id",
    });

    await nestedStore.saveAccount(mockAccount);
    expect(fs.existsSync(nestedFile)).toBe(true);
    expect((await nestedStore.getAll()).length).toBe(1);
  });

  it("should swallow error when renaming corrupted file fails", async () => {
    await store.saveAccount(mockAccount);
    fs.writeFileSync(storeFile, "{ corrupted");

    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
      new Error("Rename failed"),
    );

    await expect(store.load()).rejects.toThrow(StoreTamperException);
    vi.restoreAllMocks();
  });

  it("should default createdAt to now when omitted on new account", async () => {
    const accWithoutCreated: GoogleAccount = {
      ...mockAccount,
      id: "no-created-id",
      createdAt: 0,
    };
    await store.saveAccount(accWithoutCreated);
    const saved = await store.get("no-created-id");
    expect(saved?.createdAt).toBeGreaterThan(0);
  });
});
