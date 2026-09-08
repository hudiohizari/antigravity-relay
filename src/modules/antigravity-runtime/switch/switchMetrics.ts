import { logger } from '@/shared/logging/logger';

type SwitchScope = 'local' | 'cloud';

export type SwitchFailureReason =
  | 'unknown'
  | 'process_close_failed'
  | 'missing_bound_profile'
  | 'apply_device_profile_failed'
  | 'perform_switch_failed'
  | 'start_process_failed';

interface SwitchFailureMetadata {
  reason: SwitchFailureReason;
  message: string;
  occurredAt: number;
}

interface SwitchMetricBucket {
  switchSuccess: number;
  switchFailure: number;
  rollbackAttempt: number;
  rollbackSuccess: number;
  rollbackFailure: number;
  failureReasons: Record<SwitchFailureReason, number>;
  lastFailure: SwitchFailureMetadata | null;
}

type SwitchMetricMap = Record<SwitchScope, SwitchMetricBucket>;

const metrics: SwitchMetricMap = {
  local: {
    switchSuccess: 0,
    switchFailure: 0,
    rollbackAttempt: 0,
    rollbackSuccess: 0,
    rollbackFailure: 0,
    failureReasons: {
      unknown: 0,
      process_close_failed: 0,
      missing_bound_profile: 0,
      apply_device_profile_failed: 0,
      perform_switch_failed: 0,
      start_process_failed: 0,
    },
    lastFailure: null,
  },
  cloud: {
    switchSuccess: 0,
    switchFailure: 0,
    rollbackAttempt: 0,
    rollbackSuccess: 0,
    rollbackFailure: 0,
    failureReasons: {
      unknown: 0,
      process_close_failed: 0,
      missing_bound_profile: 0,
      apply_device_profile_failed: 0,
      perform_switch_failed: 0,
      start_process_failed: 0,
    },
    lastFailure: null,
  },
};

function logSnapshot(scope: SwitchScope, reason: string): void {
  logger.info(`[switch-metrics] ${scope} ${reason}`, metrics[scope]);
}

export function recordSwitchSuccess(scope: SwitchScope): void {
  metrics[scope].switchSuccess += 1;
  logSnapshot(scope, 'switch_success');
}

export function recordSwitchFailure(
  scope: SwitchScope,
  reason: SwitchFailureReason = 'unknown',
  message: string = '',
): void {
  metrics[scope].switchFailure += 1;
  metrics[scope].failureReasons[reason] += 1;
  metrics[scope].lastFailure = {
    reason,
    message,
    occurredAt: Date.now(),
  };
  logSnapshot(scope, 'switch_failure');
}

export function recordSwitchRollback(scope: SwitchScope, success: boolean): void {
  metrics[scope].rollbackAttempt += 1;
  if (success) {
    metrics[scope].rollbackSuccess += 1;
  } else {
    metrics[scope].rollbackFailure += 1;
  }
  logSnapshot(scope, success ? 'rollback_success' : 'rollback_failure');
}

export function getSwitchMetricsSnapshot(): SwitchMetricMap {
  return {
    local: {
      ...metrics.local,
      failureReasons: { ...metrics.local.failureReasons },
      lastFailure: metrics.local.lastFailure ? { ...metrics.local.lastFailure } : null,
    },
    cloud: {
      ...metrics.cloud,
      failureReasons: { ...metrics.cloud.failureReasons },
      lastFailure: metrics.cloud.lastFailure ? { ...metrics.cloud.lastFailure } : null,
    },
  };
}
