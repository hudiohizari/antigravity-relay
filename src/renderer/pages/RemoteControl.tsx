import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "../locales/i18n";
import { useRelayStatus } from "../hooks/useRelayStatus";
import { useTunnelStatus } from "../hooks/useTunnelStatus";
import { QRCode } from "../components/QRCode";
import { Session, RelayServerStatus, TunnelStatus } from "../../shared/types";
import {
  Radio,
  Copy,
  Check,
  RotateCw,
  Smartphone,
  ShieldAlert,
  Server,
  Cloud,
  QrCode,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatRelativeTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function parseDeviceUserAgent(ua: string): { device: string; browser: string } {
  if (!ua || ua.trim().length === 0) {
    return { device: "Mobile Device", browser: "Web Browser" };
  }
  let device = "Mobile Device";
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua)) device = "iPad";
  else if (/Android/i.test(ua)) device = "Android Device";
  else if (/Macintosh|Mac OS/i.test(ua)) device = "Mac";
  else if (/Windows/i.test(ua)) device = "Windows PC";
  else if (/Linux/i.test(ua)) device = "Linux PC";

  let browser = "Browser";
  if (/Chrome/i.test(ua) && !/Edge|Edg/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Edge|Edg/i.test(ua)) browser = "Edge";

  return { device, browser };
}

