import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import tls from "node:tls";
import {
  PortDiscoveryService,
  parsePortFromLog,
  getDefaultLogPath,
  defaultTlsReadinessProbe,
} from "@/modules/relay/port-discovery";
import { chatResumeEvents } from "@/modules/chat-resume/telemetry";

describe("PortDiscoveryService", () => {
  let tempDir: string;
  let testLogPath: string;
  let service: PortDiscoveryService;

  beforeEach(() => {
    chatResumeEvents.clearTelemetryHistory();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "port-discovery-test-"));
    testLogPath = path.join(tempDir, "main.log");
  });

  afterEach(() => {
    if (service) {
      service.stop();
      service.dispose();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Suppress temp dir cleanup error
    }
  });

  describe("Log Parsing Logic", () => {
    it("should parse port from standard log line with trailing slash", () => {
      const log = "[INFO] listening on https://127.0.0.1:54321/";
      expect(parsePortFromLog(log)).toBe(54321);
    });

    it("should parse port from log line without trailing slash", () => {
      const log = "listening on https://127.0.0.1:64978";
      expect(parsePortFromLog(log)).toBe(64978);
    });

    it("should parse port from Antigravity Local header format", () => {
      const log =
        "[2026-09-09 01:08:24.869] [info]    Local:       https://127.0.0.1:53675/";
      expect(parsePortFromLog(log)).toBe(53675);
    });

    it("should parse port from Antigravity reload message format", () => {
      const log =
        "[2026-09-09 01:08:24.868] [info]  [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:53675/";
      expect(parsePortFromLog(log)).toBe(53675);
    });

    it("should return the most recent port from multiline logs", () => {
      const log = [
        "[2026-09-08 10:00:00] listening on https://127.0.0.1:40001/",
        "[2026-09-08 11:00:00] user switched account",
        "[2026-09-08 11:00:05] listening on https://127.0.0.1:40002/",
        "[2026-09-08 12:00:00] restart complete",
        "[2026-09-08 12:00:10] listening on https://127.0.0.1:40003/",
      ].join("\n");

      expect(parsePortFromLog(log)).toBe(40003);
    });

    it("should return null for logs without matching address", () => {
      expect(
        parsePortFromLog("server ready on http://0.0.0.0:8080"),
      ).toBeNull();
      expect(parsePortFromLog("")).toBeNull();
    });

    it("should return null for invalid port numbers", () => {
      expect(
        parsePortFromLog("listening on https://127.0.0.1:999999/"),
      ).toBeNull();
      expect(parsePortFromLog("listening on https://127.0.0.1:0/")).toBeNull();
    });

    it("should resolve default log path depending on current platform", () => {
      const defaultPath = getDefaultLogPath();
      expect(defaultPath).toBeTruthy();
      expect(typeof defaultPath).toBe("string");
    });
  });

  describe("Lifecycle and Discovery", () => {
    it("should initialize with initialPort when specified", () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: 52000,
      });
      expect(service.getPort()).toBe(52000);
      expect(service.isDiscovered()).toBe(true);
    });

    it("should handle non-existent log file gracefully on start", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 100,
      });

      await service.start();

      expect(service.getPort()).toBeNull();
      expect(service.isDiscovered()).toBe(false);
      expect(service.isRestarting()).toBe(false);
    });

    it("should discover port immediately if log file already exists at startup", async () => {
      fs.writeFileSync(
        testLogPath,
        "language_server listening on https://127.0.0.1:51234/\n",
        "utf-8",
      );

      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 100,
      });

      let discoveredEventPort: number | null = null;
      service.on("port-discovered", (port) => {
        discoveredEventPort = port;
      });

      await service.start();

      expect(service.getPort()).toBe(51234);
      expect(service.isDiscovered()).toBe(true);
      expect(discoveredEventPort).toBe(51234);
    });

    it("should discover port when log file is created after service startup", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 100,
        debounceMs: 20,
      });

      await service.start();
      expect(service.getPort()).toBeNull();

      const discoveredPromise = new Promise<number>((resolve) => {
        service.on("port-discovered", resolve);
      });

      // Write log file after brief delay
      fs.writeFileSync(
        testLogPath,
        "started language server\nlistening on https://127.0.0.1:56789/\n",
        "utf-8",
      );

      const discoveredPort = await Promise.race([
        discoveredPromise,
        new Promise<number>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout waiting for port discovery")),
            2000,
          ),
        ),
      ]);

      expect(discoveredPort).toBe(56789);
      expect(service.getPort()).toBe(56789);
    });

    it("should emit port-changed when new port is appended to log file", async () => {
      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:50001/\n",
        "utf-8",
      );

      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 100,
        debounceMs: 20,
      });

      await service.start();
      expect(service.getPort()).toBe(50001);

      const portChangedPromise = new Promise<{
        oldPort: number | null;
        newPort: number;
      }>((resolve) => {
        service.on("port-changed", resolve);
      });

      // Append new port line simulating account switch
      fs.appendFileSync(
        testLogPath,
        "restarted server\nlistening on https://127.0.0.1:50002/\n",
        "utf-8",
      );

      const changeEvent = await Promise.race([
        portChangedPromise,
        new Promise<{ oldPort: number | null; newPort: number }>((_, reject) =>
          setTimeout(
            () => reject(new Error("Timeout waiting for port-changed")),
            2000,
          ),
        ),
      ]);

      expect(changeEvent.oldPort).toBe(50001);
      expect(changeEvent.newPort).toBe(50002);
      expect(service.getPort()).toBe(50002);
    });

    it("should support manual setPort and emit appropriate events", () => {
      service = new PortDiscoveryService({ logPath: testLogPath });

      let discoveredPort: number | null = null;
      let changedEvent: { oldPort: number | null; newPort: number } | null =
        null;

      service.on("port-discovered", (p) => {
        discoveredPort = p;
      });
      service.on("port-changed", (evt) => {
        changedEvent = evt;
      });

      service.setPort(41000);
      expect(service.getPort()).toBe(41000);
      expect(discoveredPort).toBe(41000);
      expect(changedEvent).toEqual({ oldPort: null, newPort: 41000 });

      service.setPort(42000);
      expect(service.getPort()).toBe(42000);
      expect(changedEvent).toEqual({ oldPort: 41000, newPort: 42000 });

      let lostEmitted = false;
      service.on("port-lost", () => {
        lostEmitted = true;
      });

      service.setPort(null);
      expect(service.getPort()).toBeNull();
      expect(lostEmitted).toBe(true);
    });

    it("should track restarting state correctly", () => {
      service = new PortDiscoveryService({ logPath: testLogPath });

      let restartEmitted = false;
      service.on("restarting", () => {
        restartEmitted = true;
      });

      expect(service.isRestarting()).toBe(false);

      service.setRestarting(true);
      expect(service.isRestarting()).toBe(true);
      expect(restartEmitted).toBe(true);

      service.setPort(43000);
      expect(service.isRestarting()).toBe(false);
    });

    it("should reject stale port from log while restarting and accept newly discovered port", async () => {
      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:57550/\n",
        "utf-8",
      );

      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: 57550,
      });

      expect(service.getPort()).toBe(57550);

      // Antigravity begins restart
      service.setRestarting(true);
      expect(service.getPort()).toBeNull();
      expect(service.getStalePort()).toBe(57550);
      expect(service.isRestarting()).toBe(true);

      // checkOnce reads the same log before new process writes to it
      const staleDiscovered = await service.checkOnce();
      expect(staleDiscovered).toBeNull();
      expect(service.getPort()).toBeNull();
      expect(service.isRestarting()).toBe(true);

      // New process boots and appends new port to log
      fs.appendFileSync(
        testLogPath,
        "[Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:59357/\n",
        "utf-8",
      );

      const newDiscovered = await service.checkOnce();
      expect(newDiscovered).toBe(59357);
      expect(service.getPort()).toBe(59357);
      expect(service.getStalePort()).toBeNull();
      expect(service.isRestarting()).toBe(false);
    });

    it("should seed stalePort from log file tail when currentPort is null and explicit port is not provided", async () => {
      fs.writeFileSync(
        testLogPath,
        "[LOG] prior session\nlistening on https://127.0.0.1:54321/\n",
        "utf-8",
      );

      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: null,
      });

      expect(service.getPort()).toBeNull();
      expect(service.getStalePort()).toBeNull();

      // Initiate restart with null in-memory port and no explicit port
      service.setRestarting(true);

      // Must have read synchronously from log to establish stale barrier
      expect(service.getStalePort()).toBe(54321);
      expect(service.isRestarting()).toBe(true);

      // checkOnce reads log and correctly rejects the stale 54321 port
      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.isRestarting()).toBe(true);
    });

    it("should seed stalePort from explicitStalePort parameter in setRestarting", () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: null,
      });

      expect(service.getStalePort()).toBeNull();
      service.setRestarting(true, 58888);

      expect(service.getStalePort()).toBe(58888);
      expect(service.isRestarting()).toBe(true);
      expect(service.getPort()).toBeNull();
    });

    it("should preserve stalePort when setPort(null) is called", () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: 51234,
      });

      expect(service.getPort()).toBe(51234);
      expect(service.getStalePort()).toBeNull();

      // Setting port to null saves currentPort into stalePort
      service.setPort(null);
      expect(service.getPort()).toBeNull();
      expect(service.getStalePort()).toBe(51234);

      // Consecutive call with null preserves stalePort without clearing
      service.setPort(null);
      expect(service.getPort()).toBeNull();
      expect(service.getStalePort()).toBe(51234);
    });

    it("should emit stale-port-rejected event and chat_port_discovery_stale_rejected telemetry when stale port is encountered", async () => {
      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:54321/\n",
        "utf-8",
      );

      service = new PortDiscoveryService({
        logPath: testLogPath,
        initialPort: 54321,
      });

      let rejectedEventPayload: {
        stalePort: number;
        discoveredPort: number;
      } | null = null;
      service.on("stale-port-rejected", (payload) => {
        rejectedEventPayload = payload;
      });

      service.setRestarting(true);

      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(rejectedEventPayload).toEqual({
        stalePort: 54321,
        discoveredPort: 54321,
        reason: "graceful_shutdown_quiet_window",
      });

      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_port_discovery_stale_rejected",
            stalePort: 54321,
            discoveredPort: 54321,
            appTarget: "app",
            reason: "graceful_shutdown_quiet_window",
          }),
        ]),
      );
    });

    it("should handle reading large log files (>64KB) efficiently", async () => {
      const padding = "x".repeat(70000) + "\n";
      const targetLine = "listening on https://127.0.0.1:49152/\n";
      fs.writeFileSync(testLogPath, padding + targetLine, "utf-8");

      service = new PortDiscoveryService({ logPath: testLogPath });
      const discovered = await service.checkOnce();

      expect(discovered).toBe(49152);
      expect(service.getPort()).toBe(49152);
    });

    it("should stop and dispose cleanly without memory leaks", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 50,
      });

      await service.start();
      expect(() => service.stop()).not.toThrow();
      expect(() => service.dispose()).not.toThrow();
    });

    it("should expose getLogPath and handle setRestarting false transition", () => {
      service = new PortDiscoveryService({ logPath: testLogPath });
      expect(service.getLogPath()).toBe(testLogPath);

      service.setRestarting(true, 54321);
      expect(service.isRestarting()).toBe(true);
      expect(service.getStalePort()).toBe(54321);

      service.setRestarting(false);
      expect(service.isRestarting()).toBe(false);
      expect(service.getStalePort()).toBeNull();
    });

    it("should safely return null from readPortFromLogSync when log path is invalid or unreadable", () => {
      service = new PortDiscoveryService({
        logPath: path.join(tempDir, "non-existent.log"),
      });
      expect(service.readPortFromLogSync()).toBeNull();
    });

    it("should safely catch read errors in readPortFromLogSync and return null", () => {
      service = new PortDiscoveryService({ logPath: testLogPath });
      fs.writeFileSync(testLogPath, "hello");
      const statSpy = vi.spyOn(fs, "statSync").mockImplementationOnce(() => {
        throw new Error("Disk error");
      });
      expect(service.readPortFromLogSync()).toBeNull();
      statSpy.mockRestore();
    });

    it("AC-02: should resolve target-aware default log paths for app vs ide", () => {
      const appPath = getDefaultLogPath("app");
      const idePath = getDefaultLogPath("ide");
      expect(appPath).toContain("Antigravity");
      expect(idePath).toContain("Antigravity IDE");
      expect(appPath).not.toBe(idePath);
    });

    it("AC-02: should dynamically retarget to a different application target and log path", () => {
      service = new PortDiscoveryService({
        appTarget: "app",
        logPath: testLogPath,
      });
      expect(service.getAppTarget()).toBe("app");
      expect(service.getLogPath()).toBe(testLogPath);

      const ideLogPath = path.join(tempDir, "ide-main.log");
      service.retarget("ide", ideLogPath);

      expect(service.getAppTarget()).toBe("ide");
      expect(service.getLogPath()).toBe(ideLogPath);
      expect(service.getPort()).toBeNull();
      expect(service.getStalePort()).toBeNull();
    });

    it("AC-04: should reject same-port rebind within quiet window (<5000ms)", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => true,
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:55555/\n",
        "utf-8",
      );

      service.setRestarting(true, 55555);
      expect(service.isRestarting()).toBe(true);

      // Check immediately within quiet window
      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.isRestarting()).toBe(true);
      expect(service.getStalePort()).toBe(55555);
    });

    it("AC-04: should reject same-port rebind while process is still terminating even after quiet window (>=5000ms)", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => true,
        isProcessTerminating: () => true,
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:55555/\n",
        "utf-8",
      );

      service.setRestarting(true, 55555);
      (service as any).restartingStartedAt = Date.now() - 6000;

      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.isRestarting()).toBe(true);
      expect(service.getStalePort()).toBe(55555); // Still preserved

      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_port_discovery_stale_rejected",
            stalePort: 55555,
            reason: "old_process_still_terminating",
          }),
        ]),
      );
    });

    it("AC-04: should accept same-port rebind after quiet window (>=5000ms) when probe succeeds and process is not terminating", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => true,
        isProcessTerminating: () => false,
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:55555/\n",
        "utf-8",
      );

      service.setRestarting(true, 55555);

      // Fast-forward restartingStartedAt beyond quiet window (>= 5000ms)
      (service as any).restartingStartedAt = Date.now() - 5500;

      let portChangedEvent: { oldPort: number | null; newPort: number } | null = null;
      service.on("port-changed", (evt) => {
        portChangedEvent = evt;
      });

      const result = await service.checkOnce();
      expect(result).toBe(55555);
      expect(service.getPort()).toBe(55555);
      expect(service.isRestarting()).toBe(false);
      expect(service.getStalePort()).toBeNull();
      expect(portChangedEvent).toEqual({ oldPort: null, newPort: 55555 });
    });

    it("AC-04: should clear stalePort after TTL (>=15000ms) even if probe fails", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => false,
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:55555/\n",
        "utf-8",
      );

      service.setRestarting(true, 55555);
      (service as any).restartingStartedAt = Date.now() - 16000;

      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.getStalePort()).toBeNull(); // TTL expired and cleared
    });

    it("AC-03: should suppress port discovery if active readiness probe fails", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => false, // probe says socket not ready
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:56789/\n",
        "utf-8",
      );

      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.getPort()).toBeNull();
      expect(service.isDiscovered()).toBe(false);
    });

    it("should reject same-port rebind after quiet window when isProcessAlive returns true", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => true,
        isProcessAlive: async () => true,
      });

      fs.writeFileSync(
        testLogPath,
        "listening on https://127.0.0.1:55555/\n",
        "utf-8",
      );

      service.setRestarting(true, 55555);
      (service as any).restartingStartedAt = Date.now() - 6000;

      let staleRejectedEvent: any = null;
      service.on("stale-port-rejected", (evt) => {
        staleRejectedEvent = evt;
      });

      const result = await service.checkOnce();
      expect(result).toBeNull();
      expect(service.isRestarting()).toBe(true);
      expect(service.getStalePort()).toBe(55555);
      expect(staleRejectedEvent).toEqual({
        stalePort: 55555,
        discoveredPort: 55555,
        reason: "old_process_still_terminating",
      });

      const history = chatResumeEvents.getTelemetryHistory();
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "chat_port_discovery_stale_rejected",
            stalePort: 55555,
            reason: "old_process_still_terminating",
          }),
        ]),
      );
    });
  });

  describe("defaultTlsReadinessProbe", () => {
    it("returns false when port is unreachable or connection fails", async () => {
      const ready = await defaultTlsReadinessProbe(65431, 80, 20);
      expect(ready).toBe(false);
    });

    it("returns true when tls socket connects successfully", async () => {
      const { EventEmitter } = await import("node:events");
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroy = vi.fn();
      mockSocket.removeAllListeners = vi.fn();
      const connectSpy = vi
        .spyOn(tls, "connect")
        .mockReturnValueOnce(mockSocket);

      const probePromise = defaultTlsReadinessProbe(54321, 500, 20);
      mockSocket.emit("secureConnect");

      const ready = await probePromise;
      expect(ready).toBe(true);
      expect(mockSocket.destroy).toHaveBeenCalled();
      connectSpy.mockRestore();
    });

    it("retries and returns false when tls socket emits error or timeout", async () => {
      const { EventEmitter } = await import("node:events");
      const connectSpy = vi.spyOn(tls, "connect").mockImplementation(() => {
        const s = new EventEmitter() as any;
        s.destroy = vi.fn();
        s.removeAllListeners = vi.fn();
        setTimeout(() => s.emit("error", new Error("TLS fail")), 5);
        return s;
      });

      const ready = await defaultTlsReadinessProbe(54321, 60, 20);
      expect(ready).toBe(false);
      connectSpy.mockRestore();
    });
  });

  describe("getDefaultLogPath Cross-Platform", () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    });

    it("returns Darwin paths for app and ide", () => {
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      expect(getDefaultLogPath("app")).toBe(
        path.join(os.homedir(), "Library/Logs/Antigravity/main.log"),
      );
      expect(getDefaultLogPath("ide")).toBe(
        path.join(os.homedir(), "Library/Logs/Antigravity IDE/main.log"),
      );
    });

    it("returns Windows paths for app and ide with APPDATA env", () => {
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });
      const originalAppData = process.env.APPDATA;
      process.env.APPDATA = "C:\\Users\\Test\\AppData\\Roaming";
      try {
        expect(getDefaultLogPath("app")).toBe(
          path.join(
            "C:\\Users\\Test\\AppData\\Roaming",
            "Antigravity/logs/main.log",
          ),
        );
        expect(getDefaultLogPath("ide")).toBe(
          path.join(
            "C:\\Users\\Test\\AppData\\Roaming",
            "Antigravity IDE/logs/main.log",
          ),
        );
      } finally {
        process.env.APPDATA = originalAppData;
      }
    });

    it("returns Linux paths for app and ide", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
      expect(getDefaultLogPath("app")).toBe(
        path.join(os.homedir(), ".config/Antigravity/logs/main.log"),
      );
      expect(getDefaultLogPath("ide")).toBe(
        path.join(os.homedir(), ".config/Antigravity IDE/logs/main.log"),
      );
    });
  });

  describe("Chunked File Reading for Large Logs", () => {
    it("reads last 64KB chunk in readPortFromLogSync when log file exceeds 65536 bytes", () => {
      service = new PortDiscoveryService({ logPath: testLogPath });
      const padding = "A".repeat(70_000) + "\n";
      const portLog = "listening on https://127.0.0.1:58765/\n";
      fs.writeFileSync(testLogPath, padding + portLog, "utf-8");

      const port = service.readPortFromLogSync();
      expect(port).toBe(58765);
    });

    it("reads last 64KB chunk in checkOnce when log file exceeds 65536 bytes", async () => {
      service = new PortDiscoveryService({
        logPath: testLogPath,
        readinessProbe: async () => true,
      });
      const padding = "B".repeat(70_000) + "\n";
      const portLog = "listening on https://127.0.0.1:59123/\n";
      fs.writeFileSync(testLogPath, padding + portLog, "utf-8");

      const port = await service.checkOnce();
      expect(port).toBe(59123);
      expect(service.getPort()).toBe(59123);
    });
  });

  describe("File Watcher Interactions", () => {
    it("handles file watcher error event cleanly without throwing and clears reference", async () => {
      fs.writeFileSync(testLogPath, "initial log\n");

      service = new PortDiscoveryService({
        logPath: testLogPath,
        pollIntervalMs: 200,
        readinessProbe: async () => true,
      });

      await service.start();
      const fileWatcher = (service as any).fileWatcher;
      expect(fileWatcher).not.toBeNull();

      expect(() => {
        fileWatcher.emit("error", new Error("EPERM"));
      }).not.toThrow();

      expect((service as any).fileWatcher).toBeNull();
    });

    it("creates dirWatcher when log file does not exist, and tears down cleanly on stop()", async () => {
      const nonExistentPath = path.join(tempDir, "sub", "main.log");
      fs.mkdirSync(path.join(tempDir, "sub"));

      service = new PortDiscoveryService({
        logPath: nonExistentPath,
        pollIntervalMs: 500,
      });

      await service.start();
      expect((service as any).dirWatcher).not.toBeNull();

      service.stop();
      expect((service as any).dirWatcher).toBeNull();
      expect((service as any).fileWatcher).toBeNull();
    });
  });
});
