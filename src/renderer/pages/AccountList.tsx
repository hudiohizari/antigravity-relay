import React, { useState, useRef, useEffect } from "react";
import { GoogleAccount } from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import { AccountCard } from "../components/AccountCard";
import { Plus, Loader2, Shield, AlertCircle, X, UserCheck } from "lucide-react";

interface AccountListProps {
  accounts: GoogleAccount[];
  isLoading: boolean;
  isAuthenticating: boolean;
  refreshingAccountId: string | null;
  deletingAccountId: string | null;
  error: string | null;
  onAddAccount: () => Promise<unknown>;
  onRemoveAccount: (id: string) => Promise<boolean>;
  onRefreshToken: (id: string) => Promise<boolean>;
  onSetActive: (id: string) => Promise<boolean>;
  onClearError: () => void;
}

export const AccountList: React.FC<AccountListProps> = ({
  accounts,
  isLoading,
  isAuthenticating,
  refreshingAccountId,
  deletingAccountId,
  error,
  onAddAccount,
  onRemoveAccount,
  onRefreshToken,
  onSetActive,
  onClearError,
}) => {
  const { t } = useTranslation();
  const [accountToRemove, setAccountToRemove] = useState<GoogleAccount | null>(
    null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Sync native dialog state with accountToRemove
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (accountToRemove && !dialog.open) {
      dialog.showModal();
    } else if (!accountToRemove && dialog.open) {
      dialog.close();
    }
  }, [accountToRemove]);

  const handleConfirmRemove = async () => {
    if (!accountToRemove) return;
    const targetId = accountToRemove.id;
    setAccountToRemove(null);
    await onRemoveAccount(targetId);
  };

  const handleCancelRemove = () => {
    setAccountToRemove(null);
  };

  return (
    <section
      aria-label={t("accessibility.accountList")}
      className="flex-1 flex flex-col max-w-4xl w-full mx-auto p-4 sm:p-6 min-w-0"
    >
      {/* Header with Title, Count Badge and Add CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {t("accounts.headerTitle")}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] text-[var(--text-secondary)]">
              {t("accounts.countBadge", { count: accounts.length })}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1">
            {t("accounts.headerSubtitle")}
          </p>
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onAddAccount}
            disabled={isAuthenticating}
            aria-busy={isAuthenticating}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] text-white text-sm font-medium rounded-md active:scale-[0.98] transition-colors duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-canvas)] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("accounts.addAccountLoading")}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{t("accounts.addAccount")}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {error && (
        <aside
          role="alert"
          className="mb-6 p-4 rounded-lg bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--primitive-color-red-400)] flex items-start justify-between gap-3 text-sm"
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle
              className="w-5 h-5 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span className="break-words">{error}</span>
          </div>
          <button
            type="button"
            onClick={onClearError}
            className="min-h-[44px] min-w-[44px] p-2 text-[var(--primitive-color-red-400)] hover:text-white rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] flex items-center justify-center shrink-0"
            aria-label={t("common.actions.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </aside>
      )}

      {/* Loading Skeleton / Empty State / Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-44 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] animate-pulse p-4"
            />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="my-auto py-12 px-4 border border-dashed border-[var(--border-default)] rounded-xl bg-[var(--bg-surface)]/50 text-center flex flex-col items-center justify-center max-w-lg mx-auto w-full">
          <div className="w-12 h-12 rounded-full bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-muted)] mb-4">
            <Shield className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
            {t("accounts.emptyTitle")}
          </h2>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-sm mb-6 leading-relaxed">
            {t("accounts.emptyDescription")}
          </p>
          <button
            type="button"
            onClick={onAddAccount}
            disabled={isAuthenticating}
            className="min-h-[44px] px-5 py-2.5 bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] text-white text-xs sm:text-sm font-medium rounded-md active:scale-[0.98] transition-colors duration-150 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
          >
            {isAuthenticating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                <span>{t("accounts.addAccountLoading")}</span>
              </>
            ) : (
              <>
                <UserCheck className="w-4 h-4" aria-hidden="true" />
                <span>{t("accounts.emptyAction")}</span>
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
          {accounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              isActive={acc.status === "active"}
              isRefreshing={refreshingAccountId === acc.id}
              isDeleting={deletingAccountId === acc.id}
              onSetActive={onSetActive}
              onRefreshToken={onRefreshToken}
              onRemoveRequest={(target) => setAccountToRemove(target)}
            />
          ))}
        </div>
      )}

      {/* Native Accessible Dialog for Account Removal Confirmation */}
      <dialog
        ref={dialogRef}
        onCancel={handleCancelRemove}
        aria-labelledby="remove-modal-title"
        aria-describedby="remove-modal-desc"
        className="backdrop:bg-[rgba(9,13,22,0.85)] backdrop:backdrop-blur-xs p-6 bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] rounded-xl shadow-2xl text-[var(--text-primary)] max-w-md w-[calc(100%-2rem)] m-auto"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-[var(--status-error-bg)] border border-[var(--status-error-border)] flex items-center justify-center shrink-0 text-[var(--primitive-color-red-400)]">
            <AlertCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="remove-modal-title" className="text-base font-semibold">
              {t("accounts.card.removeConfirmTitle")}
            </h2>
            <p
              id="remove-modal-desc"
              className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed"
            >
              {accountToRemove &&
                t("accounts.card.removeConfirmMessage", {
                  email: accountToRemove.email,
                })}
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleCancelRemove}
            className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t("accounts.card.cancelButton")}
          </button>
          <button
            type="button"
            onClick={handleConfirmRemove}
            className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--status-error-border)] bg-[var(--primitive-color-red-600)] hover:bg-[var(--primitive-color-red-500)] text-white text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t("accounts.card.removeConfirmButton")}
          </button>
        </div>
      </dialog>
    </section>
  );
};
