import childProcess from "node:child_process";
import os from "node:os";
import {
  DualServiceStatus,
  ServiceProcessInfo,
  ServiceState,
  ServiceTarget,
} from "../../shared/types";
import { findServiceBinary } from "./agy-path-detection";

function execCommand(
  cmd: string,
  timeout = 3000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

export interface ProcessSystemInterface {
  getRunningProcesses(): Promise<Array<{ pid: number; command: string }>>;
  killPid(pid: number, signal: "SIGTERM" | "SIGKILL"): Promise<void>;
  spawnProcess(commandPath: string, args: string[]): Promise<number>;
}

export class DefaultProcessSystem implements ProcessSystemInterface {
  public async getRunningProcesses(): Promise<
    Array<{ pid: number; command: string }>
  > {
    const isWindows = os.platform() === "win32";
    const processes: Array<{ pid: number; command: string }> = [];

    try {
      if (isWindows) {
        const { stdout } = await execCommand("tasklist /fo csv /nh", 3000);
        const lines = stdout.trim().split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/^"([^"]+)","(\d+)"/);
          if (match && match[1] && match[2]) {
            processes.push({
              pid: parseInt(match[2], 10),
              command: match[1],
            });
          }
        }
      } else {
        const { stdout } = await execCommand("ps -eo pid,command", 3000);
        const lines = stdout.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]?.trim();
          if (!line) continue;
          const match = line.match(/^(\d+)\s+(.+)$/);
          if (match && match[1] && match[2]) {
            processes.push({
              pid: parseInt(match[1], 10),
              command: match[2],
            });
          }
        }
      }
    } catch {
      // Return whatever was collected or empty array
    }

    return processes;
  }

  public async killPid(
    pid: number,
    signal: "SIGTERM" | "SIGKILL",
  ): Promise<void> {
    const isWindows = os.platform() === "win32";
    if (isWindows) {
      const flag = signal === "SIGKILL" ? "/F" : "";
      await execCommand(`taskkill ${flag} /PID ${pid}`, 2000);
    } else {
      process.kill(pid, signal);
    }
  }

  public async spawnProcess(
    commandPath: string,
    args: string[],
  ): Promise<number> {
    const child = childProcess.spawn(commandPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    if (!child.pid) {
      throw new Error(`Failed to spawn process from binary: ${commandPath}`);
    }
    return child.pid;
  }
}

export interface ProcessControllerOptions {
  system?: ProcessSystemInterface;
  killTimeoutMs?: number;
  pollIntervalMs?: number;
  killGraceMs?: number;
}

export class ProcessController {
  private readonly system: ProcessSystemInterface;
  private readonly killTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly killGraceMs: number;

