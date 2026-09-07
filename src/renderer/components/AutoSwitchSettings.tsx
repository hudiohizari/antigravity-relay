import React, { useState, useEffect } from "react";
import {
  AutoSwitchConfig,
  GoogleAccount,
  SwitchResult,
} from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import {
  Sliders,
  Check,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ArrowLeftRight,
  Info,
} from "lucide-react";

export interface AutoSwitchSettingsProps {
  config: AutoSwitchConfig;
  accounts: GoogleAccount[];
  isSaving: boolean;
  isSwitching: boolean;
  switchingAccountId: string | null;
  lastSwitchResult: SwitchResult | null;
  poolExhaustedReason: string | null;
  onSaveConfig: (patch: Partial<AutoSwitchConfig>) => Promise<boolean>;
  onManualSwitch: (accountId: string) => Promise<boolean>;
  className?: string;
}

const DEFAULT_CONFIG_VALUES: AutoSwitchConfig = {
  enabled: true,
  minQuotaThresholdPercent: 15,
  pollIntervalMs: 300000,
  rateLimitCooldownMs: 900000,
  autoRelaunchProcesses: true,
  preferredModels: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "claude-3-5-sonnet-vertex",
  ],
};

export const AutoSwitchSettings: React.FC<AutoSwitchSettingsProps> = ({
  config,
  accounts,
  isSaving,
  isSwitching,
  switchingAccountId,
  lastSwitchResult,
  poolExhaustedReason,
  onSaveConfig,
  onManualSwitch,
  className = "",
}) => {
  const { t } = useTranslation();

  // Local form state
  const [enabled, setEnabled] = useState(config.enabled);
  const [threshold, setThreshold] = useState(config.minQuotaThresholdPercent);
  const [pollInterval, setPollInterval] = useState(config.pollIntervalMs);
  const [cooldown, setCooldown] = useState(config.rateLimitCooldownMs);
  const [autoRelaunch, setAutoRelaunch] = useState(
    config.autoRelaunchProcesses,
  );

  // Manual switch selection
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync state when config updates
  useEffect(() => {
    setEnabled(config.enabled);
    setThreshold(config.minQuotaThresholdPercent);
    setPollInterval(config.pollIntervalMs);
    setCooldown(config.rateLimitCooldownMs);
    setAutoRelaunch(config.autoRelaunchProcesses);
  }, [config]);

  // Set default manual switch target to first non-active account
  useEffect(() => {
    const candidate = accounts.find(
      (a) => a.status !== "active" && a.status !== "rate_limited",
    );
    if (candidate) {
      setSelectedTargetId(candidate.id);
    } else if (accounts.length > 0) {
      setSelectedTargetId(accounts[0].id);
    }
  }, [accounts]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSaveSuccess(false);

    const success = await onSaveConfig({
      enabled,
      minQuotaThresholdPercent: threshold,
      pollIntervalMs: pollInterval,
      rateLimitCooldownMs: cooldown,
      autoRelaunchProcesses: autoRelaunch,
    });

    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleRestoreDefaults = () => {
    setEnabled(DEFAULT_CONFIG_VALUES.enabled);
    setThreshold(DEFAULT_CONFIG_VALUES.minQuotaThresholdPercent);
    setPollInterval(DEFAULT_CONFIG_VALUES.pollIntervalMs);
    setCooldown(DEFAULT_CONFIG_VALUES.rateLimitCooldownMs);
    setAutoRelaunch(DEFAULT_CONFIG_VALUES.autoRelaunchProcesses);
    setSaveSuccess(false);
    setActionError(null);
  };

  const handleManualSwitchTrigger = async () => {
    if (!selectedTargetId) return;
    setActionError(null);
    const success = await onManualSwitch(selectedTargetId);
    if (!success) {
      setActionError(t("switcher.switchFailed", { error: "Switch failed" }));
    }
  };

  return (
    <div
      className={`rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 sm:p-6 max-w-3xl w-full mx-auto space-y-6 min-w-0 ${className}`}
    >
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-4 min-w-0">
        <div className="flex items-center gap-2.5">
          <Sliders
            className="w-5 h-5 text-[var(--primitive-color-blue-500)] shrink-0"
            aria-hidden="true"
          />
          <h2 className="text-lg font-bold text-[var(--text-primary)] truncate">
            {t("switcher.title")}
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
          {t("switcher.subtitle")}
        </p>
      </div>

      {/* Pool Exhausted Warning Banner */}
      {poolExhaustedReason && (
        <aside
          role="alert"
          className="p-4 rounded-lg bg-[var(--status-pending-bg)] border border-[var(--status-pending-border)] text-[var(--primitive-color-amber-400)] flex items-start gap-3 text-sm"
        >
          <AlertTriangle
            className="w-5 h-5 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <div className="font-semibold">
              {t("switcher.poolExhaustedTitle")}
            </div>
            <div className="text-xs mt-1 leading-relaxed">
              {t("switcher.poolExhaustedMessage")} ({poolExhaustedReason})
            </div>
          </div>
        </aside>
      )}

      {/* Manual Switch Success Feedback Banner */}
      {lastSwitchResult && (
        <aside
          role="status"
          className="p-4 rounded-lg bg-[var(--status-running-bg)] border border-[var(--status-running-border)] text-[var(--primitive-color-emerald-400)] flex items-center gap-3 text-sm"
        >
          <Check className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {t("switcher.switchSuccess", {
              email: lastSwitchResult.newAccountEmail,
            })}
          </span>
        </aside>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <aside
          role="alert"
          className="p-4 rounded-lg bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--primitive-color-red-400)] flex items-center gap-3 text-sm"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{actionError}</span>
        </aside>
      )}

      {/* Settings Form */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* Toggle: Autonomous Auto-Switching */}
        <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 min-w-0">
          <div className="min-w-0">
            <label
              htmlFor="auto-switch-toggle"
              className="font-medium text-xs sm:text-sm text-[var(--text-primary)] block cursor-pointer"
            >
              {t("switcher.autoSwitchEnabled")}
            </label>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t("switcher.autoSwitchDescription")}
            </p>
          </div>

          <button
            type="button"
            id="auto-switch-toggle"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(!enabled)}
            className={`min-h-[44px] min-w-[56px] px-1 py-1 rounded-full border transition-colors flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] ${
              enabled
                ? "bg-[var(--primitive-color-blue-600)] border-[var(--primitive-color-blue-500)] justify-end"
                : "bg-[var(--bg-surface-elevated)] border-[var(--border-default)] justify-start"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full shadow-md transform transition-transform ${
                enabled ? "bg-white" : "bg-[var(--text-muted)]"
              }`}
            />
          </button>
        </div>

        {/* Slider: Minimum Quota Threshold Percentage */}
        <div className="p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div>
              <label
                htmlFor="threshold-slider"
                className="font-medium text-xs sm:text-sm text-[var(--text-primary)] block"
              >
                {t("switcher.minQuotaThreshold")}
              </label>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t("switcher.minQuotaDescription")}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded font-mono text-xs font-semibold bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] text-[var(--primitive-color-blue-400)] shrink-0">
              {threshold}%
            </span>
          </div>

          <div className="space-y-1">
            <input
              id="threshold-slider"
              type="range"
              min="0"
              max="50"
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-[var(--bg-subtle)] accent-[var(--primitive-color-blue-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            />
            <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
            </div>
          </div>
        </div>

        {/* Selector Grid: Evaluation Interval & Cooldown Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Polling Interval */}
          <div className="p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 space-y-2 min-w-0">
            <label
              htmlFor="poll-interval-select"
              className="font-medium text-xs sm:text-sm text-[var(--text-primary)] block"
            >
              {t("switcher.pollInterval")}
            </label>
            <select
              id="poll-interval-select"
              value={pollInterval}
              onChange={(e) => setPollInterval(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <option value={60000}>
                {t("switcher.pollIntervalMinutes", { minutes: 1 })}
              </option>
              <option value={120000}>
                {t("switcher.pollIntervalMinutes", { minutes: 2 })}
              </option>
              <option value={300000}>
                {t("switcher.pollIntervalMinutes", { minutes: 5 })}
              </option>
              <option value={600000}>
                {t("switcher.pollIntervalMinutes", { minutes: 10 })}
              </option>
              <option value={900000}>
                {t("switcher.pollIntervalMinutes", { minutes: 15 })}
              </option>
            </select>
          </div>

          {/* Rate-Limit Cooldown Duration */}
          <div className="p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 space-y-2 min-w-0">
            <label
              htmlFor="cooldown-duration-select"
              className="font-medium text-xs sm:text-sm text-[var(--text-primary)] block"
            >
              {t("switcher.cooldownDuration")}
            </label>
            <select
              id="cooldown-duration-select"
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <option value={300000}>
                {t("switcher.cooldownDurationMinutes", { minutes: 5 })}
              </option>
              <option value={600000}>
                {t("switcher.cooldownDurationMinutes", { minutes: 10 })}
              </option>
              <option value={900000}>
                {t("switcher.cooldownDurationMinutes", { minutes: 15 })}
              </option>
              <option value={1800000}>
                {t("switcher.cooldownDurationMinutes", { minutes: 30 })}
              </option>
              <option value={3600000}>
                {t("switcher.cooldownDurationMinutes", { minutes: 60 })}
              </option>
            </select>
          </div>
        </div>

        {/* Toggle: Auto-Relaunch Services */}
        <div className="flex items-start justify-between gap-4 p-3.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/50 min-w-0">
          <div className="min-w-0">
            <label
              htmlFor="auto-relaunch-toggle"
              className="font-medium text-xs sm:text-sm text-[var(--text-primary)] block cursor-pointer"
            >
              {t("switcher.autoRelaunchProcesses")}
            </label>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {t("switcher.autoRelaunchDescription")}
            </p>
          </div>

          <button
            type="button"
            id="auto-relaunch-toggle"
            role="switch"
            aria-checked={autoRelaunch}
            onClick={() => setAutoRelaunch(!autoRelaunch)}
            className={`min-h-[44px] min-w-[56px] px-1 py-1 rounded-full border transition-colors flex items-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] ${
              autoRelaunch
                ? "bg-[var(--primitive-color-blue-600)] border-[var(--primitive-color-blue-500)] justify-end"
                : "bg-[var(--bg-surface-elevated)] border-[var(--border-default)] justify-start"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full shadow-md transform transition-transform ${
                autoRelaunch ? "bg-white" : "bg-[var(--text-muted)]"
              }`}
            />
          </button>
        </div>

        {/* Scoring Weights Info Banner */}
        <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <Info
            className="w-4 h-4 text-[var(--text-muted)] shrink-0"
            aria-hidden="true"
          />
          <span>{t("switcher.scoringInfo")}</span>
        </div>

        {/* Save and Restore Buttons */}
        <div className="flex items-center justify-end gap-3 flex-wrap pt-2">
          <button
            type="button"
            onClick={handleRestoreDefaults}
            disabled={isSaving}
            className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t("switcher.restoreDefaults")}</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="min-h-[44px] px-5 py-2 rounded-md bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] active:bg-[var(--primitive-color-blue-700)] text-white text-xs sm:text-sm font-medium active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] disabled:opacity-50 flex items-center gap-2 shadow-sm"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("common.status.loading")}</span>
              </>
            ) : saveSuccess ? (
              <>
                <Check
                  className="w-4 h-4 text-[var(--primitive-color-emerald-300)]"
                  aria-hidden="true"
                />
                <span>{t("switcher.settingsSaved")}</span>
              </>
            ) : (
              <span>{t("switcher.saveSettings")}</span>
            )}
          </button>
        </div>
      </form>

      {/* Manual Switch Trigger Section */}
      <div className="border-t border-[var(--border-subtle)] pt-6 space-y-3 min-w-0">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("switcher.manualSwitch")}
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          {t("switcher.subtitle")}
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <select
            value={selectedTargetId}
            onChange={(e) => setSelectedTargetId(e.target.value)}
            disabled={isSwitching || accounts.length === 0}
            className="flex-1 min-h-[44px] px-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-canvas)] text-[var(--text-primary)] text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.email} ({acc.status})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleManualSwitchTrigger}
            disabled={isSwitching || !selectedTargetId}
            aria-busy={isSwitching}
            className="min-h-[44px] px-5 py-2.5 bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] active:bg-[var(--primitive-color-blue-700)] text-white text-xs sm:text-sm font-medium rounded-md active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0 shadow-sm"
          >
            {isSwitching && switchingAccountId === selectedTargetId ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("switcher.switchingInProgress")}</span>
              </>
            ) : isSwitching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("switcher.switchingInProgress")}</span>
              </>
            ) : (
              <>
                <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
                <span>{t("switcher.manualSwitch")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
