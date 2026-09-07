import React, { useState } from "react";
import {
  DualServiceStatus,
  ServiceTarget,
  ServiceProcessInfo,
} from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import { TransitionalStates } from "../hooks/useServiceStatus";
import {
  Server,
  Code2,
  ChevronUp,
  ChevronDown,
  Play,
  Square,
  Loader2,
  AlertCircle,
} from "lucide-react";

interface StatusBarProps {
  status: DualServiceStatus | null;
  transitionalStates: TransitionalStates;
  onToggleService: (target: ServiceTarget) => Promise<void>;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "0s";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  status,
  transitionalStates,
  onToggleService,
}) => {
  const { t } = useTranslation();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const runningCount = status?.runningCount ?? 0;
  const totalCount = status?.totalCount ?? 2;

  const getStatusDotColor = () => {
    if (runningCount === totalCount && totalCount > 0) {
      return "bg-[var(--primitive-color-emerald-500)]";
    }
    if (runningCount > 0) {
      return "bg-[var(--primitive-color-amber-500)]";
    }
    return "bg-[var(--primitive-color-neutral-400)]";
  };

  const getServiceStatusText = (
    info: ServiceProcessInfo | undefined,
    transitional: "starting" | "stopping" | null,
  ) => {
    if (transitional === "starting") return t("services.status.starting");
    if (transitional === "stopping") return t("services.status.stopping");
    if (!info) return t("services.status.stopped");
    switch (info.state) {
      case "running":
        return t("services.status.running");
      case "starting":
        return t("services.status.starting");
      case "stopping":
        return t("services.status.stopping");
      case "error":
        return t("services.status.error");
      default:
        return t("services.status.stopped");
    }
  };

  const getServiceStatusBadgeClass = (
    info: ServiceProcessInfo | undefined,
    transitional: "starting" | "stopping" | null,
  ) => {
    if (transitional) {
      return "text-[var(--primitive-color-amber-400)] bg-[var(--status-pending-bg)] border-[var(--status-pending-border)]";
    }
    if (!info) {
      return "text-[var(--primitive-color-neutral-300)] bg-[var(--status-stopped-bg)] border-[var(--status-stopped-border)]";
    }
    switch (info.state) {
      case "running":
        return "text-[var(--primitive-color-emerald-400)] bg-[var(--status-running-bg)] border-[var(--status-running-border)]";
      case "starting":
      case "stopping":
        return "text-[var(--primitive-color-amber-400)] bg-[var(--status-pending-bg)] border-[var(--status-pending-border)]";
      case "error":
        return "text-[var(--primitive-color-red-400)] bg-[var(--status-error-bg)] border-[var(--status-error-border)]";
      default:
        return "text-[var(--primitive-color-neutral-300)] bg-[var(--status-stopped-bg)] border-[var(--status-stopped-border)]";
    }
  };

  const renderServiceRow = (target: ServiceTarget) => {
    const isDaemon = target === "antigravity_daemon";
    const info = status?.services[target];
    const transitional = transitionalStates[target];
    const isRunning = info?.state === "running";
    const isBusy = Boolean(
      transitional || info?.state === "starting" || info?.state === "stopping",
    );

    const title = isDaemon
      ? t("services.daemon.title")
      : t("services.ide.title");
    const description = isDaemon
      ? t("services.daemon.description")
      : t("services.ide.description");
    const Icon = isDaemon ? Server : Code2;

    const pidText = info?.mainPid
      ? t("services.pid", { pid: info.mainPid })
      : t("services.pidNone");
    const uptimeText =
      isRunning && info
        ? t("services.uptime", { uptime: formatUptime(info.uptimeSeconds) })
        : null;

    return (
      <article
        key={target}
        className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] flex items-center justify-center shrink-0 text-[var(--primitive-color-blue-500)]">
            <Icon className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-medium text-[var(--text-primary)] truncate">
                {title}
              </h3>
              <span
                className={`text-xs px-2 py-0.5 rounded border font-mono flex items-center gap-1.5 ${getServiceStatusBadgeClass(
                  info,
                  transitional,
                )}`}
              >
                {isBusy && (
                  <Loader2
                    className="w-3 h-3 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {info?.state === "error" && !isBusy && (
                  <AlertCircle className="w-3 h-3" aria-hidden="true" />
                )}
                {getServiceStatusText(info, transitional)}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
              {description}
            </p>
            <div className="flex items-center gap-3 text-xs font-mono text-[var(--text-secondary)] mt-1">
              <span>{pidText}</span>
              {uptimeText && <span>• {uptimeText}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center self-end sm:self-center shrink-0">
          <button
            type="button"
            onClick={() => onToggleService(target)}
            disabled={isBusy}
            aria-busy={isBusy}
            className={`min-h-[44px] min-w-[88px] px-3 py-1.5 rounded-md text-xs font-medium border flex items-center justify-center gap-1.5 transition-colors duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] disabled:opacity-50 disabled:cursor-not-allowed ${
              isRunning
                ? "bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-[var(--primitive-color-red-400)] hover:bg-[var(--primitive-color-red-500)]/20"
                : "bg-[var(--bg-surface-elevated)] border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] hover:border-[var(--border-hover)]"
            }`}
          >
            {isBusy ? (
              <>
                <Loader2
                  className="w-3.5 h-3.5 animate-spin"
                  aria-hidden="true"
                />
                <span>
                  {transitional === "stopping" || info?.state === "stopping"
                    ? t("services.action.stopping")
                    : t("services.action.starting")}
                </span>
              </>
            ) : isRunning ? (
              <>
                <Square className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("services.action.stop")}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t("services.action.start")}</span>
              </>
            )}
          </button>
        </div>
      </article>
    );
  };

  return (
    <footer className="sticky bottom-0 z-30 w-full bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] min-w-0">
      {/* Popover Supervisor Drawer */}
      {isDrawerOpen && (
        <div
          id="services-popover"
          role="region"
          aria-label={t("accessibility.serviceControls")}
          className="p-4 bg-[var(--bg-surface-elevated)] border-b border-[var(--border-default)] shadow-2xl max-w-4xl mx-auto space-y-3"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("services.popover.title")}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t("services.popover.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDrawerOpen(false)}
              className="min-h-[44px] min-w-[44px] p-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              aria-label={t("common.actions.close")}
            >
              <ChevronDown className="w-4 h-4 mx-auto" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2 pt-1">
            {renderServiceRow("antigravity_daemon")}
            {renderServiceRow("antigravity_ide")}
          </div>
        </div>
      )}

      {/* Main Status Bar Strip */}
      <div className="max-w-4xl mx-auto px-4 h-[var(--comp-statusbar-height)] flex items-center justify-between text-xs gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${getStatusDotColor()}`}
            aria-hidden="true"
          />
          <span
            className="text-[var(--text-secondary)] truncate font-medium"
            role="status"
            aria-live="polite"
          >
            {t("services.bar.runningCount", {
              count: runningCount,
              total: totalCount,
            })}
          </span>
          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            aria-expanded={isDrawerOpen}
            aria-controls="services-popover"
            className="min-h-[44px] px-2 py-1 flex items-center gap-1 text-[var(--primitive-color-blue-500)] hover:text-[var(--primitive-color-blue-400)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <span>
              {isDrawerOpen
                ? t("services.bar.collapseDetails")
                : t("services.bar.expandDetails")}
            </span>
            {isDrawerOpen ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0 font-mono text-[var(--text-muted)]">
          <span>Relay: Ready</span>
          <span className="w-2 h-2 rounded-full bg-[var(--primitive-color-emerald-500)]" />
        </div>
      </div>
    </footer>
  );
};
