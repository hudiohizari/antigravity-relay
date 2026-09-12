import fastify, { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { Agent, request as undiciRequest } from "undici";
import WebSocket, { WebSocketServer, RawData } from "ws";
import {
  RelayConfig,
  RelayServerStatus,
  RemoteEvent,
  Session,
  UpstreamBridgeState,
  DEFAULT_RELAY_CONFIG,
} from "./types";
import {
  AuthRateLimiter,
  generatePairingKey,
  generateSessionToken,
  validateToken,
} from "./relay-auth";
import { SessionManager } from "./session-manager";
import { UpstreamBridge } from "./upstream-bridge";
import { PortDiscoveryService } from "./port-discovery";
import { isRateLimitError } from "@/modules/cloud-account/utils/account-status";
import { getRecommendedLocalIp } from "@/shared/platform/network";
import { logger } from "@/shared/logging/logger";

export interface RelayServerOptions {
  config?: Partial<RelayConfig>;
  sessionManager?: SessionManager;
  upstreamBridge?: UpstreamBridge;
  rateLimiter?: AuthRateLimiter;
  portDiscovery?: PortDiscoveryService;
  upstreamPort?: number;
}

interface ActiveWsPair {
  clientWs: WebSocket;
  upstreamWs: WebSocket;
  sessionId?: string;
  deviceId?: string;
}

function extractClientIp(
  headers: Record<string, string | string[] | undefined>,
  remoteAddress?: string,
): string {
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) {
    const raw = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(",")[0];
    const trimmed = raw?.trim();
    if (trimmed) {
      return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
    }
  }
  if (remoteAddress) {
    return remoteAddress.startsWith("::ffff:")
      ? remoteAddress.slice(7)
      : remoteAddress;
  }
  return "127.0.0.1";
}

function extractUserAgent(
  headers: Record<string, string | string[] | undefined>,
): string {
  const ua = headers["user-agent"];
  if (Array.isArray(ua)) {
    return ua[0] || "AntigravityRemote/1.0";
  }
  return ua || "AntigravityRemote/1.0";
}

export function extractDeviceId(
  headers: Record<string, string | string[] | undefined>,
  query?: URLSearchParams | null,
): string | undefined {
  let cookieHeader: string | string[] | undefined;
  let headerDeviceId: string | string[] | undefined;

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "cookie") {
      cookieHeader = value;
    } else if (lower === "x-device-id") {
      headerDeviceId = value;
    }
  }

  const cookieStr = Array.isArray(cookieHeader)
    ? cookieHeader.join("; ")
    : cookieHeader;
  if (cookieStr) {
    const match = cookieStr.match(/(?:^|;\s*)ag_device_id=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1].trim());
    }
  }
  if (headerDeviceId) {
    return Array.isArray(headerDeviceId) ? headerDeviceId[0] : headerDeviceId;
  }
  if (query) {
    const queryDeviceId = query.get("deviceId") || query.get("device_id");
    if (queryDeviceId) {
      return queryDeviceId;
    }
  }
  return undefined;
}

let cachedFaviconBuffer: Buffer | null = null;
let cachedFavicon32Buffer: Buffer | null = null;
let cachedIconPngBuffer: Buffer | null = null;
let cachedIcon192Buffer: Buffer | null = null;
let cachedIcon512Buffer: Buffer | null = null;
let cachedFavicon32DataUri: string | null = null;

export function resetFaviconCache(): void {
  cachedFaviconBuffer = null;
  cachedFavicon32Buffer = null;
  cachedIconPngBuffer = null;
  cachedIcon192Buffer = null;
  cachedIcon512Buffer = null;
  cachedFavicon32DataUri = null;
}

export function getFaviconBuffer(forceReload = false): Buffer | null {
  if (forceReload) {
    cachedFaviconBuffer = null;
  }
  if (cachedFaviconBuffer) return cachedFaviconBuffer;
  const candidates = [
    path.join(process.cwd(), "images", "favicon.ico"),
    path.join(__dirname, "../../images", "favicon.ico"),
    path.join(__dirname, "../../../images", "favicon.ico"),
    path.join(__dirname, "../../assets", "favicon.ico"),
    path.join(process.resourcesPath || "", "images", "favicon.ico"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedFaviconBuffer = fs.readFileSync(p);
        return cachedFaviconBuffer;
      }
    } catch (_) {}
  }
  return null;
}

export function getFavicon32Buffer(forceReload = false): Buffer | null {
  if (forceReload) {
    cachedFavicon32Buffer = null;
  }
  if (cachedFavicon32Buffer) return cachedFavicon32Buffer;
  const candidates = [
    path.join(process.cwd(), "images", "favicon-32.png"),
    path.join(process.cwd(), "images", "32x32.png"),
    path.join(__dirname, "../../images", "favicon-32.png"),
    path.join(__dirname, "../../images", "32x32.png"),
    path.join(__dirname, "../../../images", "favicon-32.png"),
    path.join(__dirname, "../../../images", "32x32.png"),
    path.join(__dirname, "../../assets", "favicon-32.png"),
    path.join(__dirname, "../../assets", "32x32.png"),
    path.join(process.resourcesPath || "", "images", "favicon-32.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedFavicon32Buffer = fs.readFileSync(p);
        return cachedFavicon32Buffer;
      }
    } catch (_) {}
  }
  return null;
}

export function getIconPngBuffer(forceReload = false): Buffer | null {
  if (forceReload) {
    cachedIconPngBuffer = null;
  }
  if (cachedIconPngBuffer) return cachedIconPngBuffer;
  const candidates = [
    path.join(process.cwd(), "images", "icon.png"),
    path.join(process.cwd(), "src", "assets", "icon.png"),
    path.join(__dirname, "../../images", "icon.png"),
    path.join(__dirname, "../../../images", "icon.png"),
    path.join(__dirname, "../../assets", "icon.png"),
    path.join(process.resourcesPath || "", "images", "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedIconPngBuffer = fs.readFileSync(p);
        return cachedIconPngBuffer;
      }
    } catch (_) {}
  }
  return null;
}

export function getFavicon32DataUri(forceReload = false): string {
  if (forceReload) {
    cachedFavicon32DataUri = null;
  }
  if (cachedFavicon32DataUri) return cachedFavicon32DataUri;
  const buffer = getFavicon32Buffer(forceReload);
  if (buffer) {
    cachedFavicon32DataUri = `data:image/png;base64,${buffer.toString("base64")}`;
    return cachedFavicon32DataUri;
  }
  return "";
}

export function getIcon192Buffer(forceReload = false): Buffer | null {
  if (forceReload) {
    cachedIcon192Buffer = null;
  }
  if (cachedIcon192Buffer) return cachedIcon192Buffer;
  const candidates = [
    path.join(process.cwd(), "images", "icon-192.png"),
    path.join(__dirname, "../../images", "icon-192.png"),
    path.join(__dirname, "../../../images", "icon-192.png"),
    path.join(__dirname, "../../assets", "icon-192.png"),
    path.join(process.resourcesPath || "", "images", "icon-192.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedIcon192Buffer = fs.readFileSync(p);
        return cachedIcon192Buffer;
      }
    } catch (_) {}
  }
  return getIconPngBuffer(forceReload);
}

export function getIcon512Buffer(forceReload = false): Buffer | null {
  if (forceReload) {
    cachedIcon512Buffer = null;
  }
  if (cachedIcon512Buffer) return cachedIcon512Buffer;
  const candidates = [
    path.join(process.cwd(), "images", "icon-512.png"),
    path.join(__dirname, "../../images", "icon-512.png"),
    path.join(__dirname, "../../../images", "icon-512.png"),
    path.join(__dirname, "../../assets", "icon-512.png"),
    path.join(process.resourcesPath || "", "images", "icon-512.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        cachedIcon512Buffer = fs.readFileSync(p);
        return cachedIcon512Buffer;
      }
    } catch (_) {}
  }
  return getIconPngBuffer(forceReload);
}

export function getManifestJson(): string {
  return JSON.stringify(
    {
      name: "Antigravity Relay",
      short_name: "Antigravity",
      description: "Antigravity Remote Web Relay",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#090d16",
      theme_color: "#090d16",
      icons: [
        {
          src: "/favicon-32.png",
          sizes: "32x32",
          type: "image/png",
        },
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon.png",
          sizes: "1024x1024",
          type: "image/png",
          purpose: "any",
        },
      ],
    },
    null,
    2,
  );
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "trailer",
]);

function safeClose(
  ws: WebSocket,
  code?: number,
  reason?: Buffer | string,
): void {
  if (
    ws.readyState === WebSocket.OPEN ||
    ws.readyState === WebSocket.CONNECTING
  ) {
    try {
      if (
        code &&
        code !== 1005 &&
        code !== 1006 &&
        code >= 1000 &&
        code <= 4999
      ) {
        ws.close(code, reason);
      } else {
        ws.close();
      }
    } catch {
      try {
        ws.terminate();
      } catch {
        // Suppress termination error
      }
    }
  }
}

