import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from '@rp/shared';
import { StaleBadge } from '../features/tasks/StaleBadge';
import { FocusPinButton } from '../features/tasks/FocusPinButton';
import { TimeframeBadge } from '../features/tasks/TimeframeBadge';
import { SizeChip } from '../features/tasks/SizeChip';
import { IntensityBars } from '../features/tasks/IntensityBars';

interface KanbanViewProps {
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void | Promise<void>;
  onToggleFocus?: (taskId: string, focused: boolean) => void;
  /** Called when cards are reordered within a single status column. The
   *  caller persists priorities (e.g. via reorderTasks). */
  onReorder?: (status: Task['status'], taskIds: string[]) => void;
  /** Per-status WIP limits. Each value is `null`/`undefined` to disable the
   *  badge or a positive number to enforce a soft cap (badge turns red when
   *  exceeded). When the prop is omitted entirely, defaults to a soft cap
   *  of 3 on `doing` to preserve existing behavior. */
  wipLimits?: Partial<Record<Task['status'], number | null | undefined>>;
}

const STATUS_LIST: Task['status'][] = ['todo', 'doing', 'blocked', 'review', 'done'];

export function KanbanView({
  tasks,
  onTaskClick,
  onStatusChange,
  onToggleFocus,
  onReorder,
  wipLimits,
}: KanbanViewProps) {
  const { t } = useTranslation();

  const statusColumns: { status: Task['status']; title: string; icon: string }[] = [
    { status: 'todo', title: t('kanban.todo'), icon: '📋' },
    { status: 'doing', title: t('kanban.doing'), icon: '🚀' },
    { status: 'blocked', title: t('kanban.blocked'), icon: '🚫' },
    { status: 'review', title: t('kanban.review'), icon: '🔍' },
    { status: 'done', title: t('kanban.done'), icon: '✅' },
  ];

  // Local optimistic order/status — dnd updates this immediately and the
  // upstream callbacks (onStatusChange / onReorder) reconcile after the
  // server roundtrip via parent re-render. We keep this in addition to the
  // `tasks` prop so the dragged card lands without a snap-back.
  const [localTasks, setLocalTasks] = useState<Task[]>(tasks);
  const [activeId, setActiveIdInternal] = useState<string | null>(null);
  // Wrap setActiveId so the prop-sync effect can read the latest drag
  // state without listing it as a dep (avoids an extra re-sync round).
  const activeIdRef = React.useRef<string | null>(null);
  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveIdInternal(id);
  }, []);
  React.useEffect(() => {
    // Don't clobber an in-flight optimistic state mid-drag — wait for
    // the drag to settle and let the next `tasks` prop update reconcile.
    if (activeIdRef.current) return;
    setLocalTasks(tasks);
  }, [tasks]);

  const tasksByStatus = useMemo(() => {
    const grouped = new Map<Task['status'], Task[]>();
    STATUS_LIST.forEach((s) => grouped.set(s, []));
    localTasks.forEach((task) => {
      const list = grouped.get(task.status) || [];
      list.push(task);
      grouped.set(task.status, list);
    });
    return grouped;
  }, [localTasks]);

  const getTypeLabel = (type: Task['type']): string => {
    switch (type) {
      case 'thinking': return t('kanban.typeThinking');
      case 'reading': return t('kanban.typeReading');
      case 'research': return t('kanban.typeResearch');
      case 'experiment': return t('kanban.typeExperiment');
      case 'coding': return t('kanban.typeCoding');
      case 'analysis': return t('kanban.typeAnalysis');
      case 'writing': return t('kanban.typeWriting');
      case 'communication': return t('kanban.typeCommunication');
      case 'admin': return t('kanban.typeAdmin');
      default: return '';
    }
  };

  const sensors = useSensors(
    // 8px activation distance: under that it's a click (onTaskClick still
    // fires); above, the drag begins. Same constraint TaskListPanel uses.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Space (not Enter) picks up / drops a card for keyboard reordering.
    // Freeing Enter lets it OPEN the focused card's details — previously
    // dnd-kit claimed both Enter and Space, so there was no keyboard path
    // to open a task from the board at all (a11y P1).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space'],
      },
    })
  );

  const dndDisabled = !onStatusChange && !onReorder;

  // Track which column we're hovering over during a drag, for the subtle
  // background highlight on the drop target.
  const [overColumn, setOverColumn] = useState<Task['status'] | null>(null);
  const activeTask = useMemo(
    () => (activeId ? localTasks.find((t) => t.id === activeId) ?? null : null),
    [activeId, localTasks]
  );

  function findContainer(id: string): Task['status'] | null {
    // The id is either a column id (one of STATUS_LIST) or a task id.
    if ((STATUS_LIST as string[]).includes(id)) return id as Task['status'];
    const task = localTasks.find((t) => t.id === id);
    return task ? task.status : null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) {
      setOverColumn(null);
      return;
    }
    setOverColumn(findContainer(String(over.id)));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setOverColumn(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const fromStatus = findContainer(activeId);
    const toStatus = findContainer(overId);
    if (!fromStatus || !toStatus) return;

    if (fromStatus !== toStatus) {
      // Cross-column drop → status change. Optimistic local move first;
      // parent will re-render via onStatusChange roundtrip. If the call
      // rejects, we roll back the local move so the card snaps back.
      const previousTasks = localTasks;
      setLocalTasks((prev) =>
        prev.map((tk) => (tk.id === activeId ? { ...tk, status: toStatus } : tk))
      );
      Promise.resolve(onStatusChange?.(activeId, toStatus)).catch(() => {
        setLocalTasks(previousTasks);
      });
      return;
    }

    // Within-column reorder. Skip if dropped on itself.
    if (activeId === overId) return;
    const sectionTasks = (tasksByStatus.get(fromStatus) ?? []).slice();
    const oldIdx = sectionTasks.findIndex((t) => t.id === activeId);
    const newIdx = sectionTasks.findIndex((t) => t.id === overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sectionTasks, oldIdx, newIdx);
    // Optimistic: rewrite priorities locally so the moved card sticks.
    setLocalTasks((prev) => {
      const idx = new Map(reordered.map((tk, i) => [tk.id, i + 1] as const));
      return prev.map((tk) =>
        idx.has(tk.id) ? { ...tk, priority: idx.get(tk.id)! } : tk
      );
    });
    onReorder?.(fromStatus, reordered.map((t) => t.id));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setOverColumn(null);
      }}
    >
      <div className="rd-flow-board">
        {statusColumns.map((column) => {
          const columnTasks = tasksByStatus.get(column.status) || [];
          // wipLimits prop overrides per-status. Falsy values (null/undefined)
          // disable the badge for that column. When the prop is omitted
          // entirely (typeof === 'undefined'), preserve the original
          // hardcoded soft cap of 3 on `doing`.
          const wipLimit =
            wipLimits === undefined
              ? column.status === 'doing'
                ? 3
                : null
              : wipLimits[column.status] ?? null;
          const isOver = overColumn === column.status && activeId !== null;
          return (
            <KanbanColumn
              key={column.status}
              status={column.status}
              title={column.title}
              count={columnTasks.length}
              wipLimit={wipLimit}
              isOver={isOver}
              taskIds={columnTasks.map((t) => t.id)}
            >
              {columnTasks.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    color: 'var(--rd-ink-3)',
                    padding: '14px 6px',
                    fontSize: 12,
                  }}
                >
                  —
                </div>
              ) : (
                columnTasks.map((task) => {
                  const isFocused = Boolean(task.focusedAt);
                  return (
                    <SortableFlowCard
                      key={task.id}
                      task={task}
                      isFocused={isFocused}
                      typeLabel={getTypeLabel(task.type)}
                      dueHardLabel={t('task.dueHard')}
                      onClick={() => onTaskClick?.(task.id)}
                      onToggleFocus={onToggleFocus}
                      dndDisabled={dndDisabled}
                      hideForOverlay={activeId === task.id}
                    />
                  );
                })
              )}
            </KanbanColumn>
          );
        })}
      </div>
      {/* DragOverlay — portal-rendered clone of the dragged card. Without
          this the source card gets clipped by the column's bounds when
          the cursor crosses into a neighboring column, so it briefly
          "disappears" mid-drag. The overlay floats at the cursor position
          regardless of which column is currently under the pointer. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div
            className={`rd-flow-card ${activeTask.focusedAt ? 'focused' : ''}`}
            style={{
              cursor: 'grabbing',
              boxShadow: 'var(--rd-shadow-3)',
              transform: 'rotate(1.5deg)',
            }}
          >
            <div className="rd-title">{activeTask.title}</div>
            <div className="rd-foot">
              <SizeChip size={activeTask.size} />
              <IntensityBars task={activeTask} />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface KanbanColumnProps {
  status: Task['status'];
  title: string;
  count: number;
  wipLimit: number | null;
  isOver: boolean;
  taskIds: string[];
  children: React.ReactNode;
}

function KanbanColumn({
  status,
  title,
  count,
  wipLimit,
  isOver,
  taskIds,
  children,
}: KanbanColumnProps) {
  // The column itself is a droppable so empty columns still accept drops.
  const { setNodeRef } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rd-flow-col${isOver ? ' is-drop-target' : ''}`}
      data-status={status}
    >
      <div className="rd-flow-col-head">
        <span
          className="rd-dot"
          aria-hidden="true"
          style={{ background: `var(--rd-st-${status})` }}
        />
        <span className="rd-label">{title}</span>
        <span className="rd-count">{count}</span>
        {wipLimit !== null && (
          <span className={`rd-wip${count > wipLimit ? ' over' : ''}`}>
            WIP {count}/{wipLimit}
          </span>
        )}
      </div>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </div>
  );
}

interface SortableFlowCardProps {
  task: Task;
  isFocused: boolean;
  typeLabel: string;
  dueHardLabel: string;
  onClick: () => void;
  onToggleFocus?: (taskId: string, focused: boolean) => void;
  dndDisabled: boolean;
  /** When true, the card is being drawn by the DragOverlay portal — hide
   *  this in-place copy so the only visible representation is the overlay
   *  floating at the cursor. Prevents the card from clipping/disappearing
   *  at column boundaries. */
  hideForOverlay?: boolean;
}