function generatePairingToken(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export interface RemoteControlProps {
  relayStatusOverride?: RelayServerStatus | null;
  tunnelStatusOverride?: TunnelStatus | null;
  sessionsOverride?: Session[];
}

export const RemoteControl: React.FC<RemoteControlProps> = ({
  relayStatusOverride,
  tunnelStatusOverride,
  sessionsOverride,
}) => {
  const { t } = useTranslation();

  const {
    status: hookRelayStatus,
    sessions: hookSessions,
    isLoading: isRelayLoading,
    isStarting: isRelayStarting,
    isStopping: isRelayStopping,
    revokingSessionId,
    error: relayError,
    fetchStatus: fetchRelayStatus,
    startRelay,
    stopRelay,
    revokeSession,
    clearError: clearRelayError,
  } = useRelayStatus();

  const {
    status: hookTunnelStatus,
    publicUrl: hookPublicUrl,
    isLoading: isTunnelLoading,
    isStarting: isTunnelStarting,
    isRestarting: isTunnelRestarting,
    error: tunnelError,
    fetchStatus: fetchTunnelStatus,
    restartTunnel,
    clearError: clearTunnelError,
  } = useTunnelStatus();

  const relayStatus =
    relayStatusOverride !== undefined ? relayStatusOverride : hookRelayStatus;
  const tunnelStatus =
    tunnelStatusOverride !== undefined
      ? tunnelStatusOverride
      : hookTunnelStatus;
  const sessions =
    sessionsOverride !== undefined ? sessionsOverride : hookSessions;
  const publicUrl =
    tunnelStatusOverride !== undefined
      ? (tunnelStatusOverride?.publicUrl ?? null)
      : hookPublicUrl;

  // Ephemeral pairing token
  const [pairingToken, setPairingToken] = useState<string>(() =>
    generatePairingToken(),
  );

  // Copy feedback state
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Session revocation confirmation modal
  const [sessionToRevoke, setSessionToRevoke] = useState<Session | null>(null);

  // Periodic ticker for live session durations
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Compute pairing URL
  const pairingUrl = useMemo(() => {
    if (publicUrl && publicUrl.trim().length > 0) {
      const base = publicUrl.endsWith("/") ? publicUrl.slice(0, -1) : publicUrl;
      return `${base}/?pair=${pairingToken}`;
    }
    const port = relayStatus?.port || 4040;
    return `http://127.0.0.1:${port}/?pair=${pairingToken}`;
  }, [publicUrl, relayStatus?.port, pairingToken]);

  const handleToggleRelay = useCallback(async () => {
    clearRelayError();
    if (relayStatus?.isRunning) {
      await stopRelay();
    } else {
      await startRelay();
    }
  }, [relayStatus?.isRunning, startRelay, stopRelay, clearRelayError]);

  const handleCopyUrl = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopiedUrl(true);
      setToastMessage(t("tunnel.urlCopied"));
      setTimeout(() => setCopiedUrl(false), 2000);
      setTimeout(() => setToastMessage(null), 3000);
    } catch {
      // Ignore clipboard failure
    }
  }, [publicUrl, t]);

  const handleCopyToken = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pairingToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }, [pairingToken]);

  const handleRegenerateKey = useCallback(() => {
    setPairingToken(generatePairingToken());
  }, []);

  const handleRefreshAll = useCallback(async () => {
    await Promise.all([fetchRelayStatus(), fetchTunnelStatus()]);
  }, [fetchRelayStatus, fetchTunnelStatus]);

  const handleConfirmRevoke = useCallback(async () => {
    if (!sessionToRevoke) return;
    const targetSession = sessionToRevoke;
    setSessionToRevoke(null);
    const parsed = parseDeviceUserAgent(targetSession.userAgent);
    const success = await revokeSession(targetSession.sessionId);
    if (success) {
      setToastMessage(t("sessions.revokedToast", { device: parsed.device }));
      setTimeout(() => setToastMessage(null), 3000);
    }
  }, [sessionToRevoke, revokeSession, t]);

  // Upstream daemon badge styling
  const upstreamState = relayStatus?.upstream?.state || "disconnected";
  const upstreamPill = useMemo(() => {
    if (relayStatus?.isBuffering) {
      return {
        text: t("relay.upstreamBuffering"),
        badgeClass:
          "bg-[var(--status-upstream-buffering-bg,rgba(168,85,247,0.12))] text-[var(--status-upstream-buffering-text,#c084fc)] border-[var(--status-upstream-buffering-border,rgba(168,85,247,0.3))]",
        dotClass: "bg-[var(--status-upstream-buffering,#a855f7)] animate-ping",
      };
    }
    if (upstreamState === "connected") {
      return {
        text: t("relay.upstreamConnected"),
        badgeClass:
          "bg-[var(--status-upstream-connected-bg,rgba(16,185,129,0.12))] text-[var(--status-upstream-connected-text,#34d399)] border-[var(--status-upstream-connected-border,rgba(16,185,129,0.3))]",
        dotClass: "bg-[var(--status-upstream-connected,#10b981)]",
      };
    }
    if (upstreamState === "reconnecting") {
      return {
        text: t("relay.upstreamReconnecting"),
        badgeClass:
          "bg-[var(--status-upstream-reconnecting-bg,rgba(245,158,11,0.12))] text-[var(--status-upstream-reconnecting-text,#fbbf24)] border-[var(--status-upstream-reconnecting-border,rgba(245,158,11,0.3))]",
        dotClass:
          "bg-[var(--status-upstream-reconnecting,#f59e0b)] animate-pulse",
      };
    }
    return {
      text: t("relay.upstreamOffline"),
      badgeClass:
        "bg-[var(--status-stopped-bg,rgba(113,113,122,0.12))] text-[var(--status-stopped-text,#9ca3af)] border-[var(--status-stopped-border,rgba(113,113,122,0.3))]",
      dotClass: "bg-[var(--status-stopped,#71717a)]",
    };
  }, [upstreamState, relayStatus?.isBuffering, t]);

  const bufferCount = relayStatus?.upstream?.bufferedCommandCount || 0;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 max-w-7xl mx-auto w-full gap-6 overflow-y-auto min-w-0">
      {/* Toast Notification Live Region */}
      {toastMessage && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--primitive-color-emerald-600,#059669)] text-white shadow-lg text-sm font-medium animate-in fade-in slide-in-from-bottom-2"
        >
          <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{toastMessage}</span>
        </aside>
      )}

      {/* Header Section */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Radio
              className="w-6 h-6 text-[var(--primitive-color-blue-500,#3b82f6)] shrink-0"
              aria-hidden="true"
            />
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] truncate">
              {t("remote.title")}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
            {t("remote.subtitle")}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={isRelayLoading || isTunnelLoading}
          aria-label={t("common.actions.refresh")}
          className="min-h-[44px] min-w-[44px] px-3 py-2 flex items-center justify-center gap-2 rounded bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors shrink-0"
        >
          <RotateCw
            className={`w-4 h-4 ${isRelayLoading || isTunnelLoading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{t("common.actions.refresh")}</span>
        </button>
      </header>

      {/* Main 2-Column Responsive Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Column 1: Local Relay Server & Cloudflare Quick Tunnel */}
        <section
          aria-labelledby="relay-supervisor-heading"
          className="flex flex-col gap-6 min-w-0"
        >
          <h2 id="relay-supervisor-heading" className="sr-only">
            Relay Server and Tunnel Management
          </h2>

          {/* Card 1: Fastify Local Relay Server */}
          <article className="p-4 sm:p-5 rounded-lg bg-[var(--comp-card-bg)] border border-[var(--comp-card-border)] flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Server
                    className="w-5 h-5 text-[var(--primitive-color-blue-400,#60a5fa)] shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
                    {t("relay.title")}
                  </h3>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t("relay.subtitle")}
                </p>
              </div>

              {/* Master Relay Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={relayStatus?.isRunning || false}
                aria-busy={isRelayStarting || isRelayStopping}
                aria-label={
                  relayStatus?.isRunning
                    ? t("relay.toggleStop")
                    : t("relay.toggleStart")
                }
                disabled={isRelayStarting || isRelayStopping}
                onClick={handleToggleRelay}
                className={`min-h-[44px] min-w-[64px] px-1 inline-flex items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  relayStatus?.isRunning
                    ? "bg-[var(--primitive-color-emerald-600,#059669)]"
                    : "bg-[var(--primitive-color-neutral-700,#3f3f46)]"
                }`}
              >
                <span
                  className={`inline-block w-6 h-6 transform rounded-full bg-white transition-transform ${
                    relayStatus?.isRunning ? "translate-x-7" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Error Banner */}
            {relayError && (
              <div
                role="alert"
                className="p-3 rounded bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-xs text-[var(--status-error-text)] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert
                    className="w-4 h-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{relayError}</span>
                </div>
                <button
                  type="button"
                  onClick={clearRelayError}
                  aria-label="Dismiss error"
                  className="min-h-[44px] min-w-[44px] p-2 text-[var(--status-error-text)] hover:opacity-80"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Relay Telemetry Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-[var(--border-subtle)]">
              {/* Operational State */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Status
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      relayStatus?.isRunning
                        ? "bg-[var(--primitive-color-emerald-500,#10b981)]"
                        : "bg-[var(--primitive-color-neutral-400,#71717a)]"
                    }`}
                  />
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {isRelayStarting
                      ? t("relay.statusStarting")
                      : isRelayStopping
                        ? t("relay.statusStopping")
                        : relayStatus?.isRunning
                          ? t("relay.statusActive")
                          : t("relay.statusInactive")}
                  </span>
                </div>
              </div>

              {/* Bound Port */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Network Port
                </span>
                <span className="text-xs font-mono text-[var(--text-primary)]">
                  {t("relay.port", { port: relayStatus?.port || 4040 })}
                </span>
              </div>

              {/* FIFO Command Buffer Count */}
              <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  {t("relay.bufferLabel")}
                </span>
                <span
                  className={`text-xs font-mono ${
                    bufferCount > 0
                      ? "text-[var(--status-upstream-buffering-text,#c084fc)] font-semibold"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {bufferCount > 0
                    ? t("relay.bufferCount", { count: bufferCount })
                    : t("relay.bufferEmpty")}
                </span>
              </div>
            </div>

            {/* Upstream Daemon Health Banner */}
            <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-medium text-[var(--text-secondary)]">
                {t("relay.upstreamTitle")}
              </span>
              <div
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-semibold ${upstreamPill.badgeClass}`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${upstreamPill.dotClass}`}
                />
                <span>{upstreamPill.text}</span>
              </div>
            </div>
          </article>

          {/* Card 2: Cloudflare Quick Tunnel */}
          <article className="p-4 sm:p-5 rounded-lg bg-[var(--comp-card-bg)] border border-[var(--comp-card-border)] flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Cloud
                    className="w-5 h-5 text-[var(--primitive-color-emerald-400,#34d399)] shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
                    {t("tunnel.title")}
                  </h3>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t("tunnel.subtitle")}
                </p>
              </div>

              {/* Tunnel Status Pill */}
              <div
                className={`px-2.5 py-1 rounded-full border text-xs font-semibold shrink-0 inline-flex items-center gap-1.5 ${
                  tunnelStatus?.state === "connected"
                    ? "bg-[rgba(16,185,129,0.12)] text-[var(--primitive-color-emerald-400,#34d399)] border-[rgba(16,185,129,0.3)]"
                    : tunnelStatus?.state === "starting" ||
                        tunnelStatus?.state === "reconnecting"
                      ? "bg-[rgba(245,158,11,0.12)] text-[var(--primitive-color-amber-400,#fbbf24)] border-[rgba(245,158,11,0.3)]"
                      : tunnelStatus?.state === "error"
                        ? "bg-[rgba(239,68,68,0.12)] text-[var(--primitive-color-red-400,#f87171)] border-[rgba(239,68,68,0.3)]"
                        : "bg-[rgba(113,113,122,0.12)] text-[var(--primitive-color-neutral-300,#d1d5db)] border-[rgba(113,113,122,0.3)]"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    tunnelStatus?.state === "connected"
                      ? "bg-[var(--primitive-color-emerald-500,#10b981)]"
                      : tunnelStatus?.state === "starting" ||
                          tunnelStatus?.state === "reconnecting"
                        ? "bg-[var(--primitive-color-amber-500,#f59e0b)] animate-pulse"
                        : tunnelStatus?.state === "error"
                          ? "bg-[var(--primitive-color-red-500,#ef4444)]"
                          : "bg-[var(--primitive-color-neutral-400,#71717a)]"
                  }`}
                />
                <span>
                  {tunnelStatus?.state === "connected"
                    ? t("tunnel.statusConnected")
                    : tunnelStatus?.state === "starting"
                      ? t("tunnel.statusStarting")
                      : tunnelStatus?.state === "reconnecting"
                        ? t("tunnel.statusReconnecting")
                        : tunnelStatus?.state === "error"
                          ? t("tunnel.statusError")
                          : t("tunnel.statusStopped")}
                </span>
              </div>
            </div>

            {/* Error Banner */}
            {tunnelError && (
              <div
                role="alert"
                className="p-3 rounded bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-xs text-[var(--status-error-text)] flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert
                    className="w-4 h-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{tunnelError}</span>
                </div>
                <button
                  type="button"
                  onClick={clearTunnelError}
                  aria-label="Dismiss error"
                  className="min-h-[44px] min-w-[44px] p-2 text-[var(--status-error-text)] hover:opacity-80"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Public URL Box */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="public-tunnel-url"
                className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider"
              >
                {t("tunnel.urlLabel")}
              </label>
              <div className="p-3 rounded bg-[var(--comp-tunnel-code-bg,#090d16)] border border-[var(--comp-tunnel-code-border)] flex items-center justify-between gap-3 min-w-0">
                <span
                  id="public-tunnel-url"
                  tabIndex={0}
                  className={`font-mono text-xs sm:text-sm truncate select-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)] ${
                    publicUrl
                      ? "text-[var(--comp-tunnel-code-text,#34d399)] font-medium"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {publicUrl || t("tunnel.urlPlaceholder")}
                </span>

                {publicUrl && (
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    aria-label={t("tunnel.copyUrl")}
                    className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded bg-[var(--comp-tunnel-copy-btn-bg,#1f2937)] hover:bg-[var(--comp-tunnel-copy-btn-hover,#27272a)] text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors shrink-0"
                  >
                    {copiedUrl ? (
                      <Check
                        className="w-4 h-4 text-[var(--primitive-color-emerald-400,#34d399)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Tunnel Actions and Process Telemetry */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => restartTunnel()}
                  disabled={isTunnelStarting || isTunnelRestarting}
                  className="min-h-[44px] px-3 py-2 flex items-center justify-center gap-2 rounded bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 ${isTunnelRestarting ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  <span>
                    {isTunnelRestarting
                      ? t("tunnel.restarting")
                      : t("tunnel.restartTunnel")}
                  </span>
                </button>
              </div>

              {tunnelStatus?.pid && (
                <span className="text-[11px] font-mono text-[var(--text-muted)]">
                  {t("tunnel.pid", { pid: tunnelStatus.pid })}
                </span>
              )}
            </div>
          </article>
        </section>

        {/* Column 2: Mobile Pairing & QR Access Card */}
        <section aria-labelledby="pairing-card-heading" className="min-w-0">
          <h2 id="pairing-card-heading" className="sr-only">
            Mobile QR Pairing and Security Credentials
          </h2>

          <article className="p-4 sm:p-5 rounded-lg bg-[var(--comp-card-bg)] border border-[var(--comp-card-border)] flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <QrCode
                    className="w-5 h-5 text-[var(--primitive-color-emerald-400,#34d399)] shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="font-semibold text-sm sm:text-base text-[var(--text-primary)] truncate">
                    {t("pairing.title")}
                  </h3>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {t("pairing.subtitle")}
                </p>
              </div>
            </div>

            {/* QR Code Presentation Container with High-Contrast Quiet Zone */}
            <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-[var(--bg-canvas)] border border-[var(--border-subtle)] gap-3">
              <QRCode
                value={pairingUrl}
                size={180}
                title={t("pairing.title")}
                description={t("pairing.scanInstructions")}
                ariaLabel={t("pairing.qrAlt")}
              />

              <div className="text-center max-w-xs">
                <p className="text-xs font-medium text-[var(--text-primary)]">
                  {t("pairing.scanInstructions")}
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  {t("pairing.scanTip")}
                </p>
              </div>
            </div>

            {/* Ephemeral Pairing Key Display and Actions */}
            <div className="flex flex-col gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>Pairing Token</span>
                <button
                  type="button"
                  onClick={handleRegenerateKey}
                  className="min-h-[44px] px-2 py-1 text-xs text-[var(--primitive-color-blue-400,#60a5fa)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-focus)] rounded cursor-pointer"
                >
                  {t("pairing.regenerateToken")}
                </button>
              </div>

              <div className="p-2.5 rounded bg-[var(--comp-tunnel-code-bg,#090d16)] border border-[var(--comp-tunnel-code-border)] flex items-center justify-between gap-2 min-w-0">
                <span className="font-mono text-xs text-[var(--text-secondary)] truncate select-text">
                  {pairingToken}
                </span>
                <button
                  type="button"
                  onClick={handleCopyToken}
                  aria-label="Copy Pairing Token"
                  className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors shrink-0"
                >
                  {copiedToken ? (
                    <Check
                      className="w-3.5 h-3.5 text-[var(--primitive-color-emerald-400,#34d399)]"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>

              {/* Security Notice */}
              <div className="p-2.5 rounded bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] flex items-start gap-2 text-xs text-[var(--primitive-color-amber-300,#fcd34d)]">
                <ShieldAlert
                  className="w-4 h-4 text-[var(--primitive-color-amber-400,#fbbf24)] shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <span className="leading-relaxed">
                  {t("pairing.securityNotice")}
                </span>
              </div>
            </div>
          </article>
        </section>
      </div>

      {/* Full-Width Section: Connected Mobile Phone Sessions */}
      <section
        aria-labelledby="connected-sessions-heading"
        className="flex flex-col gap-3 min-w-0"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Smartphone
              className="w-5 h-5 text-[var(--primitive-color-blue-400,#60a5fa)] shrink-0"
              aria-hidden="true"
            />
            <h2
              id="connected-sessions-heading"
              className="font-bold text-sm sm:text-base text-[var(--text-primary)] truncate"
            >
              {t("sessions.title")}
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] shrink-0">
              {t("sessions.activeCount", { count: sessions.length })}
            </span>
          </div>
        </div>

        {/* Sessions Content: Table or Empty State */}
        {sessions.length === 0 ? (
          <div className="p-8 rounded-lg bg-[var(--comp-card-bg)] border border-[var(--comp-card-border)] flex flex-col items-center justify-center text-center gap-2">
            <Smartphone
              className="w-10 h-10 text-[var(--text-muted)] mb-1 opacity-60"
              aria-hidden="true"
            />
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">
              {t("sessions.emptyTitle")}
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-md">
              {t("sessions.emptyDescription")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-[var(--comp-card-bg)] border border-[var(--comp-card-border)] overflow-hidden shadow-sm">
            <div className="overflow-x-auto min-w-0">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--comp-table-header-bg,#090d16)] border-b border-[var(--comp-table-border)] text-[var(--text-muted)]">
                    <th
                      scope="col"
                      className="py-3 px-4 font-semibold uppercase tracking-wider"
                    >
                      {t("sessions.colDevice")}
                    </th>
                    <th
                      scope="col"
                      className="py-3 px-4 font-semibold uppercase tracking-wider"
                    >
                      {t("sessions.colIp")}
                    </th>
                    <th
                      scope="col"
                      className="py-3 px-4 font-semibold uppercase tracking-wider"
                    >
                      {t("sessions.colDuration")}
                    </th>
                    <th
                      scope="col"
                      className="py-3 px-4 font-semibold uppercase tracking-wider"
                    >
                      {t("sessions.colLastActive")}
                    </th>
                    <th
                      scope="col"
                      className="py-3 px-4 font-semibold uppercase tracking-wider text-right"
                    >
                      {t("sessions.colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {sessions.map((sess) => {
                    const parsed = parseDeviceUserAgent(sess.userAgent);
                    const durationStr = formatDuration(now - sess.connectedAt);
                    const lastActiveStr = formatRelativeTime(
                      now - sess.lastActiveAt,
                    );
                    const isRevoking = revokingSessionId === sess.sessionId;

                    return (
                      <tr
                        key={sess.sessionId}
                        className="hover:bg-[var(--comp-table-row-hover,#1f2937)] transition-colors h-[var(--comp-table-row-height,48px)]"
                      >
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <Smartphone
                              className="w-4 h-4 text-[var(--text-secondary)] shrink-0"
                              aria-hidden="true"
                            />
                            <div className="flex flex-col min-w-0">
                              <span className="font-semibold text-[var(--text-primary)] truncate">
                                {parsed.device}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)] truncate">
                                {parsed.browser}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[var(--text-secondary)]">
                          {sess.clientIp || "127.0.0.1"}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--text-secondary)] font-mono">
                          {durationStr}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--text-secondary)]">
                          {lastActiveStr}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setSessionToRevoke(sess)}
                            disabled={isRevoking}
                            title={t("sessions.revokeTooltip")}
                            aria-label={`Revoke session for ${parsed.device}`}
                            className="min-h-[44px] min-w-[44px] px-3 py-1.5 inline-flex items-center justify-center gap-1.5 rounded text-xs font-semibold text-[var(--comp-table-revoke-btn-text,#f87171)] border border-[rgba(239,68,68,0.3)] hover:bg-[var(--comp-table-revoke-btn-hover,rgba(239,68,68,0.15))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2
                              className="w-3.5 h-3.5"
                              aria-hidden="true"
                            />
                            <span>
                              {isRevoking
                                ? t("sessions.revoking")
                                : t("sessions.revoke")}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Confirmation Modal for Session Revocation */}
      {sessionToRevoke && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-revoke-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-overlay,rgba(9,13,22,0.85))] animate-in fade-in"
        >
          <div
            role="document"
            className="w-full max-w-md p-5 rounded-xl bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] shadow-2xl flex flex-col gap-4 text-left"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-[rgba(239,68,68,0.15)] text-[var(--primitive-color-red-400,#f87171)] shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3
                  id="confirm-revoke-title"
                  className="font-bold text-base text-[var(--text-primary)]"
                >
                  {t("sessions.confirmRevokeTitle")}
                </h3>
                <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                  {t("sessions.confirmRevokeMessage", {
                    device: parseDeviceUserAgent(sessionToRevoke.userAgent)
                      .device,
                    ip: sessionToRevoke.clientIp || "127.0.0.1",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setSessionToRevoke(null)}
                className="min-h-[44px] px-4 py-2 rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
              >
                {t("common.actions.cancel")}
              </button>

              <button
                type="button"
                onClick={handleConfirmRevoke}
                className="min-h-[44px] px-4 py-2 rounded text-xs font-semibold text-white bg-[var(--primitive-color-red-600,#dc2626)] hover:bg-[var(--primitive-color-red-500,#ef4444)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
              >
                {t("sessions.confirmRevokeAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
