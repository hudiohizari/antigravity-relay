import React, { useState, useEffect, useRef } from "react";
import { SnapshotMetadata } from "../../shared/types";
import { useTranslation } from "../locales/i18n";
import {
  Shield,
  Plus,
  Trash2,
  RotateCcw,
  X,
  Loader2,
  AlertTriangle,
  Calendar,
  Layers,
  Check,
} from "lucide-react";

export interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: SnapshotMetadata[];
  isLoading: boolean;
  isCreating: boolean;
  restoringId: string | null;
  deletingId: string | null;
  onCreateSnapshot: (name: string, description?: string) => Promise<boolean>;
  onRestoreSnapshot: (id: string) => Promise<boolean>;
  onDeleteSnapshot: (id: string) => Promise<boolean>;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}

export const SnapshotModal: React.FC<SnapshotModalProps> = ({
  isOpen,
  onClose,
  snapshots,
  isLoading,
  isCreating,
  restoringId,
  deletingId,
  onCreateSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
}) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Confirmation dialogs
  const [snapshotToRestore, setSnapshotToRestore] =
    useState<SnapshotMetadata | null>(null);
  const [snapshotToDelete, setSnapshotToDelete] =
    useState<SnapshotMetadata | null>(null);

  // Native dialog open/close lifecycle
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError(t("snapshots.nameLabel"));
      return;
    }

    setFormError(null);
    const success = await onCreateSnapshot(name.trim(), description.trim() || undefined);
    if (success) {
      setName("");
      setDescription("");
    }
  };

  const handleConfirmRestore = async () => {
    if (!snapshotToRestore) return;
    const targetId = snapshotToRestore.id;
    const success = await onRestoreSnapshot(targetId);
    if (success) {
      setSnapshotToRestore(null);
      onClose();
    }
  };

  const handleConfirmDelete = async () => {
    if (!snapshotToDelete) return;
    const targetId = snapshotToDelete.id;
    const success = await onDeleteSnapshot(targetId);
    if (success) {
      setSnapshotToDelete(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="snapshot-modal-title"
      aria-describedby="snapshot-modal-description"
      className="backdrop:bg-[var(--comp-modal-overlay-bg)] backdrop:backdrop-blur-xs p-0 bg-transparent text-[var(--text-primary)] max-w-2xl w-[calc(100%-2rem)] m-auto rounded-xl border border-[var(--border-default)] shadow-2xl overflow-hidden focus:outline-none"
    >
      <div className="bg-[var(--bg-surface)] p-5 sm:p-6 space-y-6 max-h-[85vh] overflow-y-auto flex flex-col">
        {/* Header with Title and Close Button */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield
                className="w-5 h-5 text-[var(--primitive-color-emerald-400)] shrink-0"
                aria-hidden="true"
              />
              <h2
                id="snapshot-modal-title"
                className="text-lg font-bold text-[var(--text-primary)] truncate"
              >
                {t("snapshots.title")}
              </h2>
            </div>
            <p
              id="snapshot-modal-description"
              className="text-xs sm:text-sm text-[var(--text-muted)] mt-1"
            >
              {t("snapshots.subtitle")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.actions.close")}
            className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Create Snapshot Form */}
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)]/60 space-y-3 min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {t("snapshots.createButton")}
            </span>
            <span className="text-xs font-mono text-[var(--text-muted)]">
              {t("snapshots.accountCount", { count: snapshots.length })}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="snapshot-name-input" className="sr-only">
                {t("snapshots.nameLabel")}
              </label>
              <input
                id="snapshot-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("snapshots.namePlaceholder")}
                className="w-full min-h-[44px] px-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              />
            </div>

            <div>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full min-h-[44px] px-3 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              />
            </div>
          </div>

          {formError && (
            <div className="text-xs text-[var(--primitive-color-red-400)]">
              {formError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="min-h-[44px] px-4 py-2 bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] active:bg-[var(--primitive-color-blue-700)] text-white text-xs sm:text-sm font-medium rounded-md active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>{t("snapshots.creatingButton")}</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>{t("snapshots.createButton")}</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Snapshots Listing Section */}
        <div className="space-y-3 min-w-0 flex-1">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-lg bg-[var(--bg-canvas)]/40 border border-[var(--border-subtle)] animate-pulse"
                />
              ))}
            </div>
          ) : snapshots.length === 0 ? (
            <div className="py-8 px-4 text-center border border-dashed border-[var(--border-default)] rounded-xl bg-[var(--bg-canvas)]/30 flex flex-col items-center justify-center">
              <Shield
                className="w-10 h-10 text-[var(--text-muted)] mb-2"
                aria-hidden="true"
              />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("snapshots.emptyTitle")}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm">
                {t("snapshots.emptyDescription")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="p-3.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-canvas)]/40 hover:bg-[var(--bg-canvas)]/70 hover:border-[var(--border-hover)] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs sm:text-sm text-[var(--text-primary)] truncate">
                        {snap.name}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] text-[var(--primitive-color-emerald-400)]">
                        AES-256-GCM
                      </span>
                      {snap.sizeBytes && (
                        <span className="text-[11px] font-mono text-[var(--text-muted)]">
                          {formatBytes(snap.sizeBytes)}
                        </span>
                      )}
                    </div>

                    {snap.description && (
                      <p className="text-xs text-[var(--text-secondary)] truncate">
                        {snap.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-muted)] flex-wrap">
                      <div className="flex items-center gap-1">
                        <Layers className="w-3 h-3" aria-hidden="true" />
                        <span>
                          {t("snapshots.accountCount", {
                            count: snap.accountCount,
                          })}
                        </span>
                      </div>
                      {snap.activeAccountEmail && (
                        <div className="truncate">
                          {t("snapshots.activeAccountLabel", {
                            email: snap.activeAccountEmail,
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        <span>{formatDate(snap.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => setSnapshotToRestore(snap)}
                      disabled={restoringId === snap.id || deletingId === snap.id}
                      className="min-h-[44px] px-3.5 rounded-md text-xs font-medium border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {restoringId === snap.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5 text-[var(--primitive-color-blue-400)]" />
                      )}
                      <span>{t("snapshots.restoreButton")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSnapshotToDelete(snap)}
                      disabled={restoringId === snap.id || deletingId === snap.id}
                      aria-label={t("snapshots.deleteButton")}
                      title={t("snapshots.deleteButton")}
                      className="min-h-[44px] min-w-[44px] p-2 rounded-md border border-[var(--status-error-border)] bg-[var(--status-error-bg)] text-[var(--primitive-color-red-400)] hover:bg-[var(--primitive-color-red-500)]/20 active:scale-95 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] disabled:opacity-50"
                    >
                      {deletingId === snap.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            {t("common.actions.close")}
          </button>
        </div>
      </div>

      {/* Restore Confirmation Dialog Overlay */}
      {snapshotToRestore && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/80 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-labelledby="restore-dialog-title"
            aria-describedby="restore-dialog-desc"
            className="bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--status-pending-bg)] border border-[var(--status-pending-border)] flex items-center justify-center text-[var(--primitive-color-amber-400)] shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 id="restore-dialog-title" className="text-base font-bold">
                  {t("snapshots.restoreConfirmTitle")}
                </h3>
                <p
                  id="restore-dialog-desc"
                  className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1 leading-relaxed"
                >
                  {t("snapshots.restoreConfirmMessage")}
                </p>
                <div className="mt-2 text-xs font-mono text-[var(--primitive-color-emerald-400)]">
                  &quot;{snapshotToRestore.name}&quot; (
                  {t("snapshots.accountCount", {
                    count: snapshotToRestore.accountCount,
                  })}
                  )
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSnapshotToRestore(null)}
                className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={Boolean(restoringId)}
                className="min-h-[44px] px-4 py-2 rounded-md bg-[var(--primitive-color-blue-600)] hover:bg-[var(--primitive-color-blue-500)] text-white text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] flex items-center gap-1.5"
              >
                {restoringId ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("snapshots.restoringButton")}</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>{t("snapshots.restoreConfirmAction")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog Overlay */}
      {snapshotToDelete && (
        <div className="fixed inset-0 z-50 bg-[var(--bg-canvas)]/80 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-desc"
            className="bg-[var(--bg-surface-elevated)] border border-[var(--border-default)] rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--status-error-bg)] border border-[var(--status-error-border)] flex items-center justify-center text-[var(--primitive-color-red-400)] shrink-0">
                <Trash2 className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 id="delete-dialog-title" className="text-base font-bold">
                  {t("snapshots.deleteConfirmTitle")}
                </h3>
                <p
                  id="delete-dialog-desc"
                  className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1 leading-relaxed"
                >
                  {t("snapshots.deleteConfirmMessage", {
                    name: snapshotToDelete.name,
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSnapshotToDelete(null)}
                className="min-h-[44px] px-4 py-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs sm:text-sm font-medium text-[var(--text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={Boolean(deletingId)}
                className="min-h-[44px] px-4 py-2 rounded-md bg-[var(--primitive-color-red-600)] hover:bg-[var(--primitive-color-red-500)] text-white text-xs sm:text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] flex items-center gap-1.5"
              >
                {deletingId ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("snapshots.deletingButton")}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>{t("snapshots.deleteButton")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
};
