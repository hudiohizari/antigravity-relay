import { describe, it, expect, vi } from "vitest";
import { RateLimitTracker } from "../src/main/switcher/rate-limit-tracker";
import { RateLimitState } from "../src/main/switcher/types";

describe("Rate Limit Tracker & Cooldown Engine", () => {
  it("should initialize with default 15m cooldown and allow updates", () => {
    const tracker = new RateLimitTracker();
    expect(tracker.getCooldownDuration()).toBe(900000);

    tracker.setCooldownDuration(60000);
    expect(tracker.getCooldownDuration()).toBe(60000);

    expect(() => tracker.setCooldownDuration(-100)).toThrow(
      "Cooldown duration must be positive",
    );
  });

  it("should record 429 rate limit events with exponential backoff", () => {
    const tracker = new RateLimitTracker({ defaultCooldownMs: 10000 });
    const now = Date.now();

    // First limit: multiplier = 2^0 = 1 => 10,000ms
    const state1 = tracker.recordRateLimit("acc-1", "http_429", 429);
    expect(state1.isRateLimited).toBe(true);
    expect(state1.retryCount).toBe(1);
    expect(state1.cooldownUntil).toBeGreaterThanOrEqual(now + 9990);
    expect(state1.cooldownUntil).toBeLessThanOrEqual(now + 10100);

    // Second limit: multiplier = 2^1 = 2 => 20,000ms
    const state2 = tracker.recordRateLimit("acc-1", "http_429", 429);
    expect(state2.retryCount).toBe(2);
    expect(state2.cooldownUntil).toBeGreaterThanOrEqual(now + 19990);

    // Third limit: multiplier = 2^2 = 4 => 40,000ms
    const state3 = tracker.recordRateLimit("acc-1", "http_429", 429);
    expect(state3.retryCount).toBe(3);
    expect(state3.cooldownUntil).toBeGreaterThanOrEqual(now + 39990);
  });

  it("should cap exponential backoff at maxRetryExponent", () => {
    const tracker = new RateLimitTracker({
      defaultCooldownMs: 1000,
      maxRetryExponent: 3, // Cap at 2^3 = 8
    });

    let state: RateLimitState | null = null;
    for (let i = 0; i < 6; i++) {
      state = tracker.recordRateLimit("capped-acc", "http_429", 429);
    }

    expect(state?.retryCount).toBe(6);
    // Exponent capped at 3 => 1000 * 8 = 8000 ms from last record
    const expectedDuration = 1000 * 8;
    expect(state!.cooldownUntil! - state!.limitedAt!).toBe(expectedDuration);
  });

  it("should report active cooldown remaining time accurately", () => {
    const tracker = new RateLimitTracker();
    expect(tracker.getActiveCooldownRemainingMs("untracked")).toBe(0);

    tracker.recordRateLimit("acc-rem", "http_429", 429, 30000);
    const remaining = tracker.getActiveCooldownRemainingMs("acc-rem");
    expect(remaining).toBeGreaterThan(25000);
    expect(remaining).toBeLessThanOrEqual(30000);
  });

  it("should automatically expire cooldown once time has elapsed", () => {
    const tracker = new RateLimitTracker();
    // Custom 10ms cooldown
    tracker.recordRateLimit("short-cooldown", "http_429", 429, 10);
    expect(tracker.isAccountLimited("short-cooldown")).toBe(true);

    // Advance time or wait
    const startTime = Date.now();
    while (Date.now() - startTime < 20) {
      // wait 20ms
    }

    expect(tracker.isAccountLimited("short-cooldown")).toBe(false);
    const state = tracker.getRateLimitState("short-cooldown");
    expect(state?.isRateLimited).toBe(false);
  });

  it("should clear rate limits manually and reset retry counter", () => {
    const tracker = new RateLimitTracker();
    tracker.recordRateLimit("to-clear", "http_429", 429);
    expect(tracker.isAccountLimited("to-clear")).toBe(true);

    tracker.clearRateLimit("to-clear");
    expect(tracker.isAccountLimited("to-clear")).toBe(false);

    const state = tracker.getRateLimitState("to-clear");
    expect(state?.isRateLimited).toBe(false);
    expect(state?.retryCount).toBe(0);
  });

  it("should safely handle clearRateLimit for unknown account", () => {
    const tracker = new RateLimitTracker();
    expect(() => tracker.clearRateLimit("non-existent")).not.toThrow();
  });

  it("should return map of all tracked states across accounts", () => {
    const tracker = new RateLimitTracker();
    tracker.recordRateLimit("acc-a", "http_429");
    tracker.recordRateLimit("acc-b", "resource_exhausted");

    const all = tracker.getAllStates();
    expect(Object.keys(all).length).toBe(2);
    expect(all["acc-a"].isRateLimited).toBe(true);
    expect(all["acc-b"].isRateLimited).toBe(true);
  });

  it("should notify listeners when rate limit state changes", () => {
    const tracker = new RateLimitTracker();
    const listener = vi.fn();
    const unsub = tracker.onRateLimitChanged(listener);

    tracker.recordRateLimit("acc-listener", "http_429");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-listener",
        isRateLimited: true,
      }),
    );

    tracker.clearRateLimit("acc-listener");
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    tracker.recordRateLimit("acc-listener", "http_429");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("should suppress callback errors from throwing listeners", () => {
    const tracker = new RateLimitTracker();
    tracker.onRateLimitChanged(() => {
      throw new Error("Broken listener");
    });

    expect(() =>
      tracker.recordRateLimit("acc-throw", "http_429"),
    ).not.toThrow();
  });
});
