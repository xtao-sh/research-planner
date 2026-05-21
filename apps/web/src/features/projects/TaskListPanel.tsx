import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ScheduleResult, Task, TimeframeBucket } from '@rp/shared';
import { TIMEFRAME_BUCKETS } from '@rp/shared';
import { StaleBadge } from '../tasks/StaleBadge';
import { TimeframeBadge } from '../tasks/TimeframeBadge';
import { FocusPinButton } from '../tasks/FocusPinButton';
import { STATUS_COLOR } from '../tasks/statusMeta';
import { deriveIntensity } from '../../shared/intensity';

interface TaskListPanelProps {
  tasks: Task[]; // already sorted by priority
  scheduleItems: ScheduleResult['items'];
  cpSet: Set<string>;
  isDeadlineMode: boolean;
  selectedTaskId: string | null;
  updatingTaskId: string | null;
  canWriteActiveWorkspace: boolean;
  onSelect: (taskId: string) => void;
  onNewTask: () => void;
  /** Optional — if provided, renders a small "Tree" button beside "New task". */
  onShowTree?: () => void;
  onToggleFocus: (taskId: string, focused: boolean) => void;
  /** Called when the user drops a task into a new position WITHIN the same
   *  parent. Receives the full sibling-id list in the new desired order. */
  onReorder?: (taskIds: string[]) => void;
  /** Called by Tab / Shift+Tab keyboard nest/outdent. The caller computes
   *  the new parent + sibling order and PUTs the result. */
  onNest?: (taskId: string) => void;
  onOutdent?: (taskId: string) => void;
  renderInlineEditor?: (task: Task) => React.ReactNode;
  renderNewInlineEditor?: () => React.ReactNode;
  creatingNew?: boolean;
}

/**
 * Project task list. Renders a depth-first tree (parents → children) with:
 *  - Drag-to-reorder within a sibling group (the ⋮⋮ handle on each row).
 *  - Tab on a focused row → nest as a subtask of the row directly above.
 *  - Shift+Tab → outdent (promote to grandparent / root).
 *  - Each child row shows its parent name inline as "↳ under «Parent»" so
 *    the relationship is text-explicit (the indent alone wasn't enough).
 *  - Chevron toggle on rows with children to collapse/expand the subtree.
 *
 * Drag-to-NEST was attempted (delta.x threshold) and removed — dnd-kit's
 * verticalListSortingStrategy clamps horizontal motion of the dragged
 * element, so the gesture was unreliable. Keyboard + the parent picker in
 * the inline editor are the working paths.
 */
