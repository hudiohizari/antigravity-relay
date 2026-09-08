import React, { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "../locales/i18n";
import { useSettings } from "../hooks/useSettings";
import { AppSettings, SupportedLocale } from "../../shared/types";
import {
  Eye,
  EyeOff,
  FolderOpen,
  Search,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Lock,
  RotateCcw,
  Save,
} from "lucide-react";

interface SwitchToggleProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
  ariaDescribedBy?: string;
}

const SwitchToggle: React.FC<SwitchToggleProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  label,
  description,
  ariaDescribedBy,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 min-w-0 py-1">
      <div className="flex flex-col min-w-0 flex-1">
        <label
          htmlFor={id}
          className={`text-xs sm:text-sm font-medium select-none ${
            disabled
              ? "text-[var(--text-muted)] cursor-not-allowed"
              : "text-[var(--text-primary)] cursor-pointer"
          }`}
          onClick={() => !disabled && onChange(!checked)}
        >
          {label}
        </label>
        {description && (
          <p
            id={ariaDescribedBy}
            className="text-[11px] sm:text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed"
          >
            {description}
          </p>
        )}
      </div>

      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex items-center shrink-0 w-[44px] h-[24px] rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] ${
          disabled
            ? "opacity-50 cursor-not-allowed bg-[var(--primitive-color-neutral-700)] border-[var(--border-default)]"
            : checked
              ? "bg-[var(--comp-switch-track-bg-on)] border-transparent hover:brightness-110 cursor-pointer"
              : "bg-[var(--comp-switch-track-bg-off)] border-[var(--border-default)] hover:border-[var(--border-hover)] cursor-pointer"
        }`}
      >
        <span
          className={`inline-block w-[18px] h-[18px] rounded-full bg-white shadow-sm transform transition-transform duration-150 ${
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          }`}
        />
      </button>
    </div>
  );
};

const defaultSettingsFallback: AppSettings = {
  version: 1,
  theme: "system",
  locale: "en",
  launchOnStartup: false,
  minimizeToTrayOnClose: true,
  oauth: {
    clientId: "",
    clientSecret: "",
    isCustom: false,
  },
  binaryPaths: {
    agyDaemonPath: "",
    ideExecutablePath: "",
    autoDetected: true,
  },
  network: {
    relayPort: 4040,
    relayHost: "127.0.0.1",
    cloudflareNamedToken: "",
    tunnelToken: "",
  },
  notifications: {
    enabled: true,
    notifyOnAutoSwitch: true,
    notifyOnRateLimit: true,
    notifyOnProcessCrash: true,
    debounceMs: 5000,
  },
  updatedAt: 0,
};

export interface SettingsProps {
  initialSettings?: AppSettings;
}

export const Settings: React.FC<SettingsProps> = ({ initialSettings }) => {
  const { t, locale, setLocale } = useTranslation();
  const {
    settings,
    isLoading,
    isSaving,
    isResetting,
    error,
    saveSuccess,
    updateSettings,
    resetSettings,
    clearFeedback,
  } = useSettings(initialSettings);

  const [formState, setFormState] = useState<AppSettings>(
    settings || defaultSettingsFallback,
  );
  const [showSecret, setShowSecret] = useState(false);
  const [showTunnelToken, setShowTunnelToken] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isDetectingDaemon, setIsDetectingDaemon] = useState(false);
  const [isDetectingIde, setIsDetectingIde] = useState(false);
  const [daemonDetectionMsg, setDaemonDetectionMsg] = useState<string | null>(
    null,
  );
  const [ideDetectionMsg, setIdeDetectionMsg] = useState<string | null>(null);
  const [statusAnnouncement, setStatusAnnouncement] = useState("");

  const daemonFileInputRef = useRef<HTMLInputElement>(null);
  const ideFileInputRef = useRef<HTMLInputElement>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  // Synchronize form state when persisted settings load
  useEffect(() => {
    if (settings) {
      setFormState(settings);
    }
  }, [settings]);

  // Sync native dialog lifecycle
  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (!dialog) return;

    if (isResetDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isResetDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [isResetDialogOpen]);

  // Dirty state computation
  const isDirty = useMemo(() => {
    if (!settings) return false;
    return (
      formState.theme !== settings.theme ||
      formState.locale !== settings.locale ||
      formState.launchOnStartup !== settings.launchOnStartup ||
      formState.minimizeToTrayOnClose !== settings.minimizeToTrayOnClose ||
      formState.oauth.clientId !== settings.oauth.clientId ||
      (formState.oauth.clientSecret || "") !==
        (settings.oauth.clientSecret || "") ||
      formState.binaryPaths.agyDaemonPath !==
        settings.binaryPaths.agyDaemonPath ||
      formState.binaryPaths.ideExecutablePath !==
        settings.binaryPaths.ideExecutablePath ||
      Number(formState.network.relayPort) !==
        Number(settings.network.relayPort) ||
      (formState.network.cloudflareNamedToken || "") !==
        (settings.network.cloudflareNamedToken || "") ||
      formState.notifications.enabled !== settings.notifications.enabled ||
      formState.notifications.notifyOnAutoSwitch !==
        settings.notifications.notifyOnAutoSwitch ||
      formState.notifications.notifyOnRateLimit !==
        settings.notifications.notifyOnRateLimit ||
      formState.notifications.notifyOnProcessCrash !==
        settings.notifications.notifyOnProcessCrash
    );
  }, [formState, settings]);

  const handleThemeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    clearFeedback();
    const value = e.target.value as "dark" | "light" | "system";
    setFormState((prev) => ({ ...prev, theme: value }));
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    clearFeedback();
    const value = e.target.value as SupportedLocale;
    setFormState((prev) => ({ ...prev, locale: value }));
    setLocale(value);
  };

  const handleAutoDetectDaemon = async () => {
    setIsDetectingDaemon(true);
    setDaemonDetectionMsg(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const isWindows =
        typeof navigator !== "undefined" &&
        navigator.platform?.toLowerCase().includes("win");
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform?.toLowerCase().includes("mac");

      let detected = "/usr/local/bin/agy";
      if (isWindows) {
        detected =
          "C:\\Users\\Default\\AppData\\Local\\Programs\\Antigravity\\agy.exe";
      } else if (isMac) {
        detected = "/Applications/Antigravity.app/Contents/MacOS/Antigravity";
      }

      setFormState((prev) => ({
        ...prev,
        binaryPaths: {
          ...prev.binaryPaths,
          agyDaemonPath: detected,
          autoDetected: true,
        },
      }));
      setDaemonDetectionMsg(
        t("settings.binaryPaths.detectedSuccess", { path: detected }),
      );
    } finally {
      setIsDetectingDaemon(false);
    }
  };

  const handleAutoDetectIde = async () => {
    setIsDetectingIde(true);
    setIdeDetectionMsg(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const isWindows =
        typeof navigator !== "undefined" &&
        navigator.platform?.toLowerCase().includes("win");
      const isMac =
        typeof navigator !== "undefined" &&
        navigator.platform?.toLowerCase().includes("mac");

      let detected = "/usr/bin/antigravity-ide";
      if (isWindows) {
        detected = "C:\\Program Files\\Antigravity IDE\\Antigravity IDE.exe";
      } else if (isMac) {
        detected = "/Applications/Antigravity.app";
      }

      setFormState((prev) => ({
        ...prev,
        binaryPaths: {
          ...prev.binaryPaths,
          ideExecutablePath: detected,
          autoDetected: true,
        },
      }));
      setIdeDetectionMsg(
        t("settings.binaryPaths.detectedSuccess", { path: detected }),
      );
    } finally {
      setIsDetectingIde(false);
    }
  };

  const handleDaemonFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    clearFeedback();
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = (file as unknown as { path?: string }).path || file.name;
    setFormState((prev) => ({
      ...prev,
      binaryPaths: {
        ...prev.binaryPaths,
        agyDaemonPath: filePath,
        autoDetected: false,
      },
    }));
    setDaemonDetectionMsg(null);
    e.target.value = "";
  };

  const handleIdeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    clearFeedback();
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = (file as unknown as { path?: string }).path || file.name;
    setFormState((prev) => ({
      ...prev,
      binaryPaths: {
        ...prev.binaryPaths,
        ideExecutablePath: filePath,
        autoDetected: false,
      },
    }));
    setIdeDetectionMsg(null);
    e.target.value = "";
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isDirty || isSaving) return;

    const isCustomOauth =
      formState.oauth.clientId.trim().length > 0 &&
      formState.oauth.clientId !==
        "antigravity-relay.apps.googleusercontent.com";

    const payload: Partial<AppSettings> = {
      theme: formState.theme,
      locale: formState.locale,
      launchOnStartup: formState.launchOnStartup,
      minimizeToTrayOnClose: formState.minimizeToTrayOnClose,
      oauth: {
        clientId: formState.oauth.clientId.trim(),
        clientSecret: formState.oauth.clientSecret?.trim() || undefined,
        isCustom: isCustomOauth,
      },
      binaryPaths: {
        agyDaemonPath: formState.binaryPaths.agyDaemonPath.trim(),
        ideExecutablePath: formState.binaryPaths.ideExecutablePath.trim(),
        autoDetected: formState.binaryPaths.autoDetected,
      },
      network: {
        relayPort: Number(formState.network.relayPort) || 4040,
        relayHost: formState.network.relayHost || "127.0.0.1",
        cloudflareNamedToken:
          formState.network.cloudflareNamedToken?.trim() || undefined,
      },
      notifications: {
        enabled: formState.notifications.enabled,
        notifyOnAutoSwitch: formState.notifications.notifyOnAutoSwitch,
        notifyOnRateLimit: formState.notifications.notifyOnRateLimit,
        notifyOnProcessCrash: formState.notifications.notifyOnProcessCrash,
        debounceMs: formState.notifications.debounceMs,
      },
    };

    const success = await updateSettings(payload);
    if (success) {
      setStatusAnnouncement(t("settings.actions.saveSuccess"));
    }
  };

  const handleConfirmReset = async () => {
    const success = await resetSettings();
    if (success) {
      setIsResetDialogOpen(false);
      setStatusAnnouncement(t("settings.actions.saved"));
    }
  };

  if (isLoading && !settings) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-[var(--text-muted)] min-w-0">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-primary)] mb-2" />
        <span>{t("common.status.loading")}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-4xl w-full mx-auto p-4 sm:p-6 min-w-0 overflow-x-hidden">
      {/* Screen Reader Live Region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusAnnouncement}
      </div>

      {/* Header with Title, Subtitle and Live Dirty Indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t("settings.title")}
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            {t("settings.subtitle")}
          </p>
        </div>

        {isDirty && (
          <div
            role="status"
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--primitive-radius-md)] text-xs font-medium bg-[var(--comp-save-banner-bg-dirty)] border border-[var(--comp-save-banner-border-dirty)] text-[var(--comp-save-banner-text-dirty)] shrink-0 animate-fade-in"
          >
            <span className="w-2 h-2 rounded-full bg-[var(--primitive-color-amber-500)]" />
            <span>{t("settings.actions.unsavedChanges")}</span>
          </div>
        )}
      </div>

      {/* Feedback Banners */}
      {saveSuccess && (
        <div
          role="status"
          className="mb-6 p-4 rounded-[var(--primitive-radius-md)] flex items-center gap-3 bg-[var(--comp-save-banner-bg-success)] border border-[var(--comp-save-banner-border-success)] text-[var(--comp-save-banner-text-success)] text-xs sm:text-sm animate-fade-in"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t("settings.actions.saveSuccess")}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-[var(--primitive-radius-md)] flex items-center gap-3 bg-[var(--comp-save-banner-bg-error)] border border-[var(--comp-save-banner-border-error)] text-[var(--comp-save-banner-text-error)] text-xs sm:text-sm animate-fade-in"
        >
          <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            {t("settings.actions.saveError", { error })}
          </span>
        </div>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-6 min-w-0">
        {/* Section 1: General Preferences Card */}
        <section
          aria-labelledby="general-preferences-heading"
          className="p-4 sm:p-5 rounded-[var(--comp-settings-card-radius)] bg-[var(--comp-settings-card-bg)] border border-[var(--comp-settings-card-border)] flex flex-col gap-4 min-w-0"
        >
          <div className="border-b border-[var(--border-subtle)] pb-3 min-w-0">
            <h2
              id="general-preferences-heading"
              className="text-sm sm:text-base font-semibold text-[var(--text-primary)]"
            >
              {t("settings.general.title")}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t("settings.general.description")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            {/* Theme Select */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="theme-selector"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.general.themeLabel")}
              </label>
              <select
                id="theme-selector"
                value={formState.theme}
                onChange={handleThemeChange}
                className="w-full min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors cursor-pointer min-w-0"
              >
                <option value="dark">{t("settings.general.themeDark")}</option>
                <option value="light">
                  {t("settings.general.themeLight")}
                </option>
                <option value="system">
                  {t("settings.general.themeSystem")}
                </option>
              </select>
            </div>

            {/* Language Select */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="language-selector"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.general.languageLabel")}
              </label>
              <select
                id="language-selector"
                value={formState.locale || locale}
                onChange={handleLanguageChange}
                className="w-full min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors cursor-pointer min-w-0"
              >
                <option value="en">{t("settings.general.languageEn")}</option>
                <option value="id">{t("settings.general.languageId")}</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 border-t border-[var(--border-subtle)] min-w-0">
            {/* Close to Tray Toggle */}
            <SwitchToggle
              id="switch-close-to-tray"
              checked={formState.minimizeToTrayOnClose}
              onChange={(checked) => {
                clearFeedback();
                setFormState((prev) => ({
                  ...prev,
                  minimizeToTrayOnClose: checked,
                }));
              }}
              label={t("settings.general.closeToTrayLabel")}
              description={t("settings.general.closeToTrayDescription")}
              ariaDescribedBy="close-to-tray-help"
            />

            {/* Launch at Login Toggle */}
            <SwitchToggle
              id="switch-launch-at-login"
              checked={formState.launchOnStartup}
              onChange={(checked) => {
                clearFeedback();
                setFormState((prev) => ({
                  ...prev,
                  launchOnStartup: checked,
                }));
              }}
              label={t("settings.general.launchAtLoginLabel")}
              description={t("settings.general.launchAtLoginDescription")}
              ariaDescribedBy="launch-at-login-help"
            />
          </div>
        </section>

        {/* Section 2: Google OAuth Credentials Card */}
        <section
          aria-labelledby="oauth-credentials-heading"
          className="p-4 sm:p-5 rounded-[var(--comp-settings-card-radius)] bg-[var(--comp-settings-card-bg)] border border-[var(--comp-settings-card-border)] flex flex-col gap-4 min-w-0"
        >
          <div className="border-b border-[var(--border-subtle)] pb-3 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2
                id="oauth-credentials-heading"
                className="text-sm sm:text-base font-semibold text-[var(--text-primary)]"
              >
                {t("settings.oauth.title")}
              </h2>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-[var(--bg-canvas)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
                <Lock
                  className="w-3.5 h-3.5 text-[var(--primitive-color-emerald-400)]"
                  aria-hidden="true"
                />
                <span>{t("settings.oauth.encryptedBadge")}</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t("settings.oauth.description")}
            </p>
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            {/* Client ID */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="oauth-client-id"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.oauth.clientIdLabel")}
              </label>
              <input
                id="oauth-client-id"
                type="text"
                value={formState.oauth.clientId}
                onChange={(e) => {
                  clearFeedback();
                  const value = e.target.value;
                  setFormState((prev) => ({
                    ...prev,
                    oauth: { ...prev.oauth, clientId: value },
                  }));
                }}
                placeholder={t("settings.oauth.clientIdPlaceholder")}
                className="w-full min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
              />
            </div>

            {/* Client Secret */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="oauth-client-secret"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.oauth.clientSecretLabel")}
              </label>
              <div className="relative flex items-center min-w-0">
                <input
                  id="oauth-client-secret"
                  type={showSecret ? "text" : "password"}
                  value={formState.oauth.clientSecret || ""}
                  onChange={(e) => {
                    clearFeedback();
                    const value = e.target.value;
                    setFormState((prev) => ({
                      ...prev,
                      oauth: { ...prev.oauth, clientSecret: value },
                    }));
                  }}
                  placeholder={t("settings.oauth.clientSecretPlaceholder")}
                  className="w-full min-h-[44px] pl-3 pr-12 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  aria-label={
                    showSecret
                      ? t("settings.oauth.hideSecret")
                      : t("settings.oauth.showSecret")
                  }
                  aria-pressed={showSecret}
                  className="absolute right-0 top-0 bottom-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] rounded-r-[var(--comp-input-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 transition-all cursor-pointer"
                >
                  {showSecret ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Binary Paths & Process Discovery Card */}
        <section
          aria-labelledby="binary-paths-heading"
          className="p-4 sm:p-5 rounded-[var(--comp-settings-card-radius)] bg-[var(--comp-settings-card-bg)] border border-[var(--comp-settings-card-border)] flex flex-col gap-4 min-w-0"
        >
          <div className="border-b border-[var(--border-subtle)] pb-3 min-w-0">
            <h2
              id="binary-paths-heading"
              className="text-sm sm:text-base font-semibold text-[var(--text-primary)]"
            >
              {t("settings.binaryPaths.title")}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t("settings.binaryPaths.description")}
            </p>
          </div>

          <div className="flex flex-col gap-5 min-w-0">
            {/* AGY Daemon Path Input */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="daemon-binary-path"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.binaryPaths.daemonPathLabel")}
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-0">
                <input
                  id="daemon-binary-path"
                  type="text"
                  value={formState.binaryPaths.agyDaemonPath}
                  onChange={(e) => {
                    clearFeedback();
                    const value = e.target.value;
                    setFormState((prev) => ({
                      ...prev,
                      binaryPaths: {
                        ...prev.binaryPaths,
                        agyDaemonPath: value,
                        autoDetected: false,
                      },
                    }));
                  }}
                  placeholder={t("settings.binaryPaths.daemonPathPlaceholder")}
                  className="flex-1 min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
                  aria-describedby="daemon-path-status"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="file"
                    ref={daemonFileInputRef}
                    onChange={handleDaemonFileSelect}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => daemonFileInputRef.current?.click()}
                    className="flex-1 sm:flex-none min-h-[44px] min-w-[44px] px-3.5 flex items-center justify-center gap-1.5 rounded-[var(--comp-btn-radius)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] hover:border-[var(--border-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 transition-all cursor-pointer"
                  >
                    <FolderOpen
                      className="w-4 h-4 text-[var(--text-muted)]"
                      aria-hidden="true"
                    />
                    <span>{t("settings.binaryPaths.browse")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAutoDetectDaemon}
                    disabled={isDetectingDaemon}
                    className="flex-1 sm:flex-none min-h-[44px] min-w-[44px] px-3.5 flex items-center justify-center gap-1.5 rounded-[var(--comp-btn-radius)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] hover:border-[var(--border-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    {isDetectingDaemon ? (
                      <>
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin"
                          aria-hidden="true"
                        />
                        <span>{t("settings.binaryPaths.detecting")}</span>
                      </>
                    ) : (
                      <>
                        <Search
                          className="w-3.5 h-3.5 text-[var(--text-muted)]"
                          aria-hidden="true"
                        />
                        <span>{t("settings.binaryPaths.autoDetect")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Status helper */}
              <div
                id="daemon-path-status"
                className="flex items-center gap-1.5 mt-1 text-[11px] font-mono text-[var(--text-muted)] min-w-0"
              >
                {daemonDetectionMsg ? (
                  <span className="text-[var(--primitive-color-emerald-400)]">
                    ● {daemonDetectionMsg}
                  </span>
                ) : formState.binaryPaths.agyDaemonPath ? (
                  <span className="text-[var(--primitive-color-emerald-400)]">
                    ● {t("settings.binaryPaths.statusValid")}
                  </span>
                ) : (
                  <span className="text-[var(--primitive-color-neutral-400)]">
                    ○ {t("settings.binaryPaths.statusInvalid")}
                  </span>
                )}
              </div>
            </div>

            {/* Antigravity IDE Path Input */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="ide-binary-path"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.binaryPaths.idePathLabel")}
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-0">
                <input
                  id="ide-binary-path"
                  type="text"
                  value={formState.binaryPaths.ideExecutablePath}
                  onChange={(e) => {
                    clearFeedback();
                    const value = e.target.value;
                    setFormState((prev) => ({
                      ...prev,
                      binaryPaths: {
                        ...prev.binaryPaths,
                        ideExecutablePath: value,
                        autoDetected: false,
                      },
                    }));
                  }}
                  placeholder={t("settings.binaryPaths.idePathPlaceholder")}
                  className="flex-1 min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
                  aria-describedby="ide-path-status"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="file"
                    ref={ideFileInputRef}
                    onChange={handleIdeFileSelect}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => ideFileInputRef.current?.click()}
                    className="flex-1 sm:flex-none min-h-[44px] min-w-[44px] px-3.5 flex items-center justify-center gap-1.5 rounded-[var(--comp-btn-radius)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] hover:border-[var(--border-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 transition-all cursor-pointer"
                  >
                    <FolderOpen
                      className="w-4 h-4 text-[var(--text-muted)]"
                      aria-hidden="true"
                    />
                    <span>{t("settings.binaryPaths.browse")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAutoDetectIde}
                    disabled={isDetectingIde}
                    className="flex-1 sm:flex-none min-h-[44px] min-w-[44px] px-3.5 flex items-center justify-center gap-1.5 rounded-[var(--comp-btn-radius)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] hover:border-[var(--border-hover)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    {isDetectingIde ? (
                      <>
                        <Loader2
                          className="w-3.5 h-3.5 animate-spin"
                          aria-hidden="true"
                        />
                        <span>{t("settings.binaryPaths.detecting")}</span>
                      </>
                    ) : (
                      <>
                        <Search
                          className="w-3.5 h-3.5 text-[var(--text-muted)]"
                          aria-hidden="true"
                        />
                        <span>{t("settings.binaryPaths.autoDetect")}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Status helper */}
              <div
                id="ide-path-status"
                className="flex items-center gap-1.5 mt-1 text-[11px] font-mono text-[var(--text-muted)] min-w-0"
              >
                {ideDetectionMsg ? (
                  <span className="text-[var(--primitive-color-emerald-400)]">
                    ● {ideDetectionMsg}
                  </span>
                ) : formState.binaryPaths.ideExecutablePath ? (
                  <span className="text-[var(--primitive-color-emerald-400)]">
                    ● {t("settings.binaryPaths.statusValid")}
                  </span>
                ) : (
                  <span className="text-[var(--primitive-color-neutral-400)]">
                    ○ {t("settings.binaryPaths.statusInvalid")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Network & Remote Tethering Card */}
        <section
          aria-labelledby="network-tethering-heading"
          className="p-4 sm:p-5 rounded-[var(--comp-settings-card-radius)] bg-[var(--comp-settings-card-bg)] border border-[var(--comp-settings-card-border)] flex flex-col gap-4 min-w-0"
        >
          <div className="border-b border-[var(--border-subtle)] pb-3 min-w-0">
            <h2
              id="network-tethering-heading"
              className="text-sm sm:text-base font-semibold text-[var(--text-primary)]"
            >
              {t("settings.network.title")}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t("settings.network.description")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            {/* Relay Server Port */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="relay-server-port"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.network.relayPortLabel")}
              </label>
              <input
                id="relay-server-port"
                type="number"
                min={1}
                max={65535}
                value={formState.network.relayPort}
                onChange={(e) => {
                  clearFeedback();
                  const value = parseInt(e.target.value, 10) || 0;
                  setFormState((prev) => ({
                    ...prev,
                    network: { ...prev.network, relayPort: value },
                  }));
                }}
                placeholder={t("settings.network.relayPortPlaceholder")}
                className="w-full min-h-[44px] px-3 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
                aria-describedby="relay-port-help"
              />
              <p
                id="relay-port-help"
                className="text-[11px] text-[var(--text-muted)] leading-relaxed"
              >
                {t("settings.network.relayPortHelp")}
              </p>
            </div>

            {/* Cloudflare Named Tunnel Token */}
            <div className="flex flex-col gap-1.5 min-w-0">
              <label
                htmlFor="cloudflare-named-token"
                className="text-xs sm:text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings.network.tunnelTokenLabel")}
              </label>
              <div className="relative flex items-center min-w-0">
                <input
                  id="cloudflare-named-token"
                  type={showTunnelToken ? "text" : "password"}
                  value={formState.network.cloudflareNamedToken || ""}
                  onChange={(e) => {
                    clearFeedback();
                    const value = e.target.value;
                    setFormState((prev) => ({
                      ...prev,
                      network: {
                        ...prev.network,
                        cloudflareNamedToken: value,
                      },
                    }));
                  }}
                  placeholder={t("settings.network.tunnelTokenPlaceholder")}
                  className="w-full min-h-[44px] pl-3 pr-12 rounded-[var(--comp-input-radius)] bg-[var(--comp-input-bg)] border border-[var(--comp-input-border)] text-[var(--comp-input-text)] placeholder:text-[var(--comp-input-placeholder)] font-mono text-xs sm:text-sm focus-visible:border-[var(--comp-input-border-focus)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none hover:border-[var(--border-hover)] transition-colors min-w-0"
                  aria-describedby="tunnel-token-help"
                />
                <button
                  type="button"
                  onClick={() => setShowTunnelToken(!showTunnelToken)}
                  aria-label={
                    showTunnelToken
                      ? t("settings.network.hideToken")
                      : t("settings.network.showToken")
                  }
                  aria-pressed={showTunnelToken}
                  className="absolute right-0 top-0 bottom-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] rounded-r-[var(--comp-input-radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-95 transition-all cursor-pointer"
                >
                  {showTunnelToken ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <p
                id="tunnel-token-help"
                className="text-[11px] text-[var(--text-muted)] leading-relaxed"
              >
                {t("settings.network.tunnelTokenHelp")}
              </p>
            </div>
          </div>
        </section>

        {/* Section 5: Desktop Notifications Card */}
        <section
          aria-labelledby="desktop-notifications-heading"
          className="p-4 sm:p-5 rounded-[var(--comp-settings-card-radius)] bg-[var(--comp-settings-card-bg)] border border-[var(--comp-settings-card-border)] flex flex-col gap-4 min-w-0"
        >
          <div className="border-b border-[var(--border-subtle)] pb-3 min-w-0">
            <h2
              id="desktop-notifications-heading"
              className="text-sm sm:text-base font-semibold text-[var(--text-primary)]"
            >
              {t("settings.notifications.title")}
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {t("settings.notifications.description")}
            </p>
          </div>

          <div className="flex flex-col gap-3 min-w-0">
            {/* Master Notification Toggle */}
            <SwitchToggle
              id="switch-notifications-master"
              checked={formState.notifications.enabled}
              onChange={(checked) => {
                clearFeedback();
                setFormState((prev) => ({
                  ...prev,
                  notifications: {
                    ...prev.notifications,
                    enabled: checked,
                  },
                }));
              }}
              label={t("settings.notifications.masterLabel")}
              description={t("settings.notifications.masterDescription")}
              ariaDescribedBy="notifications-master-help"
            />

            <div className="pl-4 sm:pl-6 border-l-2 border-[var(--border-subtle)] flex flex-col gap-3 mt-1 min-w-0">
              {/* Auto Switch Notification */}
              <SwitchToggle
                id="switch-notify-auto-switch"
                checked={formState.notifications.notifyOnAutoSwitch}
                disabled={!formState.notifications.enabled}
                onChange={(checked) => {
                  clearFeedback();
                  setFormState((prev) => ({
                    ...prev,
                    notifications: {
                      ...prev.notifications,
                      notifyOnAutoSwitch: checked,
                    },
                  }));
                }}
                label={t("settings.notifications.autoSwitchLabel")}
                description={t("settings.notifications.autoSwitchDescription")}
                ariaDescribedBy="notify-auto-switch-help"
              />

              {/* Rate Limit Notification */}
              <SwitchToggle
                id="switch-notify-rate-limit"
                checked={formState.notifications.notifyOnRateLimit}
                disabled={!formState.notifications.enabled}
                onChange={(checked) => {
                  clearFeedback();
                  setFormState((prev) => ({
                    ...prev,
                    notifications: {
                      ...prev.notifications,
                      notifyOnRateLimit: checked,
                    },
                  }));
                }}
                label={t("settings.notifications.rateLimitsLabel")}
                description={t("settings.notifications.rateLimitsDescription")}
                ariaDescribedBy="notify-rate-limit-help"
              />

              {/* Service Errors Notification */}
              <SwitchToggle
                id="switch-notify-service-errors"
                checked={formState.notifications.notifyOnProcessCrash}
                disabled={!formState.notifications.enabled}
                onChange={(checked) => {
                  clearFeedback();
                  setFormState((prev) => ({
                    ...prev,
                    notifications: {
                      ...prev.notifications,
                      notifyOnProcessCrash: checked,
                    },
                  }));
                }}
                label={t("settings.notifications.serviceErrorsLabel")}
                description={t(
                  "settings.notifications.serviceErrorsDescription",
                )}
                ariaDescribedBy="notify-service-errors-help"
              />
            </div>
          </div>
        </section>

        {/* Section 6: Action Bar */}
        <section
          aria-label={t("settings.title")}
          className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 pb-8 min-w-0"
        >
          <button
            type="button"
            onClick={() => setIsResetDialogOpen(true)}
            className="min-h-[44px] min-w-[44px] px-4 flex items-center justify-center gap-2 rounded-[var(--comp-btn-radius)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] hover:border-[var(--border-hover)] text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] transition-all cursor-pointer"
          >
            <RotateCcw
              className="w-4 h-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <span>{t("settings.actions.reset")}</span>
          </button>

          <button
            type="submit"
            disabled={!isDirty || isSaving}
            className="min-h-[44px] min-w-[44px] px-6 flex items-center justify-center gap-2 rounded-[var(--comp-btn-radius)] bg-[var(--brand-primary)] hover:bg-[var(--brand-hover)] text-white text-xs sm:text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("settings.actions.saving")}</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{t("settings.actions.save")}</span>
              </>
            )}
          </button>
        </section>
      </form>

      {/* Reset Confirmation Modal */}
      <dialog
        ref={resetDialogRef}
        onClose={() => setIsResetDialogOpen(false)}
        aria-labelledby="reset-dialog-title"
        aria-describedby="reset-dialog-description"
        className="fixed inset-0 m-auto p-0 bg-transparent backdrop:bg-[var(--bg-overlay)] backdrop:backdrop-blur-xs z-50 rounded-[var(--comp-modal-radius)] border-none outline-none max-w-md w-[calc(100%-2rem)]"
      >
        <div className="bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] rounded-[var(--comp-modal-radius)] p-5 sm:p-6 shadow-2xl flex flex-col gap-4 text-[var(--text-primary)]">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[rgba(239,68,68,0.15)] flex items-center justify-center shrink-0 text-[var(--primitive-color-red-400)]">
              <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="reset-dialog-title"
                className="text-base sm:text-lg font-semibold text-[var(--text-primary)]"
              >
                {t("settings.actions.resetConfirmTitle")}
              </h2>
              <p
                id="reset-dialog-description"
                className="mt-1 text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed"
              >
                {t("settings.actions.resetConfirmMessage")}
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 mt-2">
            <button
              type="button"
              onClick={() => setIsResetDialogOpen(false)}
              className="min-h-[44px] min-w-[44px] px-4 rounded-[var(--comp-btn-radius)] border border-[var(--border-default)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={isResetting}
              className="min-h-[44px] min-w-[44px] px-4 rounded-[var(--comp-btn-radius)] bg-[var(--primitive-color-red-600)] hover:bg-[var(--primitive-color-red-500)] text-white text-xs sm:text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isResetting ? (
                <>
                  <Loader2
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  />
                  <span>{t("common.status.loading")}</span>
                </>
              ) : (
                <span>{t("settings.actions.resetConfirmButton")}</span>
              )}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
};
