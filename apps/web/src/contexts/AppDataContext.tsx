import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  BroadcastEnvelope,
  Note,
  PresenceMember,
  Project,
  Task,
} from '@rp/shared';
import { fetchJson } from '../api/client';
import { getInbox } from '../api/notes';
import { useAuth, type UseAuth } from '../hooks/useAuth';
import { useWorkspaces, type UseWorkspaces } from '../hooks/useWorkspaces';
import { useWorkspaceRealtime } from '../hooks/useWorkspaceRealtime';

// Map of projectId -> tasks. Used by /now and /projects pages so they can
// render per-project task counts without each page running its own fetch.
export type ProjectTasksMap = Record<string, Task[]>;

export interface AppData {
  auth: UseAuth;
  workspaces: UseWorkspaces;

  // Projects in the active workspace.
  projects: Project[];
  projectsLoading: boolean;
  refreshProjects: () => Promise<void>;

  // Per-project task cache (workspace-wide), populated lazily.
  projectTasks: ProjectTasksMap;
  /** Fetch tasks for every project in the active workspace and cache them. */
  fetchAllWorkspaceTasks: () => Promise<void>;
  /** Refresh a single project's tasks (used after edits). */
  refreshProjectTasks: (projectId: string) => Promise<void>;

  presenceMembers: PresenceMember[];
  wsConnected: boolean;
  wsLastError: 'unauthorized' | string | null;

  /** Pulses on every WebSocket event so panels can re-fetch. */
  eventTick: number;
  /** Manually pulse eventTick (for local mutations that should refresh panels immediately). */
  bumpEventTick: () => void;

  /** The active project the user is viewing — set by ProjectDetailPage. */
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;

  /** Convenience pass-through; identical to workspaces.activeWorkspaceId. */
  activeWorkspaceId: string | null;

  /** The current user's inbox notes for the active workspace. */
  inbox: Note[];
  refreshInbox: () => Promise<void>;
}

