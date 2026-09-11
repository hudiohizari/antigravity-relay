import { useTranslation } from "react-i18next";
import {
  GLOBAL_QUOTA_BAR_COLOR_CLASS_BY_STATUS,
  GLOBAL_QUOTA_TEXT_COLOR_CLASS_BY_STATUS,
} from "@/modules/cloud-account/components/CloudAccountList.constants";
import {
  clampQuotaPercentage,
  type QuotaStatus,
} from "@/modules/cloud-account/utils/quota-display";

interface CloudAccountListSummaryProps {
  totalAccounts: number;
  activeAccounts: number;
  rateLimitedAccounts: number;
  overallQuotaPercentage: number | null;
  effectiveQuotaStatus: QuotaStatus;
  isDiverged?: boolean;
  splitTargetsCount?: number;
  summaryRef?: React.Ref<HTMLDivElement>;
}

export function CloudAccountListSummary({
  totalAccounts,
  activeAccounts,
  rateLimitedAccounts,
  overallQuotaPercentage,
  effectiveQuotaStatus,
  isDiverged = false,
  splitTargetsCount = 0,
  summaryRef,
}: CloudAccountListSummaryProps) {
  const { t } = useTranslation();

  return (
    <div
      id="cloud-account-summary-card"
      ref={summaryRef}
      tabIndex={-1}
      aria-live="polite"
      className="bg-card border-border/80 rounded-xl border p-6 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-foreground text-2xl font-bold tracking-tight">
              {t("cloud.title")}
            </h2>
            {isDiverged ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300"
                role="status"
                aria-label={`${t("cloud.summary.statusDiverged", { count: splitTargetsCount })}, ${t("cloud.summary.statusDivergedSubtitle")}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                </span>
                {t("cloud.summary.statusDiverged", {
                  count: splitTargetsCount,
                })}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300"
                role="status"
                aria-label={`${t("cloud.summary.statusUnified")}, ${t("cloud.summary.statusUnifiedSubtitle")}`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {t("cloud.summary.statusUnified")}
              </span>
            )}
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm">
            {t("cloud.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t("cloud.card.actions")}
            </div>
            <div className="mt-0.5 text-lg font-bold">{totalAccounts}</div>
          </div>
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t("cloud.card.active")}
            </div>
            <div
              className={`mt-0.5 text-lg font-bold ${
                isDiverged
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {activeAccounts}
            </div>
          </div>
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t("cloud.card.rateLimited")}
            </div>
            <div className="mt-0.5 text-lg font-bold text-rose-600 dark:text-rose-400">
              {rateLimitedAccounts}
            </div>
          </div>
          {overallQuotaPercentage !== null && (
            <div className="bg-muted/30 border-border/40 min-w-[150px] rounded-xl border px-4 py-2.5">
              <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                {t("cloud.globalQuota")}
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span
                  className={`text-base font-bold ${GLOBAL_QUOTA_TEXT_COLOR_CLASS_BY_STATUS[effectiveQuotaStatus]}`}
                >
                  {overallQuotaPercentage}%
                </span>
                <div className="bg-muted/60 border-border/20 h-2 w-20 overflow-hidden rounded-full border shadow-inner">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${GLOBAL_QUOTA_BAR_COLOR_CLASS_BY_STATUS[effectiveQuotaStatus]}`}
                    style={{
                      width: `${clampQuotaPercentage(overallQuotaPercentage)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
