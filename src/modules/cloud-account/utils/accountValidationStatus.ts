import type { TFunction } from 'i18next';
import type { CloudAccount } from '@/modules/cloud-account/types';
import {
  isOAuthReauthReason,
  isRateLimitReason,
} from '@/modules/cloud-account/utils/account-status';

export type CloudAccountHealthBlockKind = 'oauth_reauth' | 'validation' | null;

/**
 * A durable OAuth refresh block prevents automatic account use, whereas validation is a
 * temporary probe gate. Show the durable recovery requirement first when both are present.
 */
export function getCloudAccountHealthBlockKind(
  health: CloudAccount['health'],
): CloudAccountHealthBlockKind {
  if (health?.oauth?.refresh_blocked) {
    return 'oauth_reauth';
  }
  if (health?.validation) {
    return 'validation';
  }
  return null;
}

export function getValidationBlockedStatusLabel(
  status: 'active' | 'rate_limited' | 'expired' | undefined,
  reason: string | undefined,
  t: TFunction,
): string | null {
  const normalizedReason = (reason || '').toLowerCase();
  const hasReason = normalizedReason !== '';
  const isBlockedByStatus = status === 'rate_limited' || status === 'expired';

  if (!isBlockedByStatus && !hasReason) {
    return null;
  }

  if (status === 'rate_limited' || isRateLimitReason(normalizedReason)) {
    return t('cloud.card.validationRiskControlled');
  }

  if (status === 'expired' || isOAuthReauthReason(normalizedReason)) {
    return t('cloud.card.validationOAuthReauthRequired');
  }

  return t('cloud.card.validationRequired');
}

export function getCloudAccountBlockedStatusLabel(
  account: Pick<CloudAccount, 'health' | 'status' | 'status_reason'>,
  t: TFunction,
): string | null {
  const healthBlockKind = getCloudAccountHealthBlockKind(account.health);
  if (healthBlockKind === 'oauth_reauth') {
    return t('cloud.card.validationOAuthReauthRequired');
  }
  if (healthBlockKind === 'validation') {
    return t('cloud.card.validationRequired');
  }
  return getValidationBlockedStatusLabel(account.status, account.status_reason, t);
}
