import React, { useState, useEffect } from "react";
import { GoogleAccount } from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import {
  RefreshCw,
  Trash2,
  CheckCircle2,
  Circle,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";

interface AccountCardProps {
  account: GoogleAccount;
  isActive: boolean;
  isRefreshing: boolean;
  isDeleting: boolean;
  onSetActive: (id: string) => Promise<boolean>;
  onRefreshToken: (id: string) => Promise<boolean>;
  onRemoveRequest: (account: GoogleAccount) => void;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds % 60}s`;
}

function formatLastUsed(timestamp?: number): string | null {
  if (!timestamp) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  isActive,
  isRefreshing,
  isDeleting,
  onSetActive,
  onRefreshToken,
  onRemoveRequest,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick expiry countdown every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(account.email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Browser clipboard fallback
    }
  };

  const getExpiryString = () => {
    const expiryTimestamp = account.tokens.expiry_timestamp;
    if (!expiryTimestamp) return null;
    const diffSeconds = Math.floor((expiryTimestamp - now) / 1000);

    if (diffSeconds > 0) {
      return t("accounts.card.expiresIn", {
        time: formatDuration(diffSeconds),
      });
    }
    return t("accounts.card.expiredAgo", {
      time: formatDuration(Math.abs(diffSeconds)),
    });
  };

  const isExpired =
    account.status === "expired" ||
    (account.tokens.expiry_timestamp
      ? account.tokens.expiry_timestamp <= now
      : false);
  const isRateLimited = account.status === "rate_limited";
  const isBusy = isRefreshing || isDeleting;

  const getStatusBadge = () => {
    if (isActive) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-[var(--primitive-color-emerald-400)] bg-[var(--status-running-bg)] border border-[var(--status-running-border)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primitive-color-emerald-500)]" />
          {t("accounts.card.active")}
        </span>
      );
    }
    if (isRateLimited) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-[var(--primitive-color-amber-400)] bg-[var(--status-pending-bg)] border border-[var(--status-pending-border)]">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          {t("accounts.card.rateLimited")}
        </span>
      );
    }
    if (isExpired) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-[var(--primitive-color-red-400)] bg-[var(--status-error-bg)] border border-[var(--status-error-border)]">
          <XCircle className="w-3 h-3" aria-hidden="true" />
          {t("accounts.card.expired")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-[var(--text-muted)] bg-[var(--status-stopped-bg)] border border-[var(--status-stopped-border)]">
        {t("accounts.card.disabled")}
      </span>
    );
  };

  const lastUsedFormatted = formatLastUsed(account.lastUsedAt);

  return (
    <article
      className={`rounded-lg p-4 transition-all duration-150 border flex flex-col justify-between min-w-0 ${
        isActive
          ? "border-[var(--primitive-color-emerald-500)]/50 bg-[var(--primitive-color-emerald-950)]/10 shadow-[0_0_12px_rgba(16,185,129,0.08)]"
          : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-surface-elevated)]"
      } ${isBusy ? "opacity-60 pointer-events-none" : ""}`}
    >
      {/* Top Identity Header */}
      <div>
        <div className="flex items-start justify-between gap-3 min-w-0 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {account.avatarUrl ? (
              <img
                src={account.avatarUrl}
                alt=""
                className="w-9 h-9 rounded-full object-cover border border-[var(--border-subtle)] shrink-0"
              />
            ) : (
              <div
                className="w-9 h-9 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-default)] flex items-center justify-center text-xs font-bold text-[var(--text-primary)] shrink-0"
                aria-hidden="true"
              >
                {account.email.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
                  {account.email}
                </span>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="min-h-[44px] min-w-[44px] p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors shrink-0 flex items-center justify-center"
                  aria-label={
                    copied
                      ? t("accounts.card.copiedEmail")
                      : t("accounts.card.copyEmail")
                  }
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[var(--primitive-color-emerald-400)]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="shrink-0">{getStatusBadge()}</div>
        </div>

        {/* Telemetry Information */}
        <div className="space-y-1.5 text-xs text-[var(--text-secondary)] font-mono border-t border-[var(--border-subtle)] pt-3">
          <div className="flex items-center gap-2">
            <Clock
              className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0"
              aria-hidden="true"
            />
            <span className="truncate">
              {getExpiryString() || "Permanent session"}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <span className="truncate">
              {lastUsedFormatted
                ? `${t("accounts.card.lastUsed")} ${lastUsedFormatted}`
                : t("accounts.card.neverUsed")}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons (WCAG 2.2 AA Min 44px Hitboxes & 8px Gap) */}
      <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {isActive ? (
            <div className="min-h-[44px] px-3 flex items-center gap-1.5 text-xs font-medium text-[var(--primitive-color-emerald-400)] select-none">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span>{t("accounts.card.isActive")}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onSetActive(account.id)}
              disabled={isBusy}
              className="min-h-[44px] px-3 rounded-md text-xs font-medium border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] active:scale-[0.98] transition-colors duration-150 flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] disabled:opacity-50"
            >
              <Circle
                className="w-3.5 h-3.5 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span>{t("accounts.card.setActive")}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onRefreshToken(account.id)}
            disabled={isBusy}
            aria-label={t("accounts.card.refreshToken")}
            title={t("accounts.card.refreshToken")}
            className="min-h-[44px] min-w-[44px] p-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-[0.98] transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--primitive-color-blue-500)]" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onRemoveRequest(account)}
            disabled={isBusy}
            aria-label={t("accounts.card.removeAccount")}
            title={t("accounts.card.removeAccount")}
            className="min-h-[44px] min-w-[44px] p-2 rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-bg)] text-[var(--primitive-color-red-400)] hover:bg-[var(--primitive-color-red-500)]/20 active:scale-[0.98] transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
};
