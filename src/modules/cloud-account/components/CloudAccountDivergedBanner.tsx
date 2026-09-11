import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import type { DivergedTargetInfo } from "@/modules/cloud-account/utils/divergedState";

export interface CloudAccountDivergedBannerProps {
  divergedTargets: DivergedTargetInfo[];
  resolvedCandidateEmail: string | null;
  isResyncing: boolean;
  onResyncAll: () => Promise<void> | void;
  summaryRef?: React.RefObject<HTMLDivElement | null>;
}

export function CloudAccountDivergedBanner({
  divergedTargets,
  resolvedCandidateEmail,
  isResyncing,
  onResyncAll,
  summaryRef,
}: CloudAccountDivergedBannerProps) {
  const { t } = useTranslation();
  const bannerRef = useRef<HTMLDivElement>(null);
  const hadFocusRef = useRef(false);

  useEffect(() => {
    return () => {
      if (
        summaryRef?.current &&
        (hadFocusRef.current ||
          (bannerRef.current &&
            document.activeElement &&
            bannerRef.current.contains(document.activeElement)))
      ) {
        summaryRef.current.focus({ preventScroll: true });
      }
    };
  }, [summaryRef]);

  const strandedTargets = divergedTargets.filter((dt) => dt.isRateLimited);
  const hasStrandedTarget = strandedTargets.length > 0;

  return (
    <div
      ref={bannerRef}
      role="region"
      aria-labelledby="diverged-banner-title"
      aria-describedby="diverged-banner-description"
      onFocusCapture={() => {
        hadFocusRef.current = true;
      }}
      onBlurCapture={(e) => {
        if (
          bannerRef.current &&
          !bannerRef.current.contains(e.relatedTarget as Node | null)
        ) {
          hadFocusRef.current = false;
        }
      }}
      className="relative mb-4 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-sm transition-all duration-300 dark:border-amber-500/35 dark:bg-amber-500/15"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/20 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/25 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="diverged-banner-title"
                className="text-sm font-semibold text-amber-950 dark:text-amber-100"
              >
                {t("cloud.divergedBanner.title")}
              </h3>

              {hasStrandedTarget && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300"
                  role="status"
                >
                  <AlertCircle
                    className="h-3 w-3 shrink-0"
                    aria-hidden="true"
                  />
                  {t("cloud.divergedBanner.strandedWarning", {
                    target: strandedTargets
                      .map((st) => st.targetLabel)
                      .join(", "),
                  })}
                </span>
              )}
            </div>

            <p
              id="diverged-banner-description"
              className="min-w-0 text-xs leading-relaxed break-words text-amber-900/90 dark:text-amber-200/90"
            >
              {t("cloud.divergedBanner.description", {
                targets: divergedTargets
                  .map((dt) => `${dt.targetLabel} (${dt.accountEmail})`)
                  .join(", "),
              })}
            </p>
          </div>
        </div>

        <div className="shrink-0 pt-1 sm:pt-0">
          <button
            type="button"
            onClick={onResyncAll}
            disabled={isResyncing || !resolvedCandidateEmail}
            aria-busy={isResyncing}
            className="group relative inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-zinc-800 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-zinc-100 sm:w-auto"
          >
            {isResyncing ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin text-current"
                  aria-hidden="true"
                />
                <span>{t("cloud.divergedBanner.resyncing")}</span>
              </>
            ) : (
              <>
                <RefreshCw
                  className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:rotate-180"
                  aria-hidden="true"
                />
                <span className="max-w-[280px] truncate sm:max-w-none">
                  {resolvedCandidateEmail
                    ? t("cloud.divergedBanner.resyncAction", {
                        email: resolvedCandidateEmail,
                      })
                    : t("cloud.divergedBanner.resyncActionDefault")}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
