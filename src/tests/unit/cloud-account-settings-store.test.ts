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
