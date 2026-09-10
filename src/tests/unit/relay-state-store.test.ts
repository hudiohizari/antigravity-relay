import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayStateStore } from "@/modules/relay/persistence/relay-state-store";
import { RelayController } from "@/modules/relay/relay-controller";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";

describe("RelayStateStore (SQLite backed) & RelayController Status Persistence", () => {
  let settingsMap: Map<string, unknown>;

  beforeEach(() => {
    settingsMap = new Map();
    vi.spyOn(CloudAccountSettingsStore, "getSetting").mockImplementation(
      (key: string, defaultValue: unknown) => {
        if (!settingsMap.has(key)) {
          return defaultValue as any;
        }
        return settingsMap.get(key) as any;
      },
    );
    vi.spyOn(CloudAccountSettingsStore, "setSetting").mockImplementation(
      (key: string, value: unknown) => {
        settingsMap.set(key, value);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to false on first run when no setting is saved", () => {
    expect(RelayStateStore.getLastStatus()).toBe(false);
  });

  it("persists true when setLastStatus(true) is invoked", () => {
    RelayStateStore.setLastStatus(true);
    expect(CloudAccountSettingsStore.setSetting).toHaveBeenCalledWith(
      "relay.last_running_status",
      true,
    );
    expect(RelayStateStore.getLastStatus()).toBe(true);
  });

  it("persists false when setLastStatus(false) is invoked", () => {
    RelayStateStore.setLastStatus(true);
    expect(RelayStateStore.getLastStatus()).toBe(true);

    RelayStateStore.setLastStatus(false);
    expect(CloudAccountSettingsStore.setSetting).toHaveBeenCalledWith(
      "relay.last_running_status",
      false,
    );
    expect(RelayStateStore.getLastStatus()).toBe(false);
  });

  it("reflects state transitions through RelayController methods", async () => {
    const controller = RelayController.getInstance();
    expect(controller.getLastStatus()).toBe(false);

    const origStart = controller.relayServer.start;
    const origStop = controller.relayServer.stop;

    try {
      controller.relayServer.start = async () => ({
        isRunning: true,
        port: 4040,
        host: "0.0.0.0",
        activeSessions: 0,
        isBuffering: false,
        upstream: {
          state: "connected",
          targetHost: "127.0.0.1",
          targetPort: 4041,
          reconnectAttempts: 0,
          bufferedCommandCount: 0,
          flushedCommandCount: 0,
        },
      });
      controller.relayServer.stop = async () => {};

      await controller.startRelay();
      expect(controller.getLastStatus()).toBe(true);

      await controller.stopRelay();
      expect(controller.getLastStatus()).toBe(false);
    } finally {
      controller.relayServer.start = origStart;
      controller.relayServer.stop = origStop;
    }
  });
});
