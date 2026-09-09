import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  TunnelManager,
  ChildProcessLike,
  CloudflaredNotFoundError,
  isMissingBinaryError,
} from "@/modules/tunnel/tunnel-manager";
import { TunnelConfigStore } from "@/modules/tunnel/tunnel-config";
import { BinaryResolver } from "@/modules/tunnel/binary-resolver";

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

      expect(spawnedCommands[0].cmd).toContain("cloudflared");
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
      }, 25);
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

  describe("Binary Resolver and Circuit Breaker Integration", () => {
    it("reports isBinaryInstalled, binaryPath, and platform in getStatus when binary is available", () => {
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });

      const mgr = new TunnelManager({
        binaryResolver: mockResolver,
      });

      const status = mgr.getStatus();
      expect(status.isBinaryInstalled).toBe(true);
      expect(status.binaryPath).toContain("cloudflared");
      expect(status.platform).toBe("darwin");
    });

    it("reports isBinaryInstalled as false when binary is missing", () => {
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/bin:/bin" },
        statSync: () => {
          throw new Error("ENOENT");
        },
        accessSync: () => {
          throw new Error("ENOENT");
        },
      });

      const mgr = new TunnelManager({
        binaryResolver: mockResolver,
      });

      const status = mgr.getStatus();
      expect(status.isBinaryInstalled).toBe(false);
      expect(status.binaryPath).toBeNull();
      expect(status.platform).toBe("darwin");
    });

    it("trips pre-flight circuit breaker on start() and rejects with CloudflaredNotFoundError without spawning", async () => {
      const mockSpawn = vi.fn();
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "" },
        statSync: () => {
          throw new Error("ENOENT");
        },
        accessSync: () => {
          throw new Error("ENOENT");
        },
        stat: async () => {
          throw new Error("ENOENT");
        },
        access: async () => {
          throw new Error("ENOENT");
        },
      });

      const mgr = new TunnelManager({
        spawnFn: mockSpawn,
        binaryResolver: mockResolver,
      });

      await expect(mgr.start()).rejects.toThrow(CloudflaredNotFoundError);

      expect(mockSpawn).not.toHaveBeenCalled();
      const status = mgr.getStatus();
      expect(status.state).toBe("error");
      expect(status.lastError).toBe("cloudflared binary not found");
      expect(status.isBinaryInstalled).toBe(false);
    });

    it("trips pre-flight circuit breaker on restart() and rejects with CloudflaredNotFoundError without spawning", async () => {
      const mockSpawn = vi.fn();
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "" },
        statSync: () => {
          throw new Error("ENOENT");
        },
        accessSync: () => {
          throw new Error("ENOENT");
        },
        stat: async () => {
          throw new Error("ENOENT");
        },
        access: async () => {
          throw new Error("ENOENT");
        },
      });

      const mgr = new TunnelManager({
        spawnFn: mockSpawn,
        binaryResolver: mockResolver,
      });

      await expect(mgr.restart()).rejects.toThrow(CloudflaredNotFoundError);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mgr.getStatus().state).toBe("error");
      expect(mgr.getStatus().lastError).toBe("cloudflared binary not found");
    });

    it("passes augmented PATH environment variable to spawned child process", async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockProc = new MockChildProcess();

      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/bin:/bin" },
        statSync: (p) => {
          if (p === "/opt/homebrew/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        accessSync: () => {},
        stat: async (p) => {
          if (p === "/opt/homebrew/bin/cloudflared") {
            return { isFile: () => true };
          }
          throw new Error("Not found");
        },
        access: async () => {},
      });

      const mgr = new TunnelManager({
        binaryResolver: mockResolver,
        spawnFn: (_cmd, _args, opts) => {
          capturedOptions = opts;
          setTimeout(() => {
            mockProc.simulateOutput(
              "stderr",
              "https://augmented-env.trycloudflare.com\n",
            );
          }, 10);
          return mockProc;
        },
      });

      await mgr.start();

      expect(capturedOptions).toBeDefined();
      const spawnedEnv = (capturedOptions?.env as NodeJS.ProcessEnv) || {};
      expect(spawnedEnv.PATH).toContain("/opt/homebrew/bin");
      expect(spawnedEnv.PATH).toContain("/usr/local/bin");
      await mgr.stop();
    });

    it("supports checkBinary with forceRefresh parameter", async () => {
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
        stat: async () => ({ isFile: () => true }),
        access: async () => {},
      });

      const spy = vi.spyOn(mockResolver, "resolve");
      const mgr = new TunnelManager({ binaryResolver: mockResolver });

      const result = await mgr.checkBinary(true);
      expect(result.isInstalled).toBe(true);
      expect(spy).toHaveBeenCalledWith({
        binaryPath: undefined,
        forceRefresh: true,
      });

      await mgr.checkBinary({ forceRefresh: true });
      expect(spy).toHaveBeenCalledWith({
        binaryPath: undefined,
        forceRefresh: true,
      });

      await mgr.checkBinary({ forceRefresh: false });
      expect(spy).toHaveBeenCalledWith({
        binaryPath: undefined,
        forceRefresh: false,
      });

      await mgr.checkBinary();
      expect(spy).toHaveBeenCalledWith({
        binaryPath: undefined,
        forceRefresh: undefined,
      });
    });

    it("falls back to default binary name when binaryPath is null in launchSubprocess", async () => {
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });
      vi.spyOn(mockResolver, "resolveSync").mockReturnValue({
        isInstalled: true,
        binaryPath: null,
        platform: "darwin",
      });

      let spawnedCmd = "";
      const fallbackManager = new TunnelManager({
        binaryResolver: mockResolver,
        spawnFn: (cmd) => {
          spawnedCmd = cmd;
          const p = new MockChildProcess();
          setTimeout(
            () =>
              p.simulateOutput(
                "stderr",
                "https://fallback-cmd.trycloudflare.com\n",
              ),
            5,
          );
          return p;
        },
      });

      await fallbackManager.start();
      expect(spawnedCmd).toBe("cloudflared");
      await fallbackManager.stop();
    });

    it("aborts reconnection if binary is uninstalled during backoff timer", async () => {
      const mockResolver = new BinaryResolver({
        platform: "darwin",
        env: { PATH: "/usr/local/bin" },
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });

      let nextPid = 55500;
      let activeProc: MockChildProcess | null = null;
      const reconnectManager = new TunnelManager({
        config: { autoRestart: true, maxRetries: 3, retryBackoffMs: 20 },
        binaryResolver: mockResolver,
        spawnFn: () => {
          activeProc = new MockChildProcess();
          activeProc.pid = nextPid++;
          setTimeout(
            () =>
              activeProc!.simulateOutput(
                "stderr",
                "https://reconnect-abort.trycloudflare.com\n",
              ),
            5,
          );
          return activeProc;
        },
      });

      await reconnectManager.start();
      expect(reconnectManager.getStatus().state).toBe("connected");

      // Now mock resolver to report uninstalled when timer triggers
      vi.spyOn(mockResolver, "resolveSync").mockReturnValue({
        isInstalled: false,
        binaryPath: null,
        platform: "darwin",
        error: "Uninstalled",
      });

      // Trigger crash to start backoff
      activeProc!.simulateCrash(1);
      expect(reconnectManager.getStatus().state).toBe("reconnecting");

      // Wait for backoff timer to fire
      await new Promise((r) => setTimeout(r, 50));

      expect(reconnectManager.getStatus().state).toBe("error");
      expect(reconnectManager.getStatus().lastError).toBe(
        "cloudflared binary not found",
      );
    });

    it("suppresses spawn error when launchSubprocess fails during backoff reconnect", async () => {
      let spawnCount = 0;
      let activeProc: MockChildProcess | null = null;
      const failingReconnectManager = new TunnelManager({
        config: { autoRestart: true, maxRetries: 3, retryBackoffMs: 20 },
        spawnFn: () => {
          spawnCount++;
          if (spawnCount > 1) {
            throw new Error("Spawn failure during reconnect");
          }
          activeProc = new MockChildProcess();
          setTimeout(
            () =>
              activeProc!.simulateOutput(
                "stderr",
                "https://failing-reconnect.trycloudflare.com\n",
              ),
            5,
          );
          return activeProc;
        },
      });

      await failingReconnectManager.start();
      activeProc!.simulateCrash(1);
      expect(failingReconnectManager.getStatus().state).toBe("reconnecting");

      await new Promise((r) => setTimeout(r, 60));
      expect(failingReconnectManager.getStatus().lastError).toBe(
        "Spawn failure during reconnect",
      );
    });
  });

  describe("isMissingBinaryError and Error Handling Edge Cases", () => {
    it("handles null, undefined, falsy, and non-object values", () => {
      expect(isMissingBinaryError(null)).toBe(false);
      expect(isMissingBinaryError(undefined)).toBe(false);
      expect(isMissingBinaryError("")).toBe(false);
      expect(isMissingBinaryError(0)).toBe(false);
      expect(isMissingBinaryError(false)).toBe(false);
    });

    it("detects ENOENT from code or message strings", () => {
      expect(isMissingBinaryError({ code: "ENOENT" })).toBe(true);
      expect(isMissingBinaryError("spawn cloudflared ENOENT")).toBe(true);
      expect(isMissingBinaryError("executable missing from system")).toBe(true);
      expect(isMissingBinaryError("binary not found")).toBe(true);
      expect(
        isMissingBinaryError(new Error("cloudflared not found in PATH")),
      ).toBe(true);
    });

    it("returns false for unrelated errors and empty objects", () => {
      expect(isMissingBinaryError(new Error("Connection reset by peer"))).toBe(
        false,
      );
      expect(isMissingBinaryError({})).toBe(false);
      expect(isMissingBinaryError({ code: "EACCES" })).toBe(false);
      expect(isMissingBinaryError({ code: "EACCES", message: "denied" })).toBe(
        false,
      );
    });

    it("handles process failure with string and object without message while stopping", () => {
      const mgr = new TunnelManager();
      (mgr as any).isStopping = true;
      (mgr as any).handleProcessFailure(new Error("Error during stop"));
      expect(mgr.getStatus().lastError).toBe("Error during stop");

      (mgr as any).handleProcessFailure({});
      expect(mgr.getStatus().lastError).toBe("[object Object]");
    });

    it("handles process failure with string and object without message when not stopping", () => {
      const mgr = new TunnelManager({ config: { autoRestart: false } });
      (mgr as any).isStopping = false;
      (mgr as any).handleProcessFailure("Simple string error");
      expect(mgr.getStatus().lastError).toBe("Simple string error");

      (mgr as any).handleProcessFailure({});
      expect(mgr.getStatus().lastError).toBe("[object Object]");
    });

    it("handles process exit with code 0 while running without stopping", () => {
      const mgr = new TunnelManager({ config: { autoRestart: false } });
      (mgr as any).isStopping = false;
      (mgr as any).handleProcessExit(0, null);
      expect(mgr.getStatus().state).toBe("error");
    });

    it("handles process exit cleanly when state is error due to missing binary in PATH", () => {
      const mgr = new TunnelManager();
      (mgr as any).state = "error";
      (mgr as any).lastError = "cloudflared executable not found in PATH";
      const proc = new MockChildProcess();
      (mgr as any).currentProcess = proc;
      (mgr as any).pid = 999;

      (mgr as any).handleProcessExit(1, null);
      expect((mgr as any).currentProcess).toBeNull();
      expect((mgr as any).pid).toBeNull();
    });

    it("handles process output and exit when PID is undefined", async () => {
      const procWithoutPid = new MockChildProcess();
      (procWithoutPid as any).pid = undefined;

      const noPidManager = new TunnelManager({
        spawnFn: () => procWithoutPid,
      });

      const startPromise = noPidManager.start();
      setTimeout(() => {
        procWithoutPid.simulateOutput(
          "stderr",
          "https://no-pid.trycloudflare.com\n",
        );
      }, 5);

      const status = await startPromise;
      expect(status.pid).toBeNull();
      await noPidManager.stop();
    });

    it("resolves binary from binaryInfo.binaryPath when launchSubprocess has no args", async () => {
      const mockResolver = new BinaryResolver({
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });
      vi.spyOn(mockResolver, "resolveSync").mockReturnValue({
        isInstalled: true,
        binaryPath: "/opt/resolved/cloudflared",
        platform: "darwin",
      });

      let spawnedCmd = "";
      const mgr = new TunnelManager({
        binaryResolver: mockResolver,
        spawnFn: (cmd) => {
          spawnedCmd = cmd;
          const p = new MockChildProcess();
          setTimeout(
            () =>
              p.simulateOutput(
                "stderr",
                "https://launch-sub.trycloudflare.com\n",
              ),
            5,
          );
          return p;
        },
      });

      await (mgr as any).launchSubprocess();
      expect(spawnedCmd).toBe("/opt/resolved/cloudflared");
      await mgr.stop();
    });

    it("resolves binary from config.binaryPath when binaryPath is null in launchSubprocess", async () => {
      const mockResolver = new BinaryResolver({
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });
      vi.spyOn(mockResolver, "resolveSync").mockReturnValue({
        isInstalled: true,
        binaryPath: null,
        platform: "darwin",
      });

      let spawnedCmd = "";
      const mgr = new TunnelManager({
        config: { binaryPath: "/opt/configured/cloudflared" },
        binaryResolver: mockResolver,
        spawnFn: (cmd) => {
          spawnedCmd = cmd;
          const p = new MockChildProcess();
          setTimeout(
            () =>
              p.simulateOutput(
                "stderr",
                "https://launch-sub2.trycloudflare.com\n",
              ),
            5,
          );
          return p;
        },
      });

      await (mgr as any).launchSubprocess();
      expect(spawnedCmd).toBe("/opt/configured/cloudflared");
      await mgr.stop();
    });

    it("resolves binary to cloudflared when both binaryPath and config.binaryPath are null in launchSubprocess", async () => {
      const mockResolver = new BinaryResolver({
        statSync: () => ({ isFile: () => true }),
        accessSync: () => {},
      });
      vi.spyOn(mockResolver, "resolveSync").mockReturnValue({
        isInstalled: true,
        binaryPath: null,
        platform: "darwin",
      });

      let spawnedCmd = "";
      const mgr = new TunnelManager({
        binaryResolver: mockResolver,
        spawnFn: (cmd) => {
          spawnedCmd = cmd;
          const p = new MockChildProcess();
          setTimeout(
            () =>
              p.simulateOutput(
                "stderr",
                "https://launch-sub3.trycloudflare.com\n",
              ),
            5,
          );
          return p;
        },
      });

      await (mgr as any).launchSubprocess();
      expect(spawnedCmd).toBe("cloudflared");
      await mgr.stop();
    });
  });
});
