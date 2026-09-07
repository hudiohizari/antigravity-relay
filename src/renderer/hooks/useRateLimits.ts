import { useState, useEffect, useCallback } from "react";
import { RateLimitState } from "../../shared/types";

export interface UseRateLimitsResult {
  rateLimits: Record<string, RateLimitState>;
  isLoading: boolean;
  error: string | null;
  fetchRateLimits: () => Promise<void>;
  clearRateLimit: (accountId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useRateLimits = (): UseRateLimitsResult => {
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitState>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRateLimits = useCallback(async () => {
    if (!window.electronAPI?.getRateLimitStates) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await window.electronAPI.getRateLimitStates();
      if (response.success && response.data) {
        setRateLimits(response.data);
      } else if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to fetch rate-limit states");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRateLimits();
  }, [fetchRateLimits]);

  const clearRateLimit = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (!window.electronAPI?.clearRateLimit) {
        return false;
      }

      setError(null);
      try {
        const response = await window.electronAPI.clearRateLimit(accountId);
        if (response.success) {
          await fetchRateLimits();
          return true;
        }
        setError(response.error || "Failed to clear rate limit");
        return false;
      } catch (err) {
        const message =
          (err as Error).message || "Failed to clear rate limit";
        setError(message);
        return false;
      }
    },
    [fetchRateLimits],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    rateLimits,
    isLoading,
    error,
    fetchRateLimits,
    clearRateLimit,
    clearError,
  };
};
