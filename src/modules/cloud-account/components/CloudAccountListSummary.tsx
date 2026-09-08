import { useTranslation } from 'react-i18next';
import {
  GLOBAL_QUOTA_BAR_COLOR_CLASS_BY_STATUS,
  GLOBAL_QUOTA_TEXT_COLOR_CLASS_BY_STATUS,
} from '@/modules/cloud-account/components/CloudAccountList.constants';
import {
  clampQuotaPercentage,
  type QuotaStatus,
} from '@/modules/cloud-account/utils/quota-display';

interface CloudAccountListSummaryProps {
  totalAccounts: number;
  activeAccounts: number;
  rateLimitedAccounts: number;
  overallQuotaPercentage: number | null;
  effectiveQuotaStatus: QuotaStatus;
}

export function CloudAccountListSummary({
  totalAccounts,
  activeAccounts,
  rateLimitedAccounts,
  overallQuotaPercentage,
  effectiveQuotaStatus,
}: CloudAccountListSummaryProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-card border-border/80 rounded-xl border p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex shrink-0 flex-col gap-1.5">
          <h2 className="text-foreground text-2xl font-bold tracking-tight">{t('cloud.title')}</h2>
          <p className="text-muted-foreground max-w-2xl text-sm">{t('cloud.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t('cloud.card.actions')}
            </div>
            <div className="mt-0.5 text-lg font-bold">{totalAccounts}</div>
          </div>
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t('cloud.card.active')}
            </div>
            <div className="mt-0.5 text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {activeAccounts}
            </div>
          </div>
          <div className="bg-muted/30 border-border/40 min-w-[80px] rounded-xl border px-4 py-2.5">
            <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              {t('cloud.card.rateLimited')}
            </div>
            <div className="mt-0.5 text-lg font-bold text-rose-600 dark:text-rose-400">
              {rateLimitedAccounts}
            </div>
          </div>
          {overallQuotaPercentage !== null && (
            <div className="bg-muted/30 border-border/40 min-w-[150px] rounded-xl border px-4 py-2.5">
              <div className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                {t('cloud.globalQuota')}
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
                    style={{ width: `${clampQuotaPercentage(overallQuotaPercentage)}%` }}
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
