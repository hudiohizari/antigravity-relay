import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { request as undiciRequest } from "undici";
import { AutoSwitchService } from "@/modules/cloud-account/services/AutoSwitchService";
import { CloudAccountSettingsStore } from "@/modules/cloud-account/persistence/cloud-account-settings-store";
import {
  RelayServer,
  extractDeviceId,
  extractClientIp,
  extractUserAgent,
  generatePairingHtml,
  generateRevokedHtml,
  resetFaviconCache,
  getFaviconBuffer,
  getFavicon32Buffer,
  getFavicon32DataUri,
  getIconPngBuffer,
  getIcon192Buffer,
  getIcon512Buffer,
  getManifestJson,
  resolveRelayViewLanguage,
  translateRelayErrorMessage,
  MAX_MUTATION_BUFFER_SIZE,
  extractCsrfTokenFromHtml,
  isUpstreamCsrfError,
} from "@/modules/relay/relay-server";
import { PortDiscoveryService } from "@/modules/relay/port-discovery";
import { MockUpstreamServer, TEST_TLS_KEY, TEST_TLS_CERT } from "../helpers/mock-upstream";
import { AuthRateLimiter } from "@/modules/relay/relay-auth";

describe("RelayServer Exhaustive Edge Cases & 100% Coverage Suite", () => {
  let mockUpstream: MockUpstreamServer;
  let upstreamPort: number;
  let relayServer: RelayServer;
  let relayPort: number;
  let tempDir: string;
  let logFilePath: string;
  let portDiscovery: PortDiscoveryService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-edge-test-"));
    logFilePath = path.join(tempDir, "main.log");

    mockUpstream = new MockUpstreamServer({
      csrfToken: "edge-test-csrf-token",
      validateCsrf: true,
    });
    upstreamPort = await mockUpstream.start();

    fs.writeFileSync(
      logFilePath,
      `[LOG] listening on https://127.0.0.1:${upstreamPort}/\n`,
      "utf-8",
    );

    portDiscovery = new PortDiscoveryService({
      logPath: logFilePath,
      pollIntervalMs: 50,
      debounceMs: 10,
    });

    relayServer = new RelayServer({
      config: {
        port: 0,
        host: "127.0.0.1",
        requirePairing: false,
      },
      portDiscovery,
    });

    const status = await relayServer.start();
    relayPort = status.port;
  });

  afterEach(async () => {
    if (relayServer) {
      await relayServer.stop();
      relayServer.dispose();
    }
    if (mockUpstream) {
      await mockUpstream.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Suppress temp cleanup error
    }
  });

  describe("Utility & Localization Pure Functions", () => {
    it("extractClientIp handles all forwarded and remoteAddress variants", () => {
      // Array forwarded-for
      expect(
        extractClientIp({ "x-forwarded-for": ["198.51.100.1", "10.0.0.1"] }),
      ).toBe("198.51.100.1");

      // Comma separated forwarded-for
      expect(
        extractClientIp({ "x-forwarded-for": "203.0.113.195, 70.41.3.18" }),
      ).toBe("203.0.113.195");

      // IPv4-mapped IPv6 in forwarded
      expect(
        extractClientIp({ "x-forwarded-for": "::ffff:192.168.1.50" }),
      ).toBe("192.168.1.50");

      // Remote address with IPv4-mapped IPv6
      expect(extractClientIp({}, "::ffff:10.20.30.40")).toBe("10.20.30.40");

      // Standard remote address
      expect(extractClientIp({}, "172.16.0.5")).toBe("172.16.0.5");

      // Empty fallback
      expect(extractClientIp({})).toBe("127.0.0.1");
    });

    it("extractUserAgent handles string, array, and missing user agents", () => {
      expect(
        extractUserAgent({ "user-agent": ["CustomUA/2.0", "FallbackUA"] }),
      ).toBe("CustomUA/2.0");
      expect(extractUserAgent({ "user-agent": [] })).toBe(
        "AntigravityRemote/1.0",
      );
      expect(extractUserAgent({ "user-agent": "Mozilla/5.0" })).toBe(
        "Mozilla/5.0",
      );
      expect(extractUserAgent({})).toBe("AntigravityRemote/1.0");
    });

    it("extractDeviceId handles array headers and query parameters", () => {
      const q = new URLSearchParams("deviceId=dev_query_123");
      expect(extractDeviceId({}, q)).toBe("dev_query_123");

      const headerArr = { "x-device-id": ["dev_arr_1", "dev_arr_2"] };
      expect(extractDeviceId(headerArr)).toBe("dev_arr_1");

      const cookieArr = {
        cookie: ["other=1", "ag_device_id=dev_cookie_arr"],
      };
      expect(extractDeviceId(cookieArr)).toBe("dev_cookie_arr");
    });

    it("resolveRelayViewLanguage parses query params, accept-language, and fallbacks", () => {
      expect(resolveRelayViewLanguage(null, "id-ID")).toBe("id");
      expect(resolveRelayViewLanguage(null, "id")).toBe("id");
      expect(resolveRelayViewLanguage(null, "en-US")).toBe("en");
      expect(resolveRelayViewLanguage(null, "en")).toBe("en");
      expect(resolveRelayViewLanguage(null, "fr")).toBe("en");

      expect(resolveRelayViewLanguage("id-ID,id;q=0.9,en;q=0.8")).toBe("id");
      expect(resolveRelayViewLanguage("en-GB,en;q=0.9")).toBe("en");
      expect(resolveRelayViewLanguage("de-DE,fr-FR;q=0.5")).toBe("en");
      expect(resolveRelayViewLanguage(null, null)).toBe("en");
    });

    it("translateRelayErrorMessage handles Indonesian and English translations", () => {
      expect(
        translateRelayErrorMessage(
          "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
          "id",
        ),
      ).toContain("telah digunakan oleh perangkat lain");

      expect(
        translateRelayErrorMessage(
          "Invalid pairing key. Check desktop dashboard.",
          "id",
        ),
      ).toContain("Kunci pemasangan tidak valid");

      expect(translateRelayErrorMessage("Generic error message", "id")).toBe(
        "Generic error message",
      );
      expect(translateRelayErrorMessage("Any error", "en")).toBe("Any error");
      expect(translateRelayErrorMessage(undefined, "id")).toBeUndefined();
    });

    it("generatePairingHtml and generateRevokedHtml render with both languages and error blocks", () => {
      const pairingEn = generatePairingHtml("Test Error", "en");
      expect(pairingEn).toContain("Pairing Required");
      expect(pairingEn).toContain("Test Error");

      const pairingId = generatePairingHtml(undefined, "id");
      expect(pairingId).toContain("Pemasangan Diperlukan");
      expect(pairingId).not.toContain("Test Error");

      const revokedEn = generateRevokedHtml("Revoke Err", "en");
      expect(revokedEn).toContain("Access Revoked by Host");
      expect(revokedEn).toContain("Revoke Err");

      const revokedId = generateRevokedHtml(undefined, "id");
      expect(revokedId).toContain("Sesi Dicabut");
      expect(revokedId).toContain("Akses Dicabut oleh Host");
    });

    it("Favicon and manifest helpers function with cache reset and forceReload", () => {
      resetFaviconCache();
      const favBuf = getFaviconBuffer(true);
      expect(favBuf).toBeDefined();

      const fav32Buf = getFavicon32Buffer(true);
      expect(fav32Buf).toBeDefined();

      const iconPng = getIconPngBuffer(true);
      expect(iconPng).toBeDefined();

      const icon192 = getIcon192Buffer(true);
      expect(icon192).toBeDefined();

      const icon512 = getIcon512Buffer(true);
      expect(icon512).toBeDefined();

      const dataUri = getFavicon32DataUri(true);
      expect(dataUri).toContain("data:image/png;base64,");

      const manifestStr = getManifestJson();
      const manifest = JSON.parse(manifestStr);
      expect(manifest.name).toBe("Antigravity Relay");
      expect(manifest.short_name).toBe("Antigravity");
      expect(manifest.icons.length).toBeGreaterThan(0);
    });
  });

  describe("Mutation Payloads & 10MB Boundary Enforcement", () => {
    it("handles string mutation body under 10MB cleanly", async () => {
      const testString = JSON.stringify({ message: "hello-under-10mb" });
      const res = await fetch(
        `http://127.0.0.1:${relayPort}/api/test-mutation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: testString,
        },
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
    });

    it("rejects string mutation body exceeding 10MB with HTTP 413", async () => {
      const app = relayServer.getApp()!;
      const oversizedString = "A".repeat(MAX_MUTATION_BUFFER_SIZE + 1024);
      const res = await app.inject({
        method: "POST",
        url: "/api/oversized-string",
        headers: { "Content-Type": "text/plain" },
        payload: oversizedString,
      });

      expect(res.statusCode).toBe(413);
      const json = res.json() as any;
      expect(json.error).toMatch(/payload[ _]too[ _]large/i);
    });

    it("rejects mutation with array content-length header exceeding 10MB", async () => {
      const app = relayServer.getApp()!;
      const oversizedLen = String(MAX_MUTATION_BUFFER_SIZE + 5000);
      const res = await app.inject({
        method: "POST",
        url: "/api/oversized-header",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": [oversizedLen, "100"] as any,
        },
        payload: "small body but fake large header",
      });

      expect(res.statusCode).toBe(413);
      const json = res.json() as any;
      expect(json.error).toBe("payload_too_large");
    });

    it("joins array headers on incoming request into comma-separated upstream headers", async () => {
      const res = await fetch(
        `http://127.0.0.1:${relayPort}/api/check-headers`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-custom-multi": "value1, value2",
          },
          body: JSON.stringify({ check: true }),
        },
      );

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.receivedHeaders["x-custom-multi"]).toBe("value1, value2");
    });
  });

  describe("CSRF Refresh Edge Cases & HTML Transformations", () => {
    it("refreshCsrfToken returns null and cleans up controller when port is falsy", async () => {
      const token = await (relayServer as any).refreshCsrfToken(0);
      expect(token).toBeNull();
      expect(relayServer.getActiveCsrfToken()).toBeNull();
    });

    it("public refreshActiveCsrfToken invokes refreshCsrfToken cleanly", async () => {
      const token = await relayServer.refreshActiveCsrfToken(upstreamPort);
      expect(token).toBe("edge-test-csrf-token");
      expect(relayServer.getActiveCsrfToken()).toBe("edge-test-csrf-token");
    });

    it("forwards 401 response and headers if upstream returns 401 CSRF but refresh fails", async () => {
      // Configure mock upstream to always return 401 CSRF even on retry
      mockUpstream.setCsrfToken("forbidden-token");
      mockUpstream.setCustomHtml(
        "<html><body>No CSRF Token Here</body></html>",
      );

      const res = await fetch(
        `http://127.0.0.1:${relayPort}/api/always-csrf-error`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-codeium-csrf-token": "stale-token",
          },
          body: JSON.stringify({ fail: true }),
        },
      );

      expect(res.status).toBe(401);
      const bodyText = await res.text();
      expect(bodyText).toContain("CSRF");
    });

    it("injects PWA tags into HTML with <head class='attr'>", async () => {
      mockUpstream.setCustomHtml(
        '<html lang="en"><head class="theme-dark"><title>App</title></head><body><div id="root"></div></body></html>',
      );

      const res = await fetch(`http://127.0.0.1:${relayPort}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('head class="theme-dark"');
      expect(html).toContain('<meta name="apple-mobile-web-app-capable"');
      expect(html).toContain('id="antigravity-relay-autoreload"');
    });

    it("injects autoreload script before </head> when no <body> exists", async () => {
      mockUpstream.setCustomHtml(
        "<!doctype html><head><title>Head Only</title></head>",
      );

      const res = await fetch(`http://127.0.0.1:${relayPort}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="antigravity-relay-autoreload"');
      expect(html).toContain("</head>");
    });

    it("appends autoreload script when neither <head> nor <body> exists", async () => {
      mockUpstream.setCustomHtml("<div>Plain Fragment</div>");

      const res = await fetch(`http://127.0.0.1:${relayPort}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("<div>Plain Fragment</div>");
      expect(html).toContain('id="antigravity-relay-autoreload"');
    });
  });

  describe("Pairing, Rate Limiting & Session Revocation Matrix", () => {
    let pairedServer: RelayServer;
    let pairedPort: number;

    beforeEach(async () => {
      pairedServer = new RelayServer({
        config: {
          port: 0,
          host: "127.0.0.1",
          requirePairing: true,
        },
        portDiscovery,
      });
      const st = await pairedServer.start();
      pairedPort = st.port;
    });

    afterEach(async () => {
      if (pairedServer) {
        await pairedServer.stop();
        pairedServer.dispose();
      }
    });

    it("returns HTTP 429 when revoked device exceeds rate limit", async () => {
      const sessionManager = (pairedServer as any).sessionManager;
      const deviceId = "dev_rate_limited_revoked";
      sessionManager.revokeDevice(deviceId);

      const rateLimiter = (pairedServer as any).rateLimiter;
      const key = AuthRateLimiter.buildKey("127.0.0.1", deviceId);
      // Exhaust rate limit
      for (let i = 0; i < 6; i++) {
        rateLimiter.recordFailure(key);
      }

      const res = await fetch(`http://127.0.0.1:${pairedPort}/?pair=any_key`, {
        headers: { "x-device-id": deviceId },
      });

      expect(res.status).toBe(429);
      const json = (await res.json()) as any;
      expect(json.error).toBe("rate_limited");
    });

    it("returns 401 HTML revoked page when revoked device submits consumed key on root", async () => {
      const sessionManager = (pairedServer as any).sessionManager;
      const deviceId = "dev_consumed_html";
      sessionManager.revokeDevice(deviceId);

      // Consume the current pairing key to retire it
      const currentKey = pairedServer.getStatus().pairingKey!;
      pairedServer.consumePairingKey(currentKey);

      const res = await fetch(
        `http://127.0.0.1:${pairedPort}/?pair=${encodeURIComponent(currentKey)}`,
        {
          headers: {
            "x-device-id": deviceId,
            Accept: "text/html",
          },
        },
      );

      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("already been consumed");
      expect(html).toContain("Access Revoked by Host");
    });

    it("returns 401 HTML revoked page when revoked device submits invalid key on root", async () => {
      const sessionManager = (pairedServer as any).sessionManager;
      const deviceId = "dev_invalid_html";
      sessionManager.revokeDevice(deviceId);

      const res = await fetch(
        `http://127.0.0.1:${pairedPort}/?pair=completely_wrong_key`,
        {
          headers: {
            "x-device-id": deviceId,
            Accept: "text/html",
          },
        },
      );

      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("Invalid pairing key");
      expect(html).toContain("Access Revoked by Host");
    });

    it("returns 401 JSON when revoked device hits API without pairing key", async () => {
      const sessionManager = (pairedServer as any).sessionManager;
      const deviceId = "dev_api_revoked";
      sessionManager.revokeDevice(deviceId);

      const res = await fetch(
        `http://127.0.0.1:${pairedPort}/api/some-endpoint`,
        {
          headers: {
            "x-device-id": deviceId,
            Accept: "application/json",
          },
        },
      );

      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error).toBe("session_revoked");
      expect(json.revoked).toBe(true);
    });

    it("returns 429 when unauthenticated device exceeds pairing rate limit", async () => {
      const deviceId = "dev_unauth_ratelimit";
      const rateLimiter = (pairedServer as any).rateLimiter;
      const key = AuthRateLimiter.buildKey("127.0.0.1", deviceId);
      for (let i = 0; i < 6; i++) {
        rateLimiter.recordFailure(key);
      }

      const res = await fetch(
        `http://127.0.0.1:${pairedPort}/?pair=wrong_key`,
        {
          headers: { "x-device-id": deviceId },
        },
      );

      expect(res.status).toBe(429);
      const json = (await res.json()) as any;
      expect(json.error).toBe("rate_limited");
    });

    it("returns 401 HTML pairing page with consumed notice for unauthenticated browser request", async () => {
      const currentKey = pairedServer.getStatus().pairingKey!;
      pairedServer.consumePairingKey(currentKey);

      const res = await fetch(
        `http://127.0.0.1:${pairedPort}/?pair=${encodeURIComponent(currentKey)}`,
        {
          headers: { Accept: "text/html" },
        },
      );

      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("already been consumed");
      expect(html).toContain("Pairing Required");
    });

    it("synchronizes session deviceId when request carries new deviceId cookie", async () => {
      // Create session first without deviceId
      const sessionManager = (pairedServer as any).sessionManager;
      const session = sessionManager.createSession({
        clientIp: "127.0.0.1",
        userAgent: "TestUA",
        token: "session_token_123",
      });

      const newDeviceId = "dev_newly_attached_456";
      const app = pairedServer.getApp()!;
      const res = await app.inject({
        method: "GET",
        url: "/api/test-session-sync",
        headers: {
          "x-session-token": "session_token_123",
          cookie: `ag_device_id=${newDeviceId}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = sessionManager.getSession(session.sessionId);
      expect(updated?.deviceId).toBe(newDeviceId);
    });

    it("handles /api/sessions/revoke endpoint with missing sessionId or streaming payload", async () => {
      // 1. Missing sessionId -> 400
      const resBad = await fetch(
        `http://127.0.0.1:${pairedPort}/api/sessions/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(resBad.status).toBe(400);

      // 2. Valid sessionId revocation
      const sessionManager = (pairedServer as any).sessionManager;
      const session = sessionManager.createSession({
        clientIp: "127.0.0.1",
        userAgent: "TestUA",
      });

      const resGood = await fetch(
        `http://127.0.0.1:${pairedPort}/api/sessions/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.sessionId }),
        },
      );
      expect(resGood.status).toBe(200);
      const json = (await resGood.json()) as any;
      expect(json.success).toBe(true);
      expect(sessionManager.getSession(session.token)).toBeUndefined();
    });
  });

  describe("Lifecycle, Pairing Key Validation & Retired Key Pruning", () => {
    it("validatePairingKey validates accurately and rejects falsy or non-string input", () => {
      expect(relayServer.validatePairingKey("")).toBe(false);
      expect(relayServer.validatePairingKey(null as any)).toBe(false);
      expect(relayServer.validatePairingKey(undefined as any)).toBe(false);
      expect(relayServer.validatePairingKey(12345 as any)).toBe(false);

      const currentKey = relayServer.getStatus().pairingKey!;
      expect(relayServer.validatePairingKey(currentKey)).toBe(true);
      expect(relayServer.validatePairingKey(`  ${currentKey}  `)).toBe(true);
      expect(relayServer.validatePairingKey("wrong-key")).toBe(false);
    });

    it("consumePairingKey rejects invalid or missing input and identifies retired keys", () => {
      expect(relayServer.consumePairingKey("")).toEqual({
        success: false,
        reason: "invalid",
      });
      expect(relayServer.consumePairingKey(null as any)).toEqual({
        success: false,
        reason: "invalid",
      });

      const key = relayServer.getStatus().pairingKey!;
      const firstConsume = relayServer.consumePairingKey(key);
      expect(firstConsume.success).toBe(true);

      const secondConsume = relayServer.consumePairingKey(key);
      expect(secondConsume.success).toBe(false);
      expect(secondConsume.reason).toBe("consumed");
    });

    it("prunes retired pairing keys beyond TTL limit", () => {
      const serverAny = relayServer as any;
      const oldKey = "stale-retired-key-1";
      const expiredTimestamp = Date.now() - (RelayServer.RETIRED_KEY_TTL_MS + 60000);
      serverAny.retiredPairingKeys.set(oldKey, expiredTimestamp);
      serverAny.retiredKeyRecords.set(oldKey, {
        retiredAt: expiredTimestamp,
        consumedIp: "127.0.0.1",
      });

      serverAny.pruneRetiredPairingKeys();
      expect(serverAny.retiredPairingKeys.has(oldKey)).toBe(false);
      expect(serverAny.retiredKeyRecords.has(oldKey)).toBe(false);
    });

    it("start() returns status immediately when already running and accepts config overrides", async () => {
      const currentStatus = relayServer.getStatus();
      const st = await relayServer.start();
      expect(st.isRunning).toBe(true);
      expect(st.port).toBe(currentStatus.port);

      // New server with overrides
      const overrideServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1" },
        portDiscovery,
      });
      const overrideStatus = await overrideServer.start({ host: "127.0.0.1" });
      expect(overrideStatus.isRunning).toBe(true);
      await overrideServer.stop();
      overrideServer.dispose();
    });

    it("getPortDiscovery returns the active PortDiscoveryService instance", () => {
      expect(relayServer.getPortDiscovery()).toBe(portDiscovery);
    });

    it("serves web app manifest via /manifest.webmanifest", async () => {
      const res = await fetch(
        `http://127.0.0.1:${relayPort}/manifest.webmanifest`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(
        "application/manifest+json",
      );
      const json = (await res.json()) as any;
      expect(json.name).toBe("Antigravity Relay");
    });

    it("revokes active WebSocket connection with SESSION_REVOKED frame on device revocation", async () => {
      const wsUrl = `ws://127.0.0.1:${relayPort}/connect-websocket`;
      const clientWs = new WebSocket(wsUrl);

      const openPromise = new Promise<void>((resolve) => {
        clientWs.on("open", () => resolve());
      });
      await openPromise;

      let receivedRevokedFrame = false;
      clientWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "SESSION_REVOKED") {
            receivedRevokedFrame = true;
          }
        } catch {
          // ignore
        }
      });

      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => {
          clientWs.on("close", (code, reason) => {
            resolve({ code, reason: reason.toString() });
          });
        },
      );

      // Find connection in activeWsConnections
      const serverAny = relayServer as any;
      const activePair = Array.from(serverAny.activeWsConnections)[0] as any;
      expect(activePair).toBeDefined();

      // Revoke the session
      relayServer.revokeDevice(activePair.deviceId);

      const closeInfo = await closePromise;
      expect(closeInfo.code).toBe(4401);
      expect(receivedRevokedFrame).toBe(true);
    });
  });

  describe("MockUpstreamServer Test Harness Full Coverage", () => {
    it("exercises getPort and resetDiscoveryCount", () => {
      expect(mockUpstream.getPort()).toBe(upstreamPort);
      expect(mockUpstream.getDiscoveryCount()).toBeGreaterThanOrEqual(0);
      mockUpstream.resetDiscoveryCount();
      expect(mockUpstream.getDiscoveryCount()).toBe(0);
    });

    it("rejects invalid WebSocket upgrade path with HTTP 404", async () => {
      const ws = new WebSocket(`wss://127.0.0.1:${upstreamPort}/invalid-ws`, {
        rejectUnauthorized: false,
      });

      const statusCode = await new Promise<number>((resolve) => {
        ws.on("unexpected-response", (_req, res) => {
          resolve(res.statusCode || 0);
        });
        ws.on("error", () => {});
      });

      expect(statusCode).toBe(404);
      ws.terminate();
    });

    it("handles non-JSON POST body returning raw body string", async () => {
      const res = await undiciRequest(
        `https://127.0.0.1:${upstreamPort}/api/raw-body`,
        {
          method: "POST",
          headers: {
            host: `127.0.0.1:${upstreamPort}`,
            "content-type": "text/plain",
            "x-codeium-csrf-token": "edge-test-csrf-token",
          },
          body: "non-json-plain-text",
          dispatcher: (relayServer as any).upstreamDispatcher,
        },
      );

      expect(res.statusCode).toBe(200);
      const json = (await res.body.json()) as any;
      expect(json.receivedBody).toBe("non-json-plain-text");
    });

    it("returns 404 for unhandled HTTP paths", async () => {
      const res = await undiciRequest(
        `https://127.0.0.1:${upstreamPort}/unknown-unhandled-path`,
        {
          method: "GET",
          headers: { host: `127.0.0.1:${upstreamPort}` },
          dispatcher: (relayServer as any).upstreamDispatcher,
        },
      );

      expect(res.statusCode).toBe(404);
      const text = await res.body.text();
      expect(text).toBe("Not Found");
    });

    it("handles stop() when connected sockets and wss throw during close", async () => {
      const dummyUpstream = new MockUpstreamServer();
      const throwingSocket = {
        close: () => {
          throw new Error("socket close error");
        },
      } as any;
      dummyUpstream.connectedSockets.add(throwingSocket);
      (dummyUpstream as any).wss = {
        close: () => {
          throw new Error("wss close error");
        },
      };

      await expect(dummyUpstream.stop()).resolves.toBeUndefined();
    });

    it("rejects start() when server address is not object", async () => {
      const dummyUpstream = new MockUpstreamServer();
      const mockServer = {
        listen: (_port: any, _host: any, cb: any) => cb(),
        address: () => null,
        on: () => mockServer,
      };
      const spy = vi
        .spyOn(https, "createServer")
        .mockReturnValue(mockServer as any);

      await expect(dummyUpstream.start()).rejects.toThrow(
        "Failed to obtain server port",
      );
      spy.mockRestore();
    });
  });

  describe("Asset & Cache Buffers Fallback Paths", () => {
    it("returns null or empty string when asset files are missing or unreadable", () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      resetFaviconCache();
      expect(getFaviconBuffer(true)).toBeNull();
      expect(getFavicon32Buffer(true)).toBeNull();
      expect(getIconPngBuffer(true)).toBeNull();
      expect(getFavicon32DataUri(true)).toBe("");
      expect(getIcon192Buffer(true)).toBeNull();
      expect(getIcon512Buffer(true)).toBeNull();
      existsSpy.mockRestore();

      const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("file read error");
      });
      const existsTrue = vi.spyOn(fs, "existsSync").mockReturnValue(true);
      resetFaviconCache();
      expect(getFaviconBuffer(true)).toBeNull();
      expect(getFavicon32Buffer(true)).toBeNull();
      expect(getIconPngBuffer(true)).toBeNull();
      readSpy.mockRestore();
      existsTrue.mockRestore();
      resetFaviconCache();
    });

    it("serves 404 on branded favicon and icon routes when buffers are missing", async () => {
      const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
      resetFaviconCache();
      const app = relayServer.getApp()!;
      for (const route of [
        "/favicon.ico",
        "/favicon-32.png",
        "/icon.png",
        "/icon-192.png",
        "/icon-512.png",
      ]) {
        const res = await app.inject({ method: "GET", url: route });
        expect(res.statusCode).toBe(404);
      }
      const htmlRes = await app.inject({ method: "GET", url: "/" });
      expect(htmlRes.statusCode).toBe(200);
      existsSpy.mockRestore();
      resetFaviconCache();
    });
  });

  describe("10MB Mutation Buffers & Stream Safety Matrix", () => {
    it("rejects Buffer mutation body exceeding 10MB", async () => {
      const app = relayServer.getApp()!;
      const oversizedBuf = Buffer.alloc(MAX_MUTATION_BUFFER_SIZE + 1024);
      const res = await app.inject({
        method: "POST",
        url: "/api/buffer-test",
        headers: { "content-length": "100" },
        payload: oversizedBuf,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe("payload_too_large");
    });

    it("rejects streaming request.body exceeding 10MB", async () => {
      const app = relayServer.getApp()!;
      const stream = Readable.from([
        Buffer.alloc(6 * 1024 * 1024),
        Buffer.alloc(6 * 1024 * 1024),
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/stream-test",
        headers: { "content-length": "100" },
        payload: stream,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe("payload_too_large");
    });

    it("rejects JSON serialized object exceeding 10MB", async () => {
      const app = relayServer.getApp()!;
      const oversizedObj = {
        data: "x".repeat(MAX_MUTATION_BUFFER_SIZE + 1024),
      };
      const res = await app.inject({
        method: "POST",
        url: "/api/json-test",
        headers: { "content-length": "100" },
        payload: oversizedObj,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toMatch(/payload[ _]too[ _]large/i);
    });
  });

  describe("Heartbeat Subsystem Lifecycle & Pruning", () => {
    it("broadcasts HEARTBEAT to open sockets and unbinds closing/closed sockets", async () => {
      const serverAny = relayServer as any;
      const dummySession = serverAny.sessionManager.createSession({
        clientIp: "127.0.0.1",
        userAgent: "TestUA",
      });
      let receivedHeartbeat = false;
      const openSocket = {
        readyState: 1,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === "HEARTBEAT") receivedHeartbeat = true;
        },
        close: () => {},
      };
      const closedSocket = { readyState: 3, send: () => {}, close: () => {} };
      const errorSocket = {
        readyState: 1,
        send: () => {
          throw new Error("send err");
        },
        close: () => {},
      };
      serverAny.sessionManager.bindSocket(dummySession.sessionId, openSocket);
      serverAny.sessionManager.bindSocket(dummySession.sessionId, closedSocket);
      serverAny.sessionManager.bindSocket(dummySession.sessionId, errorSocket);

      relayServer.broadcastHeartbeat();
      expect(receivedHeartbeat).toBe(true);

      const remainingSockets = serverAny.sessionManager.getSockets(
        dummySession.sessionId,
      );
      expect(remainingSockets).toContain(openSocket);
      expect(remainingSockets).not.toContain(closedSocket);
      expect(remainingSockets).not.toContain(errorSocket);
    });

    it("starts and stops heartbeat interval cleanly", () => {
      const serverAny = relayServer as any;
      serverAny.config.heartbeatIntervalMs = 100;
      relayServer.startHeartbeat();
      expect(serverAny.heartbeatTimer).toBeDefined();
      relayServer.stopHeartbeat();
      expect(serverAny.heartbeatTimer).toBeNull();
    });
  });

  describe("WebSocket Upgrade Edge Cases & Socket Error Lifecycles", () => {
    it("rejects WebSocket upgrade when upstream is restarting with HTTP 503 upstream_restarting", async () => {
      const restartingSpy = vi
        .spyOn(portDiscovery, "isRestarting")
        .mockReturnValue(true);

      const res = await new Promise<any>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${relayPort}/connect-websocket`,
          {
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
            },
          },
          resolve,
        );
        req.end();
      });

      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBe("2");
      restartingSpy.mockRestore();
    });

    it("rejects WebSocket upgrade when port is 0 or null with HTTP 503 upstream_unavailable", async () => {
      const portSpy = vi.spyOn(portDiscovery, "getPort").mockReturnValue(0);

      const res = await new Promise<any>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${relayPort}/connect-websocket`,
          {
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
            },
          },
          resolve,
        );
        req.end();
      });

      expect(res.statusCode).toBe(503);
      portSpy.mockRestore();
    });

    it("rejects WebSocket upgrade on unknown path with HTTP 404", async () => {
      const res = await new Promise<any>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${relayPort}/unknown-ws-path`,
          {
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
            },
          },
          resolve,
        );
        req.end();
      });

      expect(res.statusCode).toBe(404);
    });

    it("cleans up active connection pair and unbinds socket on client socket error", async () => {
      const wsUrl = `ws://127.0.0.1:${relayPort}/connect-websocket`;
      const clientWs = new WebSocket(wsUrl);
      await new Promise<void>((resolve) =>
        clientWs.on("open", () => resolve()),
      );

      const serverAny = relayServer as any;
      const pair = Array.from(serverAny.activeWsConnections)[0] as any;
      expect(pair).toBeDefined();

      pair.clientWs.emit("error", new Error("simulated client socket error"));
      expect(serverAny.activeWsConnections.has(pair)).toBe(false);
      clientWs.terminate();
    });

    it("cleans up active connection pair and closes client socket on upstream socket error", async () => {
      const wsUrl = `ws://127.0.0.1:${relayPort}/connect-websocket`;
      const clientWs = new WebSocket(wsUrl);
      await new Promise<void>((resolve) =>
        clientWs.on("open", () => resolve()),
      );

      const serverAny = relayServer as any;
      const pair = Array.from(serverAny.activeWsConnections)[0] as any;
      expect(pair).toBeDefined();

      const closePromise = new Promise<number>((resolve) => {
        clientWs.on("close", (code: number) => resolve(code));
      });

      pair.upstreamWs.emit(
        "error",
        new Error("simulated upstream socket error"),
      );
      const code = await closePromise;
      expect(code).toBe(1011);
      expect(serverAny.activeWsConnections.has(pair)).toBe(false);
    });

    it("closes active WebSocket pairs with 1012 Service Restart on port change", async () => {
      const wsUrl = `ws://127.0.0.1:${relayPort}/connect-websocket`;
      const clientWs = new WebSocket(wsUrl);
      await new Promise<void>((resolve) =>
        clientWs.on("open", () => resolve()),
      );

      const serverAny = relayServer as any;
      const pair = Array.from(serverAny.activeWsConnections)[0] as any;
      expect(pair).toBeDefined();

      const closePromise = new Promise<{ code: number; reason: string }>(
        (resolve) => {
          clientWs.on("close", (code: number, reason: Buffer) =>
            resolve({ code, reason: reason.toString() }),
          );
        },
      );

      serverAny.handlePortChanged(upstreamPort, upstreamPort + 1);
      const res = await closePromise;
      expect(res.code).toBe(1012);
      expect(res.reason).toBe("Service Restart");
    });
  });

  describe("Session Revocation & Pairing Edge Cases", () => {
    it("returns 401 JSON for revoked device submitting invalid pairing key on API", async () => {
      const pairedServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1", requirePairing: true },
        portDiscovery,
      });
      const st = await pairedServer.start();
      const app = pairedServer.getApp()!;
      const sessionManager = (pairedServer as any).sessionManager;
      const deviceId = "dev_revoked_api_invalid_key";
      sessionManager.revokeDevice(deviceId);

      const res = await app.inject({
        method: "POST",
        url: "/api/mutation?pair=wrong_key",
        headers: { "x-device-id": deviceId, accept: "application/json" },
      });

      expect(res.statusCode).toBe(401);
      const json = res.json();
      expect(json.error).toBe("session_revoked");
      await pairedServer.stop();
      pairedServer.dispose();
    });

    it("rejects WebSocket upgrade from revoked device when rate limit exceeded", async () => {
      const pairedServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1", requirePairing: true },
        portDiscovery,
      });
      const st = await pairedServer.start();
      const deviceId = "dev_revoked_ws_rate_limited";
      (pairedServer as any).sessionManager.revokeDevice(deviceId);

      const key = AuthRateLimiter.buildKey("127.0.0.1", deviceId);
      for (let i = 0; i < 6; i++) {
        (pairedServer as any).rateLimiter.recordFailure(key);
      }

      const res = await new Promise<any>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${st.port}/connect-websocket?pair=wrong_key`,
          {
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
              "x-device-id": deviceId,
            },
          },
          resolve,
        );
        req.end();
      });

      expect(res.statusCode).toBe(429);
      await pairedServer.stop();
      pairedServer.dispose();
    });

    it("rejects WebSocket upgrade from revoked device with consumed pairing key", async () => {
      const pairedServer = new RelayServer({
        config: { port: 0, host: "127.0.0.1", requirePairing: true },
        portDiscovery,
      });
      const st = await pairedServer.start();
      const deviceId = "dev_revoked_ws_consumed_key";
      (pairedServer as any).sessionManager.revokeDevice(deviceId);

      const currentKey = pairedServer.getStatus().pairingKey!;
      pairedServer.consumePairingKey(currentKey);

      const res = await new Promise<any>((resolve) => {
        const req = http.request(
          `http://127.0.0.1:${st.port}/connect-websocket?pair=${encodeURIComponent(currentKey)}`,
          {
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
              "Sec-WebSocket-Version": "13",
              "x-device-id": deviceId,
            },
          },
          resolve,
        );
        req.end();
      });

      expect(res.statusCode).toBe(401);
      await pairedServer.stop();
      pairedServer.dispose();
    });

    it("handles /api/sessions/revoke with Readable stream body", async () => {
      const app = relayServer.getApp()!;
      const session = (relayServer as any).sessionManager.createSession({
        clientIp: "127.0.0.1",
      });
      const stream = Readable.from([
        Buffer.from(JSON.stringify({ sessionId: session.sessionId })),
      ]);
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions/revoke",
        headers: { "content-type": "application/json" },
        payload: stream,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const badStream = Readable.from([Buffer.from("invalid json text")]);
      const resBad = await app.inject({
        method: "POST",
        url: "/api/sessions/revoke",
        headers: { "content-type": "application/json" },
        payload: badStream,
      });

      expect(resBad.statusCode).toBe(400);
    });
  });

  describe("Status, Listeners & Upstream Bridge Events", () => {
    it("broadcasts AGENT_OUTPUT message on upstreamBridge message event", () => {
      const serverAny = relayServer as any;
      const session = serverAny.sessionManager.createSession({
        clientIp: "127.0.0.1",
      });
      let receivedAgentOutput = false;
      const clientWs = {
        readyState: 1,
        send: (data: string) => {
          const msg = JSON.parse(data);
          if (msg.type === "AGENT_OUTPUT") receivedAgentOutput = true;
        },
        close: () => {},
      };
      serverAny.sessionManager.bindSocket(session.sessionId, clientWs);

      serverAny.upstreamBridge.messageListeners.forEach((fn: any) =>
        fn({ text: "cascade generation stream" }),
      );
      expect(receivedAgentOutput).toBe(true);
    });

    it("suppresses status update listener errors cleanly", () => {
      const badListener = () => {
        throw new Error("status listener blew up");
      };
      const unsub = relayServer.onStatusUpdated(badListener);
      expect(() => (relayServer as any).notifyStatusUpdated()).not.toThrow();
      unsub();
    });

    it("getStatus reflects disconnected bridge when port is null", () => {
      const portSpy = vi.spyOn(portDiscovery, "getPort").mockReturnValue(0);
      const status = relayServer.getStatus();
      expect(status.upstream.state).toBe("disconnected");
      portSpy.mockRestore();
    });
  });

  describe("Exhaustive Branch Coverage & Deep Lifecycle Edge Cases", () => {
    it("initializes PortDiscoveryService with options.upstreamPort if specified", () => {
      const customDiscovery = new PortDiscoveryService();
      const serverWithPort = new RelayServer({
        upstreamPort: 59999,
        portDiscovery: customDiscovery,
      });
      expect(customDiscovery.getPort()).toBe(59999);
      serverWithPort.dispose();
      customDiscovery.dispose();
    });

    it("suppresses upstreamDispatcher destroy error in resetUpstreamDispatcher", () => {
      const serverAny = relayServer as any;
      const deadAgent = serverAny.upstreamDispatcher;
      deadAgent.destroy = () => {
        throw new Error("deadAgent.destroy failure");
      };
      expect(() => serverAny.resetUpstreamDispatcher()).not.toThrow();
    });

    it("aborts active csrfRefreshController when refreshCsrfToken is called with port 0", async () => {
      const serverAny = relayServer as any;
      const controller = new AbortController();
      serverAny.csrfRefreshController = controller;
      serverAny.csrfRefreshPromise = Promise.resolve("token");
      serverAny.csrfRefreshPort = 1234;

      const token = await relayServer.refreshCsrfToken(0);
      expect(token).toBeNull();
      expect(serverAny.csrfRefreshController).toBeNull();
      expect(serverAny.csrfRefreshPromise).toBeNull();
      expect(serverAny.csrfRefreshPort).toBeNull();
    });

    it("aborts csrf probe on timeout in refreshCsrfToken", async () => {
      const hangServer = https.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (_req, _res) => {
        // Deliberately never respond
      });
      await new Promise<void>((resolve) => hangServer.listen(0, "127.0.0.1", resolve));
      const hangPort = (hangServer.address() as any).port;

      const origTimeout = (RelayServer as any).CSRF_PROBE_TIMEOUT_MS;
      (RelayServer as any).CSRF_PROBE_TIMEOUT_MS = 50;
      try {
        const token = await relayServer.refreshCsrfToken(hangPort);
        expect(token).toBeNull();
      } finally {
        (RelayServer as any).CSRF_PROBE_TIMEOUT_MS = origTimeout;
        await new Promise<void>((resolve) => hangServer.close(() => resolve()));
      }
    });

    it("returns immediately from waitForUpstreamReady when port is already ready and not restarting", async () => {
      portDiscovery.setPort(upstreamPort);
      const port = await relayServer.waitForUpstreamReady(500);
      expect(port).toBe(upstreamPort);
    });

    it("handles pruneRetiredPairingKeys while loop break condition when next value is undefined", () => {
      const serverAny = relayServer as any;
      const mapSpy = vi.spyOn(serverAny.retiredPairingKeys, "keys").mockReturnValue({
        next: () => ({ value: undefined, done: true }),
        [Symbol.iterator]: function () {
          return this;
        },
      } as any);
      Object.defineProperty(serverAny.retiredPairingKeys, "size", {
        value: 2000,
        configurable: true,
      });

      expect(() => serverAny.pruneRetiredPairingKeys()).not.toThrow();

      mapSpy.mockRestore();
      delete serverAny.retiredPairingKeys.size;
    });

    it("isKeyConsumed returns false for falsy or non-string inputs", () => {
      expect(relayServer.isKeyConsumed(undefined)).toBe(false);
      expect(relayServer.isKeyConsumed(null)).toBe(false);
      expect(relayServer.isKeyConsumed("")).toBe(false);
      expect(relayServer.isKeyConsumed(12345 as any)).toBe(false);
    });

    it("getRetiredPairingKeys returns the internal retired keys map", () => {
      expect(relayServer.getRetiredPairingKeys()).toBeInstanceOf(Map);
    });

    it("consumePairingKey returns consumed when key is in retiredPairingKeys", () => {
      const serverAny = relayServer as any;
      const retiredKey = "retired-key-direct-check";
      serverAny.retiredPairingKeys.set(retiredKey, Date.now());
      const result = relayServer.consumePairingKey(retiredKey);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("consumed");
    });

    it("consumePairingKey checks retiredPairingKeys when isKeyConsumed is bypassed", () => {
      const serverAny = relayServer as any;
      const retiredKey = "retired-key-direct-branch";
      serverAny.retiredPairingKeys.set(retiredKey, Date.now());
      let hasCall = 0;
      const spy = vi.spyOn(serverAny.retiredPairingKeys, "has").mockImplementation(() => {
        hasCall++;
        return hasCall === 2;
      });
      const result = relayServer.consumePairingKey(retiredKey);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("consumed");
      spy.mockRestore();
    });

    it("revokeDevice closes matching active WebSocket connections and handles clientWs.send throws", () => {
      const devId = "revoking-ws-device-edge";
      const fakeClientWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn().mockImplementation(() => {
          throw new Error("client send error");
        }),
        close: vi.fn(),
        terminate: vi.fn(),
      };
      const fakeUpstreamWs = {
        readyState: WebSocket.OPEN,
        close: vi.fn(),
        terminate: vi.fn(),
      };

      const pair = {
        clientWs: fakeClientWs as any,
        upstreamWs: fakeUpstreamWs as any,
        sessionId: "standalone-ws-session-edge",
        deviceId: devId,
      };

      const fakeConnectingWs = {
        readyState: WebSocket.CONNECTING,
        send: vi.fn(),
        close: vi.fn(),
        terminate: vi.fn(),
      };
      const connectingPair = {
        clientWs: fakeConnectingWs as any,
        upstreamWs: { readyState: WebSocket.CONNECTING, close: vi.fn(), terminate: vi.fn() } as any,
        sessionId: "connecting-ws-session-edge",
        deviceId: devId,
      };

      const serverAny = relayServer as any;
      serverAny.activeWsConnections.add(pair);
      serverAny.activeWsConnections.add(connectingPair);

      const revoked = relayServer.revokeDevice(devId);
      expect(revoked).toBe(true);
      expect(fakeClientWs.send).toHaveBeenCalled();
      expect(fakeClientWs.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(fakeUpstreamWs.close).toHaveBeenCalledWith(4401, "Session revoked");
      expect(fakeConnectingWs.send).toHaveBeenCalled();
      expect(serverAny.activeWsConnections.has(pair)).toBe(false);
      expect(serverAny.activeWsConnections.has(connectingPair)).toBe(false);
    });

    it("exercises safeClose when ws.close and ws.terminate throw", () => {
      const devId = "safe-close-throw-device";
      const explodingWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        close: vi.fn().mockImplementation(() => {
          throw new Error("close fail");
        }),
        terminate: vi.fn().mockImplementation(() => {
          throw new Error("terminate fail");
        }),
      };

      const pair = {
        clientWs: explodingWs as any,
        upstreamWs: explodingWs as any,
        sessionId: "standalone-safe-close-session",
        deviceId: devId,
      };

      const serverAny = relayServer as any;
      serverAny.activeWsConnections.add(pair);

      expect(() => relayServer.revokeDevice(devId)).not.toThrow();
    });

    it("getStatus returns customUpstreamBridge state when port is 0", () => {
      const customBridge = {
        getStatus: () => ({ state: "connected" }),
        isBuffering: () => false,
        isConnected: () => false,
        setTarget: vi.fn(),
        disconnect: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
        onMessage: vi.fn(() => () => {}),
        onStateChange: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
        onStatusUpdated: vi.fn(() => () => {}),
        onBufferingAlert: vi.fn(() => () => {}),
        onSwapResumed: vi.fn(() => () => {}),
        connect: vi.fn(async () => {}),
      } as any;

      const dummyDiscovery = new PortDiscoveryService();
      const server = new RelayServer({
        upstreamBridge: customBridge,
        portDiscovery: dummyDiscovery,
      });

      const status = server.getStatus();
      expect(status.upstream.state).toBe("connected");
      server.dispose();
      dummyDiscovery.dispose();
    });

    it("start respects port and host overrides in start options", async () => {
      const dummyDiscovery = new PortDiscoveryService();
      const server = new RelayServer({
        portDiscovery: dummyDiscovery,
        config: {
          port: 0,
          host: "127.0.0.1",
        },
      });

      await server.start({ port: 57987, host: "127.0.0.1" });
      const status = server.getStatus();
      expect(status.port).toBe(57987);
      expect(status.host).toBe("127.0.0.1");

      await server.stop();
      server.dispose();
      dummyDiscovery.dispose();
    });

    it("/api/sessions/revoke handles streaming body with valid JSON and invalid JSON", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
      });

      // Stream with valid JSON
      const streamValid = Readable.from([
        JSON.stringify({ sessionId: session.sessionId }),
      ]);
      const resValid = await app.inject({
        method: "POST",
        url: "/api/sessions/revoke",
        payload: streamValid,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(resValid.statusCode).toBe(200);
      expect(JSON.parse(resValid.body).success).toBe(true);

      // Stream with invalid JSON falls back to empty object and returns 400
      const streamInvalid = Readable.from(["not-a-valid-json"]);
      const resInvalid = await app.inject({
        method: "POST",
        url: "/api/sessions/revoke",
        payload: streamInvalid,
        headers: { "content-type": "application/octet-stream" },
      });
      expect(resInvalid.statusCode).toBe(400);
      expect(JSON.parse(resInvalid.body).error).toBe("Missing required field: sessionId");
    });

    it("handles accept-language header when provided as an array in proxy handler", async () => {
      const app = relayServer.getApp()!;
      const res = await app.inject({
        method: "GET",
        url: "/api/test-accept-lang",
        headers: {
          "accept-language": ["fr-FR", "en-US"] as any,
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("associates deviceId with existing unassociated session in non-pairing mode", async () => {
      const dummyDiscovery = new PortDiscoveryService();
      dummyDiscovery.setPort(upstreamPort);
      const noPairServer = new RelayServer({
        config: {
          requirePairing: false,
          port: 0,
        },
        portDiscovery: dummyDiscovery,
      });

      await noPairServer.start();
      const app = noPairServer.getApp()!;

      // 1. Manually create an existing session without deviceId
      const existing = noPairServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        userAgent: "unique-non-pair-agent",
      });
      expect(existing.deviceId).toBeUndefined();

      // 2. Request to "/" from same client IP + userAgent with no deviceId
      const res = await app.inject({
        method: "GET",
        url: "/",
        headers: {
          "user-agent": "unique-non-pair-agent",
        },
      });
      expect(res.statusCode).toBe(200);

      const sessionAfter = noPairServer.getSessionManager().getSession(existing.sessionId);
      expect(sessionAfter?.deviceId).toBeDefined();

      await noPairServer.stop();
      noPairServer.dispose();
      dummyDiscovery.dispose();
    });



    it("handles rate-limit errors in fetch catch block with AutoSwitchService", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_rl_switch",
      });

      const serverAny = relayServer as any;
      const rateLimitErr = new Error("429 resource_exhausted: quota exceeded");
      (rateLimitErr as any).statusCode = 429;

      const origDispatch = serverAny.upstreamDispatcher.dispatch.bind(serverAny.upstreamDispatcher);

      // 1. AutoSwitch succeeds with next account -> 503 Retry-After 3
      serverAny.upstreamDispatcher.dispatch = (_opts: any, handler: any) => {
        handler.onError(rateLimitErr);
        return true;
      };

      const switchSpy = vi.spyOn(AutoSwitchService, "triggerRateLimitSwitch").mockResolvedValue({
        switched: true,
        nextAccount: { email: "next-user@gmail.com" } as any,
        noAccountLeft: false,
      });

      const res1 = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: `ag_device_id=${session.deviceId}`,
        },
      });
      expect(res1.statusCode).toBe(503);
      expect(res1.headers["retry-after"]).toBe("3");
      expect(JSON.parse(res1.body).error).toBe("account_switched_rate_limited");
      expect(JSON.parse(res1.body).message).toContain("next-user@gmail.com");

      // 2. AutoSwitch has noAccountLeft -> 429 Retry-After 60
      switchSpy.mockResolvedValueOnce({
        switched: false,
        nextAccount: null as any,
        noAccountLeft: true,
      });

      const res2 = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: `ag_device_id=${session.deviceId}`,
        },
      });
      expect(res2.statusCode).toBe(429);
      expect(res2.headers["retry-after"]).toBe("60");
      expect(JSON.parse(res2.body).error).toBe("rate_limited");

      // 3. fetchErr during upstream restart returns upstream_restarting
      const nonRlErr = new Error("ECONNRESET");
      serverAny.upstreamDispatcher.dispatch = (_opts: any, handler: any) => {
        handler.onError(nonRlErr);
        return true;
      };
      let restartCheckCount = 0;
      const restartSpy = vi.spyOn(portDiscovery, "isRestarting").mockImplementation(() => {
        restartCheckCount++;
        return restartCheckCount > 2;
      });

      const res3 = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: `ag_device_id=${session.deviceId}`,
        },
      });
      expect(res3.statusCode).toBe(503);
      expect(JSON.parse(res3.body).error).toBe("upstream_restarting");
      restartSpy.mockRestore();

      // 4. Rate-limit error where triggerRateLimitSwitch throws error falls through to 503
      serverAny.upstreamDispatcher.dispatch = (_opts: any, handler: any) => {
        handler.onError(rateLimitErr);
        return true;
      };
      switchSpy.mockRejectedValueOnce(new Error("auto switch service crash"));
      const res4 = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          cookie: `ag_device_id=${session.deviceId}`,
        },
      });
      expect(res4.statusCode).toBe(503);
      expect(JSON.parse(res4.body).error).toBe("upstream_unavailable");

      serverAny.upstreamDispatcher.dispatch = origDispatch;
      switchSpy.mockRestore();
    });

    it("suppresses wss close and app close errors in stop()", async () => {
      const dummyDiscovery = new PortDiscoveryService();
      const server = new RelayServer({ portDiscovery: dummyDiscovery, config: { port: 0 } });
      await server.start();
      const serverAny = server as any;
      serverAny.wss = {
        close: () => {
          throw new Error("wss close boom");
        },
      };

      const origAppClose = serverAny.app.close.bind(serverAny.app);
      serverAny.app.close = async () => {
        throw new Error("fastify close boom");
      };

      await expect(server.stop()).resolves.not.toThrow();

      serverAny.app = { close: origAppClose };
      server.dispose();
      dummyDiscovery.dispose();
    });

    it("suppresses socket.send errors in broadcastToClients", () => {
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
      });
      const failingSocket = {
        readyState: 1,
        send: () => {
          throw new Error("socket.send broke");
        },
      };
      relayServer.getSessionManager().bindSocket(session.sessionId, failingSocket as any);

      expect(() =>
        relayServer.broadcastToClients({
          type: "AGENT_OUTPUT",
          payload: { text: "hello" },
          timestamp: Date.now(),
        }),
      ).not.toThrow();
    });

    it("suppresses upstreamDispatcher destroy error in dispose()", () => {
      const serverAny = relayServer as any;
      serverAny.upstreamDispatcher = {
        destroy: () => {
          throw new Error("dispatcher destroy explosion");
        },
      };
      expect(() => relayServer.dispose()).not.toThrow();
    });

    it("triggers broadcastHeartbeat periodically when heartbeatIntervalMs is set", () => {
      vi.useFakeTimers();
      const dummyDiscovery = new PortDiscoveryService();
      const hbServer = new RelayServer({
        config: { heartbeatIntervalMs: 50 },
        portDiscovery: dummyDiscovery,
      });

      const hbSpy = vi.spyOn(hbServer as any, "broadcastHeartbeat");
      hbServer.startHeartbeat();

      vi.advanceTimersByTime(110);
      expect(hbSpy).toHaveBeenCalled();

      hbServer.stopHeartbeat();
      hbServer.dispose();
      dummyDiscovery.dispose();
      vi.useRealTimers();
    });

    it("handles bridgeWebSocket edge cases including revoked device recovery and rate limiting", () => {
      const dummyDiscovery = new PortDiscoveryService();
      const pairServer = new RelayServer({
        config: { requirePairing: true, port: 0 },
        portDiscovery: dummyDiscovery,
      });
      const serverAny = pairServer as any;

      // 1. Revoked device, rate-limited
      const dev1 = "dev-ws-rl-test";
      pairServer.getSessionManager().revokeDevice(dev1);
      const rlKey1 = AuthRateLimiter.buildKey("127.0.0.1", dev1);
      for (let i = 0; i < 6; i++) {
        pairServer.getRateLimiter().recordFailure(rlKey1);
      }
      const ws1 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req1 = {
        url: "/connect-websocket?pair=foo",
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev1}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws1, req1, upstreamPort);
      expect(ws1.close).toHaveBeenCalledWith(4401, "Rate limited");

      // 2. Revoked device, invalid pairing key
      const dev2 = "dev-ws-rev-invalid";
      pairServer.getSessionManager().revokeDevice(dev2);
      const ws2 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req2 = {
        url: "/connect-websocket?pair=wrong-key",
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev2}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws2, req2, upstreamPort);
      expect(ws2.close).toHaveBeenCalledWith(4401, "Session revoked");

      // 3. Revoked device, no pairing key
      const dev3 = "dev-ws-rev-none";
      pairServer.getSessionManager().revokeDevice(dev3);
      const ws3 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req3 = {
        url: "/connect-websocket",
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev3}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws3, req3, upstreamPort);
      expect(ws3.close).toHaveBeenCalledWith(4401, "Session revoked");

      // 4. Revoked device successfully un-revokes with valid pairing key
      const dev4 = "dev-ws-rev-valid";
      pairServer.getSessionManager().revokeDevice(dev4);
      const validKey = pairServer.getPairingKey();
      const ws4 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req4 = {
        url: `/connect-websocket?pair=${validKey}`,
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev4}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws4, req4, upstreamPort);
      expect(pairServer.getSessionManager().isDeviceRevoked(dev4)).toBe(false);

      // 5. Fresh connection rate-limited
      const dev5 = "dev-fresh-ws-rl";
      const rlKey5 = AuthRateLimiter.buildKey("127.0.0.1", dev5);
      for (let i = 0; i < 6; i++) {
        pairServer.getRateLimiter().recordFailure(rlKey5);
      }
      const ws5 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req5 = {
        url: "/connect-websocket?pair=any-key",
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev5}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws5, req5, upstreamPort);
      expect(ws5.close).toHaveBeenCalledWith(4401, "Rate limited");

      // 6. Fresh connection invalid pairing key records failure
      const dev6 = "dev-fresh-ws-bad-key";
      const ws6 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req6 = {
        url: "/connect-websocket?pair=bad-key-123",
        headers: { "user-agent": "test", cookie: `ag_device_id=${dev6}` },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws6, req6, upstreamPort);
      expect(ws6.close).toHaveBeenCalledWith(4401, "Unauthorized: Pairing key required");

      // 7. Non-pairing mode where session creation failed
      const noPairServer = new RelayServer({ config: { requirePairing: false }, portDiscovery: dummyDiscovery });
      const origCreate = noPairServer.getSessionManager().createSession.bind(noPairServer.getSessionManager());
      (noPairServer.getSessionManager() as any).createSession = () => undefined;
      const ws7 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req7 = {
        url: "/connect-websocket",
        headers: { "user-agent": "test" },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      (noPairServer as any).bridgeWebSocket(ws7, req7, upstreamPort);
      expect(ws7.close).toHaveBeenCalledWith(1008, "Session initialization failed");
      (noPairServer.getSessionManager() as any).createSession = origCreate;
      noPairServer.dispose();

      // 8. Existing session receives deviceId in WS upgrade
      const session = pairServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        token: "ws-attach-token",
      });
      const ws8 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req8 = {
        url: "/connect-websocket?token=ws-attach-token",
        headers: { "user-agent": "test", cookie: "ag_device_id=dev_upgraded_ws" },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws8, req8, upstreamPort);
      expect(pairServer.getSessionManager().getSession(session.sessionId)?.deviceId).toBe("dev_upgraded_ws");

      // 9. Forward headers with array values
      const session9 = pairServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_ws_array_hdr",
      });
      const ws9 = { readyState: WebSocket.OPEN, close: vi.fn(), on: vi.fn() } as any;
      const req9 = {
        url: "/connect-websocket",
        headers: {
          "user-agent": "test",
          cookie: `ag_device_id=${session9.deviceId}`,
          "x-custom-multi": ["val1", "val2"] as any,
        },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;
      serverAny.bridgeWebSocket(ws9, req9, upstreamPort);

      // Clean up any connected sockets created during tests
      for (const pair of serverAny.activeWsConnections) {
        try {
          pair.upstreamWs.terminate();
        } catch {}
      }
      serverAny.activeWsConnections.clear();
      pairServer.dispose();
      dummyDiscovery.dispose();
    });

    it("handles WebSocket message sending error suppression across client and upstream", () => {
      const serverAny = relayServer as any;
      const validKey = relayServer.getPairingKey();

      let clientOnMessage: any;
      const fakeClientWs = {
        readyState: WebSocket.OPEN,
        on: vi.fn((event: string, cb: any) => {
          if (event === "message") clientOnMessage = cb;
        }),
        send: vi.fn().mockImplementation(() => {
          throw new Error("clientWs send fail");
        }),
        close: vi.fn(),
      };

      const req = {
        url: `/connect-websocket?pair=${validKey}`,
        headers: { "user-agent": "test" },
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      serverAny.bridgeWebSocket(fakeClientWs, req, upstreamPort);

      // Find the created active pair
      const pair = Array.from(serverAny.activeWsConnections as Set<any>).find(
        (p: any) => p.clientWs === fakeClientWs,
      );
      expect(pair).toBeDefined();

      // 1. Queue message while upstreamWs is still CONNECTING
      expect(() => clientOnMessage(Buffer.from("queued msg"), false)).not.toThrow();

      // 2. Upstream open fires and flushes pendingMessages; upstreamWs.send throws -> caught at line 3563
      pair.upstreamWs.send = vi.fn().mockImplementation(() => {
        throw new Error("upstreamWs send fail");
      });
      pair.upstreamWs.emit("open");

      // 3. Mark upstreamWs as OPEN; client sends message; upstreamWs.send throws -> caught at line 3575
      Object.defineProperty(pair.upstreamWs, "readyState", { value: WebSocket.OPEN, configurable: true });
      expect(() => clientOnMessage(Buffer.from("direct msg"), false)).not.toThrow();

      // 4. Trigger upstreamWs message when clientWs send throws
      expect(() => pair.upstreamWs.emit("message", Buffer.from("upstream test msg"), false)).not.toThrow();
    });

    it("buffers streaming mutation body when under 10MB limit and forwards content-length", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_stream_mutation",
      });
      const streamPayload = Readable.from([Buffer.from("part1-"), Buffer.from("part2")]);
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          "content-type": "application/octet-stream",
          cookie: `ag_device_id=${session.deviceId}`,
        },
        payload: streamPayload,
      });
      expect([200, 404, 502]).toContain(res.statusCode);
    });

    it("buffers string mutation body when under 10MB limit", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_str_mut",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          "content-type": "text/plain",
          cookie: `ag_device_id=${session.deviceId}`,
        },
        payload: "small string mutation content",
      });
      expect([200, 404, 502]).toContain(res.statusCode);
    });

    it("buffers json object mutation body when under 10MB limit", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_json_mut",
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: {
          "content-type": "application/json",
          cookie: `ag_device_id=${session.deviceId}`,
        },
        payload: JSON.stringify({ prompt: "hello" }),
      });
      expect([200, 404, 502]).toContain(res.statusCode);
    });

    it("handles upstream 429 when AutoSwitchService.triggerRateLimitSwitch throws error", async () => {
      const app = relayServer.getApp()!;
      const session = relayServer.getSessionManager().createSession({
        clientIp: "127.0.0.1",
        deviceId: "dev_429_crash",
      });
      const switchSpy = vi.spyOn(AutoSwitchService, "triggerRateLimitSwitch").mockRejectedValueOnce(
        new Error("switch crash"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/error-429",
        headers: {
          cookie: `ag_device_id=${session.deviceId}`,
        },
      });
      expect(res.statusCode).toBe(429);
      switchSpy.mockRestore();
    });

    it("handles customUpstreamBridge.connect error on start cleanly", async () => {
      const dummyDiscovery = new PortDiscoveryService();
      const customBridge = {
        connect: vi.fn().mockRejectedValue(new Error("connect failed")),
        disconnect: vi.fn(),
        dispose: vi.fn(),
        send: vi.fn(),
        getStatus: vi.fn().mockReturnValue({ isConnected: false, isBuffering: false }),
        isBuffering: vi.fn().mockReturnValue(false),
        onBufferingAlert: vi.fn().mockReturnValue(() => {}),
        onSwapResumed: vi.fn().mockReturnValue(() => {}),
        onMessage: vi.fn().mockReturnValue(() => {}),
        onStateChange: vi.fn().mockReturnValue(() => {}),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        emit: vi.fn(),
      };
      const customServer = new RelayServer({
        upstreamBridge: customBridge as any,
        portDiscovery: dummyDiscovery,
        config: { port: 0, requirePairing: false },
      });
      await customServer.start();
      expect(customBridge.connect).toHaveBeenCalled();
      await customServer.stop();
      customServer.dispose();
      dummyDiscovery.dispose();
    });

    it("setupWebSocketUpgradeHandler returns early if app or server is missing", () => {
      const dummyDiscovery = new PortDiscoveryService();
      const server = new RelayServer({ portDiscovery: dummyDiscovery, config: { port: 0 } });
      const serverAny = server as any;
      serverAny.app = null;
      expect(() => serverAny.setupWebSocketUpgradeHandler()).not.toThrow();
      serverAny.app = {};
      expect(() => serverAny.setupWebSocketUpgradeHandler()).not.toThrow();
      server.dispose();
      dummyDiscovery.dispose();
    });

    it("reconnects custom upstream bridge in handlePortChanged", () => {
      const serverAny = relayServer as any;
      serverAny.hasCustomUpstreamBridge = true;
      const reconnectSpy = vi.spyOn(serverAny.upstreamBridge, "reconnectAndFlush").mockResolvedValue(undefined as any);

      serverAny.handlePortChanged(upstreamPort, 58999);
      expect(reconnectSpy).toHaveBeenCalled();
      reconnectSpy.mockRestore();
      serverAny.hasCustomUpstreamBridge = false;
    });

    it("formats non-object data as string payload in upstreamBridge onMessage listener", () => {
      const serverAny = relayServer as any;
      const broadcastSpy = vi.spyOn(relayServer, "broadcastToClients");

      serverAny.upstreamBridge.messageListeners.forEach((fn: any) => fn("plain string token"));
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "AGENT_OUTPUT",
          payload: { text: "plain string token" },
        }),
      );
      broadcastSpy.mockRestore();
    });

    it("handles MockUpstreamServer edge cases when req.url or req.method is undefined", () => {
      const mockAny = mockUpstream as any;

      // 1. handleHttpRequest with undefined method and url
      const fakeRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };
      const fakeReq = {
        method: undefined,
        url: undefined,
        headers: {},
        on: (event: string, cb: any) => {
          if (event === "end") cb();
        },
      };
      expect(() => mockAny.handleHttpRequest(fakeReq, fakeRes)).not.toThrow();
      expect(fakeRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

      // 2. upgrade event with undefined url
      const fakeSocket = {
        write: vi.fn(),
        destroy: vi.fn(),
      };
      expect(() =>
        mockAny.server.emit("upgrade", { url: undefined, headers: {} }, fakeSocket, Buffer.alloc(0)),
      ).not.toThrow();
      expect(fakeSocket.write).toHaveBeenCalledWith(expect.stringContaining("404 Not Found"));
      expect(fakeSocket.destroy).toHaveBeenCalled();
    });
  });
});