const AppDataContext = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside <AppDataProvider>');
  return ctx;
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const workspaces = useWorkspaces(!!auth.user);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectTasks, setProjectTasks] = useState<ProjectTasksMap>({});
  const [presenceMembers, setPresenceMembers] = useState<PresenceMember[]>([]);
  const [eventTick, setEventTick] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Note[]>([]);

  const activeWorkspaceIdRef = useRef<string | null>(null);
  // AbortController for the *currently active* workspace's in-flight task
  // fetches. When the user switches workspace we abort the controller so
  // late-arriving responses from the prior workspace can't write into
  // the new workspace's projectTasks map.
  const tasksAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const prev = activeWorkspaceIdRef.current;
    activeWorkspaceIdRef.current = workspaces.activeWorkspaceId;
    if (prev !== workspaces.activeWorkspaceId) {
      tasksAbortRef.current?.abort();
      tasksAbortRef.current = new AbortController();
    }
  }, [workspaces.activeWorkspaceId]);
  // Ensure a controller exists from the first render.
  if (tasksAbortRef.current === null) {
    tasksAbortRef.current = new AbortController();
  }

  const refreshProjects = useCallback(async () => {
    const wsId = activeWorkspaceIdRef.current;
    if (!wsId) {
      setProjects([]);
      return;
    }
    try {
      setProjectsLoading(true);
      const ps = await fetchJson<Project[]>(
        `/api/projects?workspaceId=${encodeURIComponent(wsId)}`
      );
      setProjects(ps);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const bumpEventTick = useCallback(() => setEventTick((n) => n + 1), []);

  const refreshInbox = useCallback(async () => {
    const wsId = activeWorkspaceIdRef.current;
    if (!wsId) {
      setInbox([]);
      return;
    }
    try {
      const items = await getInbox(wsId);
      setInbox(items);
    } catch {
      // ignore — keep stale inbox over a flash of empty
    }
  }, []);

  // Initial / workspace-change project list load + inbox load.
  useEffect(() => {
    if (!auth.user || workspaces.loading) return;
    if (!workspaces.activeWorkspaceId) {
      setProjects([]);
      setProjectTasks({});
      setInbox([]);
      return;
    }
    void refreshProjects();
    void refreshInbox();
    // Reset task cache on workspace switch.
    setProjectTasks({});
  }, [
    auth.user,
    workspaces.activeWorkspaceId,
    workspaces.loading,
    refreshProjects,
    refreshInbox,
  ]);

  const refreshProjectTasks = useCallback(async (projectId: string) => {
    const wsAtStart = activeWorkspaceIdRef.current;
    const controller = tasksAbortRef.current;
    try {
      const ts = await fetchJson<Task[]>(`/api/projects/${projectId}/tasks`, {
        signal: controller?.signal,
      });
      // Workspace may have switched while the fetch was in flight; drop
      // the result so it can't leak into the new workspace's cache.
      if (activeWorkspaceIdRef.current !== wsAtStart) return;
      setProjectTasks((prev) => ({ ...prev, [projectId]: ts }));
    } catch {
      // ignore aborts / network errors — stale cache is preferable to nothing
    }
  }, []);

  const fetchAllWorkspaceTasks = useCallback(async () => {
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) return;
    const wsAtStart = activeWorkspaceIdRef.current;
    const controller = tasksAbortRef.current;
    await Promise.all(
      ids.map(async (pid) => {
        try {
          const ts = await fetchJson<Task[]>(`/api/projects/${pid}/tasks`, {
            signal: controller?.signal,
          });
          if (activeWorkspaceIdRef.current !== wsAtStart) return;
          setProjectTasks((prev) => ({ ...prev, [pid]: ts }));
        } catch {
          // On per-project failure (network blip, 500, abort) write an
          // empty sentinel so `allProjectsCached` can still resolve —
          // otherwise the slot stays `undefined` forever and any consumer
          // gated on "every project fetched" (e.g. /now's loadingSummary)
          // sticks in a permanent loading state. Don't clobber an existing
          // cache, and respect the workspace-switch guard.
          if (activeWorkspaceIdRef.current !== wsAtStart) return;
          setProjectTasks((prev) =>
            prev[pid] !== undefined ? prev : { ...prev, [pid]: [] }
          );
        }
      })
    );
  }, [projects]);

  // Ref-snapshot of the task cache so handleWsEvent can decide whether
  // it has ever fetched a given project without taking projectTasks as
  // a dependency (and re-creating the callback on every event).
  const projectTasksRef = useRef<ProjectTasksMap>(projectTasks);
  useEffect(() => {
    projectTasksRef.current = projectTasks;
  }, [projectTasks]);

  const handleWsEvent = useCallback(
    (e: BroadcastEnvelope) => {
      setEventTick((n) => n + 1);
      const wsId = activeWorkspaceIdRef.current;
      if (!wsId || e.workspaceId !== wsId) return;

      const t = e.eventType;
      if (t.startsWith('workspace.member.')) {
        void workspaces.refresh();
        return;
      }
      if (t.startsWith('project.')) {
        void refreshProjects();
      }
      // Refresh task cache for the affected project — but only if it's
      // either the active project, or a project we've already cached
      // (so background WS chatter for a project the user has never
      // opened doesn't trigger a fetch + cache write).
      if (e.projectId) {
        const cached = projectTasksRef.current[e.projectId] !== undefined;
        const isActive = e.projectId === activeProjectId;
        if (cached || isActive) {
          void refreshProjectTasks(e.projectId);
        }
      }
      // Note events affect inbox / project notes; just refresh inbox.
      if (t.startsWith('note.')) {
        void refreshInbox();
      }
    },
    [refreshProjects, refreshProjectTasks, refreshInbox, workspaces, activeProjectId]
  );

  const handlePresence = useCallback((members: PresenceMember[]) => {
    setPresenceMembers(members);
  }, []);

  const { connected: wsConnected, lastError: wsLastError } = useWorkspaceRealtime({
    workspaceId: workspaces.activeWorkspaceId,
    activeProjectId,
    onEvent: handleWsEvent,
    onPresence: handlePresence,
  });

  // Memoize the context value so consumers don't re-render just because
  // *some* sibling state moved. We keep the dependency set explicit so
  // any genuine change (projects list, inbox, WS connected flag, event
  // tick…) still propagates — but identical-value renders are skipped.
  const value = useMemo<AppData>(
    () => ({
      auth,
      workspaces,
      projects,
      projectsLoading,
      refreshProjects,
      projectTasks,
      fetchAllWorkspaceTasks,
      refreshProjectTasks,
      presenceMembers,
      wsConnected,
      wsLastError,
      eventTick,
      bumpEventTick,
      activeProjectId,
      setActiveProjectId,
      activeWorkspaceId: workspaces.activeWorkspaceId,
      inbox,
      refreshInbox,
    }),
    [
      auth,
      workspaces,
      projects,
      projectsLoading,
      refreshProjects,
      projectTasks,
      fetchAllWorkspaceTasks,
      refreshProjectTasks,
      presenceMembers,
      wsConnected,
      wsLastError,
      eventTick,
      bumpEventTick,
      activeProjectId,
      inbox,
      refreshInbox,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
