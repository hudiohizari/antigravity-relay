import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AccountStore } from "../src/main/account-store/account-store";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { AutoSwitchService } from "../src/main/switcher/auto-switch.service";
import { SwitchFlow } from "../src/main/switcher/switch-flow";
import {
  ProcessController,
  ProcessSystemInterface,
} from "../src/main/process/process-controller";
import { GoogleAccount } from "../src/shared/types";

class MockProcessSystem implements ProcessSystemInterface {
  public processes: Array<{ pid: number; command: string }> = [];
  public async getRunningProcesses() {
    return [...this.processes];
  }
  public async killPid(pid: number) {
    this.processes = this.processes.filter((p) => p.pid !== pid);
  }
  public async spawnProcess(cmd: string) {
    const pid = 9999;
    this.processes.push({ pid, command: cmd });
    return pid;
  }
}

describe("Auto-Switch Service & Multi-Factor Scoring Engine", () => {
  let tempDir: string;
  let storeFile: string;
  let accountStore: AccountStore;
  let rateLimitTracker: RateLimitTracker;
  let processController: ProcessController;

  const createAccount = (
    id: string,
    email: string,
    quotaPercent: number,
    lastUsedAt?: number,
    status: GoogleAccount["status"] = "active",
  ): GoogleAccount => ({
    id,
    email,
    status,
    lastUsedAt,
    tokens: {
      access_token: `token-${id}`,
      refresh_token: `refresh-${id}`,
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    quota: {
      models: {
        "gemini-1.5-pro": {
          percentage: quotaPercent,
          resetTime: new Date().toISOString(),
        },
        "gemini-2.0-flash": {
          percentage: quotaPercent,
          resetTime: new Date().toISOString(),
        },
      },
      last_polled_at: Date.now(),
      source: "api",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "switch-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    accountStore = new AccountStore({
      storePath: storeFile,
      machineId: "switch-test-machine",
    });
    rateLimitTracker = new RateLimitTracker();
    processController = new ProcessController({
      system: new MockProcessSystem(),
      killTimeoutMs: 50,
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should validate and persist dynamic configuration updates", () => {
    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    expect(service.getConfig().enabled).toBe(true);
    expect(service.getConfig().minQuotaThresholdPercent).toBe(10);

    service.setConfig({
      minQuotaThresholdPercent: 25,
      pollIntervalMs: 60000,
      rateLimitCooldownMs: 120000,
    });

    const updated = service.getConfig();
    expect(updated.minQuotaThresholdPercent).toBe(25);
    expect(updated.pollIntervalMs).toBe(60000);
    expect(updated.rateLimitCooldownMs).toBe(120000);
    expect(rateLimitTracker.getCooldownDuration()).toBe(120000);

    expect(() => service.setConfig({ minQuotaThresholdPercent: -5 })).toThrow(
      "minQuotaThresholdPercent must be between 0 and 100",
    );
    expect(() => service.setConfig({ minQuotaThresholdPercent: 105 })).toThrow(
      "minQuotaThresholdPercent must be between 0 and 100",
    );
    expect(() => service.setConfig({ pollIntervalMs: 0 })).toThrow(
      "pollIntervalMs must be greater than zero",
    );
    expect(() => service.setConfig({ rateLimitCooldownMs: -1 })).toThrow(
      "rateLimitCooldownMs must be greater than zero",
    );
  });

  it("should return NO_ELIGIBLE_ACCOUNTS when pool is empty or only has active account", async () => {
    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const resEmpty = await service.findBestAccount();
    expect(resEmpty.candidate).toBeNull();
    expect(resEmpty.reason).toBe("NO_ELIGIBLE_ACCOUNTS");

    const acc1 = createAccount("acc-1", "active@example.com", 90);
    await accountStore.saveAccount(acc1);
    await accountStore.setActive("acc-1");

    const resOnlyActive = await service.findBestAccount();
    expect(resOnlyActive.candidate).toBeNull();
    expect(resOnlyActive.reason).toBe("NO_ELIGIBLE_ACCOUNTS");
  });

  it("should filter out disabled, expired, and rate-limited candidate accounts", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 100);
    const accDisabled = createAccount(
      "acc-disabled",
      "disabled@example.com",
      95,
      undefined,
      "disabled",
    );
    const accExpired = createAccount(
      "acc-expired",
      "expired@example.com",
      95,
      undefined,
      "expired",
    );
    const accRateLimited = createAccount(
      "acc-limited",
      "limited@example.com",
      95,
      undefined,
      "rate_limited",
    );
    const accTrackerLimited = createAccount(
      "acc-tracker-limited",
      "tracked@example.com",
      95,
    );

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accDisabled);
    await accountStore.saveAccount(accExpired);
    await accountStore.saveAccount(accRateLimited);
    await accountStore.saveAccount(accTrackerLimited);
    await accountStore.setActive(accActive.id);

    rateLimitTracker.recordRateLimit("acc-tracker-limited");

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe("NO_ELIGIBLE_ACCOUNTS");
  });

  it("should score candidates by quota average and least recently used recency", async () => {
    const now = Date.now();
    const accActive = createAccount("acc-active", "active@example.com", 5, now);
    const accHighQuota = createAccount(
      "acc-high",
      "high@example.com",
      90,
      now - 1000,
    );
    const accLowQuota = createAccount(
      "acc-low",
      "low@example.com",
      40,
      now - 10000,
    );

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accHighQuota);
    await accountStore.saveAccount(accLowQuota);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate).not.toBeNull();
    expect(result.candidate?.id).toBe("acc-high");
    expect(result.rankedScores.length).toBe(2);
    expect(result.rankedScores[0].accountId).toBe("acc-high");
    expect(result.rankedScores[0].selectionRank).toBe(1);
    expect(result.rankedScores[1].accountId).toBe("acc-low");
    expect(result.rankedScores[1].selectionRank).toBe(2);
  });

  it("should prioritize accounts that were never used (lastUsedAt = 0)", async () => {
    const now = Date.now();
    const accActive = createAccount("acc-active", "active@example.com", 5, now);
    const accUsed = createAccount(
      "acc-used",
      "used@example.com",
      80,
      now - 5000,
    );
    const accFresh = createAccount(
      "acc-fresh",
      "fresh@example.com",
      80,
      0, // never used
    );

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accUsed);
    await accountStore.saveAccount(accFresh);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate?.id).toBe("acc-fresh");
    expect(result.rankedScores[0].score).toBeGreaterThan(
      result.rankedScores[1].score,
    );
  });

  it("should reject accounts below minQuotaThresholdPercent", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 2);
    const accDepleted = createAccount(
      "acc-depleted",
      "depleted@example.com",
      5,
    );

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accDepleted);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
      initialConfig: { minQuotaThresholdPercent: 10 },
    });

    const result = await service.findBestAccount();
    expect(result.candidate).toBeNull();
    expect(result.reason).toBe("ALL_BELOW_THRESHOLD");
  });

  it("should break ties using oldest usage then alphabetical ID", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 100);
    // Same quota, same lastUsedAt
    const accB = createAccount("acc-b", "b@example.com", 80, 1000);
    const accA = createAccount("acc-a", "a@example.com", 80, 1000);

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accB);
    await accountStore.saveAccount(accA);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate?.id).toBe("acc-a");
  });

  it("should break ties using lastUsedAt when candidates have identical totalScore", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 100);
    // Identical quota, minute lastUsedAt difference with large third timestamp so scores round identically
    const accOlder = createAccount("acc-older", "older@example.com", 75, 1000);
    const accNewer = createAccount("acc-newer", "newer@example.com", 75, 1001);
    const accAnchor = createAccount(
      "acc-anchor",
      "anchor@example.com",
      75,
      100000,
    );

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accNewer);
    await accountStore.saveAccount(accOlder);
    await accountStore.saveAccount(accAnchor);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate?.id).toBe("acc-older");
  });

  it("should evaluate and trigger account switch via SwitchFlow", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 5);
    const accTarget = createAccount("acc-target", "target@example.com", 90);

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accTarget);
    await accountStore.setActive(accActive.id);

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
      switchFlow,
    });

    const result = await service.evaluateAndSwitch("quota_depleted");
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.newAccountId).toBe("acc-target");
    expect(result?.previousAccountId).toBe("acc-active");

    const newActive = await accountStore.getActive();
    expect(newActive?.id).toBe("acc-target");
  });

  it("should emit poolExhausted event when evaluateAndSwitch has no candidate", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 5);
    await accountStore.saveAccount(accActive);
    await accountStore.setActive(accActive.id);

    const switchFlow = new SwitchFlow({
      accountStore,
      processController,
    });

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
      switchFlow,
    });

    let exhaustedEvent: any = null;
    const unsub = service.onPoolExhausted((info) => {
      exhaustedEvent = info;
    });

    const result = await service.evaluateAndSwitch("quota_depleted");
    expect(result).toBeNull();
    expect(exhaustedEvent).toBeDefined();
    expect(exhaustedEvent.reason).toBe("NO_ELIGIBLE_ACCOUNTS");

    unsub();
  });

  it("should not switch when auto-switch is disabled in config", async () => {
    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
      initialConfig: { enabled: false },
    });

    const result = await service.evaluateAndSwitch("scheduled_rotation");
    expect(result).toBeNull();
  });

  it("should throw error if switchFlow is missing during evaluateAndSwitch", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 5);
    const accTarget = createAccount("acc-target", "target@example.com", 90);
    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accTarget);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    await expect(service.evaluateAndSwitch("quota_depleted")).rejects.toThrow(
      "SwitchFlow coordinator not configured",
    );
  });

  it("should calculate default quota when account has no quota or empty models", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 100);
    const accNoQuota: GoogleAccount = {
      ...createAccount("acc-no-quota", "noquota@example.com", 0),
      quota: undefined,
    };
    const accEmptyModels: GoogleAccount = {
      ...createAccount("acc-empty", "empty@example.com", 0),
      quota: {
        models: {},
        last_polled_at: Date.now(),
        source: "api",
      },
    };
    const accOtherModel: GoogleAccount = {
      ...createAccount("acc-other", "other@example.com", 0),
      quota: {
        models: {
          "custom-unpreferred-model": {
            percentage: 65,
            resetTime: new Date().toISOString(),
          },
        },
        last_polled_at: Date.now(),
        source: "api",
      },
    };

    await accountStore.saveAccount(accActive);
    await accountStore.saveAccount(accNoQuota);
    await accountStore.saveAccount(accEmptyModels);
    await accountStore.saveAccount(accOtherModel);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    const result = await service.findBestAccount();
    expect(result.candidate).not.toBeNull();
    // Verify custom unpreferred model was computed
    const otherScore = result.rankedScores.find(
      (s) => s.accountId === "acc-other",
    );
    expect(otherScore?.quotaAverage).toBe(65);
  });

  it("should suppress callback errors from pool exhausted listeners", async () => {
    const accActive = createAccount("acc-active", "active@example.com", 5);
    await accountStore.saveAccount(accActive);
    await accountStore.setActive(accActive.id);

    const service = new AutoSwitchService({
      accountStore,
      rateLimitTracker,
    });

    service.onPoolExhausted(() => {
      throw new Error("Pool exhausted listener threw");
    });

    await expect(
      service.evaluateAndSwitch("quota_depleted"),
    ).resolves.toBeNull();
  });
});