  private listeners: Set<(status: DualServiceStatus) => void> = new Set();
  private transitionalStates: Partial<Record<ServiceTarget, ServiceState>> = {};
  private startTimestamps: Partial<Record<ServiceTarget, number>> = {};
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: ProcessControllerOptions = {}) {
    this.system = options.system || new DefaultProcessSystem();
    this.killTimeoutMs = options.killTimeoutMs ?? 5000;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
    this.killGraceMs = options.killGraceMs ?? 2000;
  }

  public onStatusUpdated(
    callback: (status: DualServiceStatus) => void,
  ): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(status: DualServiceStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // Guard against listener callback errors
      }
    }
  }

  public startHeartbeat(intervalMs = 5000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        const status = await this.getStatus();
        this.notifyListeners(status);
      } catch {
        // Suppress heartbeat errors
      }
    }, intervalMs);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public matchesProcess(target: ServiceTarget, command: string): boolean {
    const normalized = command.toLowerCase();

    // Never match antigravity-relay (our application itself)
    if (normalized.includes("antigravity-relay")) {
      return false;
    }

    if (target === "antigravity_ide") {
      return (
        normalized.includes("antigravity ide") ||
        normalized.includes("antigravity-ide")
      );
    }

    if (target === "antigravity_daemon") {
      // Exclude IDE when matching daemon
      if (
        normalized.includes("antigravity ide") ||
        normalized.includes("antigravity-ide")
      ) {
        return false;
      }

      // Check for standalone agy or antigravity binary
      const hasAgy = /(?:^|[/\\])agy(?:\.exe)?(?:\s|$)/i.test(command);
      const hasAntigravity = /(?:^|[/\\])antigravity(?:\.exe)?(?:\s|$)/i.test(
        command,
      );

      return hasAgy || hasAntigravity;
    }

    return false;
  }

  public async inspectTarget(
    target: ServiceTarget,
    allProcesses?: Array<{ pid: number; command: string }>,
  ): Promise<ServiceProcessInfo> {
    const processes = allProcesses || (await this.system.getRunningProcesses());
    const matchedPids: number[] = [];

    for (const proc of processes) {
      if (this.matchesProcess(target, proc.command)) {
        matchedPids.push(proc.pid);
      }
    }

    const isRunning = matchedPids.length > 0;
    const transitional = this.transitionalStates[target];

    let state: ServiceState = isRunning ? "running" : "stopped";
    if (transitional) {
      state = transitional;
    }

    if (isRunning && !this.startTimestamps[target]) {
      this.startTimestamps[target] = Date.now();
    } else if (!isRunning) {
      delete this.startTimestamps[target];
    }

    const uptimeSeconds =
      isRunning && this.startTimestamps[target]
        ? Math.floor((Date.now() - this.startTimestamps[target]!) / 1000)
        : 0;

    const commandPath = findServiceBinary(target) || undefined;

    return {
      target,
      displayName:
        target === "antigravity_daemon" ? "Antigravity" : "Antigravity IDE",
      binaryName: target === "antigravity_daemon" ? "agy" : "antigravity-ide",
      state,
      pids: matchedPids,
      mainPid: matchedPids[0] ?? null,
      uptimeSeconds,
      lastCheckedAt: Date.now(),
      commandPath,
    };
  }

  public async getStatus(): Promise<DualServiceStatus> {
    const allProcesses = await this.system.getRunningProcesses();
    const daemonInfo = await this.inspectTarget(
      "antigravity_daemon",
      allProcesses,
    );
    const ideInfo = await this.inspectTarget("antigravity_ide", allProcesses);

    const services: Record<ServiceTarget, ServiceProcessInfo> = {
      antigravity_daemon: daemonInfo,
      antigravity_ide: ideInfo,
    };

    let runningCount = 0;
    if (daemonInfo.state === "running") runningCount++;
    if (ideInfo.state === "running") runningCount++;

    return {
      services,
      runningCount,
      totalCount: 2,
      lastUpdated: Date.now(),
    };
  }

  public async startService(
    target: ServiceTarget,
  ): Promise<ServiceProcessInfo> {
    const current = await this.inspectTarget(target);
    if (current.state === "running") {
      return current;
    }

    const binaryPath = findServiceBinary(target);
    if (!binaryPath) {
      const errorInfo: ServiceProcessInfo = {
        ...current,
        state: "error",
        errorMessage: `Binary for ${target} not found on this system`,
        lastCheckedAt: Date.now(),
      };
      const status = await this.getStatus();
      status.services[target] = errorInfo;
      this.notifyListeners(status);
      return errorInfo;
    }

    this.transitionalStates[target] = "starting";
    let status = await this.getStatus();
    this.notifyListeners(status);

    try {
      const pid = await this.system.spawnProcess(binaryPath, []);
      this.startTimestamps[target] = Date.now();
      delete this.transitionalStates[target];

      const runningInfo: ServiceProcessInfo = {
        target,
        displayName:
          target === "antigravity_daemon" ? "Antigravity" : "Antigravity IDE",
        binaryName: target === "antigravity_daemon" ? "agy" : "antigravity-ide",
        state: "running",
        pids: [pid],
        mainPid: pid,
        uptimeSeconds: 0,
        lastCheckedAt: Date.now(),
        commandPath: binaryPath,
      };

      status = await this.getStatus();
      this.notifyListeners(status);
      return runningInfo;
    } catch (err) {
      delete this.transitionalStates[target];
      const errorInfo: ServiceProcessInfo = {
        ...current,
        state: "error",
        errorMessage: (err as Error).message,
        lastCheckedAt: Date.now(),
      };
      status = await this.getStatus();
      status.services[target] = errorInfo;
      this.notifyListeners(status);
      return errorInfo;
    }
  }

  public async stopService(target: ServiceTarget): Promise<ServiceProcessInfo> {
    const initial = await this.inspectTarget(target);
    if (initial.pids.length === 0) {
      delete this.transitionalStates[target];
      delete this.startTimestamps[target];
      const stoppedInfo: ServiceProcessInfo = {
        ...initial,
        state: "stopped",
        pids: [],
        mainPid: null,
        uptimeSeconds: 0,
        lastCheckedAt: Date.now(),
      };
      return stoppedInfo;
    }

    this.transitionalStates[target] = "stopping";
    let status = await this.getStatus();
    this.notifyListeners(status);

    const pidsToKill = [...initial.pids];

    // 1. Send SIGTERM to all PIDs
    for (const pid of pidsToKill) {
      try {
        await this.system.killPid(pid, "SIGTERM");
      } catch {
        // Process may have already exited
      }
    }

    // 2. Poll until processes terminate or killTimeout expires
    const startTime = Date.now();
    let remainingPids = await this.checkActivePids(pidsToKill);

    while (
      remainingPids.length > 0 &&
      Date.now() - startTime < this.killTimeoutMs
    ) {
      await this.sleep(this.pollIntervalMs);
      remainingPids = await this.checkActivePids(pidsToKill);
    }

    // 3. If any PIDs survive, escalate to SIGKILL
    if (remainingPids.length > 0) {
      for (const pid of remainingPids) {
        try {
          await this.system.killPid(pid, "SIGKILL");
        } catch {
          // Process exited
        }
      }

      // Final short grace period for SIGKILL confirmation
      const killGraceStart = Date.now();
      while (
        remainingPids.length > 0 &&
        Date.now() - killGraceStart < this.killGraceMs
      ) {
        await this.sleep(this.pollIntervalMs);
        remainingPids = await this.checkActivePids(pidsToKill);
      }
    }

    delete this.transitionalStates[target];
    delete this.startTimestamps[target];

    const finalState: ServiceState =
      remainingPids.length === 0 ? "stopped" : "error";

    const finalInfo: ServiceProcessInfo = {
      target,
      displayName:
        target === "antigravity_daemon" ? "Antigravity" : "Antigravity IDE",
      binaryName: target === "antigravity_daemon" ? "agy" : "antigravity-ide",
      state: finalState,
      pids: remainingPids,
      mainPid: remainingPids[0] ?? null,
      uptimeSeconds: 0,
      lastCheckedAt: Date.now(),
      errorMessage:
        remainingPids.length > 0
          ? `Processes [${remainingPids.join(", ")}] failed to terminate`
          : undefined,
    };

    status = await this.getStatus();
    this.notifyListeners(status);
    return finalInfo;
  }

  private async checkActivePids(targetPids: number[]): Promise<number[]> {
    const processes = await this.system.getRunningProcesses();
    const activePidSet = new Set(processes.map((p) => p.pid));
    return targetPids.filter((pid) => activePidSet.has(pid));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
