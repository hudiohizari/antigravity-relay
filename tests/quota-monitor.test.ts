import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AccountStore } from "../src/main/account-store/account-store";
import { GoogleQuotaApiClient } from "../src/main/quota/google-api";
import { QuotaMonitor } from "../src/main/quota/quota-monitor";
import { QUOTA_SCHEMA_VERSION } from "../src/main/quota/types";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { GoogleAccount, QuotaData } from "../src/shared/types";

describe("Google Quota API Client", () => {
  const sampleAccount: GoogleAccount = {
    id: "test-acc-1",
    email: "dev@example.com",
    status: "active",
    tokens: {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("should generate mock offline quota when offline flag is enabled", async () => {
    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(true);
    expect(result.quota).toBeDefined();
    expect(result.quota?.source).toBe("mock_offline");
    expect(result.quota?.models["gemini-1.5-pro"].percentage).toBe(100);
    expect(result.quota?.models["gemini-2.0-flash"].percentage).toBe(100);
  });

  it("should return failure when account access token is missing", async () => {
    const client = new GoogleQuotaApiClient();
    const badAccount: GoogleAccount = {
      ...sampleAccount,
      tokens: { ...sampleAccount.tokens, access_token: "" },
    };

    const result = await client.fetchQuota(badAccount);
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("Missing access token");
  });

  it("should handle HTTP 429 rate limits gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: new Headers(),
      text: () => Promise.resolve("Resource exhausted"),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(429);
    expect(result.isRateLimited).toBe(true);
    expect(result.error).toContain("Rate limit exceeded");
  });

  it("should handle HTTP 401/403 authorization failures", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 401,
      headers: new Headers(),
      text: () => Promise.resolve('{"error": "invalid_grant"}'),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("invalid_grant");
  });

  it("should preserve cached quota on HTTP 5xx server errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 503,
      headers: new Headers(),
      text: () => Promise.resolve("Service Unavailable"),
    });

    const existingQuota: QuotaData = {
      models: {
        "gemini-1.5-pro": {
          percentage: 75,
          resetTime: new Date().toISOString(),
        },
      },
      last_polled_at: Date.now() - 60000,
    };

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount, existingQuota);

    expect(result.success).toBe(true);
    expect(result.quota?.source).toBe("cached");
    expect(result.quota?.models["gemini-1.5-pro"].percentage).toBe(75);
    expect(result.quota?.poll_error).toContain("503");
  });

  it("should fail cleanly on 5xx without cached quota", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve("Internal Server Error"),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toContain("500");
  });

  it("should parse rate-limit headers on HTTP 200 responses", async () => {
    const headers = new Headers();
    headers.set("x-ratelimit-remaining", "800");
    headers.set("x-ratelimit-limit", "1000");
    headers.set("x-ratelimit-reset", "3600");

    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers,
      json: () => Promise.resolve({ models: [] }),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(true);
    expect(result.quota?.source).toBe("api");
    expect(result.quota?.models["gemini-1.5-pro"].percentage).toBe(80);
    expect(result.quota?.models["gemini-1.5-pro"].remainingQueries).toBe(800);
    expect(result.quota?.models["gemini-1.5-pro"].totalQueries).toBe(1000);
  });

  it("should preserve cached quota when network fetch throws offline error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));

    const existingQuota: QuotaData = {
      models: {
        "gemini-1.5-pro": {
          percentage: 90,
          resetTime: new Date().toISOString(),
        },
      },
      last_polled_at: Date.now() - 100000,
    };

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount, existingQuota);

    expect(result.success).toBe(true);
    expect(result.quota?.source).toBe("cached");
    expect(result.quota?.poll_error).toBe("ENOTFOUND");
  });

  it("should return failure when network fetch throws and no cached quota exists", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("should handle HTTP 403 forbidden without invalid_grant", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 403,
      headers: new Headers(),
      text: () => Promise.resolve("Method Not Allowed or Forbidden"),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(403);
    expect(result.error).toContain("Access forbidden (403)");
  });

  it("should use default resetTime when x-ratelimit-reset header is omitted", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ models: [] }),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const result = await client.fetchQuota(sampleAccount);

    expect(result.success).toBe(true);
    expect(result.quota?.models["gemini-1.5-pro"].resetTime).toBeDefined();
  });

  it("should export quota schema version", () => {
    expect(QUOTA_SCHEMA_VERSION).toBe(1);
  });
});

