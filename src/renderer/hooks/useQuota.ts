import { useState, useEffect, useCallback } from "react";
import { QuotaPollResult } from "../../shared/types";

export interface UseQuotaResult {
  pollAll: () => Promise<QuotaPollResult[]>;
  pollAccount: (accountId: string) => Promise<QuotaPollResult | null>;
  isPollingAll: boolean;
  pollingAccountIds: Record<string, boolean>;
  error: string | null;
  clearError: () => void;
}

export const useQuota = (
  onQuotaUpdatedCallback?: (data: unknown) => void,
): UseQuotaResult => {
  const [isPollingAll, setIsPollingAll] = useState(false);
  const [pollingAccountIds, setPollingAccountIds] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onQuotaUpdated) return;

    const unsubscribe = window.electronAPI.onQuotaUpdated((data) => {
      if (onQuotaUpdatedCallback) {
        onQuotaUpdatedCallback(data);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [onQuotaUpdatedCallback]);

  const pollAll = useCallback(async (): Promise<QuotaPollResult[]> => {
    if (!window.electronAPI?.pollAllQuotas) {
      return [];
    }

    setIsPollingAll(true);
    setError(null);

    try {
      const response = await window.electronAPI.pollAllQuotas();
      if (response.success && response.data) {
        return response.data;
      }
      if (response.error) {
        setError(response.error);
      }
      return [];
    } catch (err) {
      const message =
        (err as Error).message || "Failed to poll quota for all accounts";
      setError(message);
      return [];
    } finally {
      setIsPollingAll(false);
    }
  }, []);

  const pollAccount = useCallback(
    async (accountId: string): Promise<QuotaPollResult | null> => {
      if (!window.electronAPI?.pollAccountQuota) {
        return null;
      }

      setPollingAccountIds((prev) => ({ ...prev, [accountId]: true }));
      setError(null);

      try {
        const response = await window.electronAPI.pollAccountQuota(accountId);
        if (response.success && response.data) {
          return response.data;
        }
        if (response.error) {
          setError(response.error);
        }
        return null;
      } catch (err) {
        const message =
          (err as Error).message ||
          `Failed to poll quota for account ${accountId}`;
        setError(message);
        return null;
      } finally {
        setPollingAccountIds((prev) => ({ ...prev, [accountId]: false }));
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    pollAll,
    pollAccount,
    isPollingAll,
    pollingAccountIds,
    error,
    clearError,
  };
};
