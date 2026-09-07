import { useState, useEffect, useCallback } from "react";
import {
  AutoSwitchConfig,
  SwitchResult,
} from "../../shared/types";

export interface PoolExhaustedPayload {
  type: "pool_exhausted";
  reason: string;
}

export interface UseSwitcherResult {
  config: AutoSwitchConfig | null;
  isLoadingConfig: boolean;
  isSavingConfig: boolean;
  isSwitching: boolean;
  switchingAccountId: string | null;
  lastSwitchResult: SwitchResult | null;
  poolExhaustedReason: string | null;
  error: string | null;
  fetchConfig: () => Promise<void>;
  updateConfig: (patch: Partial<AutoSwitchConfig>) => Promise<boolean>;
  manualSwitch: (accountId: string) => Promise<boolean>;
  clearError: () => void;
  clearPoolExhausted: () => void;
}

const DEFAULT_SWITCHER_CONFIG: AutoSwitchConfig = {
  enabled: true,
  minQuotaThresholdPercent: 15,
  pollIntervalMs: 300000,
  rateLimitCooldownMs: 900000,
  autoRelaunchProcesses: true,
  preferredModels: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "claude-3-5-sonnet-vertex",
  ],
};

export const useSwitcher = (
  onSwitchComplete?: (result: SwitchResult) => void,
): UseSwitcherResult => {
  const [config, setConfig] = useState<AutoSwitchConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(
    null,
  );
  const [lastSwitchResult, setLastSwitchResult] = useState<SwitchResult | null>(
    null,
  );
  const [poolExhaustedReason, setPoolExhaustedReason] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!window.electronAPI?.getAutoSwitchConfig) {
      setIsLoadingConfig(false);
      return;
    }

    try {
      const response = await window.electronAPI.getAutoSwitchConfig();
      if (response.success && response.data) {
        setConfig(response.data);
      } else if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to load auto-switch configuration");
    } finally {
      setIsLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (!window.electronAPI?.onSwitcherEvent) return;

    const unsubscribe = window.electronAPI.onSwitcherEvent((rawEvent: unknown) => {
      const event = rawEvent as SwitchResult | PoolExhaustedPayload;

      if ("type" in event && event.type === "pool_exhausted") {
        setPoolExhaustedReason(event.reason);
        setIsSwitching(false);
        setSwitchingAccountId(null);
      } else if ("newAccountId" in event) {
        setLastSwitchResult(event);
        setIsSwitching(false);
        setSwitchingAccountId(null);
        setPoolExhaustedReason(null);
        if (onSwitchComplete) {
          onSwitchComplete(event);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [onSwitchComplete]);

  const updateConfig = useCallback(
    async (patch: Partial<AutoSwitchConfig>): Promise<boolean> => {
      if (!window.electronAPI?.setAutoSwitchConfig) {
        return false;
      }

      setIsSavingConfig(true);
      setError(null);

      try {
        const response = await window.electronAPI.setAutoSwitchConfig(patch);
        if (response.success && response.data) {
          setConfig(response.data);
          return true;
        }
        setError(response.error || "Failed to update switcher configuration");
        return false;
      } catch (err) {
        const message =
          (err as Error).message || "Failed to update switcher configuration";
        setError(message);
        return false;
      } finally {
        setIsSavingConfig(false);
      }
    },
    [],
  );

  const manualSwitch = useCallback(
    async (accountId: string): Promise<boolean> => {
      if (!window.electronAPI?.manualSwitchAccount) {
        return false;
      }

      setIsSwitching(true);
      setSwitchingAccountId(accountId);
      setError(null);
      setPoolExhaustedReason(null);

      try {
        const response = await window.electronAPI.manualSwitchAccount(accountId);
        if (response.success && response.data) {
          setLastSwitchResult(response.data);
          if (onSwitchComplete) {
            onSwitchComplete(response.data);
          }
          return true;
        }
        setError(response.error || "Failed to switch accounts");
        return false;
      } catch (err) {
        const message = (err as Error).message || "Failed to switch accounts";
        setError(message);
        return false;
      } finally {
        setIsSwitching(false);
        setSwitchingAccountId(null);
      }
    },
    [onSwitchComplete],
  );

  const clearError = useCallback(() => setError(null), []);
  const clearPoolExhausted = useCallback(() => setPoolExhaustedReason(null), []);

  return {
    config: config || DEFAULT_SWITCHER_CONFIG,
    isLoadingConfig,
    isSavingConfig,
    isSwitching,
    switchingAccountId,
    lastSwitchResult,
    poolExhaustedReason,
    error,
    fetchConfig,
    updateConfig,
    manualSwitch,
    clearError,
    clearPoolExhausted,
  };
};
