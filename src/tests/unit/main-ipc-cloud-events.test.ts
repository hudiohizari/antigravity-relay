import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudAccountEvents } from "@/modules/cloud-account/services/cloud-account-events";

describe("Main Process cloudAccountEvents IPC Forwarding", () => {
  let mockWebContentsSend: ReturnType<typeof vi.fn>;
  let mockWindow: {
    webContents: { send: ReturnType<typeof vi.fn> };
    isDestroyed: ReturnType<typeof vi.fn>;
  } | null;

  beforeEach(() => {
    mockWebContentsSend = vi.fn();
    mockWindow = {
      webContents: {
        send: mockWebContentsSend,
      },
      isDestroyed: vi.fn(() => false),
    };
  });

  it("forwards account:switched event to webContents as account-switched", () => {
    const forwarder = (payload: any) => {
      if (mockWindow && !mockWindow.isDestroyed()) {
        mockWindow.webContents.send("account-switched", payload);
      }
    };

    cloudAccountEvents.on("account:switched", forwarder);

    const testPayload = {
      accountId: "acc-123",
      target: "all" as const,
      account: { id: "acc-123", email: "test@example.com" } as any,
    };

    cloudAccountEvents.emit("account:switched", testPayload);

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      "account-switched",
      testPayload,
    );

    cloudAccountEvents.off("account:switched", forwarder);
  });

  it("forwards account:quota_updated event to webContents as accounts-updated", () => {
    const forwarder = (payload: any) => {
      if (mockWindow && !mockWindow.isDestroyed()) {
        mockWindow.webContents.send("accounts-updated", payload);
      }
    };

    cloudAccountEvents.on("account:quota_updated", forwarder);

    const testPayload = {
      accountId: "acc-123",
      quota: { models: {} } as any,
    };

    cloudAccountEvents.emit("account:quota_updated", testPayload);

    expect(mockWebContentsSend).toHaveBeenCalledWith(
      "accounts-updated",
      testPayload,
    );

    cloudAccountEvents.off("account:quota_updated", forwarder);
  });

  it("safely ignores event when window is destroyed or null", () => {
    const forwarder = (payload: any) => {
      if (mockWindow && !mockWindow.isDestroyed()) {
        mockWindow.webContents.send("account-switched", payload);
      }
    };

    cloudAccountEvents.on("account:switched", forwarder);

    // Destroy window
    mockWindow!.isDestroyed = vi.fn(() => true);

    cloudAccountEvents.emit("account:switched", { accountId: "acc-456" });
    expect(mockWebContentsSend).not.toHaveBeenCalled();

    // Null window
    mockWindow = null;
    expect(() => {
      cloudAccountEvents.emit("account:switched", { accountId: "acc-789" });
    }).not.toThrow();
    expect(mockWebContentsSend).not.toHaveBeenCalled();

    cloudAccountEvents.off("account:switched", forwarder);
  });
});
