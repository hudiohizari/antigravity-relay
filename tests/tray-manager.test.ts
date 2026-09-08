import { describe, it, expect, beforeEach, vi } from "vitest";
import { TrayManager } from "../src/main/tray/tray";
import fs from "node:fs";

const {
  MockTray,
  MockMenu,
  mockTrayInstances,
  getAppQuitCalled,
  setAppQuitCalled,
} = vi.hoisted(() => {
  const mockTrayInstances: any[] = [];
  let appQuitCalled = false;

  class MockTray {
    public toolTip = "";
    public contextMenu: any = null;
    public clickListener: Function | null = null;
    public isDestroyedFlag = false;

    constructor(public image: any) {
      mockTrayInstances.push(this);
    }

    setToolTip(tip: string) {
      this.toolTip = tip;
    }

    setContextMenu(menu: any) {
      this.contextMenu = menu;
    }

    on(event: string, cb: Function) {
      if (event === "click") {
        this.clickListener = cb;
      }
      return this;
    }

    destroy() {
      this.isDestroyedFlag = true;
    }

    isDestroyed() {
      return this.isDestroyedFlag;
    }
  }

  class MockMenu {
    public items: any[];
    constructor(items: any[]) {
      this.items = items;
    }

    static buildFromTemplate(template: any[]) {
      return new MockMenu(template);
    }
  }

  return {
    MockTray,
    MockMenu,
    mockTrayInstances,
    getAppQuitCalled: () => appQuitCalled,
    setAppQuitCalled: (v: boolean) => {
      appQuitCalled = v;
    },
  };
});

vi.mock("electron", () => {
  return {
    app: {
      quit: vi.fn(() => {
        setAppQuitCalled(true);
      }),
    },
    Tray: MockTray,
    Menu: MockMenu,
    nativeImage: {
      createFromPath: vi.fn((p: string) => ({
        path: p,
        setTemplateImage: vi.fn(),
      })),
      createFromDataURL: vi.fn((data: string) => ({
        data,
        setTemplateImage: vi.fn(),
      })),
    },
    BrowserWindow: vi.fn(),
  };
});

