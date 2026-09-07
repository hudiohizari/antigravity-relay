import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AccountStore } from "../src/main/account-store/account-store";
import { SwitchFlow } from "../src/main/switcher/switch-flow";
import {
  ProcessController,
  ProcessSystemInterface,
} from "../src/main/process/process-controller";
import { GoogleAccount } from "../src/shared/types";
import {
  setBinaryPathOverride,
  clearBinaryPathOverrides,
} from "../src/main/process/agy-path-detection";

class MockProcessSystem implements ProcessSystemInterface {
  public processes: Array<{ pid: number; command: string }> = [];
  public failKill = false;
  public failSpawn = false;

  public async getRunningProcesses() {
    return [...this.processes];
  }

  public async killPid(pid: number) {
    if (this.failKill) {
      throw new Error("Simulated kill failure");
    }
    this.processes = this.processes.filter((p) => p.pid !== pid);
  }

  public async spawnProcess(cmd: string) {
    if (this.failSpawn) {
      throw new Error("Simulated spawn failure");
    }
    const pid = Math.floor(Math.random() * 10000) + 1000;
    this.processes.push({ pid, command: cmd });
    return pid;
  }
}

describe("Switch Flow Process Coordinator", () => {
  let tempDir: string;
  let storeFile: string;
  let accountStore: AccountStore;
  let mockSystem: MockProcessSystem;
  let processController: ProcessController;

  const sampleAccountA: GoogleAccount = {
    id: "acc-alpha",
    email: "alpha@example.com",
    status: "active",
    tokens: {
      access_token: "token-alpha",
      refresh_token: "refresh-alpha",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const sampleAccountB: GoogleAccount = {
    id: "acc-beta",
    email: "beta@example.com",
    status: "active",
    tokens: {
      access_token: "token-beta",
      refresh_token: "refresh-beta",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-flow-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    accountStore = new AccountStore({
      storePath: storeFile,
      machineId: "switch-flow-machine",
    });

    await accountStore.saveAccount(sampleAccountA);
    await accountStore.saveAccount(sampleAccountB);
    await accountStore.setActive(sampleAccountA.id);

    mockSystem = new MockProcessSystem();
    processController = new ProcessController({
      system: mockSystem,
      killTimeoutMs: 50,
      pollIntervalMs: 10,
    });

    setBinaryPathOverride("antigravity_daemon", "/mock/path/agy");
    setBinaryPathOverride("antigravity_ide", "/mock/path/antigravity-ide");
  });

  afterEach(() => {
    clearBinaryPathOverrides();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should acquire mutex lock and reject concurrent switch executions", async () => {
    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    // Artificially acquire lock by calling switch
    const promise1 = switchFlow.executeSwitch(
      sampleAccountB.id,
      "manual_request",
    );
    expect(switchFlow.isInProgress()).toBe(true);

    await expect(
      switchFlow.executeSwitch(sampleAccountA.id, "scheduled_rotation"),
    ).rejects.toThrow("ALREADY_IN_PROGRESS");

    const result = await promise1;
    expect(result.success).toBe(true);
    expect(switchFlow.isInProgress()).toBe(false);
  });

  it("should throw error if target account does not exist", async () => {
    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    await expect(
      switchFlow.executeSwitch("non-existent-account", "manual_request"),
    ).rejects.toThrow("Target account not found");
    expect(switchFlow.isInProgress()).toBe(false);
  });

  it("should perform clean account switch, swap active ID, and emit events", async () => {
    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    let emittedEvent: any = null;
    const unsub = switchFlow.onSwitchEvent((res) => {
      emittedEvent = res;
    });

    const result = await switchFlow.executeSwitch(
      sampleAccountB.id,
      "quota_depleted",
    );

    expect(result.success).toBe(true);
    expect(result.previousAccountId).toBe(sampleAccountA.id);
    expect(result.newAccountId).toBe(sampleAccountB.id);
    expect(result.newAccountEmail).toBe(sampleAccountB.email);
    expect(result.reason).toBe("quota_depleted");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(emittedEvent).toEqual(result);

    const currentActive = await accountStore.getActive();
    expect(currentActive?.id).toBe(sampleAccountB.id);

    unsub();
  });

  it("should stop running processes and relaunch them when autoRelaunch is enabled", async () => {
    // Put daemon process in mock running table
    mockSystem.processes.push({ pid: 101, command: "/mock/path/agy" });
    const statusBefore = await processController.getStatus();
    expect(statusBefore.services.antigravity_daemon.state).toBe("running");

    const credentialsWriter = vi.fn().mockResolvedValue(undefined);

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
      config: {
        enabled: true,
        minQuotaThresholdPercent: 10,
        pollIntervalMs: 300000,
        rateLimitCooldownMs: 900000,
        autoRelaunchProcesses: true,
        preferredModels: [],
      },
      credentialsWriter,
    });

    const result = await switchFlow.executeSwitch(
      sampleAccountB.id,
      "rate_limited_429",
    );

    expect(result.success).toBe(true);
    expect(result.restartedProcesses).toContain("antigravity_daemon");
    expect(credentialsWriter).toHaveBeenCalledWith(
      sampleAccountB.tokens,
      expect.objectContaining({ id: sampleAccountB.id }),
    );

    const statusAfter = await processController.getStatus();
    expect(statusAfter.services.antigravity_daemon.state).toBe("running");
  });

  it("should not relaunch processes when autoRelaunch is disabled", async () => {
    mockSystem.processes.push({ pid: 202, command: "/mock/path/agy" });

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
      config: () => ({
        enabled: true,
        minQuotaThresholdPercent: 10,
        pollIntervalMs: 300000,
        rateLimitCooldownMs: 900000,
        autoRelaunchProcesses: false,
        preferredModels: [],
      }),
    });

    const result = await switchFlow.executeSwitch(
      sampleAccountB.id,
      "manual_request",
    );

    expect(result.success).toBe(true);
    expect(result.restartedProcesses).toEqual([]);

    const statusAfter = await processController.getStatus();
    expect(statusAfter.services.antigravity_daemon.state).toBe("stopped");
  });

  it("should roll back active account and emit failure event when relaunch fails", async () => {
    mockSystem.processes.push({ pid: 303, command: "/mock/path/agy" });
    mockSystem.failSpawn = true; // Relaunch will fail

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    let failureEvent: any = null;
    switchFlow.onSwitchEvent((res) => {
      if (!res.success) failureEvent = res;
    });

    await expect(
      switchFlow.executeSwitch(sampleAccountB.id, "quota_depleted"),
    ).rejects.toThrow("Failed to relaunch antigravity_daemon");

    expect(failureEvent).toBeDefined();
    expect(failureEvent.success).toBe(false);
    expect(failureEvent.error).toContain("Simulated spawn failure");

    // Rolled back to alpha
    const currentActive = await accountStore.getActive();
    expect(currentActive?.id).toBe(sampleAccountA.id);

    // Lock was safely released
    expect(switchFlow.isInProgress()).toBe(false);
  });

  it("should handle error when stopping daemon returns error state", async () => {
    mockSystem.processes.push({ pid: 404, command: "/mock/path/agy" });
    vi.spyOn(processController, "stopService").mockResolvedValueOnce({
      target: "antigravity_daemon",
      displayName: "Antigravity",
      binaryName: "agy",
      state: "error",
      errorMessage: "Daemon cannot be stopped",
      pids: [404],
      mainPid: 404,
      uptimeSeconds: 10,
      lastCheckedAt: Date.now(),
    });

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    await expect(
      switchFlow.executeSwitch(sampleAccountB.id, "manual_request"),
    ).rejects.toThrow(
      "Failed to stop antigravity_daemon: Daemon cannot be stopped",
    );
  });

  it("should handle error when stopping ide returns error state", async () => {
    mockSystem.processes.push({
      pid: 505,
      command: "/mock/path/antigravity-ide",
    });
    vi.spyOn(processController, "stopService").mockResolvedValueOnce({
      target: "antigravity_ide",
      displayName: "Antigravity IDE",
      binaryName: "antigravity-ide",
      state: "error",
      errorMessage: "IDE refuses to stop",
      pids: [505],
      mainPid: 505,
      uptimeSeconds: 10,
      lastCheckedAt: Date.now(),
    });

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    await expect(
      switchFlow.executeSwitch(sampleAccountB.id, "manual_request"),
    ).rejects.toThrow("Failed to stop antigravity_ide: IDE refuses to stop");
  });

  it("should stop and relaunch IDE successfully when IDE was running", async () => {
    mockSystem.processes.push({
      pid: 606,
      command: "/mock/path/antigravity-ide",
    });

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    const result = await switchFlow.executeSwitch(
      sampleAccountB.id,
      "manual_request",
    );
    expect(result.success).toBe(true);
    expect(result.restartedProcesses).toContain("antigravity_ide");
  });

  it("should throw error and rollback when IDE relaunch fails", async () => {
    mockSystem.processes.push({
      pid: 707,
      command: "/mock/path/antigravity-ide",
    });
    vi.spyOn(processController, "startService").mockResolvedValueOnce({
      target: "antigravity_ide",
      displayName: "Antigravity IDE",
      binaryName: "antigravity-ide",
      state: "error",
      errorMessage: "Binary crashed on launch",
      pids: [],
      mainPid: null,
      uptimeSeconds: 0,
      lastCheckedAt: Date.now(),
    });

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    await expect(
      switchFlow.executeSwitch(sampleAccountB.id, "manual_request"),
    ).rejects.toThrow(
      "Failed to relaunch antigravity_ide: Binary crashed on launch",
    );
  });

  it("should suppress rollback errors and listener callback errors", async () => {
    mockSystem.processes.push({ pid: 808, command: "/mock/path/agy" });
    mockSystem.failSpawn = true; // Will trigger failure and rollback

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    // Make rollback fail
    vi.spyOn(accountStore, "setActive")
      .mockResolvedValueOnce(true) // first call succeeds
      .mockRejectedValueOnce(new Error("Rollback DB locked")); // rollback fails

    switchFlow.onSwitchEvent(() => {
      throw new Error("Broken listener");
    });

    await expect(
      switchFlow.executeSwitch(sampleAccountB.id, "manual_request"),
    ).rejects.toThrow();
  });
});
