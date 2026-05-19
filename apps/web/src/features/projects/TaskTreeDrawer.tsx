import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Task } from '@rp/shared';
import { deriveIntensity } from '../../shared/intensity';

interface TaskTreeDrawerProps {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  projectName: string;
  /** When provided, tasks become draggable. Drop one row onto another to
   *  reparent. The parent component is responsible for cycle/depth checks
   *  beyond the local guard (server validates again). Pass null parentId to
   *  promote to root. */
  onReparent?: (taskId: string, newParentId: string | null) => void;
}

export function TaskTreeDrawer({
  open,
  onClose,
  tasks,
  projectName,
  onReparent,
}: TaskTreeDrawerProps) {
  const { t } = useTranslation();

  // Build parent → children map
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, Task[]>();
    for (const tk of tasks) {
      const key = tk.parentTaskId ?? null;
      const list = m.get(key) ?? [];
      list.push(tk);
      m.set(key, list);
    }
    // Sort each sibling group by priority
    for (const [, arr] of m) arr.sort((a, b) => a.priority - b.priority);
    return m;
  }, [tasks]);

  // Pre-compute descendants for cycle prevention.
  const descendantsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    function collect(id: string): Set<string> {
      const cached = map.get(id);
      if (cached) return cached;
      const out = new Set<string>();
      const kids = childrenOf.get(id) ?? [];
      for (const c of kids) {
        out.add(c.id);
        for (const d of collect(c.id)) out.add(d);
      }
      map.set(id, out);
      return out;
    }
    for (const tk of tasks) collect(tk.id);
    return map;
  }, [tasks, childrenOf]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap: keep Tab cycling inside the drawer. Without this Tab
  // escapes to the page underneath (which is also visually obscured by
  // the backdrop but reachable to screen readers and keyboards).
  const trapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !trapRef.current) return;
    const root = trapRef.current;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('inert'));
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    root.addEventListener('keydown', onKey);
    // Move focus into the drawer on open so Tab has a starting point.
    setTimeout(() => focusables()[0]?.focus(), 30);
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeTask = useMemo(
    () => (activeId ? tasks.find((tk) => tk.id === activeId) ?? null : null),
    [activeId, tasks]
  );

  function isInvalidDrop(draggedId: string, targetId: string): boolean {
    if (draggedId === targetId) return true;
    // Don't allow dropping into own descendant (cycle).
    const desc = descendantsOf.get(draggedId);
    if (desc?.has(targetId)) return true;
    // No-op if already its parent.
    const dragged = tasks.find((tk) => tk.id === draggedId);
    if (dragged && (dragged.parentTaskId ?? null) === targetId) return true;
    return false;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleDragOver(e: DragOverEvent) {
    setOverId(e.over ? String(e.over.id) : null);
  }
  function handleDragEnd(e: DragEndEvent) {
    const draggedId = activeId;
    const target = e.over ? String(e.over.id) : null;
    setActiveId(null);
    setOverId(null);
    if (!draggedId || !target) return;
    if (isInvalidDrop(draggedId, target)) return;
    onReparent?.(draggedId, target);
  }
  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
  }

  if (!open) return null;
  const roots = childrenOf.get(null) ?? [];
  const dragEnabled = Boolean(onReparent);

  const treeContent = (
    <>
      {/* tree */}
      <div className="card" style={{ padding: '8px 14px', marginTop: 10 }}>
        {roots.length === 0 ? (
          <p className="muted" style={{ padding: 12 }}>
            {t('task.empty')}
          </p>
        ) : (
          roots.map((tk) => (
            <TreeNode
              key={tk.id}
              task={tk}
              childrenOf={childrenOf}
              depth={0}
              dragEnabled={dragEnabled}
              activeId={activeId}
              overId={overId}
              isInvalidDrop={isInvalidDrop}
            />
          ))
        )}
      </div>
    </>
  );

  return (
    <div className="rd-capture-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${t('tree.eyebrow')} · ${projectName}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(960px, calc(100vw - 64px))',
          maxHeight: 'calc(100vh - 80px)',
          background: 'var(--rd-surface)',
          borderRadius: 12,
          boxShadow: 'var(--rd-shadow-3)',
          padding: 22,
          overflow: 'auto',
          marginTop: 80,
        }}
      >
        {/* header — title + close */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div className="rd-section-eyebrow" style={{ margin: 0 }}>
            {t('tree.eyebrow')} · {projectName}
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="rd-icon-btn"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        <p
          className="muted"
          style={{ fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}
        >
          {t('tree.subline')}
        </p>

        {/* legend */}
        <div className="rd-tree-legend">
          <span className="rd-tree-leg-item">
            <span
              className="rd-tree-leg-swatch"
              style={{ background: 'var(--rd-st-doing)' }}
            />{' '}
            {t('tree.legendActive')}
          </span>
          <span className="rd-tree-leg-item">
            <span
              className="rd-tree-leg-swatch"
              style={{ background: 'var(--rd-st-blocked)' }}
            />{' '}
            {t('tree.legendBlocked')}
          </span>
          <span className="rd-tree-leg-item">
            <span
              className="rd-tree-leg-swatch"
              style={{ background: 'var(--rd-st-done)' }}
            />{' '}
            {t('tree.legendDone')}
          </span>
          <span className="rd-tree-leg-item">
            <span
              className="rd-tree-leg-swatch"
              style={{ background: 'var(--rd-ink-4)' }}
            />{' '}
            {t('tree.legendOther')}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              color: 'var(--rd-ink-3)',
              fontSize: 11.5,
            }}
          >
            {t('tree.indentHint')}
          </span>
        </div>

        {dragEnabled ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {treeContent}
            <DragOverlay dropAnimation={null}>
              {activeTask ? (
                <div
                  className="rd-tree-row"
                  style={{
                    background: 'var(--rd-surface)',
                    border: '1px solid var(--rd-line-strong)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    boxShadow: 'var(--rd-shadow-3)',
                    transform: 'rotate(1deg)',
                    cursor: 'grabbing',
                  }}
                >
                  <span className="rd-tree-title">{activeTask.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          treeContent
        )}
      </div>
    </div>
  );
}

