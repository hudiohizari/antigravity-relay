import { useState, useEffect, useCallback } from "react";
import { GoogleAccount, OAuthResult } from "../../shared/types";

export interface UseAccountsResult {
  accounts: GoogleAccount[];
  activeAccount: GoogleAccount | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  refreshingAccountId: string | null;
  deletingAccountId: string | null;
  error: string | null;
  fetchAccounts: () => Promise<void>;
  addAccount: () => Promise<OAuthResult>;
  removeAccount: (id: string) => Promise<boolean>;
  refreshAccountToken: (id: string) => Promise<boolean>;
  selectActiveAccount: (id: string) => Promise<boolean>;
  clearError: () => void;
}

export const useAccounts = (): UseAccountsResult => {
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [refreshingAccountId, setRefreshingAccountId] = useState<string | null>(
    null,
  );
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    if (!window.electronAPI?.getAccounts) {
      setIsLoading(false);
      return;
    }
    try {
      const list = await window.electronAPI.getAccounts();
      setAccounts(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to load accounts");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const addAccount = useCallback(async (): Promise<OAuthResult> => {
    if (!window.electronAPI?.initiateOAuth) {
      return { success: false, error: "Electron API unavailable" };
    }
    setIsAuthenticating(true);
    setError(null);
    try {
      const result = await window.electronAPI.initiateOAuth();
      if (result.success) {
        await fetchAccounts();
      } else if (result.error) {
        setError(result.error);
      }
      return result;
    } catch (err) {
      const message = (err as Error).message || "OAuth authentication failed";
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsAuthenticating(false);
    }
  }, [fetchAccounts]);

  const removeAccount = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI?.deleteAccount) return false;
      setDeletingAccountId(id);
      setError(null);
      try {
        const result = await window.electronAPI.deleteAccount(id);
        if (result.success) {
          await fetchAccounts();
          return true;
        }
        setError(result.error || "Failed to remove account");
        return false;
      } catch (err) {
        setError((err as Error).message || "Failed to remove account");
        return false;
      } finally {
        setDeletingAccountId(null);
      }
    },
    [fetchAccounts],
  );

  const refreshAccountToken = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI?.refreshToken) return false;
      setRefreshingAccountId(id);
      setError(null);
      try {
        const result = await window.electronAPI.refreshToken(id);
        if (result.success) {
          await fetchAccounts();
          return true;
        }
        setError(result.error || "Failed to refresh token");
        return false;
      } catch (err) {
        setError((err as Error).message || "Failed to refresh token");
        return false;
      } finally {
        setRefreshingAccountId(null);
      }
    },
    [fetchAccounts],
  );

  const selectActiveAccount = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI?.setActiveAccount) return false;
      setError(null);
      try {
        const result = await window.electronAPI.setActiveAccount(id);
        if (result.success) {
          await fetchAccounts();
          return true;
        }
        setError(result.error || "Failed to set active account");
        return false;
      } catch (err) {
        setError((err as Error).message || "Failed to set active account");
        return false;
      }
    },
    [fetchAccounts],
  );

  const clearError = useCallback(() => setError(null), []);

  const activeAccount = accounts.find((acc) => acc.status === "active") || null;

  return {
    accounts,
    activeAccount,
    isLoading,
    isAuthenticating,
    refreshingAccountId,
    deletingAccountId,
    error,
    fetchAccounts,
    addAccount,
    removeAccount,
    refreshAccountToken,
    selectActiveAccount,
    clearError,
  };
};
