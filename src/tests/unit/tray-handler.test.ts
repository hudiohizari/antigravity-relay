import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudAccount } from "@/modules/cloud-account/types";
import { getTrayTexts } from "@/modules/app-shell/ipc/tray/i18n";
import { cloudAccountEvents } from "@/modules/cloud-account/services/cloud-account-events";

const mocks = vi.hoisted(() => {
  const accounts: CloudAccount[] = [];
  const listeners: Record<string, () => void> = {};

  return {
    accounts,
    listeners,
    appQuit: vi.fn(),
    trayDestroy: vi.fn(),
    traySetToolTip: vi.fn(),
    traySetContextMenu: vi.fn(),
    trayOn: vi.fn((event: string, cb: () => void) => {
      listeners[event] = cb;
    }),
    createFromPath: vi.fn(() => ({
      isEmpty: () => false,
      setTemplateImage: vi.fn(),
    })),
    buildFromTemplate: vi.fn((template: unknown) => template),
    getAccounts: vi.fn(async () => mocks.accounts),
    getAccount: vi.fn(async (id: string) =>
      mocks.accounts.find((a) => a.id === id),
    ),
    setActive: vi.fn(async (id: string) => {
      for (const a of mocks.accounts) {
        a.is_active = a.id === id;
      }
    }),
    updateQuota: vi.fn(async () => {}),
    fetchQuota: vi.fn(async () => ({
      models: {
        "gemini-2.5-pro": { percentage: 95, resetTime: "2026-09-09T20:00:00Z" },
      },
    })),
    isAntigravityTargetInstalled: vi.fn((_target?: string) => true),
  };
});

vi.mock("@/shared/platform/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/platform/paths")>();
  return {
    ...actual,
    isAntigravityTargetInstalled: mocks.isAntigravityTargetInstalled,
  };
});

vi.mock("electron", () => {
  class MockTray {
    destroy = mocks.trayDestroy;
    setToolTip = mocks.traySetToolTip;
    setContextMenu = mocks.traySetContextMenu;
    on = mocks.trayOn;
  }

  return {
    app: {
      quit: mocks.appQuit,
    },
    Tray: MockTray,
    Menu: {
      buildFromTemplate: mocks.buildFromTemplate,
    },
    nativeImage: {
      createFromPath: mocks.createFromPath,
    },
    BrowserWindow: class MockBrowserWindow {},
  };
});

vi.mock("@/modules/cloud-account/persistence/cloudHandler", () => ({
  CloudAccountRepo: {
    getAccounts: mocks.getAccounts,
    getAccount: mocks.getAccount,
    setActive: mocks.setActive,
    updateQuota: mocks.updateQuota,
  },
}));

vi.mock("@/modules/cloud-account/services/GoogleAPIService", () => ({
  GoogleAPIService: {
    fetchQuota: mocks.fetchQuota,
  },
}));

vi.mock(
  "@/modules/cloud-account/persistence/cloud-account-settings-store",
  () => ({
    CloudAccountSettingsStore: {
      getSetting: vi.fn(() => ({})),
      getActiveAccountIdForTarget: vi.fn(),
    },
  }),
);

