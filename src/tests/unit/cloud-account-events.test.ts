import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cloudAccountEvents,
  CloudAccountEventEmitter,
} from "@/modules/cloud-account/services/cloud-account-events";

describe("CloudAccountEvents Lifecycle Event Bus", () => {
  let emitter: CloudAccountEventEmitter;

  beforeEach(() => {
    emitter = new CloudAccountEventEmitter();
  });

  it("emits account:switched and triggers both colon and kebab-case listeners", () => {
    const colonListener = vi.fn();
    const kebabListener = vi.fn();

    emitter.on("account:switched", colonListener);
    emitter.on("account-switched", kebabListener);

    const payload = {
      accountId: "acc-123",
      target: "classic" as const,
      account: { id: "acc-123", email: "dev@example.com" } as any,
    };

    emitter.emit("account:switched", payload);

    expect(colonListener).toHaveBeenCalledTimes(1);
    expect(colonListener).toHaveBeenCalledWith(payload);
    expect(kebabListener).toHaveBeenCalledTimes(1);
    expect(kebabListener).toHaveBeenCalledWith(payload);
  });

  it("emits account:quota_updated and triggers both colon and kebab-case listeners", () => {
    const colonListener = vi.fn();
    const kebabListener = vi.fn();

    emitter.on("account:quota_updated", colonListener);
    emitter.on("account-updated", kebabListener);

    const payload = {
      accountId: "acc-456",
      quota: { models: {} } as any,
      account: { id: "acc-456", email: "user@example.com" } as any,
    };

    emitter.emit("account:quota_updated", payload);

    expect(colonListener).toHaveBeenCalledTimes(1);
    expect(colonListener).toHaveBeenCalledWith(payload);
    expect(kebabListener).toHaveBeenCalledTimes(1);
    expect(kebabListener).toHaveBeenCalledWith(payload);
  });

  it("emits account:deleted and triggers both colon and kebab-case listeners", () => {
    const colonListener = vi.fn();
    const kebabListener = vi.fn();

    emitter.on("account:deleted", colonListener);
    emitter.on("account-deleted", kebabListener);

    const payload = { accountId: "acc-789" };
    emitter.emit("account:deleted", payload);

    expect(colonListener).toHaveBeenCalledTimes(1);
    expect(colonListener).toHaveBeenCalledWith(payload);
    expect(kebabListener).toHaveBeenCalledTimes(1);
    expect(kebabListener).toHaveBeenCalledWith(payload);
  });

  it("emits account:sync_requested and triggers both colon and kebab-case listeners", () => {
    const colonListener = vi.fn();
    const kebabListener = vi.fn();

    emitter.on("account:sync_requested", colonListener);
    emitter.on("account-sync-requested", kebabListener);

    const payload = { reason: "manual_refresh", target: "ide" as const };
    emitter.emit("account:sync_requested", payload);

    expect(colonListener).toHaveBeenCalledTimes(1);
    expect(colonListener).toHaveBeenCalledWith(payload);
    expect(kebabListener).toHaveBeenCalledTimes(1);
    expect(kebabListener).toHaveBeenCalledWith(payload);
  });

  it("supports once listener and off listener removal", () => {
    const onceListener = vi.fn();
    const standardListener = vi.fn();

    emitter.once("account:deleted", onceListener);
    emitter.on("account:deleted", standardListener);

    emitter.emit("account:deleted", { accountId: "1" });
    expect(onceListener).toHaveBeenCalledTimes(1);
    expect(standardListener).toHaveBeenCalledTimes(1);

    emitter.off("account:deleted", standardListener);
    emitter.emit("account:deleted", { accountId: "2" });

    expect(onceListener).toHaveBeenCalledTimes(1);
    expect(standardListener).toHaveBeenCalledTimes(1);
  });

  it("verifies global singleton cloudAccountEvents is defined with high maxListeners", () => {
    expect(cloudAccountEvents).toBeDefined();
    expect(cloudAccountEvents.getMaxListeners()).toBeGreaterThanOrEqual(50);
  });
});
