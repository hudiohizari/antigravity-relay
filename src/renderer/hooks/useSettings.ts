import { useState, useEffect, useCallback } from "react";
import { AppSettings } from "../../shared/types";

export interface UseSettingsResult {
  settings: AppSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  isResetting: boolean;
  error: string | null;
  saveSuccess: boolean;
  fetchSettings: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<boolean>;
  resetSettings: () => Promise<boolean>;
  clearFeedback: () => void;
}

export const useSettings = (
  initialSettings?: AppSettings | null,
): UseSettingsResult => {
  const [settings, setSettings] = useState<AppSettings | null>(
    initialSettings || null,
  );
  const [isLoading, setIsLoading] = useState(() => {
    if (initialSettings) return false;
    return (
      typeof window !== "undefined" && Boolean(window.electronAPI?.getSettings)
    );
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchSettings = useCallback(async () => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api?.getSettings) {
      setIsLoading(false);
      return;
    }
    try {
      const result = await api.getSettings();
      if (result.success && result.data) {
        setSettings(result.data);
        setError(null);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api?.onSettingsUpdated) return;
    const unsubscribe = api.onSettingsUpdated((updated) => {
      setSettings(updated);
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const updateSettings = useCallback(
    async (partial: Partial<AppSettings>): Promise<boolean> => {
      const api =
        typeof window !== "undefined" ? window.electronAPI : undefined;
      if (!api?.updateSettings) {
        setError("Electron API unavailable");
        return false;
      }
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);
      try {
        const result = await api.updateSettings(partial);
        if (result.success && result.data) {
          setSettings(result.data);
          setSaveSuccess(true);
          return true;
        }
        setError(result.error || "Failed to update settings");
        return false;
      } catch (err) {
        setError((err as Error).message || "Failed to update settings");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const resetSettings = useCallback(async (): Promise<boolean> => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (!api?.resetSettings) {
      setError("Electron API unavailable");
      return false;
    }
    setIsResetting(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const result = await api.resetSettings();
      if (result.success && result.data) {
        setSettings(result.data);
        setSaveSuccess(true);
        return true;
      }
      setError(result.error || "Failed to reset settings");
      return false;
    } catch (err) {
      setError((err as Error).message || "Failed to reset settings");
      return false;
    } finally {
      setIsResetting(false);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setError(null);
    setSaveSuccess(false);
  }, []);

  return {
    settings,
    isLoading,
    isSaving,
    isResetting,
    error,
    saveSuccess,
    fetchSettings,
    updateSettings,
    resetSettings,
    clearFeedback,
  };
};
