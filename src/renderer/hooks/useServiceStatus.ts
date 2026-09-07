import { useState, useEffect, useCallback } from "react";
import {
  DualServiceStatus,
  ServiceTarget,
  ServiceActionResult,
} from "../../shared/types";

export interface TransitionalStates {
  antigravity_daemon: "starting" | "stopping" | null;
  antigravity_ide: "starting" | "stopping" | null;
}

export interface UseServiceStatusResult {
  status: DualServiceStatus | null;
  isLoading: boolean;
  transitionalStates: TransitionalStates;
  error: string | null;
  fetchStatus: () => Promise<void>;
  startService: (target: ServiceTarget) => Promise<ServiceActionResult>;
  stopService: (target: ServiceTarget) => Promise<ServiceActionResult>;
  toggleService: (target: ServiceTarget) => Promise<void>;
  clearError: () => void;
}

export const useServiceStatus = (): UseServiceStatusResult => {
  const [status, setStatus] = useState<DualServiceStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [transitionalStates, setTransitionalStates] =
    useState<TransitionalStates>({
      antigravity_daemon: null,
      antigravity_ide: null,
    });
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!window.electronAPI?.getServiceStatus) {
      setIsLoading(false);
      return;
    }
    try {
      const current = await window.electronAPI.getServiceStatus();
      setStatus(current);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to query service status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    if (window.electronAPI?.onServiceStatusUpdated) {
      const unsubscribe = window.electronAPI.onServiceStatusUpdated(
        (updatedStatus) => {
          setStatus(updatedStatus);
          // Clear transitional states when target process transitions to terminal state
          setTransitionalStates((prev) => {
            const next = { ...prev };
            if (
              updatedStatus.services.antigravity_daemon.state === "running" ||
              updatedStatus.services.antigravity_daemon.state === "stopped" ||
              updatedStatus.services.antigravity_daemon.state === "error"
            ) {
              next.antigravity_daemon = null;
            }
            if (
              updatedStatus.services.antigravity_ide.state === "running" ||
              updatedStatus.services.antigravity_ide.state === "stopped" ||
              updatedStatus.services.antigravity_ide.state === "error"
            ) {
              next.antigravity_ide = null;
            }
            return next;
          });
        },
      );
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [fetchStatus]);

  const startService = useCallback(
    async (target: ServiceTarget): Promise<ServiceActionResult> => {
      if (!window.electronAPI?.startService) {
        return { success: false, error: "Electron API unavailable" };
      }
      setTransitionalStates((prev) => ({ ...prev, [target]: "starting" }));
      setError(null);
      try {
        const res = await window.electronAPI.startService(target);
        if (!res.success && res.error) {
          setError(res.error);
          setTransitionalStates((prev) => ({ ...prev, [target]: null }));
        }
        return res;
      } catch (err) {
        const msg = (err as Error).message || "Failed to start service";
        setError(msg);
        setTransitionalStates((prev) => ({ ...prev, [target]: null }));
        return { success: false, error: msg };
      }
    },
    [],
  );

  const stopService = useCallback(
    async (target: ServiceTarget): Promise<ServiceActionResult> => {
      if (!window.electronAPI?.stopService) {
        return { success: false, error: "Electron API unavailable" };
      }
      setTransitionalStates((prev) => ({ ...prev, [target]: "stopping" }));
      setError(null);
      try {
        const res = await window.electronAPI.stopService(target);
        if (!res.success && res.error) {
          setError(res.error);
          setTransitionalStates((prev) => ({ ...prev, [target]: null }));
        }
        return res;
      } catch (err) {
        const msg = (err as Error).message || "Failed to stop service";
        setError(msg);
        setTransitionalStates((prev) => ({ ...prev, [target]: null }));
        return { success: false, error: msg };
      }
    },
    [],
  );

  const toggleService = useCallback(
    async (target: ServiceTarget): Promise<void> => {
      const current = status?.services[target];
      if (current?.state === "running") {
        await stopService(target);
      } else {
        await startService(target);
      }
    },
    [status, startService, stopService],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    isLoading,
    transitionalStates,
    error,
    fetchStatus,
    startService,
    stopService,
    toggleService,
    clearError,
  };
};
