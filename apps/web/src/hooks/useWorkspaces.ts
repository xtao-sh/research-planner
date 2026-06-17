import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWorkspace,
  listWorkspaces,
  WorkspaceSummary,
} from '../api/workspaces';

const ACTIVE_WS_STORAGE_KEY = 'rp.activeWorkspaceId';

function readStoredId(): string | null {
  try {
    const v = window.localStorage.getItem(ACTIVE_WS_STORAGE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_WS_STORAGE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_WS_STORAGE_KEY);
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

export interface UseWorkspaces {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refresh: () => Promise<void>;
  createAndActivate: (name: string) => Promise<WorkspaceSummary>;
  loading: boolean;
  error: string | null;
}

/**
 * Manage the list of workspaces the authenticated user belongs to plus the
 * currently active workspace (persisted in localStorage).
 *
 * Callers pass `enabled` to gate fetching on auth. When `enabled` becomes
 * false we clear local state so the next login starts fresh.
 */
export function useWorkspaces(enabled: boolean): UseWorkspaces {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdState(id);
    writeStoredId(id);
  }, []);

  const applyWorkspaceList = useCallback(
    (list: WorkspaceSummary[], preferredId?: string | null) => {
      setWorkspaces(list);
      if (list.length === 0) {
        setActiveWorkspaceIdState(null);
        writeStoredId(null);
        return;
      }
      const stored = preferredId ?? readStoredId();
      const pick = stored && list.some((w) => w.id === stored) ? stored : list[0].id;
      setActiveWorkspaceIdState(pick);
      writeStoredId(pick);
    },
    []
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkspaces();
      applyWorkspaceList(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyWorkspaceList]);

  const createAndActivate = useCallback(
    async (name: string): Promise<WorkspaceSummary> => {
      const created = await createWorkspace(name);
      const list = await listWorkspaces();
      applyWorkspaceList(list, created.id);
      return created;
    },
    [applyWorkspaceList]
  );

  useEffect(() => {
    if (!enabled) {
      setWorkspaces([]);
      setActiveWorkspaceIdState(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listWorkspaces();
        if (cancelled) return;
        applyWorkspaceList(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, applyWorkspaceList]);

  return useMemo(
    () => ({
      workspaces,
      activeWorkspaceId,
      setActiveWorkspaceId,
      refresh,
      createAndActivate,
      loading,
      error,
    }),
    [workspaces, activeWorkspaceId, setActiveWorkspaceId, refresh, createAndActivate, loading, error]
  );
}
