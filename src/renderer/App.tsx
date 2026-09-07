import React, { useState, useCallback } from "react";
import { useTranslation } from "./locales/i18n";
import { useAccounts } from "./hooks/useAccounts";
import { useServiceStatus } from "./hooks/useServiceStatus";
import { useSwitcher } from "./hooks/useSwitcher";
import { useQuota } from "./hooks/useQuota";
import { useSnapshots } from "./hooks/useSnapshots";
import { useRateLimits } from "./hooks/useRateLimits";
import { AccountList } from "./pages/AccountList";
import { RemoteControl } from "./pages/RemoteControl";
import { AutoSwitchSettings } from "./components/AutoSwitchSettings";
import { SnapshotModal } from "./components/SnapshotModal";
import { StatusBar } from "./components/StatusBar";
import { Globe, Radio, Settings, Users, Camera } from "lucide-react";

export const App: React.FC = () => {
  const { t, locale, setLocale } = useTranslation();
  const [activeTab, setActiveTab] = useState<
    "accounts" | "remote" | "settings"
  >("accounts");
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const {
    accounts,
    isLoading: isAccountsLoading,
    isAuthenticating,
    refreshingAccountId,
    deletingAccountId,
    error: accountError,
    fetchAccounts,
    addAccount,
    removeAccount,
    refreshAccountToken,
    selectActiveAccount,
    clearError: clearAccountError,
  } = useAccounts();

  const {
    status: serviceStatus,
    transitionalStates,
    toggleService,
  } = useServiceStatus();

  const handleSwitchComplete = useCallback(
    (result: { newAccountEmail: string }) => {
      fetchAccounts();
      setLiveAnnouncement(
        t("switcher.switchSuccess", { email: result.newAccountEmail }),
      );
    },
    [fetchAccounts, t],
  );

  const {
    config: switcherConfig,
    isSavingConfig,
    isSwitching,
    switchingAccountId,
    lastSwitchResult,
    poolExhaustedReason,
    fetchConfig,
    updateConfig,
    manualSwitch,
  } = useSwitcher(handleSwitchComplete);

  const handleQuotaUpdated = useCallback(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const { pollAccount, pollingAccountIds } = useQuota(handleQuotaUpdated);

  const handleRestoreSuccess = useCallback(async () => {
    await fetchAccounts();
    await fetchConfig();
    setLiveAnnouncement(t("snapshots.restoredToast", { name: "Snapshot" }));
  }, [fetchAccounts, fetchConfig, t]);

  const {
    snapshots,
    isLoading: isSnapshotsLoading,
    isCreating: isSnapshotCreating,
    restoringId: restoringSnapshotId,
    deletingId: deletingSnapshotId,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
  } = useSnapshots(handleRestoreSuccess);

  const { rateLimits, fetchRateLimits } = useRateLimits();

  const handleLanguageToggle = () => {
    setLocale(locale === "en" ? "id" : "en");
  };

  const handleRefreshQuota = async (accountId: string) => {
    await pollAccount(accountId);
    await fetchAccounts();
    await fetchRateLimits();
  };

  const handleManualSwitch = async (accountId: string) => {
    const success = await manualSwitch(accountId);
    if (success) {
      await fetchAccounts();
      await fetchRateLimits();
    }
    return success;
  };

  const activeRefreshingQuotaId =
    Object.keys(pollingAccountIds).find((k) => pollingAccountIds[k]) || null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)] select-none">
      {/* Screen Reader Live Region for Autonomous Switch Updates */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>

      {/* Skip to Main Content Link for Keyboard Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--primitive-color-blue-600)] focus:text-white focus:rounded focus:outline-none"
      >
        {t("accessibility.skipToContent")}
      </a>

      {/* TitleBar with Window Drag Region & Traffic Light Clearance */}
      <header className="window-drag-region h-[var(--comp-titlebar-height)] pl-[76px] pr-4 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-xs sm:text-sm text-[var(--text-primary)] truncate">
            {t("app.title")}
          </span>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
            {t("app.version")}
          </span>
        </div>

        <div className="flex items-center gap-2 window-no-drag">
          {/* Quick Snapshot Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsSnapshotModalOpen(true)}
            aria-label={t("snapshots.title")}
            title={t("snapshots.title")}
            className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] border border-[var(--border-default)] bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <Camera
              className="w-4 h-4 text-[var(--primitive-color-emerald-400)]"
              aria-hidden="true"
            />
          </button>

          {/* Locale Switcher Button */}
          <button
            type="button"
            onClick={handleLanguageToggle}
            aria-label={`Switch language. Current: ${locale.toUpperCase()}`}
            className="min-h-[44px] px-2.5 flex items-center gap-1.5 rounded text-xs font-mono border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-semibold">{locale.toUpperCase()}</span>
          </button>

          {/* Connection Telemetry Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--primitive-color-emerald-400)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primitive-color-emerald-500)]" />
            <span>{t("app.connection.online")}</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <nav
        aria-label="Primary Application Navigation"
        className="h-[var(--comp-nav-height)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 flex items-center gap-2 sm:gap-4 overflow-x-auto shrink-0"
      >
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          aria-current={activeTab === "accounts" ? "page" : undefined}
          className={`min-h-[44px] px-3 sm:px-4 flex items-center gap-2 text-xs sm:text-sm font-medium border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
            activeTab === "accounts"
              ? "border-[var(--primitive-color-blue-500)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Users className="w-4 h-4" aria-hidden="true" />
          <span>{t("nav.accounts")}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("remote")}
          aria-current={activeTab === "remote" ? "page" : undefined}
          className={`min-h-[44px] px-3 sm:px-4 flex items-center gap-2 text-xs sm:text-sm font-medium border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
            activeTab === "remote"
              ? "border-[var(--primitive-color-blue-500)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Radio className="w-4 h-4" aria-hidden="true" />
          <span>{t("nav.remoteControl")}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("settings")}
          aria-current={activeTab === "settings" ? "page" : undefined}
          className={`min-h-[44px] px-3 sm:px-4 flex items-center gap-2 text-xs sm:text-sm font-medium border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
            activeTab === "settings"
              ? "border-[var(--primitive-color-blue-500)] text-[var(--text-primary)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span>{t("nav.settings")}</span>
        </button>
      </nav>

      {/* Main View Area */}
      <main
        id="main-content"
        className="flex-1 flex flex-col min-w-0 overflow-y-auto"
      >
        {activeTab === "accounts" && (
          <AccountList
            accounts={accounts}
            isLoading={isAccountsLoading}
            isAuthenticating={isAuthenticating}
            refreshingAccountId={refreshingAccountId}
            deletingAccountId={deletingAccountId}
            isSwitching={isSwitching}
            switchingAccountId={switchingAccountId}
            refreshingQuotaAccountId={activeRefreshingQuotaId}
            rateLimits={rateLimits}
            snapshotCount={snapshots.length}
            error={accountError}
            onAddAccount={addAccount}
            onRemoveAccount={removeAccount}
            onRefreshToken={refreshAccountToken}
            onSetActive={selectActiveAccount}
            onSwitchAccount={handleManualSwitch}
            onRefreshQuota={handleRefreshQuota}
            onOpenSnapshots={() => setIsSnapshotModalOpen(true)}
            onClearError={clearAccountError}
          />
        )}

        {activeTab === "remote" && <RemoteControl />}

        {activeTab === "settings" && (
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
            {switcherConfig ? (
              <AutoSwitchSettings
                config={switcherConfig}
                accounts={accounts}
                isSaving={isSavingConfig}
                isSwitching={isSwitching}
                switchingAccountId={switchingAccountId}
                lastSwitchResult={lastSwitchResult}
                poolExhaustedReason={poolExhaustedReason}
                onSaveConfig={updateConfig}
                onManualSwitch={handleManualSwitch}
              />
            ) : (
              <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                {t("common.status.loading")}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Dual Service Sticky Status Bar */}
      <StatusBar
        status={serviceStatus}
        transitionalStates={transitionalStates}
        onToggleService={toggleService}
      />

      {/* Snapshot Manager Modal */}
      <SnapshotModal
        isOpen={isSnapshotModalOpen}
        onClose={() => setIsSnapshotModalOpen(false)}
        snapshots={snapshots}
        isLoading={isSnapshotsLoading}
        isCreating={isSnapshotCreating}
        restoringId={restoringSnapshotId}
        deletingId={deletingSnapshotId}
        onCreateSnapshot={createSnapshot}
        onRestoreSnapshot={restoreSnapshot}
        onDeleteSnapshot={deleteSnapshot}
      />
    </div>
  );
};
