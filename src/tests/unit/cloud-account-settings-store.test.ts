import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";

vi.mock("@/shared/logging/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("CloudAccountSettingsStore.getActiveAccountIdForTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a normalized active account id when the setting is a string", () => {
    vi.spyOn(CloudAccountSettingsStore, "getSetting").mockReturnValue(
      "  account-1  ",
    );

    expect(
      CloudAccountSettingsStore.getActiveAccountIdForTarget("classic"),
    ).toBe("account-1");
  });

  it("fails closed when a valid JSON setting has the wrong type", async () => {
    const getSetting = vi
      .spyOn(CloudAccountSettingsStore, "getSetting")
      .mockReturnValue({ id: "account-1" });
    const { logger } = await import("@/shared/logging/logger");

    expect(CloudAccountSettingsStore.getActiveAccountIdForTarget("ide")).toBe(
      "",
    );
    expect(getSetting).toHaveBeenCalledWith(
      "active_cloud_account.ide",
      "",
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Ignored invalid active account setting active_cloud_account.ide: expected a string",
    );
  });

  it("falls back to legacy classic setting if app setting is not present", () => {
    const getSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "getSetting")
      .mockImplementation(((key: string, defaultValue: unknown) => {
        if (key === "active_cloud_account.classic") {
          return "legacy-app-account";
        }
        return defaultValue;
      }) as any);

    expect(CloudAccountSettingsStore.getActiveAccountIdForTarget("app")).toBe(
      "legacy-app-account",
    );
    expect(getSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.app",
      "",
      expect.anything(),
    );
    expect(getSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.classic",
      "",
      expect.anything(),
    );
  });

  it("falls back to legacy agy setting if cli setting is not present", () => {
    const getSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "getSetting")
      .mockImplementation(((key: string, defaultValue: unknown) => {
        if (key === "active_cloud_account.agy") {
          return "legacy-cli-account";
        }
        return defaultValue;
      }) as any);

    expect(CloudAccountSettingsStore.getActiveAccountIdForTarget("cli")).toBe(
      "legacy-cli-account",
    );
    expect(getSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.cli",
      "",
      expect.anything(),
    );
    expect(getSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.agy",
      "",
      expect.anything(),
    );
  });

  it("performs dual-write when setting active for app or cli", () => {
    const setSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "setSetting")
      .mockImplementation(() => {});

    CloudAccountSettingsStore.setActiveForTarget("app", "account-app-1");
    expect(setSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.app",
      "account-app-1",
    );
    expect(setSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.classic",
      "account-app-1",
    );

    setSettingSpy.mockClear();
    CloudAccountSettingsStore.setActiveForTarget("cli", "account-cli-1");
    expect(setSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.cli",
      "account-cli-1",
    );
    expect(setSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.agy",
      "account-cli-1",
    );
  });

  it("performs dual-delete when clearing active for app or cli", () => {
    const deleteSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "deleteSetting")
      .mockImplementation(() => {});

    CloudAccountSettingsStore.clearActiveForTarget("app");
    expect(deleteSettingSpy).toHaveBeenCalledWith("active_cloud_account.app");
    expect(deleteSettingSpy).toHaveBeenCalledWith(
      "active_cloud_account.classic",
    );

    deleteSettingSpy.mockClear();
    CloudAccountSettingsStore.clearActiveForTarget("cli");
    expect(deleteSettingSpy).toHaveBeenCalledWith("active_cloud_account.cli");
    expect(deleteSettingSpy).toHaveBeenCalledWith("active_cloud_account.agy");
  });
});

describe("CloudAccountSettingsStore Unified Mode & Operational State", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true by default for isUnifiedMode()", () => {
    const getSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "getSetting")
      .mockImplementation((_key, defaultValue) => defaultValue as any);

    expect(CloudAccountSettingsStore.isUnifiedMode()).toBe(true);
    expect(getSettingSpy).toHaveBeenCalledWith(
      "unified_mode",
      true,
      expect.anything(),
    );
  });

  it("persists unified mode setting via setUnifiedMode()", () => {
    const setSettingSpy = vi
      .spyOn(CloudAccountSettingsStore, "setSetting")
      .mockImplementation(() => {});

    CloudAccountSettingsStore.setUnifiedMode(false);
    expect(setSettingSpy).toHaveBeenCalledWith("unified_mode", false);

    CloudAccountSettingsStore.setUnifiedMode(true);
    expect(setSettingSpy).toHaveBeenCalledWith("unified_mode", true);
  });

  it("returns operational state indicating physically unified when all installed targets share one account", async () => {
    const paths = await import("@/shared/platform/paths");
    vi.spyOn(paths, "isAntigravityTargetInstalled").mockImplementation(
      (target) => {
        return target === "app" || target === "cli";
      },
    );
    vi.spyOn(CloudAccountSettingsStore, "isUnifiedMode").mockReturnValue(true);
    vi.spyOn(
      CloudAccountSettingsStore,
      "getActiveAccountIdForTarget",
    ).mockImplementation((target) => {
      if (target === "app" || target === "cli") return "acc-shared";
      return "";
    });

    const state = CloudAccountSettingsStore.getOperationalState();
    expect(state.isUnifiedMode).toBe(true);
    expect(state.isPhysicallyUnified).toBe(true);
    expect(state.activeAccountId).toBe("acc-shared");
    expect(state.installedTargets).toEqual(["app", "cli"]);
    expect(state.divergedTargets).toEqual([]);
    expect(state.targetAccounts.app).toBe("acc-shared");
    expect(state.targetAccounts.cli).toBe("acc-shared");
  });

  it("returns operational state indicating diverged when installed targets point to different accounts", async () => {
    const paths = await import("@/shared/platform/paths");
    vi.spyOn(paths, "isAntigravityTargetInstalled").mockImplementation(
      (target) => {
        return target === "app" || target === "cli";
      },
    );
    vi.spyOn(CloudAccountSettingsStore, "isUnifiedMode").mockReturnValue(true);
    vi.spyOn(
      CloudAccountSettingsStore,
      "getActiveAccountIdForTarget",
    ).mockImplementation((target) => {
      if (target === "app") return "acc-app";
      if (target === "cli") return "acc-cli";
      return "";
    });

    const state = CloudAccountSettingsStore.getOperationalState();
    expect(state.isUnifiedMode).toBe(true);
    expect(state.isPhysicallyUnified).toBe(false);
    expect(state.activeAccountId).toBe("acc-app");
    expect(state.installedTargets).toEqual(["app", "cli"]);
    expect(state.divergedTargets).toEqual(["cli"]);
  });

  it("handles single installed target as physically unified", async () => {
    const paths = await import("@/shared/platform/paths");
    vi.spyOn(paths, "isAntigravityTargetInstalled").mockImplementation(
      (target) => {
        return target === "app";
      },
    );
    vi.spyOn(CloudAccountSettingsStore, "isUnifiedMode").mockReturnValue(true);
    vi.spyOn(
      CloudAccountSettingsStore,
      "getActiveAccountIdForTarget",
    ).mockImplementation((target) => {
      if (target === "app") return "acc-single";
      return "";
    });

    const state = CloudAccountSettingsStore.getOperationalState();
    expect(state.isPhysicallyUnified).toBe(true);
    expect(state.divergedTargets).toEqual([]);
    expect(state.activeAccountId).toBe("acc-single");
  });
});
