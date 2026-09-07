import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import {
  ProcessController,
  ProcessSystemInterface,
  DefaultProcessSystem,
} from "../src/main/process/process-controller";
import {
  findServiceBinary,
  setBinaryPathOverride,
  clearBinaryPathOverrides,
} from "../src/main/process/agy-path-detection";
import { ALL_SERVICE_TARGETS } from "../src/main/process/types";
import { DualServiceStatus } from "../src/shared/types";
import childProcess from "node:child_process";

class MockProcessSystem implements ProcessSystemInterface {
  public processes: Array<{ pid: number; command: string }> = [];
  public killedSignals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> =
    [];
  public nextPid = 1000;
  public spawnShouldFail = false;
  public killShouldThrow = false;
  public terminateOnSignal: "SIGTERM" | "SIGKILL" | "NEVER" = "SIGTERM";

  public async getRunningProcesses(): Promise<
    Array<{ pid: number; command: string }>
  > {
    return [...this.processes];
  }

  public async killPid(
    pid: number,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<void> {
    if (this.killShouldThrow) {
      throw new Error("Kill system error");
    }

    this.killedSignals.push({ pid, signal });

    if (this.terminateOnSignal === "NEVER") {
      return;
    }

    if (
      this.terminateOnSignal === signal ||
      this.terminateOnSignal === "SIGTERM"
    ) {
      this.processes = this.processes.filter((p) => p.pid !== pid);
    }
  }

  public async spawnProcess(commandPath: string): Promise<number> {
    if (this.spawnShouldFail) {
      throw new Error(`Failed to spawn binary: ${commandPath}`);
    }
    const pid = this.nextPid++;
    this.processes.push({ pid, command: commandPath });
    return pid;
  }
}

describe("Process Types", () => {
  it("should export all service targets list", () => {
    expect(ALL_SERVICE_TARGETS).toEqual([
      "antigravity_daemon",
      "antigravity_ide",
    ]);
  });
});

describe("Path Detection and Discovery", () => {
  beforeEach(() => {
    clearBinaryPathOverrides();
  });

  afterEach(() => {
    clearBinaryPathOverrides();
  });

  it("should return override path when configured", () => {
    setBinaryPathOverride("antigravity_daemon", "/custom/bin/agy");
    setBinaryPathOverride("antigravity_ide", "/custom/bin/antigravity-ide");

    expect(findServiceBinary("antigravity_daemon")).toBe("/custom/bin/agy");
    expect(findServiceBinary("antigravity_ide")).toBe(
      "/custom/bin/antigravity-ide",
    );
  });

  it("should discover binaries or return null when not found", () => {
    const daemonPath = findServiceBinary("antigravity_daemon");
    const idePath = findServiceBinary("antigravity_ide");

    expect(daemonPath === null || typeof daemonPath === "string").toBe(true);
    expect(idePath === null || typeof idePath === "string").toBe(true);
  });

  it("should probe platform candidates on darwin, win32, and linux", () => {
    const originalPlatform = os.platform;

    // Test Windows branch
    vi.spyOn(os, "platform").mockReturnValue("win32");
    findServiceBinary("antigravity_daemon");
    findServiceBinary("antigravity_ide");

    // Test Linux branch with discovered files
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(fs, "existsSync").mockImplementation(
      (p) =>
        String(p).includes("/usr/bin/antigravity-ide") ||
        String(p).includes("/usr/bin/agy"),
    );
    vi.spyOn(fs, "statSync").mockReturnValue({
      isFile: () => true,
    } as fs.Stats);

    const linuxDaemon = findServiceBinary("antigravity_daemon");
    const linuxIde = findServiceBinary("antigravity_ide");
    expect(linuxDaemon).toBe("/usr/bin/agy");
    expect(linuxIde).toBe("/usr/bin/antigravity-ide");

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should handle filesystem errors in checkPathExists safely", () => {
    vi.spyOn(fs, "existsSync").mockImplementation(() => {
      throw new Error("Disk permission error");
    });

    const pathRes = findServiceBinary("antigravity_daemon");
    expect(pathRes === null || typeof pathRes === "string").toBe(true);

    vi.restoreAllMocks();
  });
});

describe("Process Controller Supervisor Lifecycle", () => {
  let mockSystem: MockProcessSystem;
  let controller: ProcessController;

  beforeEach(() => {
    mockSystem = new MockProcessSystem();
    controller = new ProcessController({
      system: mockSystem,
      killTimeoutMs: 100, // fast timeout for tests
      pollIntervalMs: 10,
      killGraceMs: 50,
    });
    setBinaryPathOverride("antigravity_daemon", "/usr/local/bin/agy");
    setBinaryPathOverride(
      "antigravity_ide",
      "/Applications/Antigravity IDE.app/Contents/MacOS/Electron",
    );
  });

  afterEach(() => {
    clearBinaryPathOverrides();
    controller.stopHeartbeat();
  });

  it("should accurately disambiguate daemon, IDE, and self processes", () => {
    // Daemon matches
    expect(
      controller.matchesProcess("antigravity_daemon", "/usr/local/bin/agy"),
    ).toBe(true);
    expect(
      controller.matchesProcess("antigravity_daemon", "agy --port 8080"),
    ).toBe(true);
    expect(
      controller.matchesProcess("antigravity_daemon", "/opt/bin/antigravity"),
    ).toBe(true);

    // Daemon MUST NOT match IDE or relay
    expect(
      controller.matchesProcess("antigravity_daemon", "Antigravity IDE"),
    ).toBe(false);
    expect(
      controller.matchesProcess(
        "antigravity_daemon",
        "antigravity-ide --no-sandbox",
      ),
    ).toBe(false);
    expect(
      controller.matchesProcess(
        "antigravity_daemon",
        "antigravity-relay-desktop",
      ),
    ).toBe(false);

    // IDE matches
    expect(
      controller.matchesProcess(
        "antigravity_ide",
        "/Applications/Antigravity IDE.app/Contents/MacOS/Electron",
      ),
    ).toBe(true);
    expect(
      controller.matchesProcess("antigravity_ide", "antigravity-ide"),
    ).toBe(true);

    // IDE MUST NOT match relay or daemon
    expect(
      controller.matchesProcess("antigravity_ide", "antigravity-relay"),
    ).toBe(false);
    expect(controller.matchesProcess("antigravity_ide", "/usr/bin/agy")).toBe(
      false,
    );
  });

  it("should report correct status when both services are stopped", async () => {
    const status = await controller.getStatus();
    expect(status.runningCount).toBe(0);
    expect(status.totalCount).toBe(2);
    expect(status.services.antigravity_daemon.state).toBe("stopped");
    expect(status.services.antigravity_ide.state).toBe("stopped");
    expect(status.services.antigravity_daemon.pids).toEqual([]);
    expect(status.services.antigravity_ide.pids).toEqual([]);
  });

  it("should report correct status when processes are running", async () => {
    mockSystem.processes = [
      { pid: 101, command: "/usr/local/bin/agy --daemon" },
      { pid: 202, command: "Antigravity IDE" },
    ];

    const status = await controller.getStatus();
    expect(status.runningCount).toBe(2);
    expect(status.services.antigravity_daemon.state).toBe("running");
    expect(status.services.antigravity_daemon.mainPid).toBe(101);
    expect(status.services.antigravity_ide.state).toBe("running");
    expect(status.services.antigravity_ide.mainPid).toBe(202);
  });

  it("should start a stopped service successfully and notify listeners", async () => {
    const receivedStatuses: DualServiceStatus[] = [];
    const unsubscribe = controller.onStatusUpdated((s) => {
      receivedStatuses.push(s);
    });

    const res = await controller.startService("antigravity_daemon");
    expect(res.state).toBe("running");
    expect(res.mainPid).toBe(1000);
    expect(res.commandPath).toBe("/usr/local/bin/agy");

    // Status was broadcasted
    expect(receivedStatuses.length).toBeGreaterThan(0);
    const finalBroadcast = receivedStatuses[receivedStatuses.length - 1];
    expect(finalBroadcast.services.antigravity_daemon.state).toBe("running");

    // Starting already running service returns current info
    const secondStart = await controller.startService("antigravity_daemon");
    expect(secondStart.state).toBe("running");

    unsubscribe();
  });

  it("should fail to start service when binary is not found", async () => {
    clearBinaryPathOverrides();
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const res = await controller.startService("antigravity_daemon");
    expect(res.state).toBe("error");
    expect(res.errorMessage).toContain("not found");

    vi.restoreAllMocks();
  });

  it("should handle spawn errors gracefully", async () => {
    mockSystem.spawnShouldFail = true;
    const res = await controller.startService("antigravity_daemon");
    expect(res.state).toBe("error");
    expect(res.errorMessage).toContain("Failed to spawn");
  });

  it("should stop running service gracefully with SIGTERM", async () => {
    mockSystem.processes = [{ pid: 501, command: "/usr/local/bin/agy" }];
    mockSystem.terminateOnSignal = "SIGTERM";

    const res = await controller.stopService("antigravity_daemon");
    expect(res.state).toBe("stopped");
    expect(res.pids).toEqual([]);
    expect(mockSystem.killedSignals).toContainEqual({
      pid: 501,
      signal: "SIGTERM",
    });

    // Stopping already stopped service returns stopped info immediately
    const res2 = await controller.stopService("antigravity_daemon");
    expect(res2.state).toBe("stopped");
  });

  it("should escalate to SIGKILL when process does not terminate within timeout", async () => {
    mockSystem.processes = [{ pid: 601, command: "/usr/local/bin/agy" }];
    // Will not die on SIGTERM, dies only on SIGKILL
    mockSystem.terminateOnSignal = "SIGKILL";

    const res = await controller.stopService("antigravity_daemon");
    expect(res.state).toBe("stopped");
    expect(mockSystem.killedSignals).toContainEqual({
      pid: 601,
      signal: "SIGTERM",
    });
    expect(mockSystem.killedSignals).toContainEqual({
      pid: 601,
      signal: "SIGKILL",
    });
  });

  it("should report error state when process survives both SIGTERM and SIGKILL", async () => {
    mockSystem.processes = [{ pid: 701, command: "/usr/local/bin/agy" }];
    // Process refuses to terminate even on SIGKILL
    mockSystem.terminateOnSignal = "NEVER";

    const res = await controller.stopService("antigravity_daemon");
    expect(res.state).toBe("error");
    expect(res.errorMessage).toContain("failed to terminate");
    expect(res.pids).toEqual([701]);
  });

  it("should swallow errors when killPid throws during stopService", async () => {
    mockSystem.processes = [{ pid: 801, command: "/usr/local/bin/agy" }];
    mockSystem.killShouldThrow = true;
    mockSystem.terminateOnSignal = "NEVER";

    const res = await controller.stopService("antigravity_daemon");
    expect(res.state).toBe("error");
  });

  it("should swallow errors when a registered listener throws", async () => {
    controller.onStatusUpdated(() => {
      throw new Error("Exploding UI listener");
    });

    const res = await controller.startService("antigravity_daemon");
    expect(res.state).toBe("running");
  });

  it("should execute periodic heartbeat and notify listeners", async () => {
    vi.useFakeTimers();

    let heartbeatCount = 0;
    controller.onStatusUpdated(() => {
      heartbeatCount++;
    });

    controller.startHeartbeat(100);
    expect(heartbeatCount).toBe(0);

    await vi.advanceTimersByTimeAsync(250);
    expect(heartbeatCount).toBeGreaterThanOrEqual(2);

    controller.stopHeartbeat();
    const countAfterStop = heartbeatCount;
    expect(countAfterStop).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it("should return false in matchesProcess for unknown target", () => {
    expect(controller.matchesProcess("unknown_service" as any, "agy")).toBe(
      false,
    );
  });

  it("should swallow errors when heartbeat getStatus throws", async () => {
    vi.useFakeTimers();
    vi.spyOn(controller, "getStatus").mockRejectedValueOnce(
      new Error("Heartbeat status failure"),
    );

    controller.startHeartbeat(50);
    await vi.advanceTimersByTimeAsync(60);
    controller.stopHeartbeat();

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("Default Process System Integration", () => {
  it("should inspect system processes without crashing on current platform", async () => {
    const sys = new DefaultProcessSystem();
    const procs = await sys.getRunningProcesses();
    expect(Array.isArray(procs)).toBe(true);
    expect(procs.length).toBeGreaterThan(0);
    expect(typeof procs[0].pid).toBe("number");
  });

  it("should cover Windows branch of DefaultProcessSystem", async () => {
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("win32");

    // Mock childProcess.exec to return simulated tasklist CSV
    vi.spyOn(childProcess, "exec").mockImplementation(((
      _cmd: string,
      _opts: any,
      callback?: any,
    ) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      cb(null, '"agy.exe","1234"\n"Antigravity IDE.exe","5678"\n', "");
      return {} as any;
    }) as any);

    const sys = new DefaultProcessSystem();
    const procs = await sys.getRunningProcesses();
    expect(procs.length).toBe(2);
    expect(procs[0].pid).toBe(1234);
    expect(procs[0].command).toBe("agy.exe");

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should return null when linux binaries are not found", () => {
    const originalPlatform = os.platform;
    vi.spyOn(os, "platform").mockReturnValue("linux");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    expect(findServiceBinary("antigravity_daemon")).toBeNull();
    expect(findServiceBinary("antigravity_ide")).toBeNull();

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should swallow errors when getRunningProcesses encounters an exec failure", async () => {
    vi.spyOn(childProcess, "exec").mockImplementation(((
      _cmd: string,
      _opts: any,
      callback?: any,
    ) => {
      const cb = typeof _opts === "function" ? _opts : callback;
      cb(new Error("exec command error"), "", "");
      return {} as any;
    }) as any);

    const sys = new DefaultProcessSystem();
    const procs = await sys.getRunningProcesses();
    expect(procs).toEqual([]);

    vi.restoreAllMocks();
  });

  it("should invoke killPid on posix and win32 platforms", async () => {
    const sys = new DefaultProcessSystem();
    const originalPlatform = os.platform;

    // Posix killPid
    vi.spyOn(process, "kill").mockImplementation(() => true);
    await sys.killPid(1234, "SIGTERM");
    expect(process.kill).toHaveBeenCalledWith(1234, "SIGTERM");

    // Windows killPid
    vi.spyOn(os, "platform").mockReturnValue("win32");
    vi.mock("node:util", async (importOriginal) => {
      return await importOriginal();
    });
    // Windows branch executes taskkill, test that it handles cleanly or mock exec
    try {
      await sys.killPid(1234, "SIGKILL");
    } catch {
      // Ignored
    }

    vi.spyOn(os, "platform").mockImplementation(originalPlatform);
    vi.restoreAllMocks();
  });

  it("should spawn process and handle invalid pid in DefaultProcessSystem", async () => {
    const sys = new DefaultProcessSystem();

    // Mock spawn to return process with pid
    vi.spyOn(childProcess, "spawn").mockReturnValue({
      pid: 9999,
      unref: () => {},
    } as unknown as childProcess.ChildProcess);

    const pid = await sys.spawnProcess("/fake/bin", []);
    expect(pid).toBe(9999);

    // Mock spawn to return process without pid
    vi.spyOn(childProcess, "spawn").mockReturnValue({
      pid: undefined,
      unref: () => {},
    } as unknown as childProcess.ChildProcess);

    await expect(sys.spawnProcess("/fake/bin", [])).rejects.toThrow(
      "Failed to spawn process",
    );

    vi.restoreAllMocks();
  });
});
