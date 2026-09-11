import fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSwitchFlow } from "@/modules/antigravity-runtime/switch/switchFlow";
import {
  clearLastKnownAntigravityExecutablePaths,
  getLastKnownAntigravityExecutablePath,
  rememberRunningExecutablePath,
} from "@/shared/platform/paths";

const {
  applyDeviceProfile,
  closeAntigravity,
  isProcessRunning,
  recordSwitchFailure,
  recordSwitchSuccess,
  refreshAntigravityProcessCache,
  startAntigravity,
  syncTelemetryServiceMachineIdValue,
  waitForProcessExit,
} = vi.hoisted(() => ({
  applyDeviceProfile: vi.fn(),
  closeAntigravity: vi.fn(async () => undefined),
  isProcessRunning: vi.fn(async () => true),
  recordSwitchFailure: vi.fn(),
  recordSwitchSuccess: vi.fn(),
  refreshAntigravityProcessCache: vi.fn(async () => undefined),
  startAntigravity: vi.fn(async () => undefined),
  syncTelemetryServiceMachineIdValue: vi.fn(),
  waitForProcessExit: vi.fn(async () => undefined),
}));

vi.mock("@/modules/antigravity-runtime/ipc/handler", () => ({
  closeAntigravity,
  isProcessRunning,
  startAntigravity,
  _waitForProcessExit: waitForProcessExit,
}));

vi.mock("@/modules/identity-profile/ipc/handler", () => ({
  applyDeviceProfile,
  syncTelemetryServiceMachineIdValue,
}));

vi.mock("@/modules/antigravity-runtime/switch/switchMetrics", () => ({
  recordSwitchSuccess,
  recordSwitchFailure,
}));

describe("Switch Flow Process Resolution and Auto-Reopen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLastKnownAntigravityExecutablePaths();
    applyDeviceProfile.mockImplementation(() => undefined);
    isProcessRunning.mockImplementation(async () => true);
    syncTelemetryServiceMachineIdValue.mockImplementation(() => undefined);
    closeAntigravity.mockImplementation(async () => undefined);
    startAntigravity.mockImplementation(async () => undefined);
  });

  it("captures and remembers running binary path prior to process termination", async () => {
    const runningBinary =
      "C:\\Users\\Alice\\AppData\\Local\\Programs\\Google\\Antigravity\\Antigravity.exe";
    vi.spyOn(fs, "existsSync").mockImplementation(
      (candidate) => String(candidate) === runningBinary,
    );
    rememberRunningExecutablePath("classic", runningBinary);

    let pathCapturedBeforeClose: string | null = null;
    closeAntigravity.mockImplementationOnce(async () => {
      pathCapturedBeforeClose =
        getLastKnownAntigravityExecutablePath("classic");
    });

    const performSwitch = vi.fn(async () => undefined);

    const result = await executeSwitchFlow({
      scope: "cloud",
      appTarget: "classic",
      targetProfile: null,
      applyFingerprint: false,
      useCredentialStore: true,
      processExitTimeoutMs: 10000,
      skipRefreshProcessCache: true,
      performSwitch,
    });

    expect(pathCapturedBeforeClose).toBe(runningBinary);
    expect(getLastKnownAntigravityExecutablePath("classic")).toBe(
      runningBinary,
    );
    expect(result.wasRunning).toBe(true);
    expect(result.restarted).toBe(true);
    expect(closeAntigravity).toHaveBeenCalledWith("classic");
    expect(startAntigravity).toHaveBeenCalledWith("classic");
  });

  it("reopens application automatically after successful switch when wasRunning is true", async () => {
    const ideBinary =
      "C:\\Users\\Alice\\AppData\\Local\\Programs\\antigravity-ide\\antigravity-ide.exe";
    vi.spyOn(fs, "existsSync").mockImplementation(
      (candidate) => String(candidate) === ideBinary,
    );
    rememberRunningExecutablePath("ide", ideBinary);

    const performSwitch = vi.fn(async () => undefined);

    const result = await executeSwitchFlow({
      scope: "cloud",
      appTarget: "ide",
      targetProfile: null,
      applyFingerprint: false,
      useCredentialStore: true,
      processExitTimeoutMs: 10000,
      skipRefreshProcessCache: true,
      performSwitch,
    });

    expect(result).toEqual({
      target: "ide",
      wasRunning: true,
      restarted: true,
    });
    expect(performSwitch).toHaveBeenCalledTimes(1);
    expect(closeAntigravity).toHaveBeenCalledWith("ide");
    expect(startAntigravity).toHaveBeenCalledWith("ide");
    expect(recordSwitchSuccess).toHaveBeenCalledWith("cloud");
    expect(recordSwitchFailure).not.toHaveBeenCalled();
  });

  it("cleanly skips process restart when target was not running beforehand", async () => {
    isProcessRunning.mockResolvedValueOnce(false);
    const performSwitch = vi.fn(async () => undefined);

    const result = await executeSwitchFlow({
      scope: "cloud",
      appTarget: "ide",
      targetProfile: null,
      applyFingerprint: false,
      useCredentialStore: true,
      processExitTimeoutMs: 10000,
      skipRefreshProcessCache: true,
      performSwitch,
    });

    expect(result).toEqual({
      target: "ide",
      wasRunning: false,
      restarted: false,
    });
    expect(closeAntigravity).not.toHaveBeenCalled();
    expect(startAntigravity).not.toHaveBeenCalled();
    expect(performSwitch).toHaveBeenCalledTimes(1);
    expect(recordSwitchSuccess).toHaveBeenCalledWith("cloud");
    expect(recordSwitchFailure).not.toHaveBeenCalled();
  });
});
