import { useState, useEffect, useCallback } from "react";
import { TunnelStatus, TunnelConfig } from "../../shared/types";

const getAPI = () =>
  typeof window !== "undefined" ? window.electronAPI : undefined;

export interface UseTunnelStatusResult {
  status: TunnelStatus | null;
  publicUrl: string | null;
  isLoading: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isRestarting: boolean;
  error: string | null;
  fetchStatus: () => Promise<void>;
  fetchUrl: () => Promise<string | null>;
  startTunnel: (config?: Partial<TunnelConfig>) => Promise<boolean>;
  stopTunnel: () => Promise<boolean>;
  restartTunnel: (config?: Partial<TunnelConfig>) => Promise<boolean>;
  clearError: () => void;
}

export const useTunnelStatus = (): UseTunnelStatusResult => {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useCallback(async (): Promise<string | null> => {
    const api = getAPI();
    if (!api?.getTunnelUrl) {
      return null;
    }
    try {
      const res = await api.getTunnelUrl();
      if (res.publicUrl) {
        setPublicUrl(res.publicUrl);
        return res.publicUrl;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const api = getAPI();
    if (!api?.getTunnelStatus) {
      setIsLoading(false);
      return;
    }
    try {
      const current = await api.getTunnelStatus();
      setStatus(current);
      setPublicUrl(current.publicUrl);
      setError(null);
      if (current.state === "connected" && !current.publicUrl) {
        await fetchUrl();
      }
    } catch (err) {
      setError((err as Error).message || "Failed to query tunnel status");
    } finally {
      setIsLoading(false);
    }
  }, [fetchUrl]);

  useEffect(() => {
    fetchStatus();

    const api = getAPI();
    if (api?.onTunnelStatusUpdated) {
      const unsubscribe = api.onTunnelStatusUpdated((updatedStatus) => {
        setStatus(updatedStatus);
        setPublicUrl(updatedStatus.publicUrl);
        if (updatedStatus.state === "connected") {
          setIsStarting(false);
          setIsRestarting(false);
        } else if (updatedStatus.state === "stopped") {
          setIsStopping(false);
        } else if (updatedStatus.state === "error") {
          setIsStarting(false);
          setIsStopping(false);
          setIsRestarting(false);
          if (updatedStatus.lastError) {
            setError(updatedStatus.lastError);
          }
        }
      });
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [fetchStatus]);

  const startTunnel = useCallback(
    async (config?: Partial<TunnelConfig>): Promise<boolean> => {
      const api = getAPI();
      if (!api?.startTunnel) {
        setError("Tunnel API unavailable");
        return false;
      }
      setIsStarting(true);
      setError(null);
      try {
        const res = await api.startTunnel(config);
        if (res.success && res.data) {
          setStatus(res.data);
          setPublicUrl(res.data.publicUrl);
          setIsStarting(false);
          return true;
        } else {
          setError(res.error || "Failed to start Cloudflare tunnel");
          setIsStarting(false);
          return false;
        }
      } catch (err) {
        const msg =
          (err as Error).message || "Failed to start Cloudflare tunnel";
        setError(msg);
        setIsStarting(false);
        return false;
      }
    },
    [],
  );

  const stopTunnel = useCallback(async (): Promise<boolean> => {
    const api = getAPI();
    if (!api?.stopTunnel) {
      setError("Tunnel API unavailable");
      return false;
    }
    setIsStopping(true);
    setError(null);
    try {
      const res = await api.stopTunnel();
      if (res.success) {
        setIsStopping(false);
        setStatus((prev) =>
          prev
            ? { ...prev, state: "stopped", publicUrl: null, pid: null }
            : null,
        );
        setPublicUrl(null);
        return true;
      } else {
        setError(res.error || "Failed to stop Cloudflare tunnel");
        setIsStopping(false);
        return false;
      }
    } catch (err) {
      const msg = (err as Error).message || "Failed to stop Cloudflare tunnel";
      setError(msg);
      setIsStopping(false);
      return false;
    }
  }, []);

  const restartTunnel = useCallback(
    async (config?: Partial<TunnelConfig>): Promise<boolean> => {
      setIsRestarting(true);
      setError(null);
      try {
        await stopTunnel();
        const started = await startTunnel(config);
        setIsRestarting(false);
        return started;
      } catch (err) {
        const msg =
          (err as Error).message || "Failed to restart Cloudflare tunnel";
        setError(msg);
        setIsRestarting(false);
        return false;
      }
    },
    [stopTunnel, startTunnel],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    publicUrl,
    isLoading,
    isStarting,
    isStopping,
    isRestarting,
    error,
    fetchStatus,
    fetchUrl,
    startTunnel,
    stopTunnel,
    restartTunnel,
    clearError,
  };
};
