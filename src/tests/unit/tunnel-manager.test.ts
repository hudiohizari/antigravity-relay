import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  TunnelManager,
  ChildProcessLike,
} from "@/modules/tunnel/tunnel-manager";
import { TunnelConfigStore } from "@/modules/tunnel/tunnel-config";

class MockChildProcess extends EventEmitter implements ChildProcessLike {
  public pid = 12345;
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public killCalls: Array<NodeJS.Signals | number | undefined> = [];

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killCalls.push(signal);
    // Simulate process termination after signal
    setTimeout(() => {
      this.emit("exit", 0, signal?.toString() || null);
    }, 10);
    return true;
  }

  public simulateOutput(stream: "stdout" | "stderr", data: string): void {
    if (stream === "stdout") {
      this.stdout.emit("data", Buffer.from(data));
    } else {
      this.stderr.emit("data", Buffer.from(data));
    }
  }

  public simulateCrash(code = 1): void {
    this.emit("exit", code, null);
  }
}

describe("Cloudflare Tunnel Subprocess Supervisor", () => {
  describe("TunnelConfigStore", () => {
    let tempDir: string;
    let configPath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tunnel-config-test-"));
      configPath = path.join(tempDir, "tunnel.json");
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should initialize with default configuration", () => {
      const store = new TunnelConfigStore();
      const config = store.getConfig();
      expect(config.targetPort).toBe(4040);
      expect(config.autoRestart).toBe(true);
      expect(config.maxRetries).toBe(5);
      expect(config.retryBackoffMs).toBe(2000);
    });

    it("should validate target port bounds", () => {
      const store = new TunnelConfigStore();
      expect(() => store.updateConfig({ targetPort: 0 })).toThrow(
        "Invalid targetPort",
      );
      expect(() => store.updateConfig({ targetPort: 70000 })).toThrow(
        "Invalid targetPort",
      );
      expect(() => store.updateConfig({ targetPort: 4040.5 })).toThrow(
        "Invalid targetPort",
      );
    });

    it("should validate maxRetries and retryBackoffMs", () => {
      const store = new TunnelConfigStore();
      expect(() => store.updateConfig({ maxRetries: -1 })).toThrow(
        "Invalid maxRetries",
      );
      expect(() => store.updateConfig({ retryBackoffMs: 50 })).toThrow(
        "Invalid retryBackoffMs",
      );
    });

    it("should persist and reload configuration to disk", () => {
      const store1 = new TunnelConfigStore({ configPath });
      store1.updateConfig({
        targetPort: 8080,
        customDomain: "tunnel.mydev.com",
      });

      const store2 = new TunnelConfigStore({ configPath });
      expect(store2.getConfig().targetPort).toBe(8080);
      expect(store2.getConfig().customDomain).toBe("tunnel.mydev.com");
    });

    it("should reset configuration to default", () => {
      const store = new TunnelConfigStore({ configPath });
      store.updateConfig({ targetPort: 9000 });
      expect(store.getConfig().targetPort).toBe(9000);

      store.resetToDefault();
      expect(store.getConfig().targetPort).toBe(4040);
    });

    it("should create nested directory on save and gracefully handle invalid disk JSON", () => {
      const nestedPath = path.join(tempDir, "sub", "deep", "tunnel.json");
      const store = new TunnelConfigStore({ configPath: nestedPath });
      store.updateConfig({ targetPort: 8888 });
      expect(fs.existsSync(nestedPath)).toBe(true);

      // Write corrupt JSON
      fs.writeFileSync(nestedPath, "CORRUPT JSON", "utf-8");
      const storeCorrupt = new TunnelConfigStore({ configPath: nestedPath });
      expect(storeCorrupt.getConfig().targetPort).toBe(4040);

      // Suppress write error
      vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
        throw new Error("Disk full");
      });
      expect(() => store.updateConfig({ targetPort: 7777 })).not.toThrow();
    });
  });

  describe("TunnelManager Process Lifecycle", () => {
    let currentMockProcess: MockChildProcess;
    let spawnedCommands: Array<{ cmd: string; args: string[] }>;
    let manager: TunnelManager;

    beforeEach(() => {
      spawnedCommands = [];
      let nextPid = 12345;
      const mockSpawn = (cmd: string, args: string[]) => {
        spawnedCommands.push({ cmd, args });
        currentMockProcess = new MockChildProcess();
        currentMockProcess.pid = nextPid++;
        return currentMockProcess;
      };

      manager = new TunnelManager({
        config: {
          targetPort: 4040,
          retryBackoffMs: 50,
          maxRetries: 3,
        },
        spawnFn: mockSpawn,
      });
    });

    afterEach(async () => {
      await manager.stop();
    });

    it("should launch quick tunnel with target port and default args", async () => {
      const startPromise = manager.start();

      // Simulate cloudflared output emitting trycloudflare URL
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "INF +--------------------------------------------------------------------------------------------+\n" +
            "INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n" +
            "INF |  https://bold-tiger-stream.trycloudflare.com                                               |\n" +
            "INF +--------------------------------------------------------------------------------------------+",
        );
      }, 20);

      const status = await startPromise;
      expect(status.state).toBe("connected");
      expect(status.publicUrl).toBe(
        "https://bold-tiger-stream.trycloudflare.com",
      );
      expect(status.pid).toBe(12345);

      expect(spawnedCommands[0].cmd).toBe("cloudflared");
      expect(spawnedCommands[0].args).toContain("--url");
      expect(spawnedCommands[0].args).toContain("http://127.0.0.1:4040");
    });

    it("should launch named tunnel with token if provided", async () => {
      const startPromise = manager.start({
        namedTunnelToken: "eyJhIjoiMTIzNCJ9",
      });

      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stdout",
          "Connected to Cloudflare edge: https://my-custom.trycloudflare.com",
        );
      }, 20);

      await startPromise;
      expect(spawnedCommands[0].args).toEqual([
        "tunnel",
        "run",
        "--token",
        "eyJhIjoiMTIzNCJ9",
      ]);
    });

    it("should extract custom vanity domain URL if configured", () => {
      const vanityManager = new TunnelManager({
        config: { customDomain: "relay.antigravity.dev" },
      });

      const url = vanityManager.extractUrl(
        "Tunnel route registered at https://relay.antigravity.dev/status",
      );
      expect(url).toBe("https://relay.antigravity.dev/status");
    });

    it("should supervise crashes and reconnect with exponential backoff", async () => {
      const statusListener = vi.fn();
      manager.onStatusUpdated(statusListener);

      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://reconnect-test.trycloudflare.com",
        );
      }, 10);

      await startPromise;
      expect(manager.getStatus().state).toBe("connected");

      // Sabotage 1: Process crash
      currentMockProcess.simulateCrash(1);

      expect(manager.getStatus().state).toBe("reconnecting");
      expect(manager.getStatus().reconnectAttempts).toBe(1);

      // Await backoff restart
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(spawnedCommands).toHaveLength(2);

      // Send URL for reconnected process
      currentMockProcess.simulateOutput(
        "stderr",
        "https://reconnect-test-2.trycloudflare.com",
      );

      expect(manager.getStatus().state).toBe("connected");
      expect(manager.getStatus().publicUrl).toBe(
        "https://reconnect-test-2.trycloudflare.com",
      );
    });

    it("should transition to error state when retry limit is exhausted", async () => {
      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://crash-loop.trycloudflare.com",
        );
      }, 10);
      await startPromise;

      // Crash 1
      currentMockProcess.simulateCrash(1);
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Crash 2
      currentMockProcess.simulateCrash(1);
      await new Promise((resolve) => setTimeout(resolve, 120));

      // Crash 3
      currentMockProcess.simulateCrash(1);
      await new Promise((resolve) => setTimeout(resolve, 220));

      // Crash 4 (Exceeds maxRetries = 3)
      currentMockProcess.simulateCrash(1);

      expect(manager.getStatus().state).toBe("error");
      expect(manager.getStatus().lastError).toContain("exited with code 1");
    });

    it("should stop child process gracefully with SIGTERM", async () => {
      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://stopping-test.trycloudflare.com",
        );
      }, 10);
      await startPromise;

      const procRef = currentMockProcess;
      await manager.stop();

      expect(procRef.killCalls).toContain("SIGTERM");
      expect(manager.getStatus().state).toBe("stopped");
      expect(manager.getStatus().publicUrl).toBeNull();
    });

    it("should escalate to SIGKILL if child process does not exit on SIGTERM", async () => {
      const stubbornManager = new TunnelManager({
        escalationTimeoutMs: 30,
        spawnFn: () => {
          const proc = new MockChildProcess();
          // Stubborn process does NOT exit on SIGTERM
          proc.kill = vi.fn((sig) => {
            proc.killCalls.push(sig);
            if (sig === "SIGKILL") {
              setTimeout(() => proc.emit("exit", 0, "SIGKILL"), 5);
            }
            return true;
          });
          setTimeout(() => {
            proc.simulateOutput(
              "stderr",
              "https://stubborn.trycloudflare.com\n",
            );
          }, 5);
          return proc;
        },
      });

      await stubbornManager.start();
      await stubbornManager.stop();
      expect(stubbornManager.getStatus().state).toBe("stopped");
    });

    it("should return existing status if start() is called while connected", async () => {
      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://already-connected.trycloudflare.com\n",
        );
      }, 5);
      await startPromise;

      const secondStart = await manager.start();
      expect(secondStart.state).toBe("connected");
      expect(secondStart.publicUrl).toBe(
        "https://already-connected.trycloudflare.com",
      );
    });

    it("should handle spawn exception gracefully", async () => {
      const failingManager = new TunnelManager({
        config: { autoRestart: false },
        spawnFn: () => {
          throw new Error("Cannot execute binary");
        },
      });

      const status = await failingManager.start();
      expect(status.state).toBe("error");
      expect(status.lastError).toBe("Cannot execute binary");
    });

    it("should safely handle stop() when process is not running", async () => {
      await expect(manager.stop()).resolves.toBeUndefined();
      expect(manager.getStatus().state).toBe("stopped");
    });

    it("should suppress listener callback errors in transitionState", () => {
      manager.onStatusUpdated(() => {
        throw new Error("Broken status listener");
      });
      expect(() => (manager as any).transitionState("connected")).not.toThrow();
    });

    it("should allow unsubscribing from status listener", () => {
      const listener = vi.fn();
      const unsub = manager.onStatusUpdated(listener);
      (manager as any).transitionState("starting");
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      (manager as any).transitionState("connected");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should initialize default spawnFn when not provided in options", () => {
      const defaultManager = new TunnelManager();
      expect(typeof (defaultManager as any).spawnFn).toBe("function");
      expect(defaultManager.getPublicUrl()).toBeNull();
      // Invoke default spawnFn with dummy arguments without throwing
      const mockProc = (defaultManager as any).spawnFn("echo", ["test"], {});
      expect(mockProc).toBeDefined();
      if (mockProc.kill) {
        mockProc.kill();
      }
    });

    it("should handle error when SIGTERM throws in stop", async () => {
      const proc = new MockChildProcess();
      proc.kill = vi.fn((sig) => {
        if (sig === "SIGTERM") {
          throw new Error("SIGTERM error");
        }
        return true;
      });
      (manager as any).currentProcess = proc;
      await expect(manager.stop()).resolves.toBeUndefined();
    });

    it("should handle error when SIGKILL throws during escalation in stop", async () => {
      const shortEscalationManager = new TunnelManager({
        escalationTimeoutMs: 15,
      });
      const proc = new MockChildProcess();
      proc.kill = vi.fn((sig) => {
        if (sig === "SIGTERM") {
          return true;
        }
        if (sig === "SIGKILL") {
          throw new Error("SIGKILL error");
        }
        return true;
      });
      (shortEscalationManager as any).currentProcess = proc;
      await expect(shortEscalationManager.stop()).resolves.toBeUndefined();
    });

    it("should return null for non-matching output even with custom domain configured", () => {
      const customManager = new TunnelManager({
        config: { customDomain: "relay.internal.net" },
      });
      expect(customManager.extractUrl("No domain output here")).toBeNull();
    });

    it("should handle process error event and schedule restart when autoRestart enabled", async () => {
      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://test-error.trycloudflare.com\n",
        );
      }, 5);
      await startPromise;

      currentMockProcess.emit(
        "error",
        new Error("Subprocess crashed unrecoverably"),
      );
      expect(manager.getStatus().state).toBe("reconnecting");
    });

    it("should abort reconnection loop and transition to error when process emits ENOENT error", async () => {
      const enoentManager = new TunnelManager({
        config: { autoRestart: true, maxRetries: 5, retryBackoffMs: 50 },
        spawnFn: () => {
          const proc = new MockChildProcess();
          setTimeout(() => {
            const err = new Error("spawn cloudflared ENOENT");
            (err as any).code = "ENOENT";
            proc.emit("error", err);
          }, 5);
          return proc;
        },
      });

      const status = await enoentManager.start();
      expect(status.state).toBe("error");
      expect(status.lastError).toBe("cloudflared executable not found in PATH");
      expect(status.reconnectAttempts).toBe(0);
      expect((enoentManager as any).reconnectTimer).toBeNull();
    });

    it("should handle synchronous ENOENT spawn exception without reconnect loop", async () => {
      const enoentManager = new TunnelManager({
        config: { autoRestart: true, maxRetries: 5 },
        spawnFn: () => {
          const err = new Error("spawn ENOENT");
          (err as any).code = "ENOENT";
          throw err;
        },
      });

      const status = await enoentManager.start();
      expect(status.state).toBe("error");
      expect(status.lastError).toBe("cloudflared executable not found in PATH");
      expect(status.reconnectAttempts).toBe(0);
      expect((enoentManager as any).reconnectTimer).toBeNull();
    });

    it("should ignore process failure when isStopping is true", () => {
      (manager as any).isStopping = true;
      (manager as any).handleProcessFailure("Error during stop");
      expect(manager.getStatus().lastError).toBe("Error during stop");
    });

    it("should resolve immediately in waitForConnection if already terminal or connected", async () => {
      (manager as any).state = "connected";
      const statusConnected = await (manager as any).waitForConnection();
      expect(statusConnected.state).toBe("connected");

      (manager as any).state = "error";
      const statusError = await (manager as any).waitForConnection();
      expect(statusError.state).toBe("error");

      (manager as any).state = "stopped";
      const statusStopped = await (manager as any).waitForConnection();
      expect(statusStopped.state).toBe("stopped");
    });

    it("should resolve with current status if connection times out", async () => {
      const timeoutManager = new TunnelManager({
        connectionTimeoutMs: 20,
        spawnFn: () => new MockChildProcess(),
      });
      const status = await timeoutManager.start();
      expect(status.state).toBe("starting");
    });

    it("should restart running tunnel process, transition states, terminate old process, and spawn new process", async () => {
      const states: string[] = [];
      manager.onStatusUpdated((s) => states.push(s.state));

      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://initial-tunnel.trycloudflare.com\n",
        );
      }, 10);
      const initialStatus = await startPromise;
      expect(initialStatus.state).toBe("connected");
      expect(initialStatus.pid).toBe(12345);
      const firstProc = currentMockProcess;

      const restartPromise = manager.restart();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://restarted-tunnel.trycloudflare.com\n",
        );
      }, 15);

      const restartedStatus = await restartPromise;
      expect(firstProc.killed).toBe(true);
      expect(firstProc.killCalls).toContain("SIGTERM");
      expect(restartedStatus.state).toBe("connected");
      expect(restartedStatus.publicUrl).toBe(
        "https://restarted-tunnel.trycloudflare.com",
      );
      expect(restartedStatus.pid).toBe(12346);
      expect(states).toContain("stopped");
      expect(states).toContain("starting");
      expect(states).toContain("connected");
    });

    it("should restart with configuration overrides", async () => {
      const startPromise = manager.start();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://first.trycloudflare.com\n",
        );
      }, 10);
      await startPromise;

      const restartPromise = manager.restart({ targetPort: 8080 });
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://second.trycloudflare.com\n",
        );
      }, 10);
      const status = await restartPromise;
      expect(status.state).toBe("connected");
      const lastSpawn = spawnedCommands[spawnedCommands.length - 1];
      expect(lastSpawn.args).toContain("http://127.0.0.1:8080");
    });

    it("should restart cleanly when process is currently stopped", async () => {
      expect(manager.getStatus().state).toBe("stopped");

      const restartPromise = manager.restart();
      setTimeout(() => {
        currentMockProcess.simulateOutput(
          "stderr",
          "https://from-stopped.trycloudflare.com\n",
        );
      }, 10);
      const status = await restartPromise;
      expect(status.state).toBe("connected");
      expect(status.publicUrl).toBe("https://from-stopped.trycloudflare.com");
    });

    it("should escalate to SIGKILL during restart if stubborn process ignores SIGTERM", async () => {
      const stubbornRestartManager = new TunnelManager({
        escalationTimeoutMs: 30,
        spawnFn: () => {
          const proc = new MockChildProcess();
          proc.kill = vi.fn((sig) => {
            proc.killCalls.push(sig);
            if (sig === "SIGKILL") {
              setTimeout(() => proc.emit("exit", 0, "SIGKILL"), 5);
            }
            return true;
          });
          setTimeout(() => {
            proc.simulateOutput(
              "stderr",
              "https://stubborn-restart.trycloudflare.com\n",
            );
          }, 5);
          return proc;
        },
      });

      await stubbornRestartManager.start();
      const restartPromise = stubbornRestartManager.restart();
      const status = await restartPromise;
      expect(status.state).toBe("connected");
      await stubbornRestartManager.stop();
    });
  });
});