describe("TrayManager", () => {
  let mockAccountStore: any;
  let mockProcessController: any;
  let mockQuotaMonitor: any;
  let mockSwitchFlow: any;
  let mockRelayServer: any;
  let mockSettingsStore: any;
  let mockWindow: any;
  let accounts: any[] = [];
  let activeAccount: any = null;
  let processStatus: any = {
    runningCount: 2,
    totalCount: 2,
    services: {},
  };

  let processListener: Function | null = null;
  let switchListener: Function | null = null;
  let quotaListener: Function | null = null;
  let relayListener: Function | null = null;
  let settingsListener: Function | null = null;

  beforeEach(() => {
    mockTrayInstances.length = 0;
    setAppQuitCalled(false);
    vi.clearAllMocks();

    accounts = [
      { id: "acc-1", email: "first@example.com" },
      { id: "acc-2", email: "second@example.com" },
    ];
    activeAccount = accounts[0];

    mockAccountStore = {
      getAll: vi.fn(async () => accounts),
      getActive: vi.fn(async () => activeAccount),
      setActive: vi.fn(async (id: string) => {
        activeAccount = accounts.find((a) => a.id === id) || null;
      }),
    };

    mockProcessController = {
      getStatus: vi.fn(async () => processStatus),
      onStatusUpdated: vi.fn((cb: Function) => {
        processListener = cb;
        return () => {
          processListener = null;
        };
      }),
    };

    mockQuotaMonitor = {
      pollAll: vi.fn(async () => []),
      onQuotaUpdated: vi.fn((cb: Function) => {
        quotaListener = cb;
        return () => {
          quotaListener = null;
        };
      }),
    };

    mockSwitchFlow = {
      executeSwitch: vi.fn(async (id: string) => {
        activeAccount = accounts.find((a) => a.id === id) || null;
        return { success: true };
      }),
      onSwitchEvent: vi.fn((cb: Function) => {
        switchListener = cb;
        return () => {
          switchListener = null;
        };
      }),
    };

    mockRelayServer = {
      getStatus: vi.fn(() => ({
        isBuffering: false,
      })),
      onStatusUpdated: vi.fn((cb: Function) => {
        relayListener = cb;
        return () => {
          relayListener = null;
        };
      }),
    };

    mockSettingsStore = {
      get: vi.fn(async () => ({
        minimizeToTrayOnClose: true,
      })),
      onSettingsUpdated: vi.fn((cb: Function) => {
        settingsListener = cb;
        return () => {
          settingsListener = null;
        };
      }),
    };

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      restore: vi.fn(),
      on: vi.fn(),
    };
  });

  it("should initialize tray, set tooltip and build dynamic context menu", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      quotaMonitor: mockQuotaMonitor,
      switchFlow: mockSwitchFlow,
      relayServer: mockRelayServer,
      settingsStore: mockSettingsStore,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    expect(manager.isTrayCreated()).toBe(true);
    expect(mockTrayInstances.length).toBe(1);

    const tray = mockTrayInstances[0];
    expect(tray.toolTip).toBe("Antigravity Relay");
    expect(tray.contextMenu).toBeDefined();

    // Check menu template items
    const menuItems = tray.contextMenu.items;
    expect(menuItems[0].label).toBe("Antigravity Relay v1.0.0");
    expect(menuItems[2].label).toBe("● Services: 2/2 running");
    expect(menuItems[3].label).toBe("👤 Active: first@example.com");

    // Submenu for accounts
    const switchSubmenu = menuItems[5];
    expect(switchSubmenu.label).toBe("Switch Active Account");
    expect(switchSubmenu.submenu.length).toBe(2);
    expect(switchSubmenu.submenu[0].label).toBe("first@example.com");
    expect(switchSubmenu.submenu[0].checked).toBe(true);
    expect(switchSubmenu.submenu[1].label).toBe("second@example.com");
    expect(switchSubmenu.submenu[1].checked).toBe(false);
  });

  it("should handle custom icon path if exists, or fallback to default base64 data url", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);

    const managerWithCustom = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
      iconPath: "/custom/icon.png",
    });

    managerWithCustom.createTray();
    expect(managerWithCustom.getTray()).not.toBeNull();

    existsSpy.mockReturnValue(false);
    const managerFallback = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
      iconPath: "/nonexistent.png",
    });
    managerFallback.createTray();
    expect(managerFallback.getTray()).not.toBeNull();
    existsSpy.mockRestore();
  });

  it("should return existing tray if createTray is called multiple times", () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    const t1 = manager.createTray();
    const t2 = manager.createTray();
    expect(t1).toBe(t2);
  });

  it("should execute account switch when clicking non-active account in submenu", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      switchFlow: mockSwitchFlow,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const switchSubmenu = tray.contextMenu.items[5];
    const secondAccountItem = switchSubmenu.submenu[1];

    await secondAccountItem.click();

    expect(mockSwitchFlow.executeSwitch).toHaveBeenCalledWith(
      "acc-2",
      "manual_request",
    );
  });

  it("should do nothing when clicking the currently active account", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      switchFlow: mockSwitchFlow,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const switchSubmenu = tray.contextMenu.items[5];
    const activeAccountItem = switchSubmenu.submenu[0];

    await activeAccountItem.click();
    expect(mockSwitchFlow.executeSwitch).not.toHaveBeenCalled();
  });

  it("should switch active account using accountStore if switchFlow is not provided", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const switchSubmenu = tray.contextMenu.items[5];
    const secondAccountItem = switchSubmenu.submenu[1];

    await secondAccountItem.click();
    expect(mockAccountStore.setActive).toHaveBeenCalledWith("acc-2");
  });

  it("should display placeholder when account pool is empty", async () => {
    mockAccountStore.getAll.mockResolvedValue([]);
    mockAccountStore.getActive.mockResolvedValue(null);

    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const menuItems = tray.contextMenu.items;
    expect(menuItems[3].label).toBe("👤 No Active Account");

    const switchSubmenu = menuItems[5];
    expect(switchSubmenu.submenu[0].label).toBe("No accounts configured");
    expect(switchSubmenu.submenu[0].enabled).toBe(false);
  });

  it("should trigger quota monitor pollAll when Check Quota action is clicked", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      quotaMonitor: mockQuotaMonitor,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const checkQuotaItem = tray.contextMenu.items[6];
    expect(checkQuotaItem.label).toBe("Check Quota");

    await checkQuotaItem.click();
    expect(mockQuotaMonitor.pollAll).toHaveBeenCalled();
  });

  it("should handle Check Quota click when quotaMonitor is not provided", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await manager.init();
    const tray = mockTrayInstances[0];
    const checkQuotaItem = tray.contextMenu.items[6];
    await expect(checkQuotaItem.click()).resolves.not.toThrow();
  });

  it("should restore and focus window when Open Dashboard is clicked or tray is clicked", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const tray = mockTrayInstances[0];
    const openDashboardItem = tray.contextMenu.items[7];
    expect(openDashboardItem.label).toBe("Open Dashboard");

    mockWindow.isMinimized.mockReturnValue(true);
    openDashboardItem.click();

    expect(mockWindow.restore).toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();

    // Also test tray click listener on non-darwin
    if (tray.clickListener) {
      mockWindow.isMinimized.mockReturnValue(false);
      tray.clickListener();
      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    }
  });

  it("should hide window when minimizeToTray is called", () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    manager.minimizeToTray();
    expect(mockWindow.hide).toHaveBeenCalled();
  });

  it("should intercept window close event and hide window when minimizeToTrayOnClose is enabled", () => {
    let closeListener: Function | null = null;
    mockWindow.on.mockImplementation((event: string, cb: Function) => {
      if (event === "close") closeListener = cb;
    });

    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    manager.setupCloseInterception(mockWindow);

    const event = { preventDefault: vi.fn() };
    expect(closeListener).not.toBeNull();

    // 1. Normal close while not quitting
    closeListener!(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockWindow.hide).toHaveBeenCalled();

    // 2. Close while quitting
    event.preventDefault.mockClear();
    manager.setQuitting(true);
    closeListener!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();

    // 3. Custom shouldCloseToTray returning false
    manager.setQuitting(false);
    manager.setupCloseInterception(mockWindow, () => false);
    event.preventDefault.mockClear();
    closeListener!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("should execute graceful teardown and call app.quit on quit action", async () => {
    const onQuitMock = vi.fn().mockResolvedValue(undefined);
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
      onQuit: onQuitMock,
    });

    await manager.init();
    const tray = mockTrayInstances[0];
    const quitItem = tray.contextMenu.items[9];
    expect(quitItem.label).toBe("Quit Antigravity Relay");

    await quitItem.click();

    expect(onQuitMock).toHaveBeenCalled();
    expect(manager.isQuitting()).toBe(true);
    expect(getAppQuitCalled()).toBe(true);
  });

  it("should return accurate SystemTrayState from getState()", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      relayServer: mockRelayServer,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    const state = await manager.getState();
    expect(state.isVisible).toBe(true);
    expect(state.activeAccountEmail).toBe("first@example.com");
    expect(state.serviceRunningCount).toBe(2);
    expect(state.totalServiceCount).toBe(2);
    expect(state.isBuffering).toBe(false);
    expect(state.lastUpdated).toBeGreaterThan(0);
  });

  it("should update menu dynamically when events fire", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      quotaMonitor: mockQuotaMonitor,
      switchFlow: mockSwitchFlow,
      relayServer: mockRelayServer,
      settingsStore: mockSettingsStore,
      getMainWindow: () => mockWindow,
    });

    await manager.init();

    // Trigger process status update
    processStatus = { runningCount: 1, totalCount: 2, services: {} };
    if (processListener) processListener(processStatus);

    // Trigger switch event
    if (switchListener) switchListener({ success: true });

    // Trigger quota update
    if (quotaListener) quotaListener({});

    // Trigger relay update
    if (relayListener) relayListener({});

    // Trigger settings update
    if (settingsListener) settingsListener({ minimizeToTrayOnClose: false });

    // Allow async menu update to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    const tray = mockTrayInstances[0];
    expect(tray.contextMenu.items[2].label).toBe("● Services: 1/2 running");
  });

  it("should destroy tray and unsubscribe from all event listeners", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      quotaMonitor: mockQuotaMonitor,
      switchFlow: mockSwitchFlow,
      relayServer: mockRelayServer,
      settingsStore: mockSettingsStore,
      getMainWindow: () => mockWindow,
    });

    await manager.init();
    expect(manager.isTrayCreated()).toBe(true);

    const tray = mockTrayInstances[0];
    manager.destroy();

    expect(tray.isDestroyed()).toBe(true);
    expect(manager.isTrayCreated()).toBe(false);
  });

  it("should handle error when settingsStore.get fails during init", async () => {
    mockSettingsStore.get.mockRejectedValueOnce(
      new Error("Settings load error"),
    );
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      settingsStore: mockSettingsStore,
      getMainWindow: () => mockWindow,
    });

    await expect(manager.init()).resolves.not.toThrow();
  });

  it("should return early when updateMenu is called before tray is created", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await expect(manager.updateMenu()).resolves.not.toThrow();
  });

  it("should suppress errors thrown by onQuit during handleQuit", async () => {
    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
      onQuit: vi.fn().mockRejectedValueOnce(new Error("Teardown crash")),
    });

    await expect(manager.handleQuit()).resolves.not.toThrow();
    expect(manager.isQuitting()).toBe(true);
  });

  it("should handle exceptions thrown by unsubscribers and tray.destroy during destroy", async () => {
    mockProcessController.onStatusUpdated.mockReturnValueOnce(() => {
      throw new Error("Unsubscribe failed");
    });

    const manager = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });

    await manager.init();
    const tray = mockTrayInstances[0];
    vi.spyOn(tray, "destroy").mockImplementationOnce(() => {
      throw new Error("Destroy failed");
    });

    expect(() => manager.destroy()).not.toThrow();
    expect(manager.isTrayCreated()).toBe(false);
  });

  it("should handle getState when relayServer is undefined or isBuffering is true", async () => {
    // 1. relayServer is undefined
    const managerNoRelay = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      getMainWindow: () => mockWindow,
    });
    await managerNoRelay.init();
    const stateNoRelay = await managerNoRelay.getState();
    expect(stateNoRelay.isBuffering).toBe(false);

    // 2. relayServer isBuffering is true
    mockRelayServer.getStatus.mockReturnValueOnce({ isBuffering: true });
    const managerBuffering = new TrayManager({
      accountStore: mockAccountStore,
      processController: mockProcessController,
      relayServer: mockRelayServer,
      getMainWindow: () => mockWindow,
      isQuitting: () => false,
    });
    await managerBuffering.init();
    expect(managerBuffering.isQuitting()).toBe(false);

    managerBuffering.setCloseToTrayEnabled(false);
    const stateBuffering = await managerBuffering.getState();
    expect(stateBuffering.isBuffering).toBe(true);
  });
});
