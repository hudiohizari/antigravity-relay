/** Jitter factor: ±20% */
const JITTER_FACTOR = 0.2;

/** Maximum retry delay in milliseconds (30 seconds) */
const MAX_DELAY_MS = 30000;

/**
 * Apply jitter to a delay value to prevent thundering herd
 * Returns delay ± JITTER_FACTOR (e.g., 1000ms ± 20% = 800-1200ms)
 *
 * @param delayMs - Base delay in milliseconds
 * @returns Jittered delay (minimum 1ms)
 */
export function applyJitter(delayMs: number): number {
  if (delayMs <= 0) {
    return 1;
  }

  const jitterRange = delayMs * JITTER_FACTOR;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(1, Math.round(delayMs + jitter));
}

/**
 * Calculate retry delay with exponential backoff and jitter
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseMs - Base delay for first retry (default 1000ms)
 * @returns Delay in milliseconds with jitter applied
 */
export function calculateRetryDelay(attempt: number, baseMs: number = 1000): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, ...
  const exponentialDelay = baseMs * Math.pow(2, attempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, MAX_DELAY_MS);

  // Apply jitter
  return applyJitter(cappedDelay);
}

/**
 * Sleep for specified milliseconds
 *
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
