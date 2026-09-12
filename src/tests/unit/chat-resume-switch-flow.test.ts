import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSwitchFlow } from "@/modules/antigravity-runtime/switch/switchFlow";
import { ConfigManager } from "@/modules/config/ipc/manager";
import { SessionContinuityBuffer } from "@/modules/chat-resume/SessionContinuityBuffer";
import { chatResumeDispatcher } from "@/modules/chat-resume/ChatResumeDispatcher";
import { chatResumeEvents } from "@/modules/chat-resume/telemetry";

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

describe("Switch Flow Chat Resumption Integration", () => {
  let testBuffer: SessionContinuityBuffer;

  beforeEach(() => {
    vi.clearAllMocks();
    chatResumeEvents.clearTelemetryHistory();
    testBuffer = new SessionContinuityBuffer();

    isProcessRunning.mockResolvedValue(true);
    closeAntigravity.mockResolvedValue(undefined);
    startAntigravity.mockResolvedValue(undefined);
  });

  describe("Pre-Kill Snapshot & WAL Checkpoint", () => {
    it("executes WAL checkpoint and captures active turn before closeAntigravity", async () => {
      const callOrder: string[] = [];
      const walCheckpointMock = vi.fn(async () => {
        callOrder.push("walCheckpoint");
      });

      closeAntigravity.mockImplementationOnce(async () => {
        callOrder.push("closeAntigravity");
      });

      const activeTurnDetectorMock = vi.fn(async () => {
        callOrder.push("activeTurnDetector");
        return {
          cascadeId: "cascade-pre-kill",
          promptPayload: {
            prompt: "Refactor switch flow lifecycle",
            requestedModel: "gemini-1.5-pro",
          },
        };
      });

      const performSwitch = vi.fn(async () => {
        callOrder.push("performSwitch");
      });

      const triggerResumptionSpy = vi
        .spyOn(chatResumeDispatcher, "triggerResumptionForTarget")
        .mockResolvedValue(null);

      const result = await executeSwitchFlow({
        scope: "cloud",
        appTarget: "ide",
        targetProfile: null,
        applyFingerprint: false,
        useCredentialStore: true,
        processExitTimeoutMs: 10000,
        skipRefreshProcessCache: true,
        performSwitch,
        source: "auto_switch",
        accountEmail: "target@example.com",
        walCheckpoint: walCheckpointMock,
        activeTurnDetector: activeTurnDetectorMock,
      });

      expect(result.wasRunning).toBe(true);
      expect(result.restarted).toBe(true);

      // Verify strict execution ordering: WAL checkpoint and active turn detector run BEFORE closeAntigravity
      expect(callOrder.indexOf("walCheckpoint")).toBeLessThan(
        callOrder.indexOf("closeAntigravity"),
      );
      expect(callOrder.indexOf("activeTurnDetector")).toBeLessThan(
        callOrder.indexOf("closeAntigravity"),
      );
      expect(callOrder.indexOf("closeAntigravity")).toBeLessThan(
        callOrder.indexOf("performSwitch"),
      );

      // Verify post-restart resumption trigger was called
      expect(triggerResumptionSpy).toHaveBeenCalledWith("ide", {
        accountEmail: "target@example.com",
      });

      triggerResumptionSpy.mockRestore();
    });

    it("maintains crash immunity when WAL checkpoint or snapshot capture throws", async () => {
      const failingWalMock = vi.fn(async () => {
        throw new Error("Disk I/O lock on state.vscdb");
      });

      const failingDetectorMock = vi.fn(async () => {
        throw new Error("Active turn detector crash");
      });

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
        walCheckpoint: failingWalMock,
        activeTurnDetector: failingDetectorMock,
      });

      // Switch flow must complete successfully despite snapshot failures
      expect(result.restarted).toBe(true);
      expect(performSwitch).toHaveBeenCalledTimes(1);
      expect(closeAntigravity).toHaveBeenCalledWith("ide");
      expect(startAntigravity).toHaveBeenCalledWith("ide");
      expect(recordSwitchSuccess).toHaveBeenCalledWith("cloud");
      expect(recordSwitchFailure).not.toHaveBeenCalled();
    });

    it("skips active turn snapshotting when auto_resume_active_chat is false in config", async () => {
      vi.spyOn(ConfigManager, "loadConfig").mockReturnValue({
        auto_resume_active_chat: false,
      } as any);

      const activeTurnDetectorMock = vi.fn(async () => ({
        cascadeId: "should-not-run",
        promptPayload: { prompt: "Ignored" },
      }));

      const triggerResumptionSpy = vi
        .spyOn(chatResumeDispatcher, "triggerResumptionForTarget")
        .mockResolvedValue(null);

      const performSwitch = vi.fn(async () => undefined);

      await executeSwitchFlow({
        scope: "cloud",
        appTarget: "ide",
        targetProfile: null,
        applyFingerprint: false,
        useCredentialStore: true,
        processExitTimeoutMs: 10000,
        skipRefreshProcessCache: true,
        performSwitch,
        activeTurnDetector: activeTurnDetectorMock,
      });

      expect(activeTurnDetectorMock).not.toHaveBeenCalled();
      expect(triggerResumptionSpy).not.toHaveBeenCalled();

      triggerResumptionSpy.mockRestore();
    });
  });

  describe("CLI Scope Exclusion", () => {
    it("strictly excludes CLI targets from WAL checkpoint and snapshotting", async () => {
      const walMock = vi.fn();
      const detectorMock = vi.fn();
      const performSwitch = vi.fn(async () => undefined);

      await executeSwitchFlow({
        scope: "cloud",
        appTarget: "cli",
        targetProfile: null,
        applyFingerprint: false,
        useCredentialStore: true,
        processExitTimeoutMs: 10000,
        performSwitch,
        walCheckpoint: walMock,
        activeTurnDetector: detectorMock,
      });

      expect(walMock).not.toHaveBeenCalled();
      expect(detectorMock).not.toHaveBeenCalled();
      expect(closeAntigravity).not.toHaveBeenCalled();
      expect(startAntigravity).not.toHaveBeenCalled();
      expect(performSwitch).toHaveBeenCalledTimes(1);
    });

    it("strictly excludes agy target from WAL checkpoint and snapshotting", async () => {
      const walMock = vi.fn();
      const detectorMock = vi.fn();
      const performSwitch = vi.fn(async () => undefined);

      await executeSwitchFlow({
        scope: "cloud",
        appTarget: "agy" as any,
        targetProfile: null,
        applyFingerprint: false,
        useCredentialStore: true,
        processExitTimeoutMs: 10000,
        performSwitch,
        walCheckpoint: walMock,
        activeTurnDetector: detectorMock,
      });

      expect(walMock).not.toHaveBeenCalled();
      expect(detectorMock).not.toHaveBeenCalled();
      expect(closeAntigravity).not.toHaveBeenCalled();
      expect(startAntigravity).not.toHaveBeenCalled();
      expect(performSwitch).toHaveBeenCalledTimes(1);
    });
  });
});