describe("Tray Handler Functionality", () => {
  let handlerModule: typeof import("@/modules/app-shell/ipc/tray/handler");

  const createMockAccount = (
    overrides?: Partial<CloudAccount>,
  ): CloudAccount => ({
    id: "acc-1",
    provider: "google",
    email: "user1@example.com",
    token: {
      access_token: "valid-token",
      refresh_token: "valid-refresh-token",
      expires_in: 3600,
      expiry_timestamp: Math.floor(Date.now() / 1000) + 3600,
      token_type: "Bearer",
    },
    created_at: 1000,
    last_used: 1000,
    status: "active",
    is_active: true,
    ...overrides,
  });

  const createMockWindow = (options?: {
    isVisible?: boolean;
    isDestroyed?: boolean;
  }) => {
    let visible = options?.isVisible ?? false;
    const destroyed = options?.isDestroyed ?? false;
    const send = vi.fn();

    return {
      isVisible: vi.fn(() => visible),
      show: vi.fn(() => {
        visible = true;
      }),
      hide: vi.fn(() => {
        visible = false;
      }),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => destroyed),
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.accounts = [];
    for (const key in mocks.listeners) {
      delete mocks.listeners[key];
    }
    handlerModule = await import("@/modules/app-shell/ipc/tray/handler");
  });

  afterEach(() => {
    handlerModule.destroyTray();
  });

  describe("getQuotaText", () => {
    it("returns dashes when account is null", () => {
      const texts = getTrayTexts("en");
      const lines = handlerModule.getQuotaText(null, texts);
      expect(lines).toEqual(["Quota: --"]);
    });

    it("returns unknown when quota is missing", () => {
      const texts = getTrayTexts("en");
      const account = createMockAccount({ quota: undefined });
      const lines = handlerModule.getQuotaText(account, texts);
      expect(lines).toEqual(["Quota: Unknown"]);
    });

    it("returns forbidden when quota is marked forbidden", () => {
      const texts = getTrayTexts("en");
      const account = createMockAccount({
        quota: { models: {}, is_forbidden: true },
      });
      const lines = handlerModule.getQuotaText(account, texts);
      expect(lines).toEqual(["Quota: Account Forbidden"]);
    });

    it("returns 5h quota when non-weekly quota groups are present", () => {
      const texts = getTrayTexts("en");
      const account = createMockAccount({
        quota: {
          models: {},
          quota_groups: [
            {
              display_name: "Claude 3.7 Sonnet",
              buckets: [
                {
                  bucket_id: "5h",
                  window: "5h",
                  remaining_fraction: 0.85,
                  reset_time: "2026-09-09T20:00:00Z",
                },
              ],
            },
            {
              display_name: "Weekly Quota",
              buckets: [
                {
                  bucket_id: "weekly",
                  window: "weekly",
                  remaining_fraction: 0.5,
                  reset_time: "2026-09-16T00:00:00Z",
                },
              ],
            },
          ],
        },
      });

      const lines = handlerModule.getQuotaText(account, texts);
      expect(lines).toContain("5h Quota: 85%");
    });

    it("formats high, image, and claude models when present", () => {
      const texts = getTrayTexts("en");
      const account = createMockAccount({
        quota: {
          models: {
            "gemini-2.5-pro-high": {
              percentage: 90,
              resetTime: "2026-09-09T20:00:00Z",
            },
            "gemini-image-gen": {
              percentage: 75,
              resetTime: "2026-09-09T20:00:00Z",
            },
            "claude-3-7-sonnet": {
              percentage: 60,
              resetTime: "2026-09-09T20:00:00Z",
            },
          },
        },
      });

      const lines = handlerModule.getQuotaText(account, texts);
      expect(lines).toContain("Gemini High: 90%");
      expect(lines).toContain("Gemini Image: 75%");
      expect(lines).toContain("Claude 4.6: 60%");
    });

    it("formats dynamic models when standard model keywords are absent", () => {
      const texts = getTrayTexts("en");
      const account = createMockAccount({
        quota: {
          models: {
            "custom-gpt-4o": {
              display_name: "Custom GPT-4o",
              percentage: 82,
              resetTime: "2026-09-09T20:00:00Z",
            },
          },
        },
      });

      const lines = handlerModule.getQuotaText(account, texts);
      expect(lines).toContain("Custom GPT-4o: 82%");
    });
  });

  describe("updateTrayMenu and actions", () => {
    it("appends status badges to current account label for non-active states", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const activeAccount = createMockAccount({ status: "active" });
      handlerModule.updateTrayMenu(activeAccount, "en");
      let tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: user1@example.com [All]");

      const rateLimitedAccount = createMockAccount({ status: "rate_limited" });
      handlerModule.updateTrayMenu(rateLimitedAccount, "en");
      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe(
        "Current: user1@example.com [All] [Rate Limited]",
      );

      const expiredAccount = createMockAccount({ status: "expired" });
      handlerModule.updateTrayMenu(expiredAccount, "en");
      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: user1@example.com [All] [Expired]");
    });

    it("updates tooltip with current account email", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const account = createMockAccount({ email: "active@domain.com" });
      handlerModule.updateTrayMenu(account, "en");

      expect(mocks.traySetToolTip).toHaveBeenCalledWith(
        "Antigravity Relay (active@domain.com)",
      );
    });

    it("executes registered switchAccount handler on Switch Next click", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({
        id: "acc-1",
        email: "acc1@test.com",
        is_active: true,
      });
      const acc2 = createMockAccount({
        id: "acc-2",
        email: "acc2@test.com",
        is_active: false,
      });
      mocks.accounts = [acc1, acc2];

      const switchSpy = vi.fn(async (id: string) => {
        acc1.is_active = false;
        acc2.is_active = true;
      });

      handlerModule.registerTrayAccountHandlers({
        switchAccount: switchSpy,
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );
      expect(switchItem).toBeDefined();

      await switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(switchSpy).toHaveBeenCalledWith("acc-2", "all");
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://account-switched",
        { accountId: "acc-2", target: "all" },
      );
    });

    it("falls back to CloudAccountRepo.setActive when no switchAccount delegate is registered", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      const acc2 = createMockAccount({ id: "acc-2", is_active: false });
      mocks.accounts = [acc1, acc2];

      handlerModule.registerTrayAccountHandlers({
        switchAccount: null as any,
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      await switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(mocks.setActive).toHaveBeenCalledWith("acc-2", "classic");
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://account-switched",
        { accountId: "acc-2", target: "all" },
      );
    });

    it("executes registered refreshQuota handler on Refresh Quota click", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      mocks.accounts = [acc1];

      const refreshSpy = vi.fn(async (id: string) => {
        return {
          ...acc1,
          quota: {
            models: {
              "gemini-2.5-pro-high": {
                percentage: 99,
                resetTime: "2026-09-09T20:00:00Z",
              },
            },
          },
        } as CloudAccount;
      });

      handlerModule.registerTrayAccountHandlers({
        refreshQuota: refreshSpy,
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const refreshItem = tpl.find(
        (item) => item.label === "Refresh Current Quota",
      );
      expect(refreshItem).toBeDefined();

      await refreshItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(refreshSpy).toHaveBeenCalledWith("acc-1");
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://refresh-current",
      );
    });

    it("toggles main window visibility on double click", () => {
      const win = createMockWindow({ isVisible: false });
      handlerModule.initTray(win);

      expect(mocks.listeners["double-click"]).toBeDefined();

      // Double click when hidden -> shows and focuses
      mocks.listeners["double-click"]();
      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();

      // Double click when visible -> hides
      mocks.listeners["double-click"]();
      expect(win.hide).toHaveBeenCalled();
    });

    it("shows main window on Show Main Window click", () => {
      const win = createMockWindow({ isVisible: false });
      handlerModule.initTray(win);

      handlerModule.updateTrayMenu(null, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const showItem = tpl.find((item) => item.label === "Show Main Window");
      expect(showItem).toBeDefined();

      showItem!.click!(undefined as any, undefined as any, undefined as any);
      expect(win.show).toHaveBeenCalled();
      expect(win.focus).toHaveBeenCalled();
    });

    it("invokes onQuitRequested or app.quit on Quit Application click", () => {
      const win = createMockWindow();
      const quitHandler = vi.fn();
      handlerModule.initTray(win, quitHandler);

      handlerModule.updateTrayMenu(null, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const quitItem = tpl.find((item) => item.label === "Quit Application");
      expect(quitItem).toBeDefined();

      quitItem!.click!(undefined as any, undefined as any, undefined as any);
      expect(quitHandler).toHaveBeenCalled();
      expect(mocks.appQuit).not.toHaveBeenCalled();
    });

    it("supports setTrayLanguage across languages", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const account = createMockAccount({ status: "rate_limited" });
      handlerModule.updateTrayMenu(account, "en");

      handlerModule.setTrayLanguage("id");
      let tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toContain("Saat ini");
      expect(tpl[0].label).toContain("[Batas Laju Tercapai]");

      handlerModule.setTrayLanguage("zh");
      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toContain("当前账号");
      expect(tpl[0].label).toContain("[受速率限制]");
    });

    it("handles isForbidden camelCase flag and status badges", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const account = createMockAccount({
        quota: { models: {}, isForbidden: true },
      });
      handlerModule.updateTrayMenu(account, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toContain("[Account Forbidden]");
    });

    it("calls app.quit when quit is clicked and onQuitRequested is not provided", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      handlerModule.updateTrayMenu(null, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const quitItem = tpl.find((item) => item.label === "Quit Application");

      quitItem!.click!(undefined as any, undefined as any, undefined as any);
      expect(mocks.appQuit).toHaveBeenCalled();
    });

    it("safely handles switch_next when no accounts exist", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      mocks.accounts = [];
      const switchSpy = vi.fn();
      handlerModule.registerTrayAccountHandlers({ switchAccount: switchSpy });

      handlerModule.updateTrayMenu(null, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      await switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );
      expect(switchSpy).not.toHaveBeenCalled();
    });

    it("catches error without crashing when switchAccount rejects", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      mocks.accounts = [acc1];

      handlerModule.registerTrayAccountHandlers({
        switchAccount: vi.fn(async () => {
          throw new Error("Keychain lock failed");
        }),
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      await expect(
        switchItem!.click!(
          undefined as any,
          undefined as any,
          undefined as any,
        ),
      ).resolves.not.toThrow();
    });

    it("chooses candidate with highest 5h quota bottleneck via AutoSwitchService.findBestAccount", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const accCurrent = createMockAccount({
        id: "acc-current",
        email: "current@example.com",
        is_active: true,
        quota: {
          models: {
            "claude-3-7-sonnet": { percentage: 20, resetTime: "" },
          },
        },
      });
      const accAlpha = createMockAccount({
        id: "acc-alpha",
        email: "alpha@example.com",
        is_active: false,
        quota: {
          models: {
            "claude-3-7-sonnet": { percentage: 20, resetTime: "" },
          },
        },
      });
      const accBeta = createMockAccount({
        id: "acc-beta",
        email: "beta@example.com",
        is_active: false,
        quota: {
          models: {
            "claude-3-7-sonnet": { percentage: 85, resetTime: "" },
          },
        },
      });
      const accGamma = createMockAccount({
        id: "acc-gamma",
        email: "gamma@example.com",
        is_active: false,
        quota: {
          models: {
            "claude-3-7-sonnet": { percentage: 50, resetTime: "" },
          },
        },
      });
      mocks.accounts = [accCurrent, accAlpha, accBeta, accGamma];

      const switchSpy = vi.fn();
      handlerModule.registerTrayAccountHandlers({ switchAccount: switchSpy });

      handlerModule.updateTrayMenu(accCurrent, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      await switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      // Beta has 85% remaining 5h quota, so it must be chosen over Alpha (20%) and Gamma (50%)
      expect(switchSpy).toHaveBeenCalledWith("acc-beta", "all");
    });

    it("serializes concurrent rapid clicks via runWithSwitchGuard", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      const acc2 = createMockAccount({ id: "acc-2", is_active: false });
      mocks.accounts = [acc1, acc2];

      let switchCallCount = 0;
      let resolveFirstSwitch!: () => void;
      let switchStartedResolve!: () => void;
      const switchStarted = new Promise<void>((res) => {
        switchStartedResolve = res;
      });

      const switchSpy = vi.fn(() => {
        switchCallCount++;
        if (switchCallCount === 1) {
          return new Promise<void>((resolve) => {
            resolveFirstSwitch = resolve;
            switchStartedResolve();
          });
        }
        return Promise.resolve();
      });
      handlerModule.registerTrayAccountHandlers({ switchAccount: switchSpy });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      // Trigger first click (in-flight)
      const firstClick = switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      // Wait until first click enters switchAccount
      await switchStarted;

      // Trigger second click while first is still running
      const secondClick = switchItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      resolveFirstSwitch();
      await firstClick;
      await secondClick;

      // Both clicks are serialized and executed safely under the switch guard
      expect(switchSpy).toHaveBeenCalledTimes(2);
    });

    it("safely handles refresh_current when no active account exists", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      mocks.accounts = [createMockAccount({ is_active: false })];
      const refreshSpy = vi.fn();
      handlerModule.registerTrayAccountHandlers({ refreshQuota: refreshSpy });

      handlerModule.updateTrayMenu(null, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const refreshItem = tpl.find(
        (item) => item.label === "Refresh Current Quota",
      );

      await refreshItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("catches error without crashing when refreshQuota rejects", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      mocks.accounts = [acc1];

      handlerModule.registerTrayAccountHandlers({
        refreshQuota: vi.fn(async () => {
          throw new Error("Network offline");
        }),
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const refreshItem = tpl.find(
        (item) => item.label === "Refresh Current Quota",
      );

      await expect(
        refreshItem!.click!(
          undefined as any,
          undefined as any,
          undefined as any,
        ),
      ).resolves.not.toThrow();
    });

    it("falls back to GoogleAPIService.fetchQuota when refreshQuota delegate is not provided", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      mocks.accounts = [acc1];

      handlerModule.registerTrayAccountHandlers({
        refreshQuota: null as any,
      });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const refreshItem = tpl.find(
        (item) => item.label === "Refresh Current Quota",
      );

      await refreshItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(mocks.fetchQuota).toHaveBeenCalledWith("valid-token");
      expect(mocks.updateQuota).toHaveBeenCalled();
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://refresh-current",
      );
    });
  });

  describe("Tray Lifecycle and Edge Cases", () => {
    it("destroys previous tray instance when initTray is called repeatedly", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);
      expect(mocks.trayDestroy).not.toHaveBeenCalled();

      handlerModule.initTray(win);
      expect(mocks.trayDestroy).toHaveBeenCalledTimes(1);
    });

    it("aborts initTray if icon is empty", () => {
      mocks.createFromPath.mockReturnValueOnce({
        isEmpty: () => true,
        setTemplateImage: vi.fn(),
      } as any);

      const win = createMockWindow();
      handlerModule.initTray(win);

      expect(mocks.traySetContextMenu).not.toHaveBeenCalled();
    });

    it("safely ignores destroyTray if tray is already destroyed or throws", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      mocks.trayDestroy.mockImplementationOnce(() => {
        throw new Error("Object already destroyed");
      });

      expect(() => handlerModule.destroyTray()).not.toThrow();
      expect(() => handlerModule.destroyTray()).not.toThrow();
    });
  });

  describe("syncTrayWithActiveAccount and Concurrency Guards", () => {
    it("synchronizes active account and quota metrics without placeholder dashes", async () => {
      const activeAccount = createMockAccount({
        id: "acc-active",
        email: "active.developer@example.com",
        is_active: true,
        quota: {
          models: {
            "gemini-2.5-pro-high": {
              percentage: 92,
              resetTime: "2026-09-09T20:00:00Z",
            },
            "claude-3-7-sonnet": {
              percentage: 76,
              resetTime: "2026-09-09T20:00:00Z",
            },
          },
        },
      });
      mocks.accounts = [activeAccount];

      const win = createMockWindow();
      handlerModule.initTray(win);

      await handlerModule.syncTrayWithActiveAccount();

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];

      expect(tpl[0].label).toBe("Current: active.deve...xample.com [All]");
      expect(tpl.some((item) => item.label?.includes("Gemini High: 92%"))).toBe(
        true,
      );
      expect(tpl.some((item) => item.label?.includes("Claude 4.6: 76%"))).toBe(
        true,
      );
      expect(tpl.some((item) => item.label === "Quota: --")).toBe(false);
      expect(mocks.traySetToolTip).toHaveBeenCalledWith(
        "Antigravity Relay (active.developer@example.com)",
      );
    });

    it("handles cold start with zero accounts by displaying Quota: -- and Current: No Account", async () => {
      mocks.accounts = [];
      const win = createMockWindow();
      handlerModule.initTray(win);

      await handlerModule.syncTrayWithActiveAccount();

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];

      expect(tpl[0].label).toBe("Current: No Account");
      expect(tpl.some((item) => item.label === "Quota: --")).toBe(true);
      expect(mocks.traySetToolTip).toHaveBeenCalledWith("Antigravity Relay");
    });

    it("falls back cleanly on database error or lock without throwing", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      mocks.getAccounts.mockRejectedValueOnce(
        new Error("SQLITE_BUSY: database is locked"),
      );

      await expect(
        handlerModule.syncTrayWithActiveAccount(),
      ).resolves.not.toThrow();

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];

      expect(tpl[0].label).toBe("Current: No Account");
      expect(tpl.some((item) => item.label === "Quota: --")).toBe(true);
    });

    it("deduplicates in-flight calls to syncTrayWithActiveAccount", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc = createMockAccount({
        id: "acc-1",
        email: "dedup@example.com",
        is_active: true,
      });
      mocks.accounts = [acc];

      const p1 = handlerModule.syncTrayWithActiveAccount();
      const p2 = handlerModule.syncTrayWithActiveAccount();

      expect(p1).toBe(p2);
      await Promise.all([p1, p2]);

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: dedup@example.com [All]");
    });

    it("drops concurrent rapid clicks on refresh_current via isRefreshingQuota async mutex", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", is_active: true });
      mocks.accounts = [acc1];

      let resolveFirstRefresh!: () => void;
      let refreshStartedResolve!: () => void;
      const refreshStarted = new Promise<void>((res) => {
        refreshStartedResolve = res;
      });

      const refreshSpy = vi.fn(
        () =>
          new Promise<CloudAccount | null>((resolve) => {
            resolveFirstRefresh = () => resolve(acc1);
            refreshStartedResolve();
          }),
      );
      handlerModule.registerTrayAccountHandlers({ refreshQuota: refreshSpy });

      handlerModule.updateTrayMenu(acc1, "en");
      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const refreshItem = tpl.find(
        (item) => item.label === "Refresh Current Quota",
      );
      expect(refreshItem).toBeDefined();

      // Trigger first click (in-flight)
      const firstClick = refreshItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      await refreshStarted;

      // Trigger second click while first is still pending
      await refreshItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      resolveFirstRefresh();
      await firstClick;

      // Only the first click should have invoked refreshQuota; second was dropped by mutex
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it("synchronizes tray when cloudAccountEvents lifecycle events are emitted", async () => {
      const acc1 = createMockAccount({
        id: "acc-1",
        email: "first@example.com",
        is_active: true,
      });
      const acc2 = createMockAccount({
        id: "acc-2",
        email: "second@example.com",
        is_active: false,
      });
      mocks.accounts = [acc1, acc2];

      const win = createMockWindow();
      handlerModule.initTray(win);

      await handlerModule.syncTrayWithActiveAccount();

      let tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: first@example.com [All]");

      // Switch active account and emit account:switched
      acc1.is_active = false;
      acc2.is_active = true;
      cloudAccountEvents.emit("account:switched", {
        accountId: "acc-2",
        account: acc2,
      });

      await new Promise((r) => setTimeout(r, 10));
      await handlerModule.syncTrayWithActiveAccount();

      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: second@example.com [All]");

      // Update quota and emit account:quota_updated
      acc2.quota = {
        models: {
          "gemini-2.5-pro-high": { percentage: 99, resetTime: "" },
        },
      };
      cloudAccountEvents.emit("account:quota_updated", {
        accountId: "acc-2",
        account: acc2,
      });

      await new Promise((r) => setTimeout(r, 10));
      await handlerModule.syncTrayWithActiveAccount();

      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl.some((item) => item.label?.includes("Gemini High: 99%"))).toBe(
        true,
      );

      // Delete account and emit account:deleted
      mocks.accounts = [acc1];
      acc1.is_active = true;
      cloudAccountEvents.emit("account:deleted", { accountId: "acc-2" });

      await new Promise((r) => setTimeout(r, 10));
      await handlerModule.syncTrayWithActiveAccount();

      tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      expect(tpl[0].label).toBe("Current: first@example.com [All]");
    });

    it("unsubscribes from cloudAccountEvents when destroyTray is called", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      handlerModule.destroyTray();
      mocks.traySetContextMenu.mockClear();

      cloudAccountEvents.emit("account:sync_requested", { reason: "test" });
      await new Promise((r) => setTimeout(r, 10));

      expect(mocks.traySetContextMenu).not.toHaveBeenCalled();
    });
  });

  describe("Multi-Target System Tray & Granular Submenus (AC-07)", () => {
    describe("middleTruncate", () => {
      it("preserves strings that fit within maxLength", () => {
        expect(handlerModule.middleTruncate("short@example.com", 24)).toBe(
          "short@example.com",
        );
        expect(
          handlerModule.middleTruncate("exact24charslong@test.c", 24),
        ).toBe("exact24charslong@test.c");
      });

      it("middle-truncates strings exceeding maxLength to exactly maxLength characters", () => {
        const longEmail = "verylongdeveloperaccount123@domain.com";
        const truncated = handlerModule.middleTruncate(longEmail, 24);
        expect(truncated.length).toBe(24);
        expect(truncated).toContain("...");
        expect(truncated.startsWith("verylongdev")).toBe(true);
        expect(truncated.endsWith("domain.com")).toBe(true);
      });

      it("handles small maxLength cleanly", () => {
        expect(handlerModule.middleTruncate("abcdef", 3)).toBe("abc");
      });
    });

    it("renders split lines when targets have divergent active accounts", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const accApp = createMockAccount({
        id: "acc-app",
        email: "app.user@example.com",
      });
      const accIde = createMockAccount({
        id: "acc-ide",
        email: "ide.user@example.com",
      });
      const accCli = createMockAccount({
        id: "acc-cli",
        email: "cli.user@example.com",
      });

      handlerModule.updateTrayMenu(accApp, "en", {
        classic: accApp,
        ide: accIde,
        agy: accCli,
      });

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];

      expect(tpl[0].label).toBe("App: app.user@example.com");
      expect(tpl[1].label).toBe("IDE: ide.user@example.com");
      expect(tpl[2].label).toBe("CLI: cli.user@example.com");
    });

    it("renders Switch to Next Account (All) with Cmd+N/Ctrl+N accelerator", () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({ id: "acc-1", email: "user@test.com" });
      handlerModule.updateTrayMenu(acc1, "en");

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const switchAllItem = tpl.find(
        (item) => item.label === "Switch to Next Account (All)",
      );

      expect(switchAllItem).toBeDefined();
      expect(switchAllItem?.accelerator).toBe(
        process.platform === "darwin" ? "Cmd+N" : "Ctrl+N",
      );
    });

    it("provides granular submenus for individual target switching and direct account selection", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      const acc1 = createMockAccount({
        id: "acc-1",
        email: "first@example.com",
        is_active: true,
      });
      const acc2 = createMockAccount({
        id: "acc-2",
        email: "second@example.com",
        is_active: false,
      });
      mocks.accounts = [acc1, acc2];

      const switchSpy = vi.fn(async (_id: string, _target?: string) => {});
      handlerModule.registerTrayAccountHandlers({ switchAccount: switchSpy });

      handlerModule.updateTrayMenu(acc1, "en", {
        classic: acc1,
        ide: acc2,
        agy: acc1,
      });

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];
      const targetSubmenuItem = tpl.find(
        (item) => item.label === "Switch Specific Target",
      );

      expect(targetSubmenuItem).toBeDefined();
      const subItems = targetSubmenuItem!
        .submenu as Electron.MenuItemConstructorOptions[];
      expect(subItems).toBeDefined();

      const appItem = subItems.find((item) => item.label === "Antigravity App");
      const ideItem = subItems.find((item) => item.label === "Antigravity IDE");
      const cliItem = subItems.find((item) => item.label === "Antigravity CLI");

      expect(appItem).toBeDefined();
      expect(ideItem).toBeDefined();
      expect(cliItem).toBeDefined();

      const appSubmenu = appItem!
        .submenu as Electron.MenuItemConstructorOptions[];
      const appRotateItem = appSubmenu.find(
        (item) => item.label === "Switch to Next Account (App)",
      );
      expect(appRotateItem).toBeDefined();

      // Test rotating specific target (App)
      await appRotateItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(switchSpy).toHaveBeenCalledWith("acc-2", "classic");
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://account-switched",
        { accountId: "acc-2", target: "classic" },
      );

      // Test direct account switch from IDE submenu
      const ideSubmenu = ideItem!
        .submenu as Electron.MenuItemConstructorOptions[];
      const firstAccItem = ideSubmenu.find(
        (item) => item.label === "first@example.com",
      );
      expect(firstAccItem).toBeDefined();

      await firstAccItem!.click!(
        undefined as any,
        undefined as any,
        undefined as any,
      );

      expect(switchSpy).toHaveBeenCalledWith("acc-1", "ide");
      expect(win.webContents.send).toHaveBeenCalledWith(
        "tray://account-switched",
        { accountId: "acc-1", target: "ide" },
      );
    });

    it("disables submenus and prevents switching for uninstalled targets", async () => {
      const win = createMockWindow();
      handlerModule.initTray(win);

      // IDE is uninstalled, App and CLI are installed
      mocks.isAntigravityTargetInstalled.mockImplementation(
        (target?: string) => target !== "ide",
      );

      const acc1 = createMockAccount({
        id: "acc-1",
        email: "first@example.com",
      });
      mocks.accounts = [acc1];

      const switchSpy = vi.fn(async (_id: string, _target?: string) => {});
      handlerModule.registerTrayAccountHandlers({ switchAccount: switchSpy });

      handlerModule.updateTrayMenu(acc1, "en", {
        classic: acc1,
        ide: null,
        agy: acc1,
      });

      const tpl = mocks.traySetContextMenu.mock.calls.at(
        -1,
      )![0] as Electron.MenuItemConstructorOptions[];

      // In the header, IDE should not appear
      const headerLabels = tpl.map((item) => item.label);
      expect(headerLabels.some((label) => label?.startsWith("IDE:"))).toBe(
        false,
      );

      const targetSubmenuItem = tpl.find(
        (item) => item.label === "Switch Specific Target",
      );
      const subItems = targetSubmenuItem!
        .submenu as Electron.MenuItemConstructorOptions[];

      const ideItem = subItems.find((item) =>
        item.label?.includes("Antigravity IDE"),
      );
      expect(ideItem).toBeDefined();
      expect(ideItem?.enabled).toBe(false);
      expect(ideItem?.label).toContain("(Not Installed)");
      expect(ideItem?.submenu).toBeUndefined();
    });
  });
});
