import { useState, useEffect, useCallback, useRef } from "react";
import { RelayServerStatus, Session } from "../../shared/types";

const getAPI = () =>
  typeof window !== "undefined" ? window.electronAPI : undefined;

export interface UseRelayStatusResult {
  status: RelayServerStatus | null;
  sessions: Session[];
  isLoading: boolean;
  isStarting: boolean;
  isStopping: boolean;
  revokingSessionId: string | null;
  error: string | null;
  fetchStatus: () => Promise<void>;
  fetchSessions: () => Promise<void>;
  startRelay: (config?: { port?: number; host?: string }) => Promise<boolean>;
  stopRelay: () => Promise<boolean>;
  revokeSession: (sessionId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useRelayStatus = (): UseRelayStatusResult => {
  const [status, setStatus] = useState<RelayServerStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSessions = useCallback(async () => {
    const api = getAPI();
    if (!api?.getRelaySessions) {
      return;
    }
    try {
      const activeSessions = await api.getRelaySessions();
      setSessions(activeSessions);
    } catch (err) {
      setError((err as Error).message || "Failed to fetch relay sessions");
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const api = getAPI();
    if (!api?.getRelayStatus) {
      setIsLoading(false);
      return;
    }
    try {
      const current = await api.getRelayStatus();
      setStatus(current);
      setError(null);
      if (current.isRunning) {
        await fetchSessions();
      } else {
        setSessions([]);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to query relay status");
    } finally {
      setIsLoading(false);
    }
  }, [fetchSessions]);

  useEffect(() => {
    fetchStatus();

    const api = getAPI();
    if (api?.onRelayStatusUpdated) {
      const unsubscribe = api.onRelayStatusUpdated((updatedStatus) => {
        setStatus(updatedStatus);
        if (updatedStatus.isRunning) {
          setIsStarting(false);
          fetchSessions();
        } else {
          setIsStopping(false);
          setSessions([]);
        }
      });
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [fetchStatus, fetchSessions]);

  // Periodic session poll when relay is running
  useEffect(() => {
    if (status?.isRunning) {
      pollIntervalRef.current = setInterval(() => {
        fetchSessions();
      }, 3000);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [status?.isRunning, fetchSessions]);

  const startRelay = useCallback(
    async (config?: { port?: number; host?: string }): Promise<boolean> => {
      const api = getAPI();
      if (!api?.startRelay) {
        setError("Relay API unavailable");
        return false;
      }
      setIsStarting(true);
      setError(null);
      try {
        const res = await api.startRelay(config);
        if (res.success && res.data) {
          setStatus(res.data);
          setIsStarting(false);
          await fetchSessions();
          return true;
        } else {
          setError(res.error || "Failed to start relay server");
          setIsStarting(false);
          return false;
        }
      } catch (err) {
        const msg = (err as Error).message || "Failed to start relay server";
        setError(msg);
        setIsStarting(false);
        return false;
      }
    },
    [fetchSessions],
  );

  const stopRelay = useCallback(async (): Promise<boolean> => {
    const api = getAPI();
    if (!api?.stopRelay) {
      setError("Relay API unavailable");
      return false;
    }
    setIsStopping(true);
    setError(null);
    try {
      const res = await api.stopRelay();
      if (res.success) {
        setIsStopping(false);
        setStatus((prev) =>
          prev ? { ...prev, isRunning: false, activeSessions: 0 } : null,
        );
        setSessions([]);
        return true;
      } else {
        setError(res.error || "Failed to stop relay server");
        setIsStopping(false);
        return false;
      }
    } catch (err) {
      const msg = (err as Error).message || "Failed to stop relay server";
      setError(msg);
      setIsStopping(false);
      return false;
    }
  }, []);

  const revokeSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const api = getAPI();
      if (!api?.revokeRelaySession) {
        setError("Relay API unavailable");
        return false;
      }
      setRevokingSessionId(sessionId);
      setError(null);
      try {
        const res = await api.revokeRelaySession(sessionId);
        if (res.success) {
          setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
          setRevokingSessionId(null);
          return true;
        } else {
          setError(res.error || "Failed to revoke session");
          setRevokingSessionId(null);
          return false;
        }
      } catch (err) {
        const msg = (err as Error).message || "Failed to revoke session";
        setError(msg);
        setRevokingSessionId(null);
        return false;
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    sessions,
    isLoading,
    isStarting,
    isStopping,
    revokingSessionId,
    error,
    fetchStatus,
    fetchSessions,
    startRelay,
    stopRelay,
    revokeSession,
    clearError,
  };
};
