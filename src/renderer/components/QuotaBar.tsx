import React, { useState, useEffect } from "react";
import { QuotaData, ModelQuota } from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import { RefreshCw, Database } from "lucide-react";

export interface QuotaBarProps {
  quota?: QuotaData;
  isRateLimited?: boolean;
  rateLimitUntil?: number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  className?: string;
}

function formatModelName(modelId: string): string {
  const overrides: Record<string, string> = {
    "gemini-3.1-pro": "Gemini 3.1 Pro",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-flash-lite": "Gemini Flash Lite",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
    "gemini-pro-image": "Gemini Pro Image",
    "gemini-flash-image": "Gemini Flash Image",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-opus-4-5": "Claude Opus 4.5",
    "claude-3-5-sonnet-vertex": "Claude 3.5 Sonnet (Vertex)",
    "claude-on-vertex": "Claude on Vertex",
    "gpt-oss-120b": "GPT OSS 120B",
  };

  if (overrides[modelId]) {
    return overrides[modelId];
  }

  return modelId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}h ${formattedMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${remainingSeconds}s`;
}

export const QuotaBar: React.FC<QuotaBarProps> = ({
  quota,
  isRateLimited = false,
  onRefresh,
  isRefreshing = false,
  className = "",
}) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  const models = quota?.models ? Object.entries(quota.models) : [];
  const isCached = quota?.source === "cached" || Boolean(quota?.poll_error);

  const getHealthTheme = (percentage: number) => {
    if (isRateLimited) {
      return {
        fillClass: "fill-[var(--status-quota-cooldown)]",
        textClass: "text-[var(--status-quota-cooldown-text)]",
        statusKey: "quota.status.cooldown",
      };
    }
    if (percentage >= 50) {
      return {
        fillClass: "fill-[var(--status-quota-healthy)]",
        textClass: "text-[var(--status-quota-healthy-text)]",
        statusKey: "quota.status.healthy",
      };
    }
    if (percentage >= 15) {
      return {
        fillClass: "fill-[var(--status-quota-warning)]",
        textClass: "text-[var(--status-quota-warning-text)]",
        statusKey: "quota.status.warning",
      };
    }
    return {
      fillClass: "fill-[var(--status-quota-exhausted)]",
      textClass: "text-[var(--status-quota-exhausted-text)]",
      statusKey: "quota.status.exhausted",
    };
  };

  const getResetTimeString = (model: ModelQuota) => {
    if (!model.resetTime) return null;
    const target = new Date(model.resetTime).getTime();
    if (Number.isNaN(target)) return null;
    const diffSec = Math.max(0, Math.floor((target - now) / 1000));
    if (diffSec <= 0) return null;
    return t("quota.resetsIn", { time: formatDuration(diffSec) });
  };

  return (
    <section
      aria-label={t("quota.title")}
      className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40 p-3 min-w-0 ${className}`}
    >
      {/* Header with Title and Optional Actions */}
      <div className="flex items-center justify-between gap-2 mb-2.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">
            {t("quota.title")}
          </span>
          {isCached && (
            <span
              title={t("quota.offlineNotice")}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--status-stopped-bg)] text-[var(--status-stopped-text)] border border-[var(--status-stopped-border)]"
            >
              <Database className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
              <span>{t("quota.status.cached")}</span>
            </span>
          )}
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label={t("quota.refreshQuota")}
            title={t("quota.refreshQuota")}
            className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isRefreshing
                  ? "animate-spin text-[var(--primitive-color-blue-500)]"
                  : ""
              }`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Model Progress Meters */}
      {models.length === 0 ? (
        <div className="py-2 text-center text-xs text-[var(--text-muted)] italic">
          {isRefreshing ? t("quota.refreshingQuota") : t("quota.status.cached")}
        </div>
      ) : (
        <div className="space-y-3 min-w-0">
          {models.map(([modelId, model]) => {
            const displayName = model.displayName || formatModelName(modelId);
            const clampedPercent = Math.max(
              0,
              Math.min(100, Math.round(model.percentage)),
            );
            const theme = getHealthTheme(clampedPercent);
            const resetString = getResetTimeString(model);

            return (
              <div key={modelId} className="space-y-1 min-w-0">
                {/* Model Info Header */}
                <div className="flex items-center justify-between gap-2 text-xs font-mono min-w-0">
                  <span className="text-[var(--text-secondary)] font-medium truncate">
                    {displayName}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`font-semibold ${theme.textClass}`}>
                      {clampedPercent}%
                    </span>
                    {typeof model.remainingQueries === "number" &&
                      typeof model.totalQueries === "number" && (
                        <span className="text-[var(--text-muted)] text-[11px] hidden xs:inline">
                          ({model.remainingQueries.toLocaleString()}/
                          {model.totalQueries.toLocaleString()} req)
                        </span>
                      )}
                  </div>
                </div>

                {/* SVG Progress Bar Fill (Zero Inline Styles) */}
                <svg
                  role="progressbar"
                  aria-valuenow={clampedPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${displayName} quota remaining ${clampedPercent}%`}
                  className="w-full h-[var(--comp-quota-track-height)] rounded-full overflow-hidden bg-[var(--comp-quota-track-bg)] block"
                  viewBox="0 0 100 6"
                  preserveAspectRatio="none"
                >
                  <rect
                    x="0"
                    y="0"
                    width={clampedPercent}
                    height="6"
                    rx="3"
                    className={`${theme.fillClass} ${
                      isRateLimited ? "animate-pulse" : ""
                    } transition-all duration-300 ease-out`}
                  />
                </svg>

                {/* Reset Countdown Footer */}
                {resetString && (
                  <div className="text-[11px] font-mono text-[var(--text-muted)] text-right truncate">
                    {resetString}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
