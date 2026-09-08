import type { AccountSortKey, QuotaStatus } from '@/modules/cloud-account/utils/quota-display';

export type GridLayout = 'auto' | '2-col' | '3-col' | 'list' | 'compact';

export const GRID_LAYOUT_CLASSES: Record<GridLayout, string> = {
  auto: 'grid gap-4 md:grid-cols-2 xl:grid-cols-3',
  '2-col': 'grid gap-4 grid-cols-2',
  '3-col': 'grid gap-4 grid-cols-3',
  list: 'grid gap-4 grid-cols-1',
  compact: 'flex flex-col gap-2',
};

export const GLOBAL_QUOTA_BAR_COLOR_CLASS_BY_STATUS: Record<QuotaStatus, string> = {
  high: 'bg-gradient-to-r from-emerald-400 to-teal-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]',
  medium: 'bg-gradient-to-r from-amber-400 to-orange-500 shadow-[0_0_8px_rgba(245,158,11,0.25)]',
  low: 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_rgba(239,68,68,0.3)]',
};

export const GLOBAL_QUOTA_TEXT_COLOR_CLASS_BY_STATUS: Record<QuotaStatus, string> = {
  high: 'text-emerald-600 dark:text-emerald-400 font-semibold',
  medium: 'text-amber-600 dark:text-amber-500 font-semibold',
  low: 'text-rose-600 dark:text-rose-400 font-semibold',
};

export const CLOUD_ACCOUNT_SORT_OPTIONS = [
  'recently-used',
  'quota-overall',
  'quota-claude',
  'quota-pro3',
  'quota-flash',
] as const;

export const CLOUD_ACCOUNT_SORT_I18N_KEYS: Record<AccountSortKey, string> = {
  'recently-used': 'cloud.sort.recentlyUsed',
  'quota-overall': 'cloud.sort.quotaOverall',
  'quota-claude': 'cloud.sort.quotaClaude',
  'quota-pro3': 'cloud.sort.quotaPro3',
  'quota-flash': 'cloud.sort.quotaFlash',
};
