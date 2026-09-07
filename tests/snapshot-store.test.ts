import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AccountStore } from "../src/main/account-store/account-store";
import { SnapshotStore } from "../src/main/snapshots/snapshot-store";
import { SNAPSHOT_SCHEMA_VERSION } from "../src/main/snapshots/types";
import { StoreTamperException } from "../src/main/account-store/types";
import { AutoSwitchService } from "../src/main/switcher/auto-switch.service";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { GoogleAccount } from "../src/shared/types";

describe("Snapshot Store Encrypted Lifecycle", () => {
  let tempDir: string;
  let storeFile: string;
  let snapshotsDir: string;
  let accountStore: AccountStore;
  let autoSwitchService: AutoSwitchService;

  const sampleAccount: GoogleAccount = {
    id: "snapshot-acc-1",
    email: "snapshot@example.com",
    status: "active",
    tokens: {
      access_token: "super-secret-access-token-12345",
      refresh_token: "super-secret-refresh-token-67890",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    snapshotsDir = path.join(tempDir, "snapshots");

    accountStore = new AccountStore({
      storePath: storeFile,
      machineId: "snapshot-machine-id",
    });

    const rateLimitTracker = new RateLimitTracker();
    autoSwitchService = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    await accountStore.saveAccount(sampleAccount);
    await accountStore.setActive(sampleAccount.id);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should enforce mandatory snapshots directory in constructor", () => {
    expect(
      () =>
        new SnapshotStore({
          snapshotsDir: "",
          accountStore,
        }),
    ).toThrow("Snapshots directory must be specified");
  });

  it("should validate snapshot name cannot be blank", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
    });

    await expect(store.createSnapshot({ name: "" })).rejects.toThrow(
      "Snapshot name cannot be empty",
    );
    await expect(store.createSnapshot({ name: "   " })).rejects.toThrow(
      "Snapshot name cannot be empty",
    );
  });

  it("should create AES-256-GCM encrypted snapshot with zero plaintext tokens on disk", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      autoSwitchService,
      machineId: "snapshot-machine-id",
    });

    const metadata = await store.createSnapshot({
      name: "Production Baseline",
      description: "Pre-deployment state backup",
    });

    expect(metadata.id).toBeDefined();
    expect(metadata.name).toBe("Production Baseline");
    expect(metadata.description).toBe("Pre-deployment state backup");
    expect(metadata.accountCount).toBe(1);
    expect(metadata.activeAccountEmail).toBe(sampleAccount.email);
    expect(metadata.sizeBytes).toBeGreaterThan(0);

    // Verify raw file on disk
    const rawFilePath = path.join(snapshotsDir, `${metadata.id}.enc.json`);
    expect(fs.existsSync(rawFilePath)).toBe(true);

    const rawContent = fs.readFileSync(rawFilePath, "utf8");
    const envelope = JSON.parse(rawContent);

    expect(envelope.cipher).toBe("aes-256-gcm");
    expect(envelope.version).toBe(1);
    expect(envelope.iv).toHaveLength(24); // 12 bytes hex
    expect(envelope.authTag).toHaveLength(32); // 16 bytes hex
    expect(envelope.salt).toHaveLength(32); // 16 bytes hex

    // Security assertion: Zero leaked secrets on disk
    expect(rawContent).not.toContain(sampleAccount.tokens.access_token);
    expect(rawContent).not.toContain(sampleAccount.tokens.refresh_token);
  });

  it("should list snapshots sorted by date with zero exposed tokens", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      machineId: "snapshot-machine-id",
    });

    const emptyList = await store.listSnapshots();
    expect(emptyList).toEqual([]);

    const snap1 = await store.createSnapshot({ name: "Snapshot One" });
    const snap2 = await store.createSnapshot({ name: "Snapshot Two" });

    const list = await store.listSnapshots();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(snap2.id); // Newest first
    expect(list[1].id).toBe(snap1.id);

    // Verify metadata does not contain tokens property
    for (const item of list) {
      expect((item as any).tokens).toBeUndefined();
      expect((item as any).accounts).toBeUndefined();
    }
  });

  it("should decrypt and retrieve full AccountSnapshot", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      autoSwitchService,
      machineId: "snapshot-machine-id",
    });

    const meta = await store.createSnapshot({ name: "Detail Snapshot" });
    const snapshot = await store.getSnapshot(meta.id);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.id).toBe(meta.id);
    expect(snapshot?.accounts[sampleAccount.id].tokens.access_token).toBe(
      sampleAccount.tokens.access_token,
    );
    expect(snapshot?.autoSwitchConfig).toBeDefined();

    const notFound = await store.getSnapshot("non-existent-id");
    expect(notFound).toBeNull();
  });

  it("should atomically restore accounts and config from a snapshot", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      autoSwitchService,
      machineId: "snapshot-machine-id",
    });

    autoSwitchService.setConfig({ minQuotaThresholdPercent: 33 });
    const meta = await store.createSnapshot({ name: "State Before Wipe" });

    // Wipe or alter account store
    await accountStore.delete(sampleAccount.id);
    autoSwitchService.setConfig({ minQuotaThresholdPercent: 10 });
    expect(await accountStore.getAll()).toEqual([]);

    // Restore
    const restoreResult = await store.restoreSnapshot(meta.id);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.accountCount).toBe(1);

    // Verify accounts restored
    const accountsAfter = await accountStore.getAll();
    expect(accountsAfter.length).toBe(1);
    expect(accountsAfter[0].id).toBe(sampleAccount.id);

    // Verify config restored
    expect(autoSwitchService.getConfig().minQuotaThresholdPercent).toBe(33);
  });

  it("should throw error when restoring non-existent snapshot ID", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
    });

    await expect(store.restoreSnapshot("invalid-id")).rejects.toThrow(
      "Snapshot not found",
    );
  });

  it("should delete snapshot file and confirm removal", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      machineId: "snapshot-machine-id",
    });

    const meta = await store.createSnapshot({ name: "To Be Deleted" });
    const filePath = path.join(snapshotsDir, `${meta.id}.enc.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const deleted = await store.deleteSnapshot(meta.id);
    expect(deleted).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);

    const deleteAgain = await store.deleteSnapshot(meta.id);
    expect(deleteAgain).toBe(false);
  });

  it("should reject tampered or corrupted snapshot files with StoreTamperException", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
      machineId: "snapshot-machine-id",
    });

    const meta = await store.createSnapshot({ name: "Tamper Test" });
    const filePath = path.join(snapshotsDir, `${meta.id}.enc.json`);

    // Tamper with ciphertext
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    envelope.ciphertext = "ffff" + envelope.ciphertext.slice(4);
    fs.writeFileSync(filePath, JSON.stringify(envelope));

    await expect(store.getSnapshot(meta.id)).rejects.toThrow(
      StoreTamperException,
    );
    await expect(store.listSnapshots()).rejects.toThrow(StoreTamperException);
  });

  it("should expose getSnapshotsDir and export schema version", () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
    });
    expect(store.getSnapshotsDir()).toBe(path.resolve(snapshotsDir));
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
  });

  it("should handle snapshot with no active account ID", async () => {
    const freshStoreFile = path.join(tempDir, "fresh.enc.json");
    const freshStore = new AccountStore({ storePath: freshStoreFile });
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore: freshStore,
    });

    const meta = await store.createSnapshot({ name: "Empty Pool Snapshot" });
    expect(meta.activeAccountEmail).toBeUndefined();

    const list = await store.listSnapshots();
    const found = list.find((s) => s.id === meta.id);
    expect(found?.activeAccountEmail).toBeUndefined();
  });

  it("should wrap read failures with StoreTamperException during listSnapshots", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
    });

    const meta = await store.createSnapshot({ name: "Unreadable File" });
    const filePath = path.join(snapshotsDir, `${meta.id}.enc.json`);

    // Force invalid JSON syntax so JSON.parse throws SyntaxError
    fs.writeFileSync(filePath, "NOT_JSON{{{");

    await expect(store.listSnapshots()).rejects.toThrow(StoreTamperException);
    await expect(store.getSnapshot(meta.id)).rejects.toThrow(
      StoreTamperException,
    );
  });

  it("should reject envelope with invalid IV or authTag length or corrupted structure", async () => {
    const store = new SnapshotStore({
      snapshotsDir,
      accountStore,
    });

    const meta = await store.createSnapshot({ name: "Invalid Byte Length" });
    const filePath = path.join(snapshotsDir, `${meta.id}.enc.json`);

    // 1. Invalid IV byte length
    const envelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    envelope.iv = "aabb"; // too short (2 bytes instead of 12)
    fs.writeFileSync(filePath, JSON.stringify(envelope));

    await expect(store.getSnapshot(meta.id)).rejects.toThrow(
      StoreTamperException,
    );

    // 2. Unsupported cipher
    envelope.cipher = "des-ede3";
    fs.writeFileSync(filePath, JSON.stringify(envelope));

    await expect(store.getSnapshot(meta.id)).rejects.toThrow(
      StoreTamperException,
    );
  });
});