export function TaskListPanel({
  tasks,
  scheduleItems,
  cpSet,
  isDeadlineMode,
  selectedTaskId,
  updatingTaskId,
  canWriteActiveWorkspace,
  onSelect,
  onNewTask,
  onShowTree,
  onToggleFocus,
  onReorder,
  onNest,
  onOutdent,
  renderInlineEditor,
  renderNewInlineEditor,
  creatingNew,
}: TaskListPanelProps) {
  const { t } = useTranslation();

  const sensors = useSensors(
    // Require an 8px drag before starting — keeps clicks-to-select snappy.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Per-project collapse state. We persist TWO sets: collapsed parent
  // tasks (for the chevron toggle on rows that have children) and
  // collapsed status sections (for the section headers below).
  const projectId = tasks[0]?.projectId;
  const collapseStorageKey = projectId
    ? `rp.tasks.collapsed.${projectId}`
    : null;
  const sectionStorageKey = projectId
    ? `rp.tasks.sections.${projectId}`
    : null;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (!collapseStorageKey || typeof window === 'undefined') return new Set();
    try {
      const v = window.sessionStorage.getItem(collapseStorageKey);
      return v ? new Set(JSON.parse(v) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (!collapseStorageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        collapseStorageKey,
        JSON.stringify([...collapsed])
      );
    } catch {
      /* quota / privacy */
    }
  }, [collapseStorageKey, collapsed]);
  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // Status sections: collapsed by default for 'done' (history); user can
  // fold others. Persisted per-project in sessionStorage. The string type
  // (instead of Task['status']) is widened so the synthetic 'today' lens
  // can share the same collapse-set + persistence path.
  type SectionKey = Task['status'] | 'today';
  const [sectionCollapsed, setSectionCollapsed] = useState<Set<SectionKey>>(
    () => {
      if (!sectionStorageKey || typeof window === 'undefined')
        return new Set<SectionKey>(['done']);
      try {
        const v = window.sessionStorage.getItem(sectionStorageKey);
        if (v) return new Set(JSON.parse(v) as SectionKey[]);
        return new Set<SectionKey>(['done']);
      } catch {
        return new Set<SectionKey>(['done']);
      }
    }
  );
  useEffect(() => {
    if (!sectionStorageKey || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(
        sectionStorageKey,
        JSON.stringify([...sectionCollapsed])
      );
    } catch {
      /* quota / privacy */
    }
  }, [sectionStorageKey, sectionCollapsed]);
  function toggleSection(s: SectionKey) {
    setSectionCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  // Timeframe filter — null = no filter (show all), 'none' = show only
  // bucketless tasks, otherwise show only tasks with this bucket. The
  // chip row only renders when at least one task in the project has a
  // bucket; users who don't use the feature never see it.
  const [bucketFilter, setBucketFilter] = useState<TimeframeBucket | 'none' | null>(null);
  const anyBucketed = useMemo(
    () => tasks.some((t) => Boolean(t.timeframeBucket)),
    [tasks]
  );
  // Per-bucket counts for the chip badges. Excludes done tasks so the
  // counts match the typical user mental model ("how many active tasks
  // are in this bucket").
  const bucketCounts = useMemo(() => {
    const out: Record<TimeframeBucket | 'none', number> = {
      week: 0, month: 0, quarter: 0, year: 0, someday: 0, none: 0,
    };
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const b = t.timeframeBucket;
      if (b) out[b]++;
      else out.none++;
    }
    return out;
  }, [tasks]);
  const filteredTasks = useMemo(() => {
    if (bucketFilter === null) return tasks;
    if (bucketFilter === 'none') return tasks.filter((t) => !t.timeframeBucket);
    return tasks.filter((t) => t.timeframeBucket === bucketFilter);
  }, [tasks, bucketFilter]);

  function handleDragEnd(event: DragEndEvent) {
    if (!onReorder) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromTask = tasks.find((t) => t.id === active.id);
    const toTask = tasks.find((t) => t.id === over.id);
    if (!fromTask || !toTask) return;
    // Drag is constrained per section (each status group is its own
    // SortableContext) so cross-section drags don't fire here. Reorder
    // within the status group; priorities of other-status tasks are left
    // untouched.
    if (fromTask.status !== toTask.status) return;
    const sectionTasks = tasks
      .filter((t) => t.status === fromTask.status)
      .sort((a, b) => a.priority - b.priority);
    const oldIdx = sectionTasks.findIndex((t) => t.id === active.id);
    const newIdx = sectionTasks.findIndex((t) => t.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    // No-op drag (released onto self after dnd-kit's collision falls back).
    if (oldIdx === newIdx) return;
    const reordered = arrayMove(sectionTasks, oldIdx, newIdx);
    onReorder(reordered.map((t) => t.id));
  }

  const dndDisabled = !canWriteActiveWorkspace || !onReorder;

  // Group tasks by status into sections. Within each section, tasks are
  // sorted by priority. We render flat (no depth indent) — the inline
  // "↳ 属于 «Parent»" breadcrumb provides hierarchy info textually.
  // Section order: doing first (active work), then blocked (urgent flag),
  // then todo (queue), then review, then done (history, collapsed by default).
  const SECTION_ORDER: Task['status'][] = [
    'doing',
    'blocked',
    'todo',
    'review',
    'done',
  ];
  const { todayTasks, sections, childCount, parentTitleById } = useMemo(() => {
    const titleById = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const tk of filteredTasks) {
      titleById.set(tk.id, tk.title);
      if (tk.parentTaskId) {
        counts.set(tk.parentTaskId, (counts.get(tk.parentTaskId) ?? 0) + 1);
      }
    }
    // Today lens: pinned (focusedAt) OR soft-due within 2 days. We render
    // these in a vermilion section ABOVE the status sections and suppress
    // their re-appearance below — every task shows up exactly once.
    // Mitigation against over-organizing small projects: only render the
    // Today section when (a) there's at least one such task AND (b) the
    // total non-done count is ≥ 6. Below that threshold, the regular
    // status sections + the focus star already do the job.
    const now = Date.now();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    const candidateToday = filteredTasks.filter((tk) => {
      if (tk.status === 'done') return false;
      if (tk.focusedAt) return true;
      if (tk.dueSoft) {
        const t = new Date(tk.dueSoft).getTime();
        return t - now <= TWO_DAYS;
      }
      return false;
    });
    const nonDone = filteredTasks.filter((tk) => tk.status !== 'done').length;
    const todayList: Task[] =
      candidateToday.length > 0 && nonDone >= 6
        ? candidateToday.slice().sort((a, b) => a.priority - b.priority)
        : [];
    const todaySet = new Set(todayList.map((t) => t.id));

    const byStatus = new Map<Task['status'], Task[]>();
    for (const s of SECTION_ORDER) byStatus.set(s, []);
    for (const tk of filteredTasks) {
      if (todaySet.has(tk.id)) continue; // shown in Today section
      const arr = byStatus.get(tk.status);
      if (arr) arr.push(tk);
    }
    for (const arr of byStatus.values()) {
      arr.sort((a, b) => a.priority - b.priority);
    }
    const out = SECTION_ORDER.map((s) => ({
      status: s,
      tasks: byStatus.get(s) ?? [],
    }));
    return {
      todayTasks: todayList,
      sections: out,
      childCount: counts,
      parentTitleById: titleById,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks]);

  return (
    <div className="card">
      <div className="task-list-header">
        <h3>{t('task.list')}</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onShowTree && (
            <button
              type="button"
              onClick={onShowTree}
              className="rd-btn rd-btn-sm"
            >
              {t('tree.openTree')}
            </button>
          )}
          {canWriteActiveWorkspace && (
            <button
              type="button"
              onClick={onNewTask}
              className="btn-new-task"
            >
              {t('task.newTask')}
            </button>
          )}
        </div>
      </div>
      {/* Caption — teaches the keyboard shortcuts unobtrusively. */}
      {(onNest || onOutdent) && (
        <p className="task-list-caption">{t('task.listCaption')}</p>
      )}
      {anyBucketed && (
        <div
          className="rd-tf-group"
          role="toolbar"
          aria-label={t('timeframe.label')}
          style={{ padding: '6px 14px 2px' }}
        >
          <button
            type="button"
            className="rd-tf-chip"
            aria-pressed={bucketFilter === null}
            onClick={() => setBucketFilter(null)}
          >
            <span>{t('timeframe.filterAll')}</span>
          </button>
          {TIMEFRAME_BUCKETS.map((b) => {
            const n = bucketCounts[b];
            if (n === 0 && bucketFilter !== b) return null;
            return (
              <button
                key={b}
                type="button"
                className="rd-tf-chip"
                data-bucket={b}
                aria-pressed={bucketFilter === b}
                onClick={() => setBucketFilter(bucketFilter === b ? null : b)}
              >
                <span
                  className="rd-tf-chip-dot"
                  data-bucket={b}
                  aria-hidden="true"
                />
                <span>{t(`timeframe.buckets.${b}` as const)}</span>
                <span style={{ opacity: 0.7, marginLeft: 2 }}>{n}</span>
              </button>
            );
          })}
          {bucketCounts.none > 0 && (
            <button
              type="button"
              className="rd-tf-chip"
              aria-pressed={bucketFilter === 'none'}
              onClick={() => setBucketFilter(bucketFilter === 'none' ? null : 'none')}
            >
              <span>{t('timeframe.filterNone')}</span>
              <span style={{ opacity: 0.7, marginLeft: 2 }}>
                {bucketCounts.none}
              </span>
            </button>
          )}
        </div>
      )}
      {creatingNew && renderNewInlineEditor && (
        <div className="task-inline-editor-new">
          {renderNewInlineEditor()}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        {tasks.length === 0 && (
          <div className="task-list-empty">
            <p>{t('task.empty')}</p>
            <p className="empty-state-hint">{t('task.emptyHint')}</p>
          </div>
        )}
        {todayTasks.length > 0 && (() => {
          const isCollapsed = sectionCollapsed.has('today');
          return (
            <section
              className="task-section task-section--today"
              data-status="today"
            >
              <button
                type="button"
                className="task-section-header"
                onClick={() => toggleSection('today')}
                aria-expanded={!isCollapsed}
              >
                <span className="task-section-chevron" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span
                  className="task-section-dot task-section-dot--today"
                  aria-hidden="true"
                />
                <span className="task-section-label">
                  ★ {t('task.todayFocus')}
                </span>
                <span className="task-section-count">{todayTasks.length}</span>
              </button>
              {!isCollapsed && (
                <SortableContext
                  items={todayTasks.map((tk) => tk.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="task-list">
                    {todayTasks.map((tk) => {
                      const plan = scheduleItems.find(
                        (it) => it.taskId === tk.id
                      );
                      const isOnCriticalPath = cpSet.has(tk.id);
                      const hasDeadlineRisk = (() => {
                        if (!tk.dueHard || !plan) return false;
                        const hardDate = new Date(tk.dueHard).getTime();
                        const endPlanned = new Date(plan.endPlanned).getTime();
                        return endPlanned > hardDate;
                      })();
                      const parentTitle = tk.parentTaskId
                        ? parentTitleById.get(tk.parentTaskId) ?? null
                        : null;
                      const childN = childCount.get(tk.id) ?? 0;
                      return (
                        <SortableTaskRow
                          key={tk.id}
                          task={tk}
                          depth={0}
                          parentTitle={parentTitle}
                          childCount={childN}
                          isCollapsed={collapsed.has(tk.id)}
                          onToggleCollapse={() => toggleCollapsed(tk.id)}
                          plan={plan}
                          isOnCriticalPath={isOnCriticalPath}
                          hasDeadlineRisk={hasDeadlineRisk}
                          isDeadlineMode={isDeadlineMode}
                          isSelected={tk.id === selectedTaskId}
                          isUpdating={updatingTaskId === tk.id}
                          canWrite={canWriteActiveWorkspace}
                          onSelect={onSelect}
                          onToggleFocus={onToggleFocus}
                          onNest={onNest}
                          onOutdent={onOutdent}
                          renderInlineEditor={renderInlineEditor}
                          dndDisabled={dndDisabled}
                          t={t}
                        />
                      );
                    })}
                  </ul>
                </SortableContext>
              )}
            </section>
          );
        })()}
        {sections.map(({ status, tasks: groupTasks }) => {
          // Hide empty groups — only render sections that have content.
          if (groupTasks.length === 0) return null;
          const isCollapsed = sectionCollapsed.has(status);
          const statusLabel = t(`task.statusLabels.${status}`);
          return (
            <section key={status} className="task-section" data-status={status}>
              <button
                type="button"
                className="task-section-header"
                onClick={() => toggleSection(status)}
                aria-expanded={!isCollapsed}
              >
                <span className="task-section-chevron" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span
                  className="task-section-dot"
                  aria-hidden="true"
                  style={{ background: STATUS_COLOR[status] }}
                />
                <span className="task-section-label">{statusLabel}</span>
                <span className="task-section-count">{groupTasks.length}</span>
              </button>
              {!isCollapsed && (
                <SortableContext
                  items={groupTasks.map((tk) => tk.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="task-list">
                    {groupTasks.map((tk) => {
                      const plan = scheduleItems.find(
                        (it) => it.taskId === tk.id
                      );
                      const isOnCriticalPath = cpSet.has(tk.id);
                      const hasDeadlineRisk = (() => {
                        if (!tk.dueHard || !plan) return false;
                        const hardDate = new Date(tk.dueHard).getTime();
                        const endPlanned = new Date(plan.endPlanned).getTime();
                        return endPlanned > hardDate;
                      })();
                      const parentTitle = tk.parentTaskId
                        ? parentTitleById.get(tk.parentTaskId) ?? null
                        : null;
                      const childN = childCount.get(tk.id) ?? 0;
                      return (
                        <SortableTaskRow
                          key={tk.id}
                          task={tk}
                          depth={0}
                          parentTitle={parentTitle}
                          childCount={childN}
                          isCollapsed={collapsed.has(tk.id)}
                          onToggleCollapse={() => toggleCollapsed(tk.id)}
                          plan={plan}
                          isOnCriticalPath={isOnCriticalPath}
                          hasDeadlineRisk={hasDeadlineRisk}
                          isDeadlineMode={isDeadlineMode}
                          isSelected={tk.id === selectedTaskId}
                          isUpdating={updatingTaskId === tk.id}
                          canWrite={canWriteActiveWorkspace}
                          onSelect={onSelect}
                          onToggleFocus={onToggleFocus}
                          onNest={onNest}
                          onOutdent={onOutdent}
                          renderInlineEditor={renderInlineEditor}
                          dndDisabled={dndDisabled}
                          t={t}
                        />
                      );
                    })}
                  </ul>
                </SortableContext>
              )}
            </section>
          );
        })}
      </DndContext>
    </div>
  );
}

interface SortableTaskRowProps {
  task: Task;
  depth: number;
  parentTitle: string | null;
  childCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  plan: ScheduleResult['items'][number] | undefined;
  isOnCriticalPath: boolean;
  hasDeadlineRisk: boolean;
  isDeadlineMode: boolean;
  isSelected: boolean;
  isUpdating: boolean;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onToggleFocus: (id: string, focused: boolean) => void;
  onNest?: (id: string) => void;
  onOutdent?: (id: string) => void;
  renderInlineEditor?: (task: Task) => React.ReactNode;
  dndDisabled: boolean;
  t: TFunction;
}

function SortableTaskRow({
  task: tk,
  depth,
  parentTitle,
  childCount,
  isCollapsed,
  onToggleCollapse,
  plan,
  isOnCriticalPath,
  hasDeadlineRisk,
  isDeadlineMode,
  isSelected,
  isUpdating,
  canWrite,
  onSelect,
  onToggleFocus,
  onNest,
  onOutdent,
  renderInlineEditor,
  dndDisabled,
  t,
}: SortableTaskRowProps) {
  const { i18n } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tk.id, disabled: dndDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // Direct paddingLeft (no CSS-var indirection) — bulletproof against
    // dnd-kit's transform wrappers. 24px per depth level.
    paddingLeft: `${depth * 24}px`,
  };

  const typeIcons: Record<Task['type'], string> = {
    thinking: 'TH',
    reading: 'RD',
    research: 'RS',
    experiment: 'EX',
    coding: 'CD',
    analysis: 'AN',
    writing: 'WR',
    communication: 'CM',
    admin: 'AD',
  };
  const statusColors = STATUS_COLOR;

  // Tab / Shift+Tab nest/outdent. Only fires when focus is on the row itself
  // (the role="button" task-item-clickable div), NOT inside an input or
  // textarea — so editing the inline-editor isn't disrupted.
  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(tk.id);
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && onNest) {
      e.preventDefault();
      onNest(tk.id);
      return;
    }
    if (e.key === 'Tab' && e.shiftKey && onOutdent) {
      e.preventDefault();
      onOutdent(tk.id);
      return;
    }
  }

  const hasChildren = childCount > 0;

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-depth={depth}
      className={`task-item-enhanced ${isSelected ? 'selected' : ''} ${
        depth > 0 ? 'task-item-subtask' : ''
      } ${hasChildren ? 'task-item-parent' : ''} ${
        tk.focusedAt ? 'focused' : ''
      }`}
    >
      {/* Inline parent reference — names the parent explicitly. The single
          most disambiguating cue: indent alone can't tell you WHOSE child. */}
      {depth > 0 && parentTitle && (
        <div className="task-parent-ref" aria-hidden="true">
          ↳ {t('task.under')}{' '}
          <span className="task-parent-name">{parentTitle}</span>
        </div>
      )}
      <div className="task-item-content">
        {!dndDisabled && (
          <button
            type="button"
            className="task-drag-handle"
            aria-label={t('task.dragHandle')}
            title={t('task.dragHandle')}
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        )}
        {/* Chevron — visible only on parent rows. Click toggles collapse. */}
        {hasChildren ? (
          <button
            type="button"
            className="task-chevron"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? t('task.expandChildren', { n: childCount })
                : t('task.collapseChildren', { n: childCount })
            }
            title={
              isCollapsed
                ? t('task.expandChildren', { n: childCount })
                : t('task.collapseChildren', { n: childCount })
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="task-chevron task-chevron--placeholder" aria-hidden="true" />
        )}
        <div
          role="button"
          tabIndex={0}
          className="task-item-clickable"
          onClick={() => onSelect(tk.id)}
          onKeyDown={handleRowKeyDown}
        >
          <div
            className="task-indicator"
            style={{ backgroundColor: statusColors[tk.status] }}
          />
          <div className="task-main">
            {/* Two-zone row: title left (the protagonist), metadata cluster
                right (size, date, due, badges, star) — all demoted to a
                quiet ink-500 mono register. The status word + monogram
                were dropped: the section header + leading 8px block
                already encode status; restating it three times was noise. */}
            <div className="task-header-row">
              <span className="task-type-letter" aria-hidden="true" title={tk.type}>
                {typeIcons[tk.type]}
              </span>
              <span
                className={`task-title-enhanced ${hasChildren ? 'task-title--parent' : ''}`}
              >
                {tk.title}
              </span>
              {hasChildren && isCollapsed && (
                <span className="task-collapsed-count" aria-label={t('task.collapsedHidden', { n: childCount })}>
                  {t('task.subtaskCount', { n: childCount })}
                </span>
              )}
              <span className="task-meta-cluster">
                {/* Size chip + intensity bars: same atoms the Flow Board uses
                    so a task reads visually identical across both views. */}
                <span className="rd-size-chip" aria-label={t(`task.size.${tk.size ?? 'm'}` as const)}>
                  {(tk.size ?? 'm').toUpperCase()}
                </span>
                <span
                  className="rd-intensity"
                  data-level={deriveIntensity(tk)}
                  aria-label={`intensity ${deriveIntensity(tk)}`}
                >
                  <span className="rd-bar" />
                  <span className="rd-bar" />
                  <span className="rd-bar" />
                  <span className="rd-bar" />
                  <span className="rd-bar" />
                </span>
                {plan && (
                  <span className="task-meta-item task-meta-date">
                    {new Date(plan.endPlanned).toLocaleString(i18n.language, {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
                {tk.dueHard && (
                  <span
                    className="task-meta-item task-meta-due"
                    style={{ color: hasDeadlineRisk ? 'var(--danger-color)' : undefined }}
                    title={t('task.dueHard')}
                  >
                    ⏰ {new Date(tk.dueHard).toLocaleDateString(i18n.language, {
                      month: '2-digit',
                      day: '2-digit',
                    })}
                  </span>
                )}
                {isDeadlineMode && isOnCriticalPath && (
                  <span className="badge badge-critical" title={t('task.criticalPathBadge')}>
                    CP
                  </span>
                )}
                {isDeadlineMode && hasDeadlineRisk && (
                  <span className="badge badge-warning" title={t('task.deadlineRisk')}>
                    {t('task.delayed')}
                  </span>
                )}
                {tk.timeframeBucket && (
                  <TimeframeBadge
                    bucket={tk.timeframeBucket}
                    anchor={tk.timeframeAnchor}
                    variant="full"
                    showCountdown={false}
                  />
                )}
                <StaleBadge task={tk} />
                <FocusPinButton
                  focused={Boolean(tk.focusedAt)}
                  onToggle={() => onToggleFocus(tk.id, !tk.focusedAt)}
                />
              </span>
            </div>
            {isUpdating && (
              <div className="task-updating-indicator">
                <span className="spinner"></span>
                {t('task.updating')}
              </div>
            )}
          </div>
        </div>
      </div>
      {isSelected && renderInlineEditor ? renderInlineEditor(tk) : null}
    </li>
  );
}
