import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIpcRenderer = vi.hoisted(() => ({
  on: vi.fn(),
  off: vi.fn(),
  send: vi.fn(),
  invoke: vi.fn(),
  postMessage: vi.fn(),
}));

const mockContextBridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: mockIpcRenderer,
  contextBridge: mockContextBridge,
}));

describe("preload account sync bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("exposes onAccountSwitched and registers/unregisters tray://account-switched listener", async () => {
    (process as { contextIsolated?: boolean }).contextIsolated = true;
    await import("@/preload");

    const exposed =
      mockContextBridge.exposeInMainWorld.mock.calls[0]?.[1] ??
      (window as unknown as { electron: Record<string, unknown> }).electron;
    expect(exposed).toBeDefined();
    expect(typeof exposed.onAccountSwitched).toBe("function");

    const callback = vi.fn();
    const unbind = exposed.onAccountSwitched(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      "tray://account-switched",
      expect.any(Function),
    );
    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      "account-switched",
      expect.any(Function),
    );

    // Simulate IPC event
    const registeredHandler = mockIpcRenderer.on.mock.calls.find(
      (call) => call[0] === "tray://account-switched",
    )?.[1];
    expect(registeredHandler).toBeDefined();
    registeredHandler({}, "acc-test-123");
    expect(callback).toHaveBeenCalledWith("acc-test-123");

    // Unbind
    unbind();
    expect(mockIpcRenderer.off).toHaveBeenCalledWith(
      "tray://account-switched",
      expect.any(Function),
    );
    expect(mockIpcRenderer.off).toHaveBeenCalledWith(
      "account-switched",
      expect.any(Function),
    );
  });

  it("exposes onAccountsUpdated and registers/unregisters tray://accounts-updated and refresh-current listeners", async () => {
    (process as { contextIsolated?: boolean }).contextIsolated = true;
    await import("@/preload");

    const exposed =
      mockContextBridge.exposeInMainWorld.mock.calls[0]?.[1] ??
      (window as unknown as { electron: Record<string, unknown> }).electron;
    expect(exposed).toBeDefined();
    expect(typeof exposed.onAccountsUpdated).toBe("function");

    const callback = vi.fn();
    const unbind = exposed.onAccountsUpdated(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      "tray://accounts-updated",
      expect.any(Function),
    );
    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      "tray://refresh-current",
      expect.any(Function),
    );

    // Simulate refresh-current event
    const refreshHandler = mockIpcRenderer.on.mock.calls.find(
      (call) => call[0] === "tray://refresh-current",
    )?.[1];
    expect(refreshHandler).toBeDefined();
    refreshHandler();
    expect(callback).toHaveBeenCalledTimes(1);

    // Unbind
    unbind();
    expect(mockIpcRenderer.off).toHaveBeenCalledWith(
      "tray://accounts-updated",
      expect.any(Function),
    );
    expect(mockIpcRenderer.off).toHaveBeenCalledWith(
      "tray://refresh-current",
      expect.any(Function),
    );
  });
});