const SortableFlowCard = React.memo(
  function SortableFlowCard({
  task,
  isFocused,
  typeLabel,
  dueHardLabel,
  onClick,
  onToggleFocus,
  dndDisabled,
  hideForOverlay,
}: SortableFlowCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dndDisabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While the DragOverlay clone is the visible representation, the
    // in-place card is invisible but still occupies its slot so other
    // cards don't reflow underneath the cursor.
    opacity: hideForOverlay || isDragging ? 0 : 1,
    visibility: hideForOverlay || isDragging ? 'hidden' : 'visible',
    cursor: dndDisabled ? undefined : 'grab',
  };

  // Compose dnd-kit's keydown (Space pickup) with an Enter-to-open handler.
  // The explicit onKeyDown below would otherwise shadow the one inside
  // `listeners`, so we call it through.
  const dndKeyDown = (listeners as { onKeyDown?: React.KeyboardEventHandler })
    ?.onKeyDown;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rd-flow-card ${isFocused ? 'focused' : ''}`}
      onClick={onClick}
      title={typeLabel}
      aria-label={`${task.title} — ${typeLabel}`}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick();
          return;
        }
        dndKeyDown?.(e);
      }}
    >
      <span className="rd-drag-handle" aria-hidden="true">⋮⋮</span>
      <div className="rd-title">{task.title}</div>
      {/* Card foot atoms ordered per the canonical row schema documented
          in features/tasks/rowMetadata.ts. Keep new atoms slotted into
          the right position rather than appending. */}
      <div className="rd-foot">
        <SizeChip size={task.size} />
        <IntensityBars task={task} />
        {task.timeframeBucket && (
          <TimeframeBadge
            bucket={task.timeframeBucket}
            anchor={task.timeframeAnchor}
            variant="compact"
          />
        )}
        {task.dueHard && (
          <span
            className="rd-age"
            style={{ color: 'var(--rd-st-blocked)', fontWeight: 600 }}
            title={dueHardLabel}
          >
            ⏰{' '}
            {new Date(task.dueHard).toLocaleDateString(undefined, {
              month: '2-digit',
              day: '2-digit',
            })}
          </span>
        )}
        <StaleBadge task={task} />
        {onToggleFocus && (
          // Focus star is interactive — stop propagation so clicking it
          // doesn't also fire the card's onClick (open-task) handler.
          // Pointer events on the wrapping span aren't intercepted by
          // dnd-kit listeners since the inner button toggles its own state.
          <span
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <FocusPinButton
              focused={isFocused}
              onToggle={() => onToggleFocus(task.id, !task.focusedAt)}
            />
          </span>
        )}
      </div>
      {task.status === 'doing' && (
        <div className="rd-progress" aria-hidden="true">
          <div
            className="rd-fill"
            style={{
              width: `${30 + (task.id.length * 7) % 50}%`,
            }}
          />
        </div>
      )}
    </div>
  );
  },
  (a, b) =>
    a.task === b.task &&
    a.isFocused === b.isFocused &&
    a.dndDisabled === b.dndDisabled &&
    a.hideForOverlay === b.hideForOverlay &&
    a.typeLabel === b.typeLabel &&
    a.dueHardLabel === b.dueHardLabel
);
