import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  PortDiscoveryService,
  parsePortFromLog,
  getDefaultLogPath,
} from "@/modules/relay/port-discovery";

describe("PortDiscoveryService", () => {
  let tempDir: string;
  let testLogPath: string;
  let service: PortDiscoveryService;

  beforeEach(() => {
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
  });
});
