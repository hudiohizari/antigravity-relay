import { useMemo } from 'react';
import { filter, flatMap, isEmpty, size, sumBy } from 'lodash-es';
import type { CloudAccount } from '@/modules/cloud-account/types';
import type { AppConfig } from '@/modules/config/types';
import {
  buildAccountTierOptions,
  filterAndSortCloudAccounts,
  getEffectiveSelectedTierKeys,
  type AccountTierOption,
} from '@/modules/cloud-account/utils/account-tier-filter';
import {
  getQuotaStatus,
  roundQuotaPercentage,
  type AccountSortKey,
  type QuotaStatus,
} from '@/modules/cloud-account/utils/quota-display';

export interface CloudAccountListView {
  sortedAccounts: CloudAccount[];
  tierOptions: AccountTierOption[];
  effectiveSelectedTierKeys: string[];
  effectiveSelectedTierKeySet: Set<string>;
  hasActiveTierFilter: boolean;
  visibleAccountIds: string[];
  totalAccounts: number;
  activeAccounts: number;
  rateLimitedAccounts: number;
  overallQuotaPercentage: number | null;
  effectiveQuotaStatus: QuotaStatus;
}

function calculateOverallQuotaPercentage(
  accounts: CloudAccount[],
  modelVisibility: Record<string, boolean>,
): number | null {
  if (accounts.length === 0) {
    return null;
  }

  const visibleModelInfos = flatMap(accounts, (account) => {
    if (!account.quota?.models) {
      return [];
    }

    return Object.entries(account.quota.models)
      .filter(([modelName]) => modelVisibility[modelName] !== false)
      .map(([, info]) => info);
  });

  if (isEmpty(visibleModelInfos)) {
    return null;
  }

  const averagePercentage =
    sumBy(visibleModelInfos, (modelInfo) => modelInfo.percentage) / visibleModelInfos.length;

  return roundQuotaPercentage(averagePercentage);
}

export function useCloudAccountListView(
  accounts: CloudAccount[] | undefined,
  config: AppConfig | undefined,
  currentSort: AccountSortKey,
): CloudAccountListView {
  const sourceAccounts = accounts ?? [];
  const selectedTierKeys = config?.account_tier_filter ?? [];
  const modelVisibility = config?.model_visibility ?? {};

  const tierOptions = useMemo(() => buildAccountTierOptions(sourceAccounts), [sourceAccounts]);
  const effectiveSelectedTierKeys = useMemo(
    () => getEffectiveSelectedTierKeys(selectedTierKeys, tierOptions),
    [selectedTierKeys, tierOptions],
  );
  const effectiveSelectedTierKeySet = useMemo(
    () => new Set(effectiveSelectedTierKeys),
    [effectiveSelectedTierKeys],
  );

  const sortedAccounts = useMemo(() => {
    return filterAndSortCloudAccounts(sourceAccounts, {
      selectedTierKeys: effectiveSelectedTierKeys,
      sortKey: currentSort,
      modelVisibility,
      tierOptions,
    });
  }, [currentSort, effectiveSelectedTierKeys, modelVisibility, sourceAccounts, tierOptions]);

  const visibleAccountIds = useMemo(
    () => sortedAccounts.map((account) => account.id),
    [sortedAccounts],
  );

  const overallQuotaPercentage = useMemo(
    () => calculateOverallQuotaPercentage(sortedAccounts, modelVisibility),
    [modelVisibility, sortedAccounts],
  );

  const overallQuotaStatus =
    overallQuotaPercentage === null ? null : getQuotaStatus(overallQuotaPercentage);

  return {
    sortedAccounts,
    tierOptions,
    effectiveSelectedTierKeys,
    effectiveSelectedTierKeySet,
    hasActiveTierFilter: effectiveSelectedTierKeys.length > 0,
    visibleAccountIds,
    totalAccounts: size(sortedAccounts),
    activeAccounts: filter(sortedAccounts, (account) => account.is_active).length,
    rateLimitedAccounts: filter(sortedAccounts, (account) => account.status === 'rate_limited')
      .length,
    overallQuotaPercentage,
    effectiveQuotaStatus: overallQuotaStatus ?? 'low',
  };
}