interface TreeNodeProps {
  task: Task;
  childrenOf: Map<string | null, Task[]>;
  depth: number;
  dragEnabled: boolean;
  activeId: string | null;
  overId: string | null;
  isInvalidDrop: (draggedId: string, targetId: string) => boolean;
}

function TreeNode({
  task,
  childrenOf,
  depth,
  dragEnabled,
  activeId,
  overId,
  isInvalidDrop,
}: TreeNodeProps) {
  const { t } = useTranslation();
  const kids = childrenOf.get(task.id) ?? [];
  // "stuck" — task is doing >7 days OR blocked
  const startedAtMs = task.startedAt
    ? new Date(task.startedAt).getTime()
    : null;
  const stuckDays =
    task.status === 'doing' && startedAtMs
      ? Math.floor((Date.now() - startedAtMs) / 86_400_000)
      : 0;
  const isBlocked = task.status === 'blocked';
  const showStuck = isBlocked || stuckDays >= 7;
  const intensityLevel = deriveIntensity(task);

  // Drag source
  const draggable = useDraggable({ id: task.id, disabled: !dragEnabled });
  // Drop target
  const droppable = useDroppable({ id: task.id, disabled: !dragEnabled });

  const isBeingDragged = activeId === task.id;
  const isOver = overId === task.id && activeId !== null && activeId !== task.id;
  const dropValid =
    activeId && isOver ? !isInvalidDrop(activeId, task.id) : false;

  // Compose refs: row is both draggable and droppable.
  const setRowRef = (el: HTMLDivElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };

  const rowStyle: React.CSSProperties = {
    cursor: dragEnabled ? 'grab' : undefined,
    opacity: isBeingDragged ? 0.4 : 1,
    outline: isOver
      ? `2px solid ${dropValid ? 'var(--accent)' : 'var(--rd-st-blocked)'}`
      : undefined,
    outlineOffset: isOver ? 2 : undefined,
    borderRadius: isOver ? 6 : undefined,
    position: 'relative',
  };

  return (
    <div className="rd-tree-node" data-depth={Math.min(3, depth)}>
      {depth > 0 && <span className="rd-tree-elbow" aria-hidden="true" />}
      <div
        ref={setRowRef}
        className="rd-tree-row"
        style={rowStyle}
        {...(dragEnabled ? draggable.attributes : {})}
        {...(dragEnabled ? draggable.listeners : {})}
      >
        {isOver && dropValid && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: -16,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12,
              color: 'var(--accent)',
              fontWeight: 700,
            }}
          >
            ↳
          </span>
        )}
        <span className="rd-tree-caret">{kids.length > 0 ? '▾' : ''}</span>
        <span className="rd-pill" data-status={task.status}>
          <span className="rd-dot" />
          {t(`task.statusLabels.${task.status}`)}
        </span>
        <span className="rd-tree-title">{task.title}</span>
        <span className="rd-size-chip">
          {(task.size || 'm').toUpperCase()}
        </span>
        <span className="rd-intensity" data-level={intensityLevel}>
          <span className="rd-bar" />
          <span className="rd-bar" />
          <span className="rd-bar" />
          <span className="rd-bar" />
          <span className="rd-bar" />
        </span>
        {showStuck && (
          <span className="rd-tree-stuck">
            ▲{' '}
            {isBlocked
              ? t('tree.stuckBlocked', { n: stuckDays })
              : t('tree.stuckDoing', { n: stuckDays })}
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <div>
          <BranchProgressBar children_={kids} />
          {kids.map((c) => (
            <TreeNode
              key={c.id}
              task={c}
              childrenOf={childrenOf}
              depth={depth + 1}
              dragEnabled={dragEnabled}
              activeId={activeId}
              overId={overId}
              isInvalidDrop={isInvalidDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchProgressBar({ children_ }: { children_: Task[] }) {
  const { t } = useTranslation();
  const counts = {
    done: children_.filter((c) => c.status === 'done').length,
    doing: children_.filter((c) => c.status === 'doing').length,
    blocked: children_.filter((c) => c.status === 'blocked').length,
    review: children_.filter((c) => c.status === 'review').length,
    todo: children_.filter((c) => c.status === 'todo').length,
  };
  const total = Math.max(1, children_.length);
  const seg = (n: number, color: string) =>
    n > 0 && (
      <div
        className="rd-seg"
        style={{ width: `${(n / total) * 100}%`, background: color }}
      />
    );
  return (
    <div className="rd-branch-bar">
      <span className="rd-branch-bar-lbl">
        {t('tree.trialsCount', { n: children_.length })}
      </span>
      <div className="rd-branch-bar-track">
        {seg(counts.done, 'var(--rd-st-done)')}
        {seg(counts.doing, 'var(--rd-st-doing)')}
        {seg(counts.blocked, 'var(--rd-st-blocked)')}
        {seg(counts.review, 'var(--rd-st-review)')}
        {seg(counts.todo, 'var(--rd-st-todo)')}
      </div>
    </div>
  );
}
