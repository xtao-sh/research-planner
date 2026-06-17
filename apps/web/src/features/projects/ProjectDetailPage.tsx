import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  Dependency,
  Milestone,
  Note,
  Project,
  ScheduleResult,
  Task,
} from '@rp/shared';
import { getProjectNotes } from '../../api/notes';
import type { DurationMode } from '@rp/scheduler';
// NOTE: DependencyGraph, WeekView, SearchPanel, ExportDialog were intentionally
// cut from the project detail UI as part of the strategic refocus. Components
// remain on disk but have no entry point.
import { KanbanView } from '../../components/KanbanView';
import { ReviewReport } from '../../components/ReviewReport';
import { fetchJson, sendJson } from '../../api/client';
import { setTaskFocus, reorderTasks, setTaskParent } from '../../api/tasks';
import {
  TaskFormState,
  defaultForm,
  formatDateInput,
  parseDateInput,
} from '../task-form/form';
// MilestonePanel removed from the rendered tree — handlers kept for
// future re-introduction. Component file remains on disk.
import { ProjectNotesTab } from './ProjectNotesTab';
import { ProjectArtifactsTab } from './ProjectArtifactsTab';
import { ProjectTimelineTab } from './ProjectTimelineTab';
import { canWrite as canWriteRole } from '../workspaces/permissions';
import { useAppData } from '../../contexts/AppDataContext';
import { ProjectBriefing } from './ProjectBriefing';
import type { ProjectMode } from '@rp/shared';
import { Gantt } from './Gantt';
import { UncertaintyLane } from './UncertaintyLane';
import { TaskInlineEditor } from './TaskInlineEditor';
import { TaskDetailsDrawer } from './TaskDetailsDrawer';
import { TaskListPanel } from './TaskListPanel';
import { TaskTreeDrawer } from './TaskTreeDrawer';
import { useWipLimits } from '../settings/settingsStore';
import { ScheduleControls } from './ScheduleControls';
import { ScenarioPanel } from './ScenarioPanel';
import { ProjectModeHeader } from './ProjectModeHeader';
import { SkeletonList } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';

// 'kanban' | 'gantt' are the only view modes that have UI affordances now.
// 'dependencies' and 'week' components remain on disk but are unreachable.
type ViewMode = 'gantt' | 'kanban';

type ProjectTab = 'tasks' | 'notes' | 'artifacts' | 'timeline';
const PROJECT_TABS: ProjectTab[] = ['tasks', 'notes', 'artifacts', 'timeline'];

function parseTab(value: string | null): ProjectTab {
  if (value && (PROJECT_TABS as string[]).includes(value)) {
    return value as ProjectTab;
  }
  return 'tasks';
}