export function generateAutoReloadScript(
  upstreamPort: number | null,
  upstreamEpoch: number,
): string {
  return `<script id="antigravity-relay-autoreload">
(function() {
  if (window.__antigravityRelayAutoReloadInjected) return;
  window.__antigravityRelayAutoReloadInjected = true;
  window.__antigravitySessionRevoked = false;

  try {
    var deviceMatch = document.cookie.match(/(?:^|;\s*)ag_device_id=([^;]+)/);
    if (deviceMatch && deviceMatch[1]) {
      localStorage.setItem("ag_device_id", decodeURIComponent(deviceMatch[1].trim()));
    } else {
      var storedDeviceId = localStorage.getItem("ag_device_id");
      if (storedDeviceId) {
        document.cookie = "ag_device_id=" + encodeURIComponent(storedDeviceId) + "; path=/; max-age=31536000; SameSite=Lax";
      }
    }
  } catch (_) {}

  var initialPort = ${upstreamPort ?? "null"};
  var initialEpoch = ${upstreamEpoch};
  var reloading = false;
  var RELAY_CHANNEL = "antigravity-relay";

  var copyCatalog = {
    en: {
      overlayTitle: "Access Revoked",
      overlayMessage: "Your access was revoked by the desktop host. Enter a new pairing key to reconnect.",
      overlayBadge: "Disconnected by Host",
      repairButton: "Re-pair Device",
      repairButtonLoading: "Connecting...",
      repairButtonAria: "Submit pairing key to re-pair this device",
      pairingInputLabel: "Pairing Key",
      pairingInputPlaceholder: "Enter pairing key",
      invalidKeyError: "Invalid pairing key. Please verify the key shown on your desktop dashboard.",
      emptyKeyError: "Please enter a pairing key before submitting.",
      rateLimitError: "Too many pairing attempts. Please wait.",
      networkError: "Unable to reach the relay server. Please check your network connection.",
      syncingSiblingTabs: "Device re-paired successfully. Synchronizing open tabs...",
      keyConsumedError: "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
      staleKeyError: "The previous pairing key is no longer valid. Enter the newly generated key shown on the desktop dashboard.",
      reconnectingBanner: "Antigravity restarting, reconnecting...",
      relayStoppedBanner: "Relay server stopped, waiting for server..."
    },
    id: {
      overlayTitle: "Akses Dicabut",
      overlayMessage: "Akses Anda telah dicabut oleh host desktop. Masukkan kunci pairing baru untuk menyambung kembali.",
      overlayBadge: "Terputus oleh Host",
      repairButton: "Hubungkan Ulang Perangkat",
      repairButtonLoading: "Menyambungkan...",
      repairButtonAria: "Kirim kunci pairing untuk menghubungkan ulang perangkat ini",
      pairingInputLabel: "Kunci Pairing",
      pairingInputPlaceholder: "Masukkan kunci pairing",
      invalidKeyError: "Kunci pairing tidak valid. Silakan periksa kunci yang ditampilkan di dashboard desktop Anda.",
      emptyKeyError: "Silakan masukkan kunci pairing sebelum mengirimkan.",
      rateLimitError: "Terlalu banyak percobaan pairing. Silakan tunggu.",
      networkError: "Tidak dapat menjangkau server relay. Silakan periksa koneksi jaringan Anda.",
      syncingSiblingTabs: "Perangkat berhasil dihubungkan ulang. Menyelaraskan tab yang terbuka...",
      keyConsumedError: "Kunci pairing ini sudah digunakan oleh perangkat lain. Silakan minta kunci baru dari host desktop.",
      staleKeyError: "Kunci pairing sebelumnya sudah tidak valid. Masukkan kunci yang baru ditampilkan di dashboard desktop.",
      reconnectingBanner: "Antigravity memulai ulang, menghubungkan kembali...",
      relayStoppedBanner: "Server relay berhenti, menunggu server..."
    }
  };

  function getCatalog() {
    try {
      var navLang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
      if (navLang.indexOf("id") === 0) {
        return copyCatalog.id;
      }
    } catch (_) {}
    return copyCatalog.en;
  }

  function broadcastSessionRevoked() {
    try {
      if (typeof window.BroadcastChannel !== "undefined") {
        var bc = new BroadcastChannel(RELAY_CHANNEL);
        bc.postMessage({ type: "SESSION_REVOKED", timestamp: Date.now() });
        bc.close();
      }
    } catch (_) {}
    try {
      localStorage.setItem("ag_relay_revoked_at", Date.now().toString());
    } catch (_) {}
  }

  function broadcastSessionRestored() {
    try {
      if (typeof window.BroadcastChannel !== "undefined") {
        var bc = new BroadcastChannel(RELAY_CHANNEL);
        bc.postMessage({ type: "SESSION_RESTORED", timestamp: Date.now() });
        bc.close();
      }
    } catch (_) {}
    try {
      localStorage.removeItem("ag_relay_revoked_at");
      localStorage.setItem("ag_relay_restored_at", Date.now().toString());
      localStorage.setItem("ag_auth_restored", Date.now().toString());
    } catch (_) {}
  }

  try {
    var currentUrlParams = new URLSearchParams(window.location.search);
    var hasPairParam = currentUrlParams.has("pair");
    if (hasPairParam) {
      broadcastSessionRestored();
    } else {
      localStorage.removeItem("ag_relay_revoked_at");
    }
    if (hasPairParam || currentUrlParams.has("useWebSocket")) {
      currentUrlParams.delete("pair");
      currentUrlParams.delete("useWebSocket");
      var remainingSearch = currentUrlParams.toString();
      var cleanSearch = remainingSearch ? "?" + remainingSearch : "";
      var cleanPath = window.location.pathname + cleanSearch + window.location.hash;
      window.history.replaceState({}, document.title, cleanPath);
    }
  } catch (_) {}

  function lockBodyScroll() {
    try {
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.touchAction = "none";
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    } catch (_) {}
  }

  function unlockBodyScroll() {
    try {
      document.documentElement.style.overflow = "";
      document.documentElement.style.touchAction = "";
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    } catch (_) {}
  }

  function unmountRevocationOverlay() {
    try {
      var existingHost = document.getElementById("antigravity-revocation-host");
      if (existingHost && existingHost.parentNode) {
        existingHost.parentNode.removeChild(existingHost);
      }
    } catch (_) {}
    unlockBodyScroll();
  }

  function mountRevocationOverlay() {
    if (document.getElementById("antigravity-revocation-host")) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mountRevocationOverlay);
      return;
    }

    lockBodyScroll();

    var strings = getCatalog();
    var host = document.createElement("div");
    host.id = "antigravity-revocation-host";
    host.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:auto;";
    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = \`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .scrim {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        background: rgba(9, 13, 22, 0.88);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: clamp(1rem, 5vw, 2rem);
        padding-top: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-top, 0px));
        padding-bottom: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-bottom, 0px));
        padding-left: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-left, 0px));
        padding-right: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-right, 0px));
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        z-index: 2147483647;
      }
      .card {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 12px;
        padding: clamp(1.25rem, 5vw, 2rem);
        max-width: 400px;
        width: 100%;
        max-height: calc(100vh - 32px);
        max-height: calc(100dvh - 32px);
        overflow-y: auto;
        box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.6);
        color: #f9fafb;
        min-width: 0;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 500;
        color: #f87171;
        margin-bottom: 1.25rem;
      }
      .badge-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ef4444;
        flex-shrink: 0;
      }
      .icon-box {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ef4444;
        margin-bottom: 1rem;
      }
      h1 {
        font-size: 1.25rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
        color: #f9fafb;
      }
      p {
        font-size: 0.875rem;
        color: #9ca3af;
        line-height: 1.5;
        margin-bottom: 1.25rem;
      }
      .error-alert {
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.35);
        color: #f87171;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.8125rem;
        line-height: 1.4;
        margin-bottom: 1rem;
        display: none;
      }
      label {
        display: block;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #9ca3af;
        margin-bottom: 0.5rem;
      }
      input {
        width: 100%;
        min-height: 44px;
        padding: 0.75rem 1rem;
        background: #0d131f;
        border: 1px solid #374151;
        border-radius: 8px;
        color: #f9fafb;
        font-family: monospace;
        font-size: 16px;
        margin-bottom: 1.25rem;
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      input:hover {
        border-color: #6b7280;
      }
      input:focus-visible {
        border-color: #3b82f6;
        outline: none;
        box-shadow: 0 0 0 2px #090d16, 0 0 0 4px #3b82f6;
      }
      input[aria-invalid="true"] {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.08);
      }
      input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
      }
      button {
        width: 100%;
        min-height: 44px;
        padding: 0.75rem;
        background: #10b981;
        color: #000000;
        font-weight: 600;
        font-size: 0.875rem;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-sizing: border-box;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      button:hover {
        background: #059669;
      }
      button:active {
        transform: scale(0.98);
      }
      button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px #111827, 0 0 0 4px #3b82f6;
      }
      button:disabled {
        opacity: 0.6;
        cursor: wait;
        pointer-events: none;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .animate-spin {
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
      }
      @keyframes form-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-6px); }
        40%, 80% { transform: translateX(6px); }
      }
      .shake {
        animation: form-shake 0.4s ease-in-out;
      }
      .sync-toast {
        margin-top: 1rem;
        padding: 8px 12px;
        border-radius: 6px;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid rgba(16, 185, 129, 0.3);
        color: #34d399;
        font-size: 0.8125rem;
        display: none;
        text-align: center;
      }
    \`;

    var overlay = document.createElement("div");
    overlay.className = "scrim";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "overlay-title");
    overlay.setAttribute("aria-describedby", "overlay-desc");

    overlay.innerHTML =
      '<div class="card" id="revocation-card">' +
        '<div class="badge" role="status">' +
          '<span class="badge-dot" aria-hidden="true"></span>' +
          '<span>' + strings.overlayBadge + '</span>' +
        '</div>' +
        '<div class="icon-box" aria-hidden="true">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>' +
            '<path d="m14.5 9-5 5"></path>' +
            '<path d="m9.5 9 5 5"></path>' +
          '</svg>' +
        '</div>' +
        '<h1 id="overlay-title">' + strings.overlayTitle + '</h1>' +
        '<p id="overlay-desc">' + strings.overlayMessage + '</p>' +
        '<div class="error-alert" id="overlay-error" role="alert" aria-live="assertive"></div>' +
        '<form id="overlay-form" novalidate>' +
          '<label for="overlay-key">' + strings.pairingInputLabel + '</label>' +
          '<input type="password" id="overlay-key" name="pair" placeholder="' + strings.pairingInputPlaceholder + '" autocomplete="off" autocapitalize="none" spellcheck="false" required aria-required="true" aria-invalid="false" aria-describedby="overlay-error" />' +
          '<button type="submit" id="overlay-submit" aria-label="' + strings.repairButtonAria + '">' +
            '<span>' + strings.repairButton + '</span>' +
          '</button>' +
        '</form>' +
        '<div class="sync-toast" id="overlay-sync" role="status" aria-live="polite">' +
          strings.syncingSiblingTabs +
        '</div>' +
      '</div>';

    shadow.appendChild(style);
    shadow.appendChild(overlay);
    document.body.appendChild(host);

    var card = shadow.getElementById("revocation-card");
    var input = shadow.getElementById("overlay-key");
    var form = shadow.getElementById("overlay-form");
    var submitBtn = shadow.getElementById("overlay-submit");
    var errorBox = shadow.getElementById("overlay-error");
    var syncToast = shadow.getElementById("overlay-sync");

    overlay.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.key === "Tab") {
        var focusable = [input, submitBtn].filter(function(el) { return el && !el.disabled; });
        if (focusable.length === 0) return;
        var activeEl = shadow.activeElement;
        if (e.shiftKey) {
          if (!activeEl || activeEl === focusable[0]) {
            e.preventDefault();
            focusable[focusable.length - 1].focus();
          }
        } else {
          if (!activeEl || activeEl === focusable[focusable.length - 1]) {
            e.preventDefault();
            focusable[0].focus();
          }
        }
      }
    });

    setTimeout(function() {
      try {
        input.focus();
        if (typeof input.select === "function") input.select();
      } catch (_) {}
    }, 50);

    form.addEventListener("submit", function(e) {
      e.preventDefault();
      var key = input.value.trim();
      if (!key) {
        input.setAttribute("aria-invalid", "true");
        errorBox.textContent = strings.emptyKeyError;
        errorBox.style.display = "block";
        if (card) {
          card.classList.remove("shake");
          void card.offsetWidth;
          card.classList.add("shake");
        }
        input.focus();
        return;
      }

      input.setAttribute("aria-invalid", "false");
      errorBox.style.display = "none";
      input.setAttribute("disabled", "true");
      submitBtn.setAttribute("disabled", "true");
      submitBtn.setAttribute("aria-busy", "true");
      var spinnerSvg = '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor"></circle><path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>';
      submitBtn.innerHTML = spinnerSvg + '<span>' + strings.repairButtonLoading + '</span>';

      fetch("/?pair=" + encodeURIComponent(key), {
        method: "GET",
        headers: { "Accept": "application/json" },
        credentials: "same-origin"
      })
        .then(function(res) {
          if (res.status === 200 || res.ok) {
            broadcastSessionRestored();
            syncToast.textContent = strings.syncingSiblingTabs;
            syncToast.style.display = "block";
            setTimeout(function() {
              unmountRevocationOverlay();
              window.location.reload();
            }, 500);
            return;
          }
          return res.json().then(function(data) {
            if (data && data.error === "key_consumed") {
              throw { status: res.status, message: strings.keyConsumedError || strings.invalidKeyError };
            }
            if (data && data.error === "session_revoked") {
              throw { status: res.status, message: strings.staleKeyError || strings.invalidKeyError };
            }
            if (res.status === 429 || (data && data.error === "rate_limited")) {
              throw { status: 429, message: strings.rateLimitError };
            }
            throw { status: res.status, message: strings.invalidKeyError };
          }).catch(function(jsonErr) {
            if (jsonErr && jsonErr.message) throw jsonErr;
            if (res.status === 429) throw { status: 429, message: strings.rateLimitError };
            throw { status: res.status, message: strings.invalidKeyError };
          });
        })
        .catch(function(err) {
          input.removeAttribute("disabled");
          submitBtn.removeAttribute("disabled");
          submitBtn.removeAttribute("aria-busy");
          submitBtn.innerHTML = '<span>' + strings.repairButton + '</span>';
          input.setAttribute("aria-invalid", "true");
          if (card) {
            card.classList.remove("shake");
            void card.offsetWidth;
            card.classList.add("shake");
          }
          var msg = err && err.message ? err.message : strings.networkError;
          errorBox.textContent = msg;
          errorBox.style.display = "block";
          input.focus();
        });
    });
  }

  function handleRevocation(shouldBroadcast) {
    window.__antigravitySessionRevoked = true;
    reloading = false;
    unmountReloadBanner();
    if (shouldBroadcast) {
      broadcastSessionRevoked();
    }
    mountRevocationOverlay();
  }

  function initCrossTabSyncListener() {
    var handleRestoredEvent = function() {
      var host = document.getElementById("antigravity-revocation-host");
      if (host && host.shadowRoot) {
        var toast = host.shadowRoot.getElementById("overlay-sync");
        if (toast) {
          toast.textContent = getCatalog().syncingSiblingTabs;
          toast.style.display = "block";
        }
      }
      setTimeout(function() {
        unmountRevocationOverlay();
        window.location.reload();
      }, 300);
    };

    var handleRevokedEvent = function() {
      handleRevocation(false);
    };

    if (typeof window.BroadcastChannel !== "undefined") {
      try {
        var bc = new BroadcastChannel(RELAY_CHANNEL);
        bc.onmessage = function(event) {
          if (!event || !event.data) return;
          if (event.data.type === "SESSION_REVOKED") {
            handleRevokedEvent();
          } else if (event.data.type === "SESSION_RESTORED" || event.data.type === "AUTH_RESTORED") {
            handleRestoredEvent();
          }
        };
      } catch (_) {}
    }

    window.addEventListener("storage", function(event) {
      if (event.key === "ag_relay_revoked_at" && event.newValue) {
        handleRevokedEvent();
      } else if (event.key === "ag_relay_restored_at" && event.newValue) {
        handleRestoredEvent();
      } else if (event.key === "ag_auth_restored" && event.newValue) {
        handleRestoredEvent();
      }
    });
  }

  initCrossTabSyncListener();

  function unmountReloadBanner() {
    try {
      var host = document.getElementById("antigravity-reload-host");
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
      var legacyBanner = document.getElementById("relay-reload-banner");
      if (legacyBanner && legacyBanner.parentNode) {
        legacyBanner.parentNode.removeChild(legacyBanner);
      }
    } catch (_) {}
  }

  function mountReloadBanner(msg, type) {
    try {
      var mode = (type === "stopped") ? "stopped" : "restarting";
      var defaultMsg = (mode === "stopped")
        ? (getCatalog().relayStoppedBanner || "Relay server stopped, waiting for server...")
        : (getCatalog().reconnectingBanner || "Antigravity restarting, reconnecting...");
      var message = msg || defaultMsg;
      var host = document.getElementById("antigravity-reload-host");
      if (!host) {
        if (!document.body) return;
        host = document.createElement("div");
        host.id = "antigravity-reload-host";
        document.body.appendChild(host);

        var shadow = host.attachShadow({ mode: "closed" });
        var style = document.createElement("style");
        style.textContent = [
          ":host { position: fixed; top: max(12px, calc(env(safe-area-inset-top, 0px) + 8px)); left: 50%; transform: translateX(-50%); z-index: 2147483647; pointer-events: none; width: auto; display: flex; justify-content: center; align-items: center; margin: 0; padding: 0; border: none; }",
          ".ag-banner { pointer-events: auto; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; max-width: min(calc(100vw - 32px), 400px); width: max-content; padding: 8px 16px; border-radius: 9999px; background: rgba(15, 23, 42, 0.90); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(56, 189, 248, 0.35); box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3); font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; font-weight: 500; line-height: 1.4; color: #e0f2fe; letter-spacing: -0.01em; text-align: left; word-break: break-word; user-select: none; -webkit-user-select: none; transition: border-color 0.2s ease, transform 0.2s ease; }",
          ".ag-banner:hover { border-color: rgba(56, 189, 248, 0.55); }",
          ".ag-banner:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }",
          ".ag-banner--stopped, .ag-banner--amber { border-color: rgba(245, 158, 11, 0.45); }",
          ".ag-banner--stopped:hover, .ag-banner--amber:hover { border-color: rgba(245, 158, 11, 0.65); }",
          ".ag-banner--stopped:focus-visible, .ag-banner--amber:focus-visible { outline: 2px solid #fbbf24; outline-offset: 2px; }",
          ".ag-banner--stopped .ag-dot, .ag-banner--stopped .ag-dot-ping, .ag-banner--amber .ag-dot, .ag-banner--amber .ag-dot-ping { background: #fbbf24; }",
          ".ag-banner--restarting, .ag-banner--cyan { border-color: rgba(56, 189, 248, 0.35); }",
          ".ag-banner--restarting:hover, .ag-banner--cyan:hover { border-color: rgba(56, 189, 248, 0.55); }",
          ".ag-banner--restarting:focus-visible, .ag-banner--cyan:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }",
          ".ag-banner--restarting .ag-dot, .ag-banner--restarting .ag-dot-ping, .ag-banner--cyan .ag-dot, .ag-banner--cyan .ag-dot-ping { background: #38bdf8; }",
          ".ag-dot-wrapper { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 8px; height: 8px; flex-shrink: 0; margin: 0; padding: 0; }",
          ".ag-dot { position: relative; display: block; width: 8px; height: 8px; border-radius: 50%; background: #38bdf8; flex-shrink: 0; }",
          ".ag-dot-ping { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 50%; background: #38bdf8; opacity: 0.75; animation: ag-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite; pointer-events: none; }",
          ".ag-text { display: inline-block; flex: 1 1 auto; }",
          "@keyframes ag-ping { 0% { transform: scale(1); opacity: 0.8; } 75%, 100% { transform: scale(2.4); opacity: 0; } }",
          "@media (prefers-reduced-motion: reduce) { .ag-dot-ping { display: none !important; animation: none !important; } }",
        ].join("");
        shadow.appendChild(style);

        var banner = document.createElement("div");
        banner.className = "ag-banner ag-banner--" + mode + (mode === "stopped" ? " ag-banner--amber" : " ag-banner--cyan");
        banner.setAttribute("role", "status");
        banner.setAttribute("aria-live", "polite");
        banner.setAttribute("aria-atomic", "true");
        banner.innerHTML =
          '<span class="ag-dot-wrapper" aria-hidden="true"><span class="ag-dot-ping"></span><span class="ag-dot"></span></span><span class="ag-text">' +
          message +
          "</span>";
        shadow.appendChild(banner);
        host.__agBanner = banner;
        host.__agBannerText = banner.querySelector(".ag-text");
        host.dataset.mode = mode;
      } else {
        if (host.__agBanner) {
          host.__agBanner.classList.remove("ag-banner--stopped", "ag-banner--amber", "ag-banner--restarting", "ag-banner--cyan");
          host.__agBanner.classList.add("ag-banner--" + mode);
          host.__agBanner.classList.add(mode === "stopped" ? "ag-banner--amber" : "ag-banner--cyan");
        }
        if (host.__agBannerText) {
          host.__agBannerText.textContent = message;
        }
        host.dataset.mode = mode;
      }
    } catch (_) {}
  }
  var showBanner = mountReloadBanner;
  try {
    window.__agMountReloadBanner = mountReloadBanner;
    window.__agUnmountReloadBanner = unmountReloadBanner;
  } catch (_) {}

  function triggerReload() {
    if (reloading || window.__antigravitySessionRevoked) return;
    reloading = true;
    mountReloadBanner(getCatalog().relayStoppedBanner, "stopped");

    var pollAttempts = 0;
    var check = function() {
      if (window.__antigravitySessionRevoked) {
        reloading = false;
        unmountReloadBanner();
        return;
      }
      fetch("/health", { cache: "no-store" })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (window.__antigravitySessionRevoked) {
            reloading = false;
            unmountReloadBanner();
            return;
          }
          pollAttempts = 0;
          if (data && data.isRestarting) {
            mountReloadBanner(getCatalog().reconnectingBanner, "restarting");
            setTimeout(check, 1000);
            return;
          }
          if (data && data.isRunning && data.upstreamPort && !data.isRestarting) {
            window.location.reload();
            return;
          }
          setTimeout(check, 1000);
        })
        .catch(function() {
          if (!window.__antigravitySessionRevoked) {
            mountReloadBanner(getCatalog().relayStoppedBanner, "stopped");
            pollAttempts++;
            var delay = pollAttempts > 5 ? 3000 : 1000;
            setTimeout(check, delay);
          } else {
            reloading = false;
            unmountReloadBanner();
          }
        });
    };
    setTimeout(check, 500);
  }

  var trackedSockets = [];
  var hasDeadSocket = false;

  if (typeof window.WebSocket !== "undefined") {
    var OrigWS = window.WebSocket;
    class PatchedWS extends OrigWS {
      constructor(...args) {
        super(...args);
        trackedSockets.push(this);
        this.addEventListener("message", function(event) {
          try {
            var data = typeof event.data === "string" ? JSON.parse(event.data) : null;
            if (data && (data.type === "SESSION_REVOKED" || data.revoked)) {
              handleRevocation(true);
            }
            if (data && data.type === "RELAY_STOPPED") {
              mountReloadBanner(getCatalog().relayStoppedBanner, "stopped");
            }
          } catch (_) {}
        });
        this.addEventListener("close", function(event) {
          if (event.code === 4401 || event.reason === "Session revoked" || event.reason === "Session revoked by host") {
            handleRevocation(true);
            return;
          }
          if (typeof window === "undefined" || window.__antigravitySessionRevoked) {
            return;
          }
          if (event.code === 1012 || event.code === 1006 || event.code === 1011 || event.code === 1000 || event.reason === "Server stopping") {
            hasDeadSocket = true;
            triggerReload();
          }
        });
      }
    }
    window.WebSocket = PatchedWS;
  }

  function checkResumeHealth() {
    if (window.__antigravitySessionRevoked) return;
    var revokedAt = null;
    try {
      revokedAt = localStorage.getItem("ag_relay_revoked_at");
    } catch (_) {}
    if (revokedAt) {
      handleRevocation(false);
      return;
    }
    if (reloading) return;

    var hadClosedSockets = hasDeadSocket || (trackedSockets.length > 0 && trackedSockets.some(function(s) {
      return s.readyState === 2 || s.readyState === 3;
    }));

    fetch("/health", { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (window.__antigravitySessionRevoked) return;
        var portChanged = data && data.upstreamPort && initialPort && data.upstreamPort !== initialPort;
        var epochChanged = data && typeof data.upstreamEpoch === "number" && data.upstreamEpoch > initialEpoch;
        var isHealthy = data && data.isRunning && data.upstreamPort && !data.isRestarting;

        if (portChanged || epochChanged) {
          triggerReload();
        } else if (isHealthy && hadClosedSockets) {
          window.location.reload();
        }
      })
      .catch(function() {
        if (hadClosedSockets) {
          triggerReload();
        }
      });
  }

  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "visible") {
      checkResumeHealth();
    }
  });

  window.addEventListener("pageshow", function() {
    checkResumeHealth();
  });

  setInterval(function() {
    if (reloading || window.__antigravitySessionRevoked) return;
    fetch("/health", { cache: "no-store" })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (window.__antigravitySessionRevoked) return;
        var portChanged = data && data.upstreamPort && initialPort && data.upstreamPort !== initialPort;
        var epochChanged = data && typeof data.upstreamEpoch === "number" && data.upstreamEpoch > initialEpoch;
        if (portChanged || epochChanged) {
          triggerReload();
        }
      })
      .catch(function() {});
  }, 5000);
})();
</script>`;
}