describe("Quota Monitor Background Engine", () => {
  let tempDir: string;
  let storeFile: string;
  let accountStore: AccountStore;
  let rateLimitTracker: RateLimitTracker;

  const sampleAccount: GoogleAccount = {
    id: "acc-monitor-1",
    email: "poller@example.com",
    status: "active",
    tokens: {
      access_token: "valid-token",
      refresh_token: "valid-refresh",
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: "Bearer",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "quota-test-"));
    storeFile = path.join(tempDir, "accounts.enc.json");
    accountStore = new AccountStore({
      storePath: storeFile,
      machineId: "monitor-machine-id",
    });
    rateLimitTracker = new RateLimitTracker();
    await accountStore.saveAccount(sampleAccount);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should configure and update polling intervals safely", () => {
    const monitor = new QuotaMonitor({
      accountStore,
      rateLimitTracker,
      pollIntervalMs: 60000,
    });

    expect(monitor.getInterval()).toBe(60000);
    monitor.setInterval(120000);
    expect(monitor.getInterval()).toBe(120000);

    // Update interval while running to restart timer
    monitor.start();
    expect(monitor.isPolling()).toBe(true);
    monitor.setInterval(30000);
    expect(monitor.getInterval()).toBe(30000);
    expect(monitor.isPolling()).toBe(true);
    monitor.stop();

    expect(() => monitor.setInterval(0)).toThrow("greater than zero");
  });

  it("should catch and suppress error inside setInterval scheduled tick", async () => {
    vi.useFakeTimers();
    const monitor = new QuotaMonitor({
      accountStore,
      pollIntervalMs: 1000,
    });
    vi.spyOn(monitor, "pollAll").mockRejectedValueOnce(
      new Error("Timer tick failed"),
    );
    monitor.start();
    vi.advanceTimersByTime(1000);
    monitor.stop();
    vi.useRealTimers();
  });

  it("should start, stop, and report polling state correctly", () => {
    const monitor = new QuotaMonitor({
      accountStore,
      rateLimitTracker,
      pollIntervalMs: 5000,
    });

    expect(monitor.isPolling()).toBe(false);
    monitor.start();
    expect(monitor.isPolling()).toBe(true);
    monitor.stop();
    expect(monitor.isPolling()).toBe(false);
  });

  it("should execute polling tick on scheduled timer", async () => {
    vi.useFakeTimers();
    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
      pollIntervalMs: 5000,
    });

    const spy = vi.spyOn(monitor, "pollAll");
    monitor.start();
    vi.advanceTimersByTime(5000);
    expect(spy).toHaveBeenCalled();
    monitor.stop();
    vi.useRealTimers();
  });

  it("should avoid overlapping concurrent pollAll executions", async () => {
    const monitor = new QuotaMonitor({
      accountStore,
      rateLimitTracker,
    });
    (monitor as any).isCurrentlyPolling = true;
    const res = await monitor.pollAll();
    expect(res).toEqual([]);
  });

  it("should handle unexpected error during individual account poll in pollAll", async () => {
    const monitor = new QuotaMonitor({
      accountStore,
      rateLimitTracker,
    });
    vi.spyOn(monitor, "pollAccount").mockRejectedValue(
      new Error("Unexpected crash"),
    );
    const results = await monitor.pollAll();
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe("Unexpected crash");
  });

  it("should suppress callback errors from quota and rate limit listeners", async () => {
    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });
    monitor.onQuotaUpdated(() => {
      throw new Error("Callback exploded");
    });
    monitor.onRateLimitDetected(() => {
      throw new Error("Callback exploded");
    });
    await expect(monitor.pollAccount(sampleAccount.id)).resolves.toBeDefined();
    (monitor as any).notifyRateLimit(sampleAccount.id, { success: false });
  });

  it("should return error when polling a non-existent account", async () => {
    const monitor = new QuotaMonitor({ accountStore, rateLimitTracker });
    const result = await monitor.pollAccount("non-existent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should poll an account, save quota, and notify listeners on success", async () => {
    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });

    let eventPayload: any = null;
    const unsub = monitor.onQuotaUpdated((data) => {
      eventPayload = data;
    });

    const result = await monitor.pollAccount(sampleAccount.id);

    expect(result.success).toBe(true);
    expect(eventPayload).toBeDefined();
    expect(eventPayload.accountId).toBe(sampleAccount.id);

    const saved = await accountStore.get(sampleAccount.id);
    expect(saved?.quota).toBeDefined();
    expect(saved?.quota?.source).toBe("mock_offline");

    unsub();
  });

  it("should handle HTTP 429 during polling, record rate limit, and update account status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: new Headers(),
      text: () => Promise.resolve("Rate limited"),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });

    let rateLimitEvent: any = null;
    monitor.onRateLimitDetected((event) => {
      rateLimitEvent = event;
    });

    const result = await monitor.pollAccount(sampleAccount.id);

    expect(result.isRateLimited).toBe(true);
    expect(rateLimitTracker.isAccountLimited(sampleAccount.id)).toBe(true);

    const accountInStore = await accountStore.get(sampleAccount.id);
    expect(accountInStore?.status).toBe("rate_limited");
    expect(rateLimitEvent).toBeDefined();
  });

  it("should mark account expired upon 401 token authentication failures", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 401,
      headers: new Headers(),
      text: () => Promise.resolve("invalid_grant"),
    });

    const client = new GoogleQuotaApiClient({ fetchFn: mockFetch as any });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });

    await monitor.pollAccount(sampleAccount.id);

    const accountInStore = await accountStore.get(sampleAccount.id);
    expect(accountInStore?.status).toBe("expired");
  });

  it("should poll all registered accounts in batch and return results", async () => {
    const acc2: GoogleAccount = {
      ...sampleAccount,
      id: "acc-monitor-2",
      email: "second@example.com",
    };
    await accountStore.saveAccount(acc2);

    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });

    const results = await monitor.pollAll();
    expect(results.length).toBe(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("should restore rate_limited account status to active when cooldown has elapsed and poll succeeds", async () => {
    const limitedAccount: GoogleAccount = {
      ...sampleAccount,
      id: "acc-cooldown-cleared",
      status: "rate_limited",
    };
    await accountStore.saveAccount(limitedAccount);

    // Make sure rateLimitTracker reports not limited
    rateLimitTracker.clearRateLimit(limitedAccount.id);

    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitor = new QuotaMonitor({
      accountStore,
      apiClient: client,
      rateLimitTracker,
    });

    const unsubRate = monitor.onRateLimitDetected(() => {});
    unsubRate();

    const res = await monitor.pollAccount(limitedAccount.id);
    expect(res.success).toBe(true);

    const updatedAccount = await accountStore.get(limitedAccount.id);
    expect(updatedAccount?.status).toBe("active");
  });

  it("should restore rate_limited account when rateLimitTracker is omitted", async () => {
    const limitedAccount: GoogleAccount = {
      ...sampleAccount,
      id: "acc-no-tracker-restore",
      status: "rate_limited",
    };
    await accountStore.saveAccount(limitedAccount);

    const client = new GoogleQuotaApiClient({ mockOffline: true });
    const monitorWithoutTracker = new QuotaMonitor({
      accountStore,
      apiClient: client,
    });

    const res = await monitorWithoutTracker.pollAccount(limitedAccount.id);
    expect(res.success).toBe(true);

    const updatedAccount = await accountStore.get(limitedAccount.id);
    expect(updatedAccount?.status).toBe("active");
  });
});