export function ProjectDetailPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const {
    workspaces,
    projects,
    eventTick,
    setActiveProjectId,
    refreshProjects,
  } = useAppData();
  const [modeSwitching, setModeSwitching] = useState(false);
  // Per-project WIP limits from /settings — empty record means "no overrides"
  // and KanbanView falls back to its built-in default (3 on `doing`).
  const wipLimits = useWipLimits(projectId);

  const activeWorkspaceRole = workspaces.workspaces.find(
    (w) => w.id === workspaces.activeWorkspaceId
  )?.role;
  const canWriteActiveWorkspace = canWriteRole(activeWorkspaceRole);

  // Track active project in shared state so realtime/presence still work.
  useEffect(() => {
    setActiveProjectId(projectId ?? null);
    return () => setActiveProjectId(null);
  }, [projectId, setActiveProjectId]);

  // Local project-scoped state.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [newDepSourceId, setNewDepSourceId] = useState('');
  const [newDepType, setNewDepType] = useState<'FS' | 'SS' | 'FF' | 'SF'>('FS');
  const [newDepLag, setNewDepLag] = useState<number>(0);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [showTree, setShowTree] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('gantt');
  const [durationMode, setDurationMode] = useState<DurationMode>('expected');
  // Scenario comparison: a saved-snapshot id whose bars get drawn as a ghost
  // overlay on the lane / Gantt. Stored in three separate slots so the
  // overlay rendering doesn't have to re-resolve from id every render.
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeScenarioSnapshot, setActiveScenarioSnapshot] =
    useState<ScheduleResult | null>(null);
  const [activeScenarioName, setActiveScenarioName] = useState<string | null>(null);
  // Review panel is collapsed by default but the toggle persists per-project
  // in sessionStorage — so a user mid-retrospective doesn't have to re-open
  // it after each tab switch / WS refresh / cross-project navigation.
  const [showReview, setShowReview] = useState(false);
  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return;
    try {
      const v = window.sessionStorage.getItem(`rp.review.open.${projectId}`);
      setShowReview(v === '1');
    } catch {
      setShowReview(false);
    }
  }, [projectId]);
  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return;
    const key = `rp.review.open.${projectId}`;
    try {
      if (showReview) window.sessionStorage.setItem(key, '1');
      else window.sessionStorage.removeItem(key);
    } catch {
      /* quota / privacy errors */
    }
  }, [projectId, showReview]);

  // Phase I: load project notes so the Progress retrospective can show
  // "captures this period". Refreshes when the workspace event tick bumps.
  const [projectNotes, setProjectNotes] = useState<Note[]>([]);

  // Top-level project tab (Tasks / Notes / Artifacts / Timeline) — URL-driven.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: ProjectTab = parseTab(searchParams.get('tab'));
  function setActiveTab(next: ProjectTab) {
    const params = new URLSearchParams(searchParams);
    if (next === 'tasks') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  }

  // Ref to current tasks so refreshProject can detect "first load vs.
  // subsequent refresh" without re-creating the callback on every state
  // change (which would cascade into the eventTick effect).
  const tasksRef = useRef<Task[]>([]);

  const refreshProject = useCallback(
    async (mode: DurationMode = durationMode) => {
      if (!projectId) return;
      // Only show the full-page loading placeholder on FIRST load (no tasks
      // yet). Subsequent refreshes (mode toggle, WS event tick, drag-reorder
      // etc.) keep the existing data on screen so we don't flash a blank
      // page (which would also reset scroll). Read via ref to avoid the
      // useCallback closure capturing a stale tasks=[] from first render.
      const isInitial = tasksRef.current.length === 0;
      if (isInitial) setLoading(true);
      try {
        const [tasksResp, depsResp, milestonesResp, sched] = await Promise.all([
          fetchJson<Task[]>(`/api/projects/${projectId}/tasks`),
          fetchJson<Dependency[]>(`/api/projects/${projectId}/deps`),
          fetchJson<Milestone[]>(`/api/projects/${projectId}/milestones`),
          fetchJson<ScheduleResult>(`/api/projects/${projectId}/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ durationMode: mode }),
          }),
        ]);
        setTasks(tasksResp);
        setDeps(depsResp);
        setMilestones(milestonesResp);
        setSchedule(sched);
        setError(null);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, durationMode]
  );

  // Debounced refresh — coalesces the burst of WS events that arrive when a
  // multi-step mutation (drag-reorder, scenario apply, etc.) commits server-side.
  // Initial-load callsites use `refreshProject` directly to fetch immediately.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(
    (mode?: DurationMode) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void refreshProject(mode);
        refreshTimerRef.current = null;
      }, 200);
    },
    [refreshProject]
  );
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  // Initial load + reload when projectId changes.
  useEffect(() => {
    if (!projectId) return;
    // Clear the previous project's data so the loading placeholder shows
    // on cross-project navigation (the refreshProject helper uses
    // `tasks.length === 0` to decide whether this is an initial load).
    setTasks([]);
    setDeps([]);
    setMilestones([]);
    setSchedule(null);
    setSelectedTaskId(null);
    void refreshProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Track the latest project events from the realtime channel.
  const lastEventTickRef = useRef(eventTick);
  useEffect(() => {
    if (eventTick !== lastEventTickRef.current) {
      lastEventTickRef.current = eventTick;
      if (projectId) debouncedRefresh();
    }
  }, [eventTick, projectId, debouncedRefresh]);

  // Deep-link support — when the page is opened with ?task=<id>, select
  // that task once the tasks array has loaded and scroll its row into
  // view. The Search and Command Palette pages use this to navigate to
  // a specific task instead of dumping the user at the top of the
  // task list. The param is consumed (cleared) so a subsequent refresh
  // doesn't re-trigger the scroll.
  const taskParam = searchParams.get('task');
  useEffect(() => {
    if (!taskParam || tasks.length === 0) return;
    const found = tasks.find((tk) => tk.id === taskParam);
    if (!found) return;
    setSelectedTaskId(taskParam);
    // Defer the scroll until the row exists in the DOM. requestAnimationFrame
    // is enough — the tasks state update + render are sync after this effect.
    requestAnimationFrame(() => {
      const row = document.querySelector(
        `[data-task-id="${CSS.escape(taskParam)}"]`
      );
      if (row && row instanceof HTMLElement) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Brief highlight pulse — class is auto-removed after ~1.5s by
        // the animationend handler in App.css.
        row.classList.add('rd-row-deeplink-pulse');
        window.setTimeout(
          () => row.classList.remove('rd-row-deeplink-pulse'),
          1500
        );
      }
    });
    // Strip the param so a later refresh / back-nav doesn't repeat.
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
  }, [taskParam, tasks, searchParams, setSearchParams]);

  const selectedTask = useMemo(
    () => tasks.find((tk) => tk.id === selectedTaskId) || null,
    [selectedTaskId, tasks]
  );

  useEffect(() => {
    if (!projectId) {
      setProjectNotes([]);
      return;
    }
    let cancelled = false;
    getProjectNotes(projectId)
      .then((list) => {
        if (!cancelled) setProjectNotes(list);
      })
      .catch(() => {
        if (!cancelled) setProjectNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, eventTick]);

  // Sync the form when the user picks a *different* task (or clears the
  // selection). We intentionally depend on `selectedTaskId` only — NOT on the
  // selectedTask object reference. Otherwise every WS-driven `refreshProject`
  // would replace the `tasks` array, return a fresh `selectedTask` object,
  // and clobber the user's in-flight edits to the form (e.g. typing into the
  // notes textarea would lose every keystroke that overlapped with a refresh).
  // Reading the latest task via a ref keeps the dependency minimal but still
  // gets up-to-date data when the user actually switches tasks.
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  useEffect(() => {
    const current = selectedTaskId
      ? tasksRef.current.find((tk) => tk.id === selectedTaskId) || null
      : null;
    if (current) {
      setForm({
        title: current.title,
        type: current.type,
        status: current.status,
        priority: current.priority,
        size: current.size ?? 'm',
        intensity: current.intensity ?? null,
        estimate: {
          o: current.estimate.o,
          m: current.estimate.m,
          p: current.estimate.p,
          confidence: current.estimate.confidence,
        },
        dueSoft: formatDateInput(current.dueSoft),
        dueHard: formatDateInput(current.dueHard),
        timeframeBucket: current.timeframeBucket ?? null,
        timeframeAnchor: current.timeframeAnchor ?? null,
        assignee: current.assignee || '',
        notes: current.notes || '',
        milestoneId: current.milestoneId || '',
        parentTaskId: current.parentTaskId || '',
      });
      setNewDepSourceId('');
    } else {
      const base = defaultForm();
      base.priority = tasksRef.current.length + 1;
      setForm(base);
      setNewDepSourceId('');
    }
  }, [selectedTaskId]);

  // Targeted sync — when the selected task's *server-derived* bucket/anchor
  // fields change (e.g. after the inline editor auto-commits a new bucket
  // and the server stamps an anchor), pull just those two fields into the
  // form. We can't depend on the whole `tasks` array (would clobber
  // in-flight free-text edits like notes), but a narrowly-scoped merge
  // keeps the drawer's countdown + Reset-button visibility in step with
  // the server.
  const selectedTimeframeBucket = useMemo(
    () => (selectedTaskId
      ? tasks.find((t) => t.id === selectedTaskId)?.timeframeBucket ?? null
      : null),
    [selectedTaskId, tasks]
  );
  const selectedTimeframeAnchor = useMemo(
    () => (selectedTaskId
      ? tasks.find((t) => t.id === selectedTaskId)?.timeframeAnchor ?? null
      : null),
    [selectedTaskId, tasks]
  );
  useEffect(() => {
    if (!selectedTaskId) return;
    setForm((f) => {
      if (
        f.timeframeBucket === selectedTimeframeBucket &&
        f.timeframeAnchor === selectedTimeframeAnchor
      ) {
        return f;
      }
      return {
        ...f,
        timeframeBucket: selectedTimeframeBucket,
        timeframeAnchor: selectedTimeframeAnchor,
      };
    });
  }, [selectedTaskId, selectedTimeframeBucket, selectedTimeframeAnchor]);

  async function handleDurationModeChange(mode: DurationMode) {
    setDurationMode(mode);
    await refreshProject(mode);
  }

  // Scenario save/list/delete handlers were removed in the strategic
  // refocus — the scenarios API endpoints + schema remain intact, but the
  // UI for managing them was cut.

  async function handleCreateMilestone(title: string, dueSoft?: string) {
    if (!projectId) return;
    try {
      await sendJson(`/api/projects/${projectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ title, dueSoft }),
      });
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('milestone.createFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  async function handleDeleteMilestone(mId: string) {
    if (!projectId) return;
    try {
      await sendJson(`/api/milestones/${mId}`, { method: 'DELETE' });
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('milestone.deleteFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  async function handleSaveTask() {
    if (!projectId) return;
    if (!form.title.trim()) {
      toast.push(t('task.titleRequired'), { kind: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        type: form.type,
        status: form.status,
        priority: Number(form.priority) || 1,
        size: form.size,
        intensity: form.intensity,
        estimate: {
          o: Number(form.estimate.o) || 1,
          m: Number(form.estimate.m) || 1,
          p: Number(form.estimate.p) || 1,
          confidence: form.estimate.confidence,
        },
        assignee: form.assignee || undefined,
        notes: form.notes || undefined,
        dueSoft: parseDateInput(form.dueSoft),
        dueHard: parseDateInput(form.dueHard),
        // For create: only send if user picked one (null is "make it
        // explicit none" which we don't want at creation — undefined =
        // leave it off entirely).
        // For edit: send the value explicitly so null clears the bucket.
        timeframeBucket: selectedTaskId
          ? form.timeframeBucket
          : form.timeframeBucket ?? undefined,
        milestoneId: form.milestoneId || undefined,
        // null sends "make this top-level"; undefined leaves it untouched.
        parentTaskId: form.parentTaskId || null,
      };
      const isEdit = Boolean(selectedTaskId);
      const url = isEdit
        ? `/api/tasks/${selectedTaskId}`
        : `/api/projects/${projectId}/tasks`;
      const method = isEdit ? 'PUT' : 'POST';
      await sendJson(url, {
        method,
        body: JSON.stringify(payload),
      });
      await refreshProject();
      if (!isEdit) {
        setSelectedTaskId(null);
        setCreatingNew(false);
        setForm({ ...defaultForm(), priority: tasks.length + 1 });
      }
    } catch (e: any) {
      toast.push(`${t('task.saveFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTask(taskId: string) {
    if (!projectId) return;
    if (!confirm(t('task.confirmDelete'))) return;
    try {
      await sendJson(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.deleteFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  async function applyTaskPatch(taskId: string, patch: Partial<Task>) {
    if (!projectId) return;
    setUpdatingTaskId(taskId);
    try {
      await sendJson(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.updateFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    } finally {
      setUpdatingTaskId(null);
    }
  }

  function handleSelectTask(taskId: string) {
    // Toggle: clicking the already-selected row collapses the inline editor.
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
      setShowDetailsDrawer(false);
      return;
    }
    setSelectedTaskId(taskId);
    setCreatingNew(false);
    // Progress mode has no inline-row editor (the Flow Board renders cards,
    // not list rows with an "expand below" slot). Opening a task in that
    // mode auto-opens the side drawer so the user can actually edit. In
    // deadline mode the inline editor below the row is the primary surface
    // and the drawer remains opt-in via "More details".
    if (mode === 'progress') {
      setShowDetailsDrawer(true);
    } else {
      setShowDetailsDrawer(false);
    }
  }

  function handleCancelInlineEdit() {
    setSelectedTaskId(null);
    setCreatingNew(false);
    setShowDetailsDrawer(false);
  }

  function handleCloseDrawer() {
    setShowDetailsDrawer(false);
    // In progress mode the drawer IS the editor — closing it should also
    // clear the selection so a re-click on the same card reopens it
    // (otherwise handleSelectTask's toggle branch would fire and the user
    // would have to click twice). In deadline mode keep the inline editor
    // open so closing "More details" doesn't dismiss the row's editor.
    if (mode === 'progress') {
      setSelectedTaskId(null);
    }
  }

  async function handleReorder(taskIds: string[]) {
    if (!projectId) return;
    // Optimistic: assign provisional priorities and re-sort locally so the
    // dragged row sticks while the server roundtrips.
    setTasks((prev) => {
      const orderIdx = new Map(taskIds.map((id, i) => [id, i + 1] as const));
      return prev.map((tk) =>
        orderIdx.has(tk.id) ? { ...tk, priority: orderIdx.get(tk.id)! } : tk
      );
    });
    try {
      await reorderTasks(projectId, taskIds);
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.reorderFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
      await refreshProject();
    }
  }

  /** Nest: make `taskId` a subtask of the row directly preceding it in
   *  the rendered (depth-first) order at the same depth. Mirrors the Tab
   *  behaviour in any outliner (Notion / Workflowy / Roam). */
  async function handleNest(taskId: string) {
    const list = [...tasks].sort((a, b) => a.priority - b.priority);
    // Build orderedTasks-equivalent: depth-first walk.
    const childrenByParent = new Map<string | null, Task[]>();
    for (const tk of list) {
      const key = tk.parentTaskId ?? null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(tk);
    }
    const flat: Array<{ task: Task; depth: number }> = [];
    function walk(parent: string | null, depth: number) {
      for (const tk of childrenByParent.get(parent) ?? []) {
        flat.push({ task: tk, depth });
        walk(tk.id, depth + 1);
      }
    }
    walk(null, 0);
    const idx = flat.findIndex((x) => x.task.id === taskId);
    if (idx <= 0) {
      toast.push(t('task.cannotNestFirst'), { kind: 'warning' });
      return;
    }
    const me = flat[idx];
    // Find the nearest preceding sibling AT THE SAME DEPTH — that's the new
    // parent. (If me is depth 0, that's the previous root. If me is depth 1,
    // it's the previous depth-1 sibling.)
    let target: Task | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (flat[i].depth === me.depth) {
        target = flat[i].task;
        break;
      }
      // If we walk PAST our parent (depth < me.depth - 1), stop — there's
      // no preceding sibling.
      if (flat[i].depth < me.depth) break;
    }
    if (!target) {
      toast.push(t('task.cannotNestFirst'), { kind: 'warning' });
      return;
    }
    // Server enforces depth ≤ 3; pre-check so the error is friendly.
    if (me.depth + 1 > 2 /* depth 0/1/2 = root/child/grandchild */) {
      toast.push(t('task.depthLimitReached'), { kind: 'warning' });
      return;
    }
    const newSiblings = [
      ...tasks
        .filter((t) => t.parentTaskId === target!.id && t.id !== taskId)
        .sort((a, b) => a.priority - b.priority)
        .map((t) => t.id),
      taskId,
    ];
    await handleReparent(taskId, target.id, newSiblings);
  }

  /** Outdent: promote `taskId` to be a sibling of its current parent.
   *  Mirrors Shift+Tab in any outliner. */
  async function handleOutdent(taskId: string) {
    const me = tasks.find((tk) => tk.id === taskId);
    if (!me || !me.parentTaskId) return; // already root
    const parent = tasks.find((tk) => tk.id === me.parentTaskId);
    const newParentId = parent?.parentTaskId ?? null;
    const newSiblings = [
      ...tasks
        .filter(
          (tk) => (tk.parentTaskId ?? null) === newParentId && tk.id !== taskId
        )
        .sort((a, b) => a.priority - b.priority)
        .map((tk) => tk.id),
      taskId,
    ];
    await handleReparent(taskId, newParentId, newSiblings);
  }

  /** Move task into a new parent and reorder its new sibling group. Server
   *  validates the parent chain (cycle / depth / cross-project) and returns
   *  400 if invalid — we surface via alert and refresh to roll back. */
  async function handleReparent(
    taskId: string,
    newParentId: string | null,
    newSiblingIds: string[]
  ) {
    if (!projectId) return;
    // Optimistic: re-parent locally + re-priority within the new sibling set.
    setTasks((prev) => {
      const orderIdx = new Map(newSiblingIds.map((id, i) => [id, i + 1] as const));
      return prev.map((tk) => {
        if (tk.id === taskId) {
          return {
            ...tk,
            parentTaskId: newParentId ?? undefined,
            priority: orderIdx.has(tk.id) ? orderIdx.get(tk.id)! : tk.priority,
          };
        }
        return orderIdx.has(tk.id) ? { ...tk, priority: orderIdx.get(tk.id)! } : tk;
      });
    });
    try {
      await setTaskParent(taskId, newParentId);
      if (newSiblingIds.length > 0) {
        await reorderTasks(projectId, newSiblingIds);
      }
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.reparentFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
      await refreshProject();
    }
  }

  async function handleToggleFocus(taskId: string, focused: boolean) {
    try {
      await setTaskFocus(taskId, focused);
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.updateFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  function handleNewTask() {
    setSelectedTaskId(null);
    setCreatingNew(true);
    setShowDetailsDrawer(false);
    setForm({ ...defaultForm(), priority: tasks.length + 1 });
  }

  // handleTaskDateChange was used by the WeekView (now unreachable); removed.

  const scheduleItems = schedule?.items || [];
  const cpSet = useMemo(() => new Set(schedule?.criticalPath || []), [schedule]);
  const tasksByPriority = useMemo(
    () => [...tasks].sort((a, b) => a.priority - b.priority),
    [tasks]
  );
  const metrics = useMemo(() => {
    const total = tasks.length;
    const doing = tasks.filter((tk) => tk.status === 'doing').length;
    const blocked = tasks.filter((tk) => tk.status === 'blocked').length;
    const done = tasks.filter((tk) => tk.status === 'done').length;
    const riskItems = scheduleItems.filter((it) => it.violatesHardDue);
    const cpTitles = tasks.filter((tk) => cpSet.has(tk.id)).map((tk) => tk.title);

    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const softDeadlineWarnings = tasks.filter((tk) => {
      if (tk.status === 'done' || !tk.dueSoft) return false;
      const dueTime = new Date(tk.dueSoft).getTime();
      const schedItem = scheduleItems.find((it) => it.taskId === tk.id);
      if (!schedItem) return false;
      const planEnd = new Date(schedItem.endPlanned).getTime();
      return planEnd > dueTime - threeDays && planEnd <= dueTime;
    });

    return { total, doing, blocked, done, riskItems, cpTitles, softDeadlineWarnings };
  }, [tasks, scheduleItems, cpSet]);

  const predecessors = useMemo(() => {
    if (!selectedTask) return [] as Dependency[];
    return deps.filter((d) => d.toTaskId === selectedTask.id);
  }, [deps, selectedTask]);
  const addableTasks = useMemo(() => {
    if (!selectedTask) return [] as Task[];
    return tasks.filter(
      (tk) =>
        tk.id !== selectedTask.id &&
        !predecessors.some((dep) => dep.fromTaskId === tk.id)
    );
  }, [tasks, selectedTask, predecessors]);

  useEffect(() => {
    if (!newDepSourceId && addableTasks.length > 0) {
      setNewDepSourceId(addableTasks[0].id);
    }
  }, [addableTasks, newDepSourceId]);

  async function handleAddDependency() {
    if (!projectId || !selectedTask || !newDepSourceId) return;
    try {
      await sendJson(`/api/projects/${projectId}/deps`, {
        method: 'POST',
        body: JSON.stringify({
          fromTaskId: newDepSourceId,
          toTaskId: selectedTask.id,
          type: newDepType,
          lag: Number.isFinite(newDepLag) ? newDepLag : 0,
        }),
      });
      await refreshProject();
      setNewDepSourceId('');
      setNewDepType('FS');
      setNewDepLag(0);
    } catch (e: any) {
      toast.push(`${t('task.addDependencyFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  async function handleRemoveDependency(depId: string) {
    if (!projectId) return;
    try {
      await sendJson(`/api/deps/${depId}`, { method: 'DELETE' });
      await refreshProject();
    } catch (e: any) {
      toast.push(`${t('task.removeDependencyFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  // Project must exist in workspace; if not, redirect.
  const project: Project | undefined = projects.find((p) => p.id === projectId);
  if (!projectId) return <Navigate to="/projects" replace />;

  const mode: ProjectMode = project?.mode ?? 'progress';
  const isDeadlineMode = mode === 'deadline';

  // In progress mode the visualizations card is not rendered at all (the
  // Kanban view duplicated the task list above; see Density pass commit).
  // Kanban only lives inside deadline-mode visualizations now.

  async function handleModeChange(next: ProjectMode) {
    if (!projectId || next === mode || modeSwitching) return;
    if (!canWriteActiveWorkspace) return;
    setModeSwitching(true);
    try {
      await sendJson(`/api/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({ mode: next }),
      });
      await refreshProjects();
    } catch (e: any) {
      toast.push(`${t('project.mode.label')}: ${String(e?.message || e)}`, { kind: 'error' });
    } finally {
      setModeSwitching(false);
    }
  }

  async function handleDeleteProject() {
    if (!projectId || !canWriteActiveWorkspace) return;
    try {
      await sendJson(`/api/projects/${projectId}`, { method: 'DELETE' });
      await refreshProjects();
      navigate('/projects');
    } catch (e: any) {
      toast.push(`${t('project.deleteFailed')}: ${String(e?.message || e)}`, { kind: 'error' });
    }
  }

  return (
    <>
      {project && (
        <ProjectModeHeader
          project={project}
          mode={mode}
          modeSwitching={modeSwitching}
          canWriteActiveWorkspace={canWriteActiveWorkspace}
          taskCount={tasks.length}
          onModeChange={handleModeChange}
          onBack={() => navigate('/projects')}
          onDelete={handleDeleteProject}
        />
      )}

      {loading && (
        <div className="card">
          <SkeletonList rows={4} />
        </div>
      )}
      {error && (
        <p className="error-message">
          {t('common.error')}：{error}
        </p>
      )}

      {!loading && !error && (
        <>
          {project && (
            <ProjectBriefing
              project={project}
              tasks={tasks}
              notes={projectNotes}
            />
          )}
          {projectId && (
            <nav className="rd-tab-bar" role="tablist" aria-label={t('projectTabs.tasks')}>
              {PROJECT_TABS.map((tab) => {
                const labelMap: Record<ProjectTab, string> = {
                  tasks: t('projectTabs.tasks'),
                  notes: t('projectTabs.notes'),
                  artifacts: t('projectTabs.artifacts'),
                  timeline: t('projectTabs.timeline'),
                };
                const countMap: Record<ProjectTab, number | null> = {
                  tasks: tasks.length,
                  notes: projectNotes.length,
                  artifacts: null,
                  timeline: null,
                };
                const count = countMap[tab];
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`rd-tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {labelMap[tab]}
                    {count !== null && count > 0 && (
                      <span className="rd-count">{count}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}

          {activeTab === 'notes' && projectId && (
            <ProjectNotesTab
              projectId={projectId}
              refreshTrigger={eventTick}
              onOpenCapture={() =>
                window.dispatchEvent(new CustomEvent('rp:open-capture'))
              }
            />
          )}

          {activeTab === 'artifacts' && projectId && (
            <ProjectArtifactsTab
              projectId={projectId}
              refreshTrigger={eventTick}
              canWrite={canWriteActiveWorkspace}
            />
          )}

          {activeTab === 'timeline' && projectId && (
            <ProjectTimelineTab
              projectId={projectId}
              refreshTrigger={eventTick}
            />
          )}

          {activeTab === 'tasks' && (
          <>
          {/* MilestonePanel removed — milestone verticals already render on
              the Uncertainty Lane (Deadline mode) and the design canvas
              doesn't surface a separate milestones list above the task
              view. Underlying API + create/delete handlers are kept for
              the (currently hidden) re-introduction. */}

          {/* Project summary stats card removed — the briefing strip above
              already says "进行中 N · 阻塞 N · 笔记 N · 聚焦 N", and the
              task list itself shows the totals via status badges. The only
              piece worth keeping is the deadline-mode critical path; that
              is shown inline under the warnings panel below. */}
          {isDeadlineMode && metrics.cpTitles.length > 0 && (
            <p className="critical-path-line">
              <span className="critical-path-label">{t('metrics.criticalPath')}</span>
              <span className="critical-path-value">
                {metrics.cpTitles.join(' → ')}
              </span>
            </p>
          )}

          {isDeadlineMode && metrics.riskItems.length > 0 && (
            <div className="warning-panel">
              <h3>{t('warning.hardDeadlineViolation')}</h3>
              <ul className="warning-list">
                {metrics.riskItems.map((item) => {
                  const task = tasks.find((tk) => tk.id === item.taskId);
                  if (!task) return null;
                  const delay = Math.ceil(
                    (new Date(item.endPlanned).getTime() -
                      new Date(task.dueHard!).getTime()) /
                      (1000 * 60 * 60 * 24)
                  );
                  return (
                    <li key={item.taskId} className="warning-item">
                      <div className="warning-item-content">
                        <div className="warning-item-title">{task.title}</div>
                        <div className="warning-item-details">
                          {t('warning.expectedFinish')}:
                          {new Date(item.endPlanned).toLocaleDateString(i18n.language)} | {t('warning.hardDue')}:
                          {new Date(task.dueHard!).toLocaleDateString(i18n.language)}
                        </div>
                      </div>
                      <div className="warning-item-badge">{t('warning.delayDays', { days: delay })}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {isDeadlineMode && metrics.softDeadlineWarnings.length > 0 && (
            <div className="soft-deadline-panel">
              <h3>{t('warning.softDeadlineApproaching')}</h3>
              <ul className="warning-list">
                {metrics.softDeadlineWarnings.map((task) => {
                  const schedItem = scheduleItems.find(
                    (it) => it.taskId === task.id
                  );
                  if (!schedItem) return null;
                  const daysLeft = Math.ceil(
                    (new Date(task.dueSoft!).getTime() -
                      new Date(schedItem.endPlanned).getTime()) /
                      (1000 * 60 * 60 * 24)
                  );
                  return (
                    <li key={task.id} className="warning-item">
                      <div className="warning-item-content">
                        <div className="warning-item-title">{task.title}</div>
                        <div className="warning-item-details">
                          {t('warning.expectedFinish')}:
                          {new Date(schedItem.endPlanned).toLocaleDateString(i18n.language)} | {t('warning.softDue')}:
                          {new Date(task.dueSoft!).toLocaleDateString(i18n.language)}
                        </div>
                      </div>
                      <div
                        className="warning-item-badge"
                        style={{ background: 'var(--warning-color)' }}
                      >
                        {t('warning.daysLeft', { days: daysLeft })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Progress mode: Flow Board is the primary task view. The verbose
              TaskListPanel only surfaces in Deadline mode (above the
              Uncertainty Lane). */}
          {!isDeadlineMode && (
            <section className="rd-flow-board-section">
              <div className="rd-flow-board-eyebrow-row">
                <div className="rd-section-eyebrow">
                  {t('progressMode.eyebrow')}
                </div>
                <div className="rd-flow-board-helper">
                  {t('progressMode.helper')}
                </div>
              </div>
              <KanbanView
                tasks={tasksByPriority}
                onTaskClick={handleSelectTask}
                onStatusChange={(taskId, newStatus) =>
                  applyTaskPatch(taskId, { status: newStatus })
                }
                onToggleFocus={handleToggleFocus}
                onReorder={(_status, taskIds) => handleReorder(taskIds)}
                wipLimits={
                  Object.keys(wipLimits).length > 0 ? wipLimits : undefined
                }
              />
              {canWriteActiveWorkspace && (
                creatingNew ? (
                  <div className="rd-flow-board-new-task">
                    <TaskInlineEditor
                      form={form}
                      setForm={setForm}
                      selectedTask={null}
                      saving={saving}
                      canWriteActiveWorkspace={canWriteActiveWorkspace}
                      onSave={handleSaveTask}
                      onDelete={handleDeleteTask}
                      onCancel={handleCancelInlineEdit}
                      onOpenDrawer={() => setShowDetailsDrawer(true)}
                      onApplyPatch={applyTaskPatch}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost rd-flow-board-add"
                    onClick={handleNewTask}
                  >
                    + {t('task.newTask')}
                  </button>
                )
              )}
            </section>
          )}

          {/* TaskListPanel renders its own .card surface with an h3 "任务列表"
              header — no outer "任务管理" h2 wrapper needed. Only shown in
              Deadline mode now; Progress mode uses the Flow Board above. */}
          {isDeadlineMode && (
          <TaskListPanel
              tasks={tasksByPriority}
              scheduleItems={scheduleItems}
              cpSet={cpSet}
              isDeadlineMode={isDeadlineMode}
              selectedTaskId={selectedTaskId}
              updatingTaskId={updatingTaskId}
              canWriteActiveWorkspace={canWriteActiveWorkspace}
              onSelect={handleSelectTask}
              onNewTask={handleNewTask}
              onShowTree={() => setShowTree(true)}
              onToggleFocus={handleToggleFocus}
              onReorder={handleReorder}
              onNest={handleNest}
              onOutdent={handleOutdent}
              creatingNew={creatingNew}
              renderNewInlineEditor={() => (
                <TaskInlineEditor
                  form={form}
                  setForm={setForm}
                  selectedTask={null}
                  saving={saving}
                  canWriteActiveWorkspace={canWriteActiveWorkspace}
                  onSave={handleSaveTask}
                  onDelete={handleDeleteTask}
                  onCancel={handleCancelInlineEdit}
                  onOpenDrawer={() => setShowDetailsDrawer(true)}
                  onApplyPatch={applyTaskPatch}
                />
              )}
              renderInlineEditor={(task) => (
                <TaskInlineEditor
                  form={form}
                  setForm={setForm}
                  selectedTask={task}
                  saving={saving}
                  canWriteActiveWorkspace={canWriteActiveWorkspace}
                  onSave={handleSaveTask}
                  onDelete={handleDeleteTask}
                  onCancel={handleCancelInlineEdit}
                  onOpenDrawer={() => setShowDetailsDrawer(true)}
                  onApplyPatch={applyTaskPatch}
                  tasks={tasks}
                  onReparent={handleReparent}
                />
              )}
            />
          )}

          <TaskDetailsDrawer
            open={showDetailsDrawer}
            onClose={handleCloseDrawer}
            form={form}
            setForm={setForm}
            selectedTask={selectedTask}
            saving={saving}
            canWriteActiveWorkspace={canWriteActiveWorkspace}
            isDeadlineMode={isDeadlineMode}
            milestones={milestones}
            predecessors={predecessors}
            addableTasks={addableTasks}
            tasks={tasks}
            newDepSourceId={newDepSourceId}
            setNewDepSourceId={setNewDepSourceId}
            newDepType={newDepType}
            setNewDepType={setNewDepType}
            newDepLag={newDepLag}
            setNewDepLag={setNewDepLag}
            onSave={handleSaveTask}
            onDelete={handleDeleteTask}
            onAddDependency={handleAddDependency}
            onRemoveDependency={handleRemoveDependency}
            onApplyPatch={applyTaskPatch}
            projectNotes={projectNotes}
          />

          <TaskTreeDrawer
            open={showTree}
            onClose={() => setShowTree(false)}
            tasks={tasks}
            projectName={project?.name ?? ''}
            onReparent={
              canWriteActiveWorkspace
                ? (taskId, newParentId) => {
                    const newSiblings = [
                      ...tasks
                        .filter(
                          (tk) =>
                            (tk.parentTaskId ?? null) === newParentId &&
                            tk.id !== taskId
                        )
                        .sort((a, b) => a.priority - b.priority)
                        .map((tk) => tk.id),
                      taskId,
                    ];
                    void handleReparent(taskId, newParentId, newSiblings);
                  }
                : undefined
            }
          />

          {/* In progress mode the Kanban duplicates the task list above and
              the Gantt is meaningless — we render NEITHER by default. Both
              live behind quiet toggles at the page foot. In deadline mode
              the Gantt is the unique value, so we always show it; Kanban
              still hides behind a toggle. */}
          {isDeadlineMode && (
            <section className="card schedule-view">
              <h2>{t('view.visualizations')}</h2>
              <div className="view-tabs">
                <button
                  className={`view-tab ${viewMode === 'gantt' ? 'active' : ''}`}
                  onClick={() => setViewMode('gantt')}
                >
                  {t('view.lane')}
                </button>
                <button
                  className={`view-tab ${viewMode === 'kanban' ? 'active' : ''}`}
                  onClick={() => setViewMode('kanban')}
                >
                  {t('view.gantt')}
                </button>
              </div>
              <ScheduleControls
                durationMode={durationMode}
                onDurationModeChange={handleDurationModeChange}
                projectIdPresent={Boolean(projectId)}
                schedule={schedule}
              />
              {projectId && (
                <ScenarioPanel
                  projectId={projectId}
                  durationMode={durationMode}
                  activeScenarioId={activeScenarioId}
                  onActiveChange={(id, snapshot, name) => {
                    setActiveScenarioId(id);
                    setActiveScenarioSnapshot(snapshot);
                    setActiveScenarioName(name);
                  }}
                />
              )}
              {/* Default deadline-mode view is the Uncertainty Lane (the
                  redesign's core innovation): each task renders an O→P
                  envelope with the most-likely M solid inside it. The
                  legacy Gantt sits behind the second tab for users who
                  want a single-line timeline. */}
              {viewMode === 'gantt' && (
                <UncertaintyLane
                  items={scheduleItems}
                  tasks={tasks}
                  cpSet={cpSet}
                  milestones={milestones}
                  projectStart={project?.startDate}
                  overlay={
                    activeScenarioId && activeScenarioSnapshot
                      ? {
                          items: activeScenarioSnapshot.items,
                          name: activeScenarioName || '',
                        }
                      : undefined
                  }
                />
              )}
              {viewMode === 'kanban' && (
                <Gantt
                  items={scheduleItems}
                  tasks={tasks}
                  cpSet={cpSet}
                  milestones={milestones}
                  overlay={
                    activeScenarioId && activeScenarioSnapshot
                      ? {
                          items: activeScenarioSnapshot.items,
                          name: activeScenarioName || '',
                        }
                      : undefined
                  }
                />
              )}
            </section>
          )}

          {/* Foot: optional retrospective. Collapsed by default — heavy block
              of stats most days don't need to see. */}
          <div className="page-foot-toggles">
            <button
              type="button"
              className="page-foot-toggle"
              onClick={() => setShowReview((v) => !v)}
              aria-expanded={showReview}
            >
              {showReview ? '↑ ' : '↓ '}{t('review.panel')}
            </button>
          </div>
          {showReview && (
            <section className="card">
              <ReviewReport
                tasks={tasks}
                schedule={schedule}
                notes={projectNotes}
                projectName={project?.name || 'Project'}
                onAddTask={canWriteActiveWorkspace ? handleNewTask : undefined}
              />
            </section>
          )}
          </>
          )}
        </>
      )}

    </>
  );
}