export function resolveRelayViewLanguage(
  acceptLanguage?: string | null,
  langQuery?: string | null,
): "en" | "id" {
  if (langQuery) {
    const normalized = langQuery.trim().toLowerCase();
    if (normalized.startsWith("id")) return "id";
    if (normalized.startsWith("en")) return "en";
  }

  if (acceptLanguage) {
    const parts = acceptLanguage.split(",").map((p) => p.trim().toLowerCase());
    for (const part of parts) {
      const tag = part.split(";")[0].trim();
      if (tag.startsWith("id")) return "id";
      if (tag.startsWith("en")) return "en";
    }
  }

  return "en";
}

export function translateRelayErrorMessage(
  errorMessage: string | undefined,
  lang: "en" | "id",
): string | undefined {
  if (!errorMessage || lang !== "id") return errorMessage;
  if (errorMessage.includes("already been consumed")) {
    return "Kunci pemasangan ini telah digunakan oleh perangkat lain. Silakan minta kunci baru dari host desktop.";
  }
  if (errorMessage.includes("Invalid pairing key")) {
    return "Kunci pemasangan tidak valid. Periksa dashboard desktop.";
  }
  return errorMessage;
}

export function generatePairingHtml(
  errorMessage?: string,
  lang: "en" | "id" = "en",
): string {
  const errorBlock = errorMessage
    ? `<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:18px;">${errorMessage}</div>`
    : "";

  const title =
    lang === "id"
      ? "Antigravity Relay - Pemasangan Diperlukan"
      : "Antigravity Relay - Pairing Required";
  const heading =
    lang === "id"
      ? "Pemasangan Perangkat Diperlukan"
      : "Device Pairing Required";
  const desc =
    lang === "id"
      ? "Untuk mengakses Antigravity Relay, masukkan kunci pemasangan dari dashboard desktop Anda."
      : "To access Antigravity Relay, enter the pairing key from your desktop dashboard.";
  const label = lang === "id" ? "Kunci Pemasangan" : "Pairing Key";
  const placeholder =
    lang === "id" ? "Masukkan kunci pemasangan..." : "Enter pairing key...";
  const button = lang === "id" ? "Pasangkan Perangkat" : "Pair Device";
  const dataUri = getFavicon32DataUri();

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#090d16">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Antigravity">
  <title>${title}</title>${dataUri ? `\n  <link rel="icon" type="image/png" sizes="32x32" href="${dataUri}">` : ""}
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/icon.png">
  <link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">
  <link rel="manifest" href="/manifest.json">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 1rem;
      padding-top: max(1rem, env(safe-area-inset-top, 0px));
      padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));
      padding-left: max(1rem, env(safe-area-inset-left, 0px));
      padding-right: max(1rem, env(safe-area-inset-right, 0px));
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 2rem;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .icon {
      width: 44px;
      height: 44px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.25rem;
      color: #10b981;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #9ca3af; line-height: 1.5; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin-bottom: 0.5rem; }
    input {
      width: 100%;
      min-height: 44px;
      padding: 0.75rem 1rem;
      background: #0d131f;
      border: 1px solid #1f2937;
      border-radius: 8px;
      color: #f3f4f6;
      font-family: monospace;
      font-size: 16px;
      margin-bottom: 1.25rem;
      outline: none;
      box-sizing: border-box;
    }
    input:focus { border-color: #10b981; }
    button {
      width: 100%;
      min-height: 44px;
      padding: 0.75rem;
      background: #10b981;
      color: #000;
      font-weight: 600;
      font-size: 0.875rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      box-sizing: border-box;
    }
    button:hover { background: #059669; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
    </div>
    <h1>${heading}</h1>
    <p>${desc}</p>
    ${errorBlock}
    <form method="GET" action="/">
      <input type="hidden" name="useWebSocket" value="true" />
      <label for="pair">${label}</label>
      <input type="password" id="pair" name="pair" placeholder="${placeholder}" autofocus autocomplete="off" required />
      <button type="submit">${button}</button>
    </form>
  </div>
</body>
</html>`;
}

export function generateRevokedHtml(
  errorMessage?: string,
  lang: "en" | "id" = "en",
): string {
  const errorBlock = errorMessage
    ? `<div role="alert" aria-live="assertive" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.4;margin-bottom:18px;">${errorMessage}</div>`
    : "";

  const title =
    lang === "id"
      ? "Sesi Dicabut - Antigravity Relay"
      : "Session Revoked - Antigravity Relay";
  const badgeText =
    lang === "id" ? "Terputus oleh Host" : "Disconnected by Host";
  const heading =
    lang === "id" ? "Akses Dicabut oleh Host" : "Access Revoked by Host";
  const desc =
    lang === "id"
      ? "Sesi Dicabut: Akses telah dicabut oleh host desktop. Masukkan kunci pemasangan yang valid untuk menghubungkan kembali."
      : "Session Revoked: Access was revoked by the desktop host. Please enter a valid pairing key to re-establish your connection.";
  const label = lang === "id" ? "Kunci Pemasangan Baru" : "New Pairing Key";
  const placeholder =
    lang === "id"
      ? "Masukkan kunci pemasangan baru"
      : "Enter fresh pairing key";
  const buttonText = lang === "id" ? "Hubungkan" : "Connect";
  const buttonAria =
    lang === "id"
      ? "Kirim kunci pemasangan baru untuk menghubungkan kembali perangkat yang dicabut ini"
      : "Submit new pairing key to reconnect this revoked device";
  const connectingText = lang === "id" ? "Menghubungkan..." : "Connecting...";
  const dataUri = getFavicon32DataUri();

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#090d16">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Antigravity">
  <title>${title}</title>${dataUri ? `\n  <link rel="icon" type="image/png" sizes="32x32" href="${dataUri}">` : ""}
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="apple-touch-icon" href="/icon.png">
  <link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">
  <link rel="manifest" href="/manifest.json">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #f9fafb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: clamp(1rem, 5vw, 2rem);
      padding-top: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-top, 0px));
      padding-bottom: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-bottom, 0px));
      padding-left: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-left, 0px));
      padding-right: max(clamp(1rem, 5vw, 2rem), env(safe-area-inset-right, 0px));
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: clamp(1.25rem, 5vw, 2rem);
      max-width: 400px;
      width: 100%;
      max-height: calc(100vh - 32px);
      max-height: calc(100dvh - 32px);
      overflow-y: auto;
      box-shadow: 0 20px 35px -5px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05);
      min-width: 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #f87171;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      margin-bottom: 1.25rem;
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ef4444;
      flex-shrink: 0;
    }
    .icon {
      width: 44px;
      height: 44px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1rem;
      color: #ef4444;
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; color: #f9fafb; }
    p { font-size: 0.875rem; color: #9ca3af; line-height: 1.5; margin-bottom: 1.25rem; }
    label { display: block; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin-bottom: 0.5rem; }
    input {
      width: 100%;
      min-height: 44px;
      padding: 0.75rem 1rem;
      background: #0d131f;
      border: 1px solid #374151;
      border-radius: 8px;
      color: #f9fafb;
      font-family: monospace;
      font-size: 16px;
      margin-bottom: 1.25rem;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input:hover { border-color: #6b7280; }
    input:focus-visible {
      border-color: #3b82f6;
      outline: none;
      box-shadow: 0 0 0 2px #090d16, 0 0 0 4px #3b82f6;
    }
    input[aria-invalid="true"] {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
    }
    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button {
      width: 100%;
      min-height: 44px;
      padding: 0.75rem;
      background: #10b981;
      color: #000000;
      font-weight: 600;
      font-size: 0.875rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-sizing: border-box;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    button:hover { background: #059669; }
    button:active { transform: scale(0.98); background: #047857; }
    button:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px #111827, 0 0 0 4px #3b82f6;
    }
    button:disabled {
      opacity: 0.65;
      cursor: wait;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .animate-spin {
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes form-shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .shake {
      animation: form-shake 0.4s ease-in-out;
    }
  </style>
</head>
<body>
  <div class="card" id="revocation-card" role="alertdialog" aria-modal="true" aria-labelledby="revoked-heading" aria-describedby="revoked-desc">
    <div class="badge" role="status">
      <span class="badge-dot" aria-hidden="true"></span>
      ${badgeText}
    </div>
    <div class="icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
    </div>
    <h1 id="revoked-heading">${heading}</h1>
    <p id="revoked-desc">${desc}</p>
    ${errorBlock}
    <form id="reconnect-form" method="GET" action="/" novalidate>
      <input type="hidden" name="useWebSocket" value="true" />
      <label for="pair">${label}</label>
      <input type="password" id="pair" name="pair" placeholder="${placeholder}" autocomplete="off" autocapitalize="none" spellcheck="false" required aria-label="${label}" aria-required="true" aria-invalid="false" />
      <button type="submit" id="submit-btn" aria-label="${buttonAria}">
        <span>${buttonText}</span>
      </button>
    </form>
  </div>
  <script>
    (function() {
      // URL sanitization via history.replaceState
      try {
        if (window.history && window.history.replaceState) {
          var params = new URLSearchParams(window.location.search);
          if (params.has("pair") || params.has("useWebSocket")) {
            params.delete("pair");
            params.delete("useWebSocket");
            var remaining = params.toString();
            var clean = window.location.pathname + (remaining ? "?" + remaining : "") + window.location.hash;
            window.history.replaceState({}, document.title, clean);
          }
        }
      } catch (_) {}

      // Sibling tab sync
      if (typeof window.BroadcastChannel !== "undefined") {
        try {
          var bc = new BroadcastChannel("antigravity-relay");
          bc.onmessage = function(ev) {
            if (ev && ev.data && (ev.data.type === "SESSION_RESTORED" || ev.data.type === "AUTH_RESTORED")) {
              window.location.reload();
            }
          };
        } catch (_) {}
      }
      window.addEventListener("storage", function(ev) {
        if (ev.key === "ag_relay_restored_at" || ev.key === "ag_auth_restored") {
          window.location.reload();
        }
      });

      var card = document.getElementById("revocation-card");
      var input = document.getElementById("pair");
      var btn = document.getElementById("submit-btn");
      var form = document.getElementById("reconnect-form");

      // Autofocus & select on mount
      setTimeout(function() {
        if (input) {
          try {
            input.focus();
            if (typeof input.select === "function") input.select();
          } catch (_) {}
        }
      }, 50);

      // Focus trap and Escape prevention
      document.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
        if (e.key === "Tab") {
          var focusable = [input, btn].filter(function(el) { return el && !el.disabled; });
          if (focusable.length === 0) return;
          var active = document.activeElement;
          if (e.shiftKey) {
            if (!active || active === focusable[0]) {
              e.preventDefault();
              focusable[focusable.length - 1].focus();
            }
          } else {
            if (!active || active === focusable[focusable.length - 1]) {
              e.preventDefault();
              focusable[0].focus();
            }
          }
        }
      });

      // Form submission validation and loading spinner
      if (form && input && btn) {
        form.addEventListener("submit", function(e) {
          var val = input.value.trim();
          if (!val) {
            e.preventDefault();
            input.setAttribute("aria-invalid", "true");
            if (card) {
              card.classList.remove("shake");
              void card.offsetWidth;
              card.classList.add("shake");
            }
            input.focus();
            return;
          }
          input.setAttribute("aria-invalid", "false");
          btn.setAttribute("disabled", "true");
          btn.setAttribute("aria-busy", "true");
          btn.innerHTML = '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor"></circle><path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg><span>${connectingText}</span>';
        });
      }
    })();
  </script>
</body>
</html>`;
}

export class RelayServer {
  private readonly config: RelayConfig;
  private readonly sessionManager: SessionManager;
  private readonly upstreamBridge: UpstreamBridge;
  private readonly rateLimiter: AuthRateLimiter;
  private readonly portDiscovery: PortDiscoveryService;
  private readonly upstreamDispatcher: Agent;

  private app: FastifyInstance | null = null;
  private wss: WebSocketServer | null = null;
  private upgradeHandler:
    ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private activeWsConnections: Set<ActiveWsPair> = new Set();

  private isRunning = false;
  private startedAt?: number;
  private upstreamEpoch = 0;
  private hasCustomUpstreamBridge = false;
  private statusListeners: Set<(status: RelayServerStatus) => void> = new Set();
  private unhookUpstream?: () => void;
  private unhookSessionRevoked?: () => void;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly retiredPairingKeys: Map<string, number> = new Map();
  private readonly retiredKeyRecords: Map<
    string,
    {
      retiredAt: number;
      consumedByIp?: string;
      consumedByDeviceId?: string;
    }
  > = new Map();
  public static readonly RETIRED_KEY_TTL_MS = 60 * 60 * 1000; // 1 hour
  public static readonly MAX_RETIRED_KEYS = 200;
  public static readonly PAIRING_GRACE_PERIOD_MS = 60 * 1000; // 60 seconds
  private currentPairingKey: string = generatePairingKey();

  constructor(options?: RelayServerOptions) {
    this.config = {
      ...DEFAULT_RELAY_CONFIG,
      ...options?.config,
    };
    this.sessionManager =
      options?.sessionManager ??
      new SessionManager({
        maxBufferedCommands: this.config.maxBufferedCommands,
        bufferTtlMs: this.config.bufferTtlMs,
      });
    this.hasCustomUpstreamBridge = !!options?.upstreamBridge;
    this.upstreamBridge =
      options?.upstreamBridge ??
      new UpstreamBridge({
        sessionManager: this.sessionManager,
        autoReconnect: false,
      });
    this.rateLimiter = options?.rateLimiter ?? new AuthRateLimiter();

    this.portDiscovery = options?.portDiscovery ?? new PortDiscoveryService();
    if (options?.upstreamPort !== undefined) {
      this.portDiscovery.setPort(options.upstreamPort);
    }

    // Scoped Agent for localhost upstream with self-signed certificate acceptance
    this.upstreamDispatcher = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
      pipelining: 1,
      keepAliveTimeout: 30000,
    });

    this.wireUpstreamEvents();
    this.wirePortDiscoveryEvents();
    this.wireSessionEvents();
  }

  public getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  public getUpstreamBridge(): UpstreamBridge {
    return this.upstreamBridge;
  }

  public getPortDiscovery(): PortDiscoveryService {
    return this.portDiscovery;
  }

  public getPairingKey(): string {
    return this.currentPairingKey;
  }

  private pruneRetiredPairingKeys(): void {
    const now = Date.now();
    for (const [key, retiredAt] of this.retiredPairingKeys.entries()) {
      if (now - retiredAt > RelayServer.RETIRED_KEY_TTL_MS) {
        this.retiredPairingKeys.delete(key);
        this.retiredKeyRecords.delete(key);
      }
    }
    while (this.retiredPairingKeys.size > RelayServer.MAX_RETIRED_KEYS) {
      const oldestKey = this.retiredPairingKeys.keys().next().value;
      if (oldestKey !== undefined) {
        this.retiredPairingKeys.delete(oldestKey);
        this.retiredKeyRecords.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  public regeneratePairingKey(): string {
    if (this.currentPairingKey) {
      const now = Date.now();
      this.retiredPairingKeys.set(this.currentPairingKey, now);
      this.retiredKeyRecords.set(this.currentPairingKey, { retiredAt: now });
      this.pruneRetiredPairingKeys();
    }
    this.currentPairingKey = generatePairingKey();
    this.notifyStatusUpdated();
    return this.currentPairingKey;
  }

  public validatePairingKey(candidate?: string | null): boolean {
    if (!candidate || typeof candidate !== "string") {
      return false;
    }
    return validateToken(candidate.trim(), this.currentPairingKey);
  }

  public consumePairingKey(
    candidate?: string | null,
    contextOrIp?:
      | string
      | {
          clientIp?: string;
          originalDeviceId?: string;
        },
  ): {
    success: boolean;
    reason?: "invalid" | "consumed";
  } {
    this.pruneRetiredPairingKeys();
    if (!candidate || typeof candidate !== "string") {
      return { success: false, reason: "invalid" };
    }
    const trimmed = candidate.trim();
    const context =
      typeof contextOrIp === "string" ? { clientIp: contextOrIp } : contextOrIp;

    const record = this.retiredKeyRecords.get(trimmed);
    if (record) {
      const isWithinGrace =
        Date.now() - record.retiredAt <= RelayServer.PAIRING_GRACE_PERIOD_MS;
      const isSameIp = Boolean(
        context?.clientIp &&
        record.consumedByIp &&
        context.clientIp === record.consumedByIp,
      );
      const isExplicitDifferentDevice = Boolean(
        context?.originalDeviceId &&
        record.consumedByDeviceId &&
        context.originalDeviceId !== record.consumedByDeviceId,
      );

      if (isWithinGrace && isSameIp && !isExplicitDifferentDevice) {
        return { success: true };
      }
      return { success: false, reason: "consumed" };
    }

    if (this.retiredPairingKeys.has(trimmed)) {
      return { success: false, reason: "consumed" };
    }
    if (
      !this.currentPairingKey ||
      !validateToken(trimmed, this.currentPairingKey)
    ) {
      if (this.retiredPairingKeys.has(trimmed)) {
        return { success: false, reason: "consumed" };
      }
      return { success: false, reason: "invalid" };
    }

    const consumedKey = this.currentPairingKey;
    const now = Date.now();
    this.retiredPairingKeys.set(consumedKey, now);
    this.retiredKeyRecords.set(consumedKey, {
      retiredAt: now,
      consumedByIp: context?.clientIp,
      consumedByDeviceId: context?.originalDeviceId,
    });
    this.currentPairingKey = generatePairingKey();
    this.pruneRetiredPairingKeys();
    this.notifyStatusUpdated();
    return { success: true };
  }

  public isKeyConsumed(candidate?: string | null): boolean {
    if (!candidate || typeof candidate !== "string") {
      return false;
    }
    this.pruneRetiredPairingKeys();
    return this.retiredPairingKeys.has(candidate.trim());
  }

  public getRetiredPairingKeys(): Map<string, number> {
    return this.retiredPairingKeys;
  }

  public getRateLimiter(): AuthRateLimiter {
    return this.rateLimiter;
  }

  public revokeDevice(deviceId: string): boolean {
    const session = this.sessionManager.getSessionByDeviceId(deviceId);
    const sessionId = session?.sessionId;
    const revoked = this.sessionManager.revokeDevice(deviceId);
    for (const pair of Array.from(this.activeWsConnections)) {
      if (
        (sessionId && pair.sessionId === sessionId) ||
        pair.deviceId === deviceId
      ) {
        if (
          pair.clientWs.readyState === WebSocket.OPEN ||
          pair.clientWs.readyState === WebSocket.CONNECTING
        ) {
          try {
            pair.clientWs.send(
              JSON.stringify({
                type: "SESSION_REVOKED",
                reason: "Session revoked by host",
                revokedAt: Date.now(),
              }),
            );
          } catch (err) {
            logger.warn(
              "RelayServer: Failed to send SESSION_REVOKED frame",
              err,
            );
          }
        }
        safeClose(pair.clientWs, 4401, "Session revoked");
        safeClose(pair.upstreamWs, 4401, "Session revoked");
        this.activeWsConnections.delete(pair);
      }
    }
    this.notifyStatusUpdated();
    return revoked;
  }

  public getStatus(): RelayServerStatus {
    const port = this.portDiscovery.getPort();
    const isRestarting = this.portDiscovery.isRestarting();
    const isBuffering = isRestarting || this.upstreamBridge.isBuffering();

    const bridgeStatus = this.upstreamBridge.getStatus();
    const upstreamState: UpstreamBridgeState = isRestarting
      ? "reconnecting"
      : port
        ? "connected"
        : this.hasCustomUpstreamBridge
          ? bridgeStatus.state
          : "disconnected";

    const localIp = getRecommendedLocalIp();
    const networkUrl =
      this.isRunning && localIp
        ? `http://${localIp}:${this.config.port}`
        : null;

    return {
      isRunning: this.isRunning,
      port: this.config.port,
      host: this.config.host,
      activeSessions: this.sessionManager.getConnectedSessions().length,
      isBuffering,
      upstream: {
        ...bridgeStatus,
        state: upstreamState,
        targetHost: "127.0.0.1",
        targetPort: port ?? bridgeStatus.targetPort,
      },
      startedAt: this.startedAt,
      upstreamPort: port,
      upstreamEpoch: this.upstreamEpoch,
      isRestarting,
      localIp,
      networkUrl,
      pairingKey: this.isRunning ? this.currentPairingKey : null,
    };
  }

  public onStatusUpdated(
    callback: (status: RelayServerStatus) => void,
  ): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  public async start(overrides?: {
    port?: number;
    host?: string;
  }): Promise<RelayServerStatus> {
    resetFaviconCache();
    if (this.isRunning) {
      return this.getStatus();
    }

    if (overrides?.port) {
      this.config.port = overrides.port;
    }
    if (overrides?.host) {
      this.config.host = overrides.host;
    }

    await this.portDiscovery.start();

    const app = fastify({
      logger: false,
      forceCloseConnections: true,
    });

    await app.register(fastifyCors, {
      origin: this.config.corsOrigins,
      credentials: true,
    });

    // Content type parser for all media types allowing raw body forwarding
    app.addContentTypeParser("*", (_request, payload, done) => {
      done(null, payload);
    });

    // Non-proxied health check endpoint
    app.get("/health", async () => {
      const status = this.getStatus();
      return {
        success: true,
        status: "healthy",
        isRunning: this.isRunning,
        activeSessions: status.activeSessions,
        isBuffering: status.isBuffering,
        upstream: status.upstream,
        upstreamPort: status.upstreamPort,
        upstreamEpoch: this.upstreamEpoch,
        isRestarting: status.isRestarting,
        timestamp: Date.now(),
      };
    });

    // Branded favicon route
    app.get("/favicon.ico", async (_request, reply) => {
      const buffer = getFaviconBuffer();
      if (!buffer) {
        return reply.status(404).send("Not Found");
      }
      return reply
        .header("Content-Type", "image/x-icon")
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    });

    // Branded 32x32 PNG favicon route
    app.get("/favicon-32.png", async (_request, reply) => {
      const buffer = getFavicon32Buffer();
      if (!buffer) {
        return reply.status(404).send("Not Found");
      }
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    });

    // Branded app icon route
    app.get("/icon.png", async (_request, reply) => {
      const buffer = getIconPngBuffer();
      if (!buffer) {
        return reply.status(404).send("Not Found");
      }
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    });

    // Branded 192x192 PNG icon route for PWA
    app.get("/icon-192.png", async (_request, reply) => {
      const buffer = getIcon192Buffer();
      if (!buffer) {
        return reply.status(404).send("Not Found");
      }
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    });

    // Branded 512x512 PNG icon route for PWA
    app.get("/icon-512.png", async (_request, reply) => {
      const buffer = getIcon512Buffer();
      if (!buffer) {
        return reply.status(404).send("Not Found");
      }
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=86400")
        .send(buffer);
    });

    // Web app manifest routes for PWA
    const serveManifest = async (_request: unknown, reply: any) => {
      return reply
        .header("Content-Type", "application/manifest+json; charset=utf-8")
        .header("Cache-Control", "public, max-age=86400")
        .send(getManifestJson());
    };
    app.get("/manifest.json", serveManifest);
    app.get("/manifest.webmanifest", serveManifest);

    // Non-proxied status endpoint
    app.get("/api/status", async () => {
      return {
        success: true,
        data: this.getStatus(),
      };
    });

    // Sessions endpoint (backward compatibility)
    app.get("/api/sessions", async () => {
      return {
        success: true,
        data: this.sessionManager.getActiveSessions(),
      };
    });

    // Revoke session endpoint (backward compatibility)
    app.post("/api/sessions/revoke", async (request, reply) => {
      let body = request.body as Record<string, unknown> | undefined;
      if (body && typeof (body as any).pipe === "function") {
        const chunks: Buffer[] = [];
        for await (const chunk of body as any) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          body = {};
        }
      }
      if (!body || typeof body.sessionId !== "string") {
        return reply.status(400).send({
          success: false,
          error: "Missing required field: sessionId",
        });
      }
      const revoked = this.sessionManager.revokeSession(body.sessionId);
      return {
        success: revoked,
      };
    });

    // Wildcard reverse proxy handler
    app.route({
      method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"],
      url: "/*",
      handler: async (request, reply) => {
        const clientIp = extractClientIp(
          request.headers,
          request.socket?.remoteAddress,
        );
        const userAgent = extractUserAgent(request.headers);
        const requirePairing = this.config.requirePairing !== false;

        const rawUrl = request.url || "/";
        const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
        const rawAcceptLanguage = request.headers["accept-language"];
        const acceptLanguage = Array.isArray(rawAcceptLanguage)
          ? rawAcceptLanguage.join(", ")
          : rawAcceptLanguage;
        const langParam =
          parsedUrl.searchParams.get("lang") ||
          parsedUrl.searchParams.get("language");
        const viewLang = resolveRelayViewLanguage(acceptLanguage, langParam);
        const pairingToken = parsedUrl.searchParams.get("pair") || undefined;
        const sessionToken =
          (!requirePairing ? pairingToken : undefined) ||
          parsedUrl.searchParams.get("token") ||
          (request.headers["x-session-token"] as string | undefined);

        const originalDeviceId = extractDeviceId(
          request.headers,
          parsedUrl.searchParams,
        );
        let deviceId = originalDeviceId;

        const hasDeviceCookie = !!(
          request.headers["cookie"] &&
          /(?:^|;\s*)ag_device_id=/.test(String(request.headers["cookie"]))
        );

        if (!deviceId) {
          deviceId = `dev_${crypto.randomUUID()}`;
          reply.header(
            "Set-Cookie",
            `ag_device_id=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax`,
          );
        } else if (!hasDeviceCookie) {
          reply.header(
            "Set-Cookie",
            `ag_device_id=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; SameSite=Lax`,
          );
        }

        const rateLimitKey = AuthRateLimiter.buildKey(clientIp, deviceId);

        const acceptsJson =
          typeof request.headers.accept === "string" &&
          request.headers.accept.includes("application/json") &&
          !request.headers.accept.includes("text/html");

        const isHtml =
          !acceptsJson &&
          request.method === "GET" &&
          (parsedUrl.pathname === "/" ||
            parsedUrl.pathname === "/index.html" ||
            (typeof request.headers.accept === "string" &&
              request.headers.accept.includes("text/html")));

        let session: Session | undefined;

        // 1. Revoked device handling
        if (deviceId && this.sessionManager.isDeviceRevoked(deviceId)) {
          if (pairingToken) {
            if (this.rateLimiter.isRateLimited(rateLimitKey)) {
              return reply.status(429).send({
                error: "rate_limited",
                message: "Too many pairing attempts. Please wait.",
              });
            }

            const consumeResult = this.consumePairingKey(pairingToken);
            if (consumeResult.success || !requirePairing) {
              this.rateLimiter.recordSuccess(rateLimitKey);
              this.sessionManager.clearDeviceRevocation(deviceId);
              session = this.sessionManager.createSession({
                clientIp,
                userAgent,
                token: !requirePairing ? pairingToken : undefined,
                deviceId,
              });
            } else {
              this.rateLimiter.recordFailure(rateLimitKey);
              if (consumeResult.reason === "consumed") {
                if (isHtml) {
                  return reply
                    .status(401)
                    .type("text/html")
                    .send(
                      generateRevokedHtml(
                        translateRelayErrorMessage(
                          "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
                          viewLang,
                        ),
                        viewLang,
                      ),
                    );
                }
                return reply.status(401).send({
                  error: "key_consumed",
                  message:
                    "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
                  revoked: true,
                });
              } else {
                if (isHtml) {
                  return reply
                    .status(401)
                    .type("text/html")
                    .send(
                      generateRevokedHtml(
                        translateRelayErrorMessage(
                          "Invalid pairing key. Check desktop dashboard.",
                          viewLang,
                        ),
                        viewLang,
                      ),
                    );
                }
                return reply.status(401).send({
                  error: "session_revoked",
                  message: "Access was revoked by the desktop host",
                  revoked: true,
                });
              }
            }
          } else {
            if (isHtml) {
              return reply
                .status(401)
                .type("text/html")
                .send(generateRevokedHtml(undefined, viewLang));
            }
            return reply.status(401).send({
              error: "session_revoked",
              message: "Access was revoked by the desktop host",
              revoked: true,
            });
          }
        }

        // 2. Lookup existing active session (routine reload / refresh)
        if (!session && deviceId) {
          session = this.sessionManager.getSessionByDeviceId(deviceId);
        }
        if (!session && sessionToken) {
          session = this.sessionManager.getSessionByToken(sessionToken);
        }

        if (session) {
          session.clientIp = clientIp;
          session.userAgent = userAgent;
          if (deviceId && !session.deviceId) {
            this.sessionManager.updateSessionDeviceId(
              session.sessionId,
              deviceId,
            );
          }
          this.sessionManager.updateSessionActivity(session.sessionId);
        } else if (pairingToken) {
          // 3. Unauthenticated device pairing with candidate key
          if (this.rateLimiter.isRateLimited(rateLimitKey)) {
            return reply.status(429).send({
              error: "rate_limited",
              message: "Too many pairing attempts. Please wait.",
            });
          }

          const consumeResult = this.consumePairingKey(pairingToken, {
            clientIp,
            originalDeviceId,
          });
          if (consumeResult.success || !requirePairing) {
            this.rateLimiter.recordSuccess(rateLimitKey);
            session = this.sessionManager.createSession({
              clientIp,
              userAgent,
              token: !requirePairing ? pairingToken : undefined,
              deviceId,
            });
          } else {
            this.rateLimiter.recordFailure(rateLimitKey);
            if (consumeResult.reason === "consumed") {
              if (isHtml) {
                return reply
                  .status(401)
                  .type("text/html")
                  .send(
                    generatePairingHtml(
                      translateRelayErrorMessage(
                        "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
                        viewLang,
                      ),
                      viewLang,
                    ),
                  );
              }
              return reply.status(401).send({
                error: "key_consumed",
                message:
                  "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host.",
              });
            } else {
              if (isHtml) {
                return reply
                  .status(401)
                  .type("text/html")
                  .send(
                    generatePairingHtml(
                      translateRelayErrorMessage(
                        "Invalid pairing key. Check desktop dashboard.",
                        viewLang,
                      ),
                      viewLang,
                    ),
                  );
              }
              return reply.status(401).send({
                error: "invalid_key",
                message: "Invalid pairing key",
              });
            }
          }
        } else if (!requirePairing) {
          if (
            parsedUrl.pathname === "/" ||
            parsedUrl.pathname === "/index.html"
          ) {
            if (!originalDeviceId) {
              const existing = this.sessionManager
                .getActiveSessions()
                .find(
                  (s) => s.clientIp === clientIp && s.userAgent === userAgent,
                );
              if (existing) {
                if (!existing.deviceId && deviceId) {
                  this.sessionManager.updateSessionDeviceId(
                    existing.sessionId,
                    deviceId,
                  );
                }
                this.sessionManager.updateSessionActivity(existing.sessionId);
                session = existing;
              }
            }

            if (!session) {
              session = this.sessionManager.createSession({
                clientIp,
                userAgent,
                deviceId,
              });
              this.notifyStatusUpdated();
            }
          } else if (!originalDeviceId) {
            const existing = this.sessionManager
              .getActiveSessions()
              .find(
                (s) => s.clientIp === clientIp && s.userAgent === userAgent,
              );
            if (existing) {
              this.sessionManager.updateSessionActivity(existing.sessionId);
              session = existing;
            }
          }
        }

        // If still unauthenticated, block request from reaching upstream IDE
        if (requirePairing && (!session || !session.authenticated)) {
          if (isHtml) {
            return reply
              .status(401)
              .type("text/html")
              .send(generatePairingHtml(undefined, viewLang));
          }

          return reply.status(401).send({
            error: "unauthorized",
            message: "Pairing key required to access Antigravity Relay",
          });
        }

        if (this.portDiscovery.isRestarting()) {
          return reply.status(503).header("Retry-After", "2").send({
            error: "upstream_restarting",
            retry_after_ms: 2000,
          });
        }

        const port = this.portDiscovery.getPort();
        if (!port) {
          return reply.status(503).header("Retry-After", "2").send({
            error: "upstream_unavailable",
            retry_after_ms: 2000,
          });
        }

        const upstreamUrl = `https://127.0.0.1:${port}${request.url}`;

        const upstreamHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (value === undefined) continue;
          const lowerKey = key.toLowerCase();
          if (
            lowerKey === "host" ||
            lowerKey === "connection" ||
            lowerKey === "keep-alive" ||
            lowerKey === "transfer-encoding"
          ) {
            continue;
          }
          upstreamHeaders[lowerKey] = Array.isArray(value)
            ? value.join(", ")
            : value;
        }
        upstreamHeaders["host"] = `127.0.0.1:${port}`;

        const method = request.method.toUpperCase();
        const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
        let bodyStream: any = undefined;

        if (hasBody) {
          if (request.body !== undefined && request.body !== null) {
            if (
              Buffer.isBuffer(request.body) ||
              typeof request.body === "string"
            ) {
              bodyStream = request.body;
            } else if (
              typeof (request.body as any).pipe === "function" ||
              typeof (request.body as any)[Symbol.asyncIterator] === "function"
            ) {
              bodyStream = request.body;
            } else {
              bodyStream = JSON.stringify(request.body);
            }
          } else if (request.raw) {
            bodyStream = request.raw;
          }
        }

        const isPotentialHtml =
          method === "GET" &&
          (parsedUrl.pathname === "/" ||
            parsedUrl.pathname === "/index.html" ||
            parsedUrl.pathname.endsWith(".html") ||
            String(request.headers.accept || "").includes("text/html"));

        if (isPotentialHtml) {
          delete upstreamHeaders["accept-encoding"];
        }

        try {
          const upstreamRes = await undiciRequest(upstreamUrl, {
            method: method as any,
            headers: upstreamHeaders,
            body: bodyStream,
            dispatcher: this.upstreamDispatcher,
          });

          const contentType = String(
            upstreamRes.headers["content-type"] || "",
          ).toLowerCase();

          if (
            this.config.injectAutoReload !== false &&
            method === "GET" &&
            upstreamRes.statusCode === 200 &&
            contentType.includes("text/html")
          ) {
            const rawHtml = await upstreamRes.body.text();
            let finalHtml = rawHtml;

            // Regex-strip any existing <link rel="icon"...> or <link rel="shortcut icon"...>, <link rel="apple-touch-icon"...>, and <link rel="manifest"...>
            finalHtml = finalHtml.replace(
              /<link\b(?:[^>"']|"[^"]*"|'[^']*')*?\brel=["']?(?:(?:shortcut\s+)?icon|apple-touch-icon(?:-precomposed)?|manifest)["']?(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/gi,
              "",
            );

            const dataUri = getFavicon32DataUri();
            const pwaTags = [
              dataUri
                ? `<link rel="icon" type="image/png" sizes="32x32" href="${dataUri}">`
                : "",
              '<link rel="icon" type="image/x-icon" href="/favicon.ico">',
              '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
              '<link rel="apple-touch-icon" href="/icon.png">',
              '<link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png">',
              '<link rel="manifest" href="/manifest.json">',
              '<meta name="theme-color" content="#090d16">',
              '<meta name="mobile-web-app-capable" content="yes">',
              '<meta name="apple-mobile-web-app-capable" content="yes">',
              '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
              '<meta name="apple-mobile-web-app-title" content="Antigravity">',
            ]
              .filter(Boolean)
              .join("\n  ");

            if (finalHtml.includes("<head>")) {
              finalHtml = finalHtml.replace("<head>", `<head>\n  ${pwaTags}`);
            } else if (/<head[^>]*>/i.test(finalHtml)) {
              finalHtml = finalHtml.replace(
                /<head[^>]*>/i,
                (match) => `${match}\n  ${pwaTags}`,
              );
            }

            if (!rawHtml.includes('id="antigravity-relay-autoreload"')) {
              const injectedScript = generateAutoReloadScript(
                port,
                this.upstreamEpoch,
              );
              if (finalHtml.includes("</body>")) {
                finalHtml = finalHtml.replace(
                  "</body>",
                  `${injectedScript}</body>`,
                );
              } else if (finalHtml.includes("</head>")) {
                finalHtml = finalHtml.replace(
                  "</head>",
                  `${injectedScript}</head>`,
                );
              } else {
                finalHtml = finalHtml + injectedScript;
              }
            }

            for (const [headerName, headerVal] of Object.entries(
              upstreamRes.headers,
            )) {
              if (headerVal === undefined) continue;
              const lower = headerName.toLowerCase();
              if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-length") {
                continue;
              }
              reply.header(headerName, headerVal);
            }

            return reply.status(upstreamRes.statusCode).send(finalHtml);
          }

          if (upstreamRes.statusCode === 429) {
            try {
              const { AutoSwitchService } =
                await import("@/modules/cloud-account/services/AutoSwitchService");
              const { CloudAccountSettingsStore } =
                await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
              const isUnified = CloudAccountSettingsStore.isUnifiedMode();
              const switchResult =
                await AutoSwitchService.triggerRateLimitSwitch({
                  reason: "HTTP 429 upstream rate limit",
                  source: "relay",
                  appTarget: isUnified ? "all" : undefined,
                });

              if (switchResult.switched && switchResult.nextAccount) {
                this.broadcastToClients({
                  type: "BUFFERING_ALERT",
                  payload: {
                    reason: `Switched account to ${switchResult.nextAccount.email} due to rate limit. Resuming session...`,
                  },
                  timestamp: Date.now(),
                });

                return reply
                  .status(503)
                  .header("Retry-After", "3")
                  .send({
                    error: "account_switched_rate_limited",
                    message: `Rate limit reached on current account. Automatically switched to account ${switchResult.nextAccount.email} with highest 5h quota. Please retry.`,
                    switched_to: switchResult.nextAccount.email,
                    retry_after_ms: 3000,
                  });
              } else if (switchResult.noAccountLeft) {
                this.broadcastToClients({
                  type: "ERROR",
                  payload: {
                    error: "ALL_ACCOUNTS_RATE_LIMITED",
                    message:
                      "All Google accounts are currently rate-limited or depleted.",
                  },
                  timestamp: Date.now(),
                });

                return reply.status(429).header("Retry-After", "60").send({
                  error: "rate_limited",
                  message:
                    "All Google Antigravity accounts are currently rate limited. Please wait for 5h quota reset or add another account.",
                  retry_after_ms: 60000,
                });
              }
            } catch {
              // Fall through to standard 429 delivery
            }
          }

          for (const [headerName, headerVal] of Object.entries(
            upstreamRes.headers,
          )) {
            if (headerVal === undefined) continue;
            const lower = headerName.toLowerCase();
            if (HOP_BY_HOP_HEADERS.has(lower)) continue;
            reply.header(headerName, headerVal);
          }

          return reply.status(upstreamRes.statusCode).send(upstreamRes.body);
        } catch (fetchErr) {
          if (isRateLimitError(fetchErr)) {
            try {
              const { AutoSwitchService } =
                await import("@/modules/cloud-account/services/AutoSwitchService");
              const { CloudAccountSettingsStore } =
                await import("@/modules/cloud-account/persistence/cloud-account-settings-store");
              const isUnified = CloudAccountSettingsStore.isUnifiedMode();
              const switchResult =
                await AutoSwitchService.triggerRateLimitSwitch({
                  error: fetchErr,
                  reason: "Upstream rate limit connection error",
                  source: "relay",
                  appTarget: isUnified ? "all" : undefined,
                });
              if (switchResult.switched && switchResult.nextAccount) {
                return reply
                  .status(503)
                  .header("Retry-After", "3")
                  .send({
                    error: "account_switched_rate_limited",
                    message: `Rate limit reached. Automatically switched to ${switchResult.nextAccount.email}. Please retry.`,
                    retry_after_ms: 3000,
                  });
              } else if (switchResult.noAccountLeft) {
                return reply.status(429).header("Retry-After", "60").send({
                  error: "rate_limited",
                  message:
                    "All Google Antigravity accounts are currently rate limited.",
                  retry_after_ms: 60000,
                });
              }
            } catch {
              // fallback
            }
          }
          const isRestarting = this.portDiscovery.isRestarting();
          return reply
            .status(503)
            .header("Retry-After", "2")
            .send({
              error: isRestarting
                ? "upstream_restarting"
                : "upstream_unavailable",
              retry_after_ms: 2000,
            });
        }
      },
    });

    await app.listen({
      port: this.config.port,
      host: this.config.host,
    });

    const addr = app.server.address();
    if (addr && typeof addr === "object") {
      this.config.port = addr.port;
    }

    this.app = app;
    this.isRunning = true;
    this.startedAt = Date.now();
    this.startHeartbeat();

    this.setupWebSocketUpgradeHandler();

    if (this.hasCustomUpstreamBridge) {
      this.upstreamBridge.connect().catch(() => {
        // Connect errors handled by upstream bridge buffering
      });
    }

    this.notifyStatusUpdated();
    return this.getStatus();
  }

  public async stop(): Promise<void> {
    if (!this.isRunning && !this.app) {
      return;
    }

    this.stopHeartbeat();
    this.isRunning = false;
    this.startedAt = undefined;

    this.portDiscovery.stop();

    this.broadcastToClients({
      type: "RELAY_STOPPED",
      payload: {},
      timestamp: Date.now(),
    });

    for (const pair of this.activeWsConnections) {
      safeClose(pair.clientWs, 1000, "Server stopping");
      safeClose(pair.upstreamWs, 1000, "Server stopping");
    }
    this.activeWsConnections.clear();

    if (this.upgradeHandler && this.app?.server) {
      this.app.server.off("upgrade", this.upgradeHandler);
      this.upgradeHandler = null;
    }

    if (this.wss) {
      try {
        this.wss.close();
      } catch {
        // Suppress websocket server close error
      }
      this.wss = null;
    }

    for (const session of this.sessionManager.getActiveSessions()) {
      this.sessionManager.closeSessionSocket(
        session.sessionId,
        1000,
        "Server stopping",
      );
    }

    await this.upstreamBridge.disconnect();

    if (this.app) {
      try {
        await this.app.close();
      } catch {
        // Suppress fastify close error
      }
      this.app = null;
    }

    this.notifyStatusUpdated();
  }

  public broadcastToClients(event: RemoteEvent): void {
    const payload = JSON.stringify(event);
    for (const session of this.sessionManager.getActiveSessions()) {
      const sockets = this.sessionManager.getSockets(session.sessionId);
      for (const socket of sockets) {
        if (socket && socket.readyState === 1 /* OPEN */) {
          try {
            socket.send(payload);
          } catch {
            // Suppress socket send error
          }
        }
      }
    }
  }

  public dispose(): void {
    this.stopHeartbeat();
    this.portDiscovery.dispose();
    try {
      this.upstreamDispatcher.destroy();
    } catch {
      // Suppress agent destroy error
    }
    if (this.unhookUpstream) {
      this.unhookUpstream();
      this.unhookUpstream = undefined;
    }
    if (this.unhookSessionRevoked) {
      this.unhookSessionRevoked();
      this.unhookSessionRevoked = undefined;
    }
    this.upstreamBridge.dispose();
    this.statusListeners.clear();
  }

  public getApp(): FastifyInstance | null {
    return this.app;
  }

  public startHeartbeat(): void {
    this.stopHeartbeat();
    if (
      this.config.heartbeatIntervalMs &&
      this.config.heartbeatIntervalMs > 0
    ) {
      this.heartbeatTimer = setInterval(() => {
        this.broadcastHeartbeat();
      }, this.config.heartbeatIntervalMs);
    }
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public broadcastHeartbeat(): void {
    const activeSessions = this.sessionManager.getActiveSessions();
    const payload = JSON.stringify({
      type: "HEARTBEAT",
      payload: {
        timestamp: Date.now(),
        isBuffering: this.upstreamBridge.isBuffering(),
        activeSessions: activeSessions.length,
      },
      timestamp: Date.now(),
    });

    for (const session of activeSessions) {
      const sockets = this.sessionManager.getSockets(session.sessionId);
      for (const socket of sockets) {
        if (socket.readyState === 1 /* OPEN */) {
          try {
            socket.send(payload);
          } catch {
            this.sessionManager.unbindSocket(session.sessionId, socket);
          }
        } else if (socket.readyState === 2 || socket.readyState === 3) {
          this.sessionManager.unbindSocket(session.sessionId, socket);
        }
      }
    }
  }

  private setupWebSocketUpgradeHandler(): void {
    if (!this.app?.server) {
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });

    this.upgradeHandler = (
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
    ) => {
      const parsedUrl = req.url ? new URL(req.url, "http://127.0.0.1") : null;
      const pathname = parsedUrl?.pathname ?? "";

      if (pathname === "/connect-websocket" || pathname === "/ws") {
        const port = this.portDiscovery.getPort();
        if (!port || this.portDiscovery.isRestarting()) {
          const reason = this.portDiscovery.isRestarting()
            ? "upstream_restarting"
            : "upstream_unavailable";
          const body = JSON.stringify({ error: reason, retry_after_ms: 2000 });
          socket.write(
            `HTTP/1.1 503 Service Unavailable\r\n` +
              `Content-Type: application/json\r\n` +
              `Retry-After: 2\r\n` +
              `Content-Length: ${Buffer.byteLength(body)}\r\n` +
              `Connection: close\r\n` +
              `\r\n` +
              body,
          );
          socket.destroy();
          return;
        }

        const clientIp = extractClientIp(
          req.headers,
          req.socket?.remoteAddress,
        );
        const deviceId = extractDeviceId(
          req.headers as any,
          parsedUrl?.searchParams,
        );
        const rateLimitKey = AuthRateLimiter.buildKey(clientIp, deviceId);

        if (deviceId && this.sessionManager.isDeviceRevoked(deviceId)) {
          const pairParam = parsedUrl?.searchParams.get("pair");
          if (this.rateLimiter.isRateLimited(rateLimitKey)) {
            const body = JSON.stringify({
              error: "rate_limited",
              message: "Too many pairing attempts. Please wait.",
            });
            socket.write(
              `HTTP/1.1 429 Too Many Requests\r\n` +
                `Content-Type: application/json\r\n` +
                `Retry-After: 60\r\n` +
                `Content-Length: ${Buffer.byteLength(body)}\r\n` +
                `Connection: close\r\n` +
                `\r\n` +
                body,
            );
            socket.destroy();
            return;
          }

          if (pairParam && this.validatePairingKey(pairParam)) {
            // Valid pairing key provided; allow upgrade to bridgeWebSocket where key is consumed
          } else {
            this.rateLimiter.recordFailure(rateLimitKey);
            const isConsumed =
              pairParam && this.retiredPairingKeys.has(pairParam.trim());
            const errorCode = isConsumed ? "key_consumed" : "session_revoked";
            const errorMsg = isConsumed
              ? "This pairing key has already been consumed by another device. Please get a fresh key from the desktop host."
              : "Access was revoked by the desktop host";
            const body = JSON.stringify({
              error: errorCode,
              message: errorMsg,
              revoked: true,
            });
            socket.write(
              `HTTP/1.1 401 Unauthorized\r\n` +
                `Content-Type: application/json\r\n` +
                `Content-Length: ${Buffer.byteLength(body)}\r\n` +
                `Connection: close\r\n` +
                `\r\n` +
                body,
            );
            socket.destroy();
            return;
          }
        }

        this.wss?.handleUpgrade(req, socket, head, (clientWs) => {
          this.bridgeWebSocket(clientWs, req, port);
        });
        return;
      }

      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    };

    this.app.server.on("upgrade", this.upgradeHandler);
  }

  private bridgeWebSocket(
    clientWs: WebSocket,
    req: IncomingMessage,
    upstreamPort: number,
  ): void {
    const clientIp = extractClientIp(req.headers, req.socket?.remoteAddress);
    const userAgent = extractUserAgent(req.headers);
    const requirePairing = this.config.requirePairing !== false;

    const parsedUrl = req.url ? new URL(req.url, "http://127.0.0.1") : null;
    const pairParam = parsedUrl?.searchParams.get("pair") || undefined;
    const sessionToken =
      (!requirePairing ? pairParam : undefined) ||
      parsedUrl?.searchParams.get("token") ||
      (req.headers["x-session-token"] as string | undefined);
    const originalDeviceId = extractDeviceId(
      req.headers as any,
      parsedUrl?.searchParams,
    );
    let deviceId = originalDeviceId;

    const rateLimitKey = AuthRateLimiter.buildKey(clientIp, deviceId);
    let session: Session | undefined;

    // Handle revoked device
    if (deviceId && this.sessionManager.isDeviceRevoked(deviceId)) {
      if (pairParam) {
        if (this.rateLimiter.isRateLimited(rateLimitKey)) {
          safeClose(clientWs, 4401, "Rate limited");
          return;
        }
        const consumeResult = this.consumePairingKey(pairParam);
        if (consumeResult.success || !requirePairing) {
          this.rateLimiter.recordSuccess(rateLimitKey);
          this.sessionManager.clearDeviceRevocation(deviceId);
          session = this.sessionManager.createSession({
            clientIp,
            userAgent,
            token: !requirePairing ? pairParam : undefined,
            deviceId,
          });
        } else {
          this.rateLimiter.recordFailure(rateLimitKey);
          safeClose(clientWs, 4401, "Session revoked");
          return;
        }
      } else {
        safeClose(clientWs, 4401, "Session revoked");
        return;
      }
    }

    // Check existing session (routine reload / refresh / cookie-based authentication)
    if (!session && deviceId) {
      session = this.sessionManager.getSessionByDeviceId(deviceId);
    }
    if (!session && sessionToken) {
      session = this.sessionManager.getSessionByToken(sessionToken);
    }

    // If session exists: existing sessions bypass pairing re-check!
    if (!session) {
      if (pairParam) {
        if (this.rateLimiter.isRateLimited(rateLimitKey)) {
          safeClose(clientWs, 4401, "Rate limited");
          return;
        }
        const consumeResult = this.consumePairingKey(pairParam, {
          clientIp,
          originalDeviceId,
        });
        if (consumeResult.success || !requirePairing) {
          this.rateLimiter.recordSuccess(rateLimitKey);
          if (!deviceId) {
            deviceId = `dev_${crypto.randomUUID()}`;
          }
          session = this.sessionManager.createSession({
            clientIp,
            userAgent,
            token: !requirePairing ? pairParam : undefined,
            deviceId,
          });
        } else {
          this.rateLimiter.recordFailure(rateLimitKey);
        }
      } else if (!requirePairing) {
        if (!deviceId && !originalDeviceId) {
          const existing = this.sessionManager
            .getActiveSessions()
            .find(
              (s) =>
                s.clientIp === clientIp &&
                s.userAgent === userAgent &&
                s.socketState === "disconnected",
            );
          if (existing) {
            session = existing;
          }
        }
        if (!session) {
          if (!deviceId) {
            deviceId = `dev_${crypto.randomUUID()}`;
          }
          session = this.sessionManager.createSession({
            clientIp,
            userAgent,
            deviceId,
          });
          this.notifyStatusUpdated();
        }
      }
    }

    if (requirePairing && (!session || !session.authenticated)) {
      safeClose(clientWs, 4401, "Unauthorized: Pairing key required");
      return;
    }

    if (!session) {
      safeClose(clientWs, 1008, "Session initialization failed");
      return;
    }

    session.clientIp = clientIp;
    session.userAgent = userAgent;
    if (deviceId && !session.deviceId) {
      this.sessionManager.updateSessionDeviceId(session.sessionId, deviceId);
    }

    const sessionId = session.sessionId;
    this.sessionManager.bindSocket(sessionId, clientWs);
    this.notifyStatusUpdated();

    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      const lowerKey = key.toLowerCase();
      if (
        [
          "host",
          "upgrade",
          "connection",
          "sec-websocket-key",
          "sec-websocket-version",
          "sec-websocket-extensions",
        ].includes(lowerKey)
      ) {
        continue;
      }
      forwardHeaders[lowerKey] = Array.isArray(value)
        ? value.join(", ")
        : value;
    }
    forwardHeaders["host"] = `127.0.0.1:${upstreamPort}`;

    const upstreamUrl = `wss://127.0.0.1:${upstreamPort}${req.url || "/connect-websocket"}`;
    const upstreamWs = new WebSocket(upstreamUrl, {
      headers: forwardHeaders,
      rejectUnauthorized: false,
    });

    const pair: ActiveWsPair = { clientWs, upstreamWs, sessionId, deviceId };
    this.activeWsConnections.add(pair);

    const pendingMessages: Array<{ data: RawData; isBinary: boolean }> = [];
    let isUpstreamOpen = false;

    upstreamWs.on("open", () => {
      isUpstreamOpen = true;
      for (const msg of pendingMessages) {
        try {
          upstreamWs.send(msg.data, { binary: msg.isBinary });
        } catch {
          // Suppress send error
        }
      }
      pendingMessages.length = 0;
    });

    clientWs.on("message", (data: RawData, isBinary: boolean) => {
      this.sessionManager.updateSessionActivity(sessionId);
      if (isUpstreamOpen && upstreamWs.readyState === WebSocket.OPEN) {
        try {
          upstreamWs.send(data, { binary: isBinary });
        } catch {
          // Suppress send error
        }
      } else if (upstreamWs.readyState === WebSocket.CONNECTING) {
        pendingMessages.push({ data, isBinary });
      }
    });

    upstreamWs.on("message", (data: RawData, isBinary: boolean) => {
      this.sessionManager.updateSessionActivity(sessionId);
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(data, { binary: isBinary });
        } catch {
          // Suppress send error
        }
      }
    });

    clientWs.on("close", (code: number, reason: Buffer) => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(upstreamWs, code, reason);
      this.notifyStatusUpdated();
    });

    upstreamWs.on("close", (code: number, reason: Buffer) => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(clientWs, code, reason);
      this.notifyStatusUpdated();
    });

    clientWs.on("error", () => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(upstreamWs);
      this.notifyStatusUpdated();
    });

    upstreamWs.on("error", () => {
      this.activeWsConnections.delete(pair);
      this.sessionManager.unbindSocket(sessionId, clientWs as any);
      safeClose(clientWs, 1011, "Upstream connection error");
      this.notifyStatusUpdated();
    });
  }

  private handlePortChanged(_oldPort: number | null, _newPort: number): void {
    this.upstreamEpoch++;
    if (!this.hasCustomUpstreamBridge) {
      this.upstreamBridge.flushBuffer().catch(() => {});
    }
    for (const pair of this.activeWsConnections) {
      if (pair.sessionId) {
        this.sessionManager.unbindSocket(pair.sessionId);
      }
      safeClose(pair.clientWs, 1012, "Service Restart");
      safeClose(pair.upstreamWs, 1012, "Service Restart");
    }
    this.activeWsConnections.clear();
    this.notifyStatusUpdated();
  }

  private handleRestarting(): void {
    this.upstreamEpoch++;
    if (!this.hasCustomUpstreamBridge) {
      this.upstreamBridge.enterBuffering("Antigravity restarting");
    }
    for (const pair of this.activeWsConnections) {
      if (pair.sessionId) {
        this.sessionManager.unbindSocket(pair.sessionId);
      }
      safeClose(pair.clientWs, 1012, "Service Restart");
      safeClose(pair.upstreamWs, 1012, "Service Restart");
    }
    this.activeWsConnections.clear();
    this.notifyStatusUpdated();
  }

  private wireSessionEvents(): void {
    this.unhookSessionRevoked = this.sessionManager.onSessionRevoked(
      (revokedSessionId) => {
        for (const pair of Array.from(this.activeWsConnections)) {
          if (pair.sessionId === revokedSessionId) {
            safeClose(pair.clientWs, 4401, "Session revoked");
            safeClose(pair.upstreamWs, 4401, "Session revoked");
            this.activeWsConnections.delete(pair);
          }
        }
        this.notifyStatusUpdated();
      },
    );
  }

  private wirePortDiscoveryEvents(): void {
    this.portDiscovery.on("port-discovered", () => {
      if (!this.hasCustomUpstreamBridge) {
        this.upstreamBridge.flushBuffer().catch(() => {});
      }
      this.notifyStatusUpdated();
    });

    this.portDiscovery.on("port-changed", ({ oldPort, newPort }) => {
      this.handlePortChanged(oldPort, newPort);
    });

    this.portDiscovery.on("restarting", () => {
      this.handleRestarting();
    });
  }

  private wireUpstreamEvents(): void {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      this.upstreamBridge.onBufferingAlert((reason) => {
        this.broadcastToClients({
          type: "BUFFERING_ALERT",
          payload: { reason },
          timestamp: Date.now(),
        });
        this.notifyStatusUpdated();
      }),
    );

    unsubs.push(
      this.upstreamBridge.onSwapResumed(() => {
        this.broadcastToClients({
          type: "SWAP_RESUMED",
          payload: {},
          timestamp: Date.now(),
        });
        this.notifyStatusUpdated();
      }),
    );

    unsubs.push(
      this.upstreamBridge.onMessage((data) => {
        const payload =
          typeof data === "object" && data !== null
            ? (data as Record<string, unknown>)
            : { text: String(data) };
        this.broadcastToClients({
          type: "AGENT_OUTPUT",
          payload,
          timestamp: Date.now(),
        });
      }),
    );

    unsubs.push(
      this.upstreamBridge.onStateChange(() => {
        this.notifyStatusUpdated();
      }),
    );

    this.unhookUpstream = () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }

  private notifyStatusUpdated(): void {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Suppress listener error
      }
    }
  }
}
