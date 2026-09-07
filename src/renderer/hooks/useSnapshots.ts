import { useState, useEffect, useCallback } from "react";
import { SnapshotMetadata } from "../../shared/types";

export interface UseSnapshotsResult {
  snapshots: SnapshotMetadata[];
  isLoading: boolean;
  isCreating: boolean;
  restoringId: string | null;
  deletingId: string | null;
  error: string | null;
  fetchSnapshots: () => Promise<void>;
  createSnapshot: (name: string, description?: string) => Promise<boolean>;
  restoreSnapshot: (id: string) => Promise<boolean>;
  deleteSnapshot: (id: string) => Promise<boolean>;
  clearError: () => void;
}

export const useSnapshots = (
  onRestoreSuccess?: (accountCount?: number) => void,
): UseSnapshotsResult => {
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    if (!window.electronAPI?.listSnapshots) {
      setIsLoading(false);
      return;
    }

    try {
      const response = await window.electronAPI.listSnapshots();
      if (response.success && response.data) {
        setSnapshots(response.data);
      } else if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to list snapshots");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const createSnapshot = useCallback(
    async (name: string, description?: string): Promise<boolean> => {
      if (!window.electronAPI?.createSnapshot) {
        return false;
      }

      setIsCreating(true);
      setError(null);

      try {
        const response = await window.electronAPI.createSnapshot({
          name,
          description,
        });
        if (response.success && response.data) {
          await fetchSnapshots();
          return true;
        }
        setError(response.error || "Failed to create snapshot");
        return false;
      } catch (err) {
        const message = (err as Error).message || "Failed to create snapshot";
        setError(message);
        return false;
      } finally {
        setIsCreating(false);
      }
    },
    [fetchSnapshots],
  );

  const restoreSnapshot = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI?.restoreSnapshot) {
        return false;
      }

      setRestoringId(id);
      setError(null);

      try {
        const response = await window.electronAPI.restoreSnapshot(id);
        if (response.success) {
          if (onRestoreSuccess) {
            onRestoreSuccess(response.accountCount);
          }
          return true;
        }
        setError(response.error || "Failed to restore snapshot");
        return false;
      } catch (err) {
        const message = (err as Error).message || "Failed to restore snapshot";
        setError(message);
        return false;
      } finally {
        setRestoringId(null);
      }
    },
    [onRestoreSuccess],
  );

  const deleteSnapshot = useCallback(
    async (id: string): Promise<boolean> => {
      if (!window.electronAPI?.deleteSnapshot) {
        return false;
      }

      setDeletingId(id);
      setError(null);

      try {
        const response = await window.electronAPI.deleteSnapshot(id);
        if (response.success) {
          await fetchSnapshots();
          return true;
        }
        setError(response.error || "Failed to delete snapshot");
        return false;
      } catch (err) {
        const message = (err as Error).message || "Failed to delete snapshot";
        setError(message);
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [fetchSnapshots],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    snapshots,
    isLoading,
    isCreating,
    restoringId,
    deletingId,
    error,
    fetchSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    clearError,
  };
};
