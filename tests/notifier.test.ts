import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NativeNotifier,
  NotificationPayloadSchema,
} from "../src/main/notifications/notifier";
import { SettingsStore } from "../src/main/settings/settings-store";
import { DEFAULT_APP_SETTINGS } from "../src/main/settings/types";

// Mock Electron Notification
const mockInstances: any[] = [];
let isSupportedMock = true;

vi.mock("electron", () => {
  class MockNotification {
    public options: any;
    public listeners = new Map<string, Function>();
    public show = vi.fn();
    public on = vi.fn((event: string, cb: Function) => {
      this.listeners.set(event, cb);
      return this;
    });

    constructor(options: any) {
      this.options = options;
      mockInstances.push(this);
    }

    static isSupported = vi.fn(() => isSupportedMock);
  }

  return {
    Notification: MockNotification,
    BrowserWindow: vi.fn(),
  };
});

describe("NativeNotifier", () => {
  beforeEach(() => {
    mockInstances.length = 0;
    isSupportedMock = true;
    vi.clearAllMocks();
  });

  it("should validate payload with NotificationPayloadSchema", () => {
    const valid = NotificationPayloadSchema.safeParse({
      type: "account_switched",
      title: "Test Title",
      body: "Test Body",
    });
    expect(valid.success).toBe(true);

    const invalid = NotificationPayloadSchema.safeParse({
      type: "unknown_type",
      title: "",
    });
    expect(invalid.success).toBe(false);
  });

  it("should return false when Notification is not supported by OS", async () => {
    isSupportedMock = false;
    const notifier = new NativeNotifier();

    const result = await notifier.send({
      type: "general_alert",
      title: "Title",
      body: "Body",
    });

    expect(result).toBe(false);
    expect(mockInstances.length).toBe(0);
  });

  it("should return false for invalid notification payload", async () => {
    const notifier = new NativeNotifier();
    const result = await notifier.send({
      type: "invalid_type" as any,
      title: "",
      body: "",
    });
    expect(result).toBe(false);
  });

  it("should dispatch notification and wire click handler to restore window", async () => {
    const mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    const notifier = new NativeNotifier({
      getMainWindow: () => mockWindow as any,
      iconPath: "/path/to/icon.png",
    });

    const dispatched = await notifier.send({
      type: "general_alert",
      title: "Hello Alert",
      body: "Alert description",
      silent: false,
      urgency: "normal",
    });

    expect(dispatched).toBe(true);
    expect(mockInstances.length).toBe(1);

    const instance = mockInstances[0];
    expect(instance.options.title).toBe("Hello Alert");
    expect(instance.options.body).toBe("Alert description");
    expect(instance.options.icon).toBe("/path/to/icon.png");
    expect(instance.show).toHaveBeenCalled();

    // Trigger click callback
    const clickHandler = instance.listeners.get("click");
    expect(clickHandler).toBeDefined();
    clickHandler();

    expect(mockWindow.restore).toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();
  });

  it("should handle window click when window is not minimized or is destroyed/null", async () => {
    let currentWindow: any = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    const notifier = new NativeNotifier({
      getMainWindow: () => currentWindow,
    });

    await notifier.send({
      type: "general_alert",
      title: "Alert",
      body: "Msg",
    });

    const instance = mockInstances[0];
    const clickHandler = instance.listeners.get("click");

    clickHandler();
    expect(currentWindow.restore).not.toHaveBeenCalled();
    expect(currentWindow.show).toHaveBeenCalled();

    // Now test with null or destroyed window
    currentWindow = null;
    expect(() => clickHandler()).not.toThrow();

    currentWindow = {
      isDestroyed: vi.fn().mockReturnValue(true),
      show: vi.fn(),
    };
    expect(() => clickHandler()).not.toThrow();
    expect(currentWindow.show).not.toHaveBeenCalled();
  });

  it("should suppress notification when master notifications toggle is disabled", async () => {
    const notifier = new NativeNotifier();
    notifier.setPreferences({
      enabled: false,
      notifyOnAutoSwitch: true,
      notifyOnRateLimit: true,
      notifyOnProcessCrash: true,
      debounceMs: 5000,
    });

    const dispatched = await notifier.send({
      type: "account_switched",
      title: "Account Switched",
      body: "Details",
    });

    expect(dispatched).toBe(false);
    expect(mockInstances.length).toBe(0);
  });

  it("should suppress specific categories when disabled in preferences", async () => {
    const notifier = new NativeNotifier();
    notifier.setPreferences({
      enabled: true,
      notifyOnAutoSwitch: false,
      notifyOnRateLimit: false,
      notifyOnProcessCrash: false,
      debounceMs: 5000,
    });

    expect(
      await notifier.send({
        type: "account_switched",
        title: "T1",
        body: "B1",
      }),
    ).toBe(false);

    expect(
      await notifier.send({
        type: "rate_limit_cooldown",
        title: "T2",
        body: "B2",
      }),
    ).toBe(false);

    expect(
      await notifier.send({
        type: "service_crash",
        title: "T3",
        body: "B3",
      }),
    ).toBe(false);

    // General alert is allowed when master enabled is true
    expect(
      await notifier.send({
        type: "general_alert",
        title: "T4",
        body: "B4",
      }),
    ).toBe(true);
  });

  it("should enforce 5-second debounce window per event type", async () => {
    const notifier = new NativeNotifier({ defaultDebounceMs: 5000 });

    const first = await notifier.send({
      type: "rate_limit_cooldown",
      title: "Cooldown 1",
      body: "Body 1",
    });
    expect(first).toBe(true);

    // Immediate second dispatch with same event type should be debounced
    const second = await notifier.send({
      type: "rate_limit_cooldown",
      title: "Cooldown 2",
      body: "Body 2",
    });
    expect(second).toBe(false);

    // Different event type should NOT be debounced
    const differentType = await notifier.send({
      type: "service_crash",
      title: "Crash 1",
      body: "Body 3",
    });
    expect(differentType).toBe(true);

    // After resetDebounce, same event type should succeed again
    notifier.resetDebounce();
    const third = await notifier.send({
      type: "rate_limit_cooldown",
      title: "Cooldown 3",
      body: "Body 4",
    });
    expect(third).toBe(true);
  });

  it("should support helper methods for account switch, rate limit, crash, and general alerts", async () => {
    const notifier = new NativeNotifier();

    // 1. notifyAccountSwitched with previous email
    const s1 = await notifier.notifyAccountSwitched(
      "old@test.com",
      "new@test.com",
    );
    expect(s1).toBe(true);
    expect(mockInstances[0].options.body).toContain(
      "Switched from old@test.com to new@test.com",
    );

    notifier.resetDebounce();

    // 2. notifyAccountSwitched without previous email
    const s2 = await notifier.notifyAccountSwitched(null, "first@test.com");
    expect(s2).toBe(true);
    expect(mockInstances[1].options.body).toContain(
      "Active account switched to first@test.com",
    );

    // 3. notifyRateLimit
    const s3 = await notifier.notifyRateLimit("limited@test.com", 20);
    expect(s3).toBe(true);
    expect(mockInstances[2].options.title).toBe("Rate Limit Detected");
    expect(mockInstances[2].options.body).toContain("20 minutes");

    // 4. notifyServiceCrash with exit code
    const s4 = await notifier.notifyServiceCrash("Antigravity Daemon", 137);
    expect(s4).toBe(true);
    expect(mockInstances[3].options.title).toBe("Service Alert");
    expect(mockInstances[3].options.body).toContain("with code 137");

    notifier.resetDebounce();

    // 5. notifyServiceCrash without exit code
    const s5 = await notifier.notifyServiceCrash("Antigravity IDE");
    expect(s5).toBe(true);
    expect(mockInstances[4].options.body).toBe(
      "Antigravity IDE exited unexpectedly",
    );

    // 6. notifyGeneral
    const s6 = await notifier.notifyGeneral("General Title", "General Body");
    expect(s6).toBe(true);
    expect(mockInstances[5].options.title).toBe("General Title");
  });

  it("should read and update preferences via SettingsStore", async () => {
    const mockSettings = {
      ...DEFAULT_APP_SETTINGS,
      notifications: {
        enabled: true,
        notifyOnAutoSwitch: true,
        notifyOnRateLimit: true,
        notifyOnProcessCrash: true,
        debounceMs: 3000,
      },
    };

    let updateCallback: ((s: any) => void) | null = null;
    const mockSettingsStore = {
      get: vi.fn().mockResolvedValue(mockSettings),
      update: vi.fn().mockImplementation(async (partial: any) => {
        const updated = {
          ...mockSettings,
          notifications: {
            ...mockSettings.notifications,
            ...partial.notifications,
          },
        };
        if (updateCallback) updateCallback(updated);
        return updated;
      }),
      onSettingsUpdated: vi.fn().mockImplementation((cb: (s: any) => void) => {
        updateCallback = cb;
        return () => {};
      }),
    } as unknown as SettingsStore;

    const notifier = new NativeNotifier({ settingsStore: mockSettingsStore });

    const initialPrefs = await notifier.getPreferences();
    expect(initialPrefs.debounceMs).toBe(3000);

    const updated = await notifier.updatePreferences({ debounceMs: 8000 });
    expect(updated.debounceMs).toBe(8000);
    expect(mockSettingsStore.update).toHaveBeenCalledWith({
      notifications: expect.objectContaining({ debounceMs: 8000 }),
    });
  });

  it("should update preferences in-memory when SettingsStore is not provided", async () => {
    const notifier = new NativeNotifier();
    const updated = await notifier.updatePreferences({
      enabled: false,
      debounceMs: 12000,
    });

    expect(updated.enabled).toBe(false);
    expect(updated.debounceMs).toBe(12000);

    const prefs = await notifier.getPreferences();
    expect(prefs.enabled).toBe(false);
    expect(prefs.debounceMs).toBe(12000);
  });

  it("should fall back gracefully when SettingsStore.get throws during send", async () => {
    const mockSettingsStore = {
      get: vi.fn().mockRejectedValue(new Error("Disk failure")),
      onSettingsUpdated: vi.fn().mockReturnValue(() => {}),
    } as unknown as SettingsStore;

    const notifier = new NativeNotifier({ settingsStore: mockSettingsStore });
    notifier.setPreferences({
      enabled: true,
      notifyOnAutoSwitch: true,
      notifyOnRateLimit: true,
      notifyOnProcessCrash: true,
      debounceMs: 5000,
    });

    const result = await notifier.send({
      type: "general_alert",
      title: "Fallback Title",
      body: "Fallback Body",
    });

    expect(result).toBe(true);
    expect(mockInstances.length).toBe(1);
  });

  it("should refresh preferences from SettingsStore when it resolves successfully during send", async () => {
    const mockSettings = {
      ...DEFAULT_APP_SETTINGS,
      notifications: {
        enabled: true,
        notifyOnAutoSwitch: true,
        notifyOnRateLimit: true,
        notifyOnProcessCrash: true,
        debounceMs: 5000,
      },
    };

    const mockSettingsStore = {
      get: vi.fn().mockResolvedValue(mockSettings),
      onSettingsUpdated: vi.fn().mockReturnValue(() => {}),
    } as unknown as SettingsStore;

    const notifier = new NativeNotifier({
      settingsStore: mockSettingsStore,
      getMainWindow: undefined,
    });

    const result = await notifier.send({
      type: "general_alert",
      title: "Settings Refreshed Title",
      body: "Settings Refreshed Body",
    });

    expect(result).toBe(true);
    const instance = mockInstances[0];
    const clickHandler = instance.listeners.get("click");
    expect(() => clickHandler()).not.toThrow();
  });
});
