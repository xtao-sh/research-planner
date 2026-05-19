import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Dependency, Milestone, Task } from '@rp/shared';
import {
  TaskFormState,
  typeOptions,
  statusOptions,
  sizeOptions,
} from '../task-form/form';

interface TaskDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  form: TaskFormState;
  setForm: React.Dispatch<React.SetStateAction<TaskFormState>>;
  selectedTask: Task | null;
  saving: boolean;
  canWriteActiveWorkspace: boolean;
  isDeadlineMode: boolean;
  milestones: Milestone[];
  predecessors: Dependency[];
  addableTasks: Task[];
  tasks: Task[];
  newDepSourceId: string;
  setNewDepSourceId: (id: string) => void;
  newDepType: 'FS' | 'SS' | 'FF' | 'SF';
  setNewDepType: (type: 'FS' | 'SS' | 'FF' | 'SF') => void;
  newDepLag: number;
  setNewDepLag: (lag: number) => void;
  onSave: () => void;
  onDelete?: (taskId: string) => void;
  onAddDependency: () => void;
  onRemoveDependency: (depId: string) => void;
}

/**
 * Centered popup modal showing the FULL set of task fields. Opened from
 * the inline editor via the "更多详情 / Full details" button. Includes
 * the same major fields as the inline editor (title, status, size, hard
 * due, notes) PLUS the advanced fields (type, soft due, milestone,
 * dependencies, O/M/P estimate, tags) so the user can review and edit
 * everything in one place before saving.
 */
export function TaskDetailsDrawer({
  open,
  onClose,
  form,
  setForm,
  selectedTask,
  saving,
  canWriteActiveWorkspace,
  isDeadlineMode,
  milestones,
  predecessors,
  addableTasks,
  tasks,
  newDepSourceId,
  setNewDepSourceId,
  newDepType,
  setNewDepType,
  newDepLag,
  setNewDepLag,
  onSave,
  onDelete,
  onAddDependency,
  onRemoveDependency,
}: TaskDetailsDrawerProps) {
  const { t } = useTranslation();
  const trapRef = useRef<HTMLDivElement>(null);

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Focus trap: wrap Tab cycling inside the modal. Initial focus is handled
  // by the title input's `autoFocus` (and the `data-rp-autofocus` hint
  // below) — don't fight it here, otherwise focus lands on the close
  // button (first focusable) instead of the title field.
  useEffect(() => {
    if (!open || !trapRef.current) return;
    const root = trapRef.current;
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('inert'));
    // Explicitly focus the autofocus-marked field so it wins regardless of
    // React's autoFocus timing vs. this effect.
    const preferred = root.querySelector<HTMLElement>('[data-rp-autofocus]');
    if (preferred) preferred.focus();
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
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const statusLabels: Record<Task['status'], string> = {
    todo: t('task.statusLabels.todo'),
    doing: t('task.statusLabels.doing'),
    blocked: t('task.statusLabels.blocked'),
    review: t('task.statusLabels.review'),
    done: t('task.statusLabels.done'),
  };
  return (
    <>
      <div
        className="task-modal-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={trapRef}
        tabIndex={-1}
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('task.drawer.title')}
      >
        <div className="task-modal-header">
          <h3>
            {selectedTask
              ? t('task.modal.editTitle', { title: selectedTask.title })
              : t('task.modal.newTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="task-drawer-close"
            aria-label={t('task.drawer.close')}
          >
            ✕
          </button>
        </div>

        <div className="task-modal-body">
          {/* === MAJOR FIELDS === */}
          <section className="task-modal-section">
            <h4 className="task-modal-section-title">{t('task.modal.basics')}</h4>

            <div className="form-group">
              <label>{t('task.title')}</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                autoFocus
                data-rp-autofocus
              />
            </div>

            <div className="form-group">
              <label>{t('task.status')}</label>
              <div className="status-pill-row">
                {statusOptions.map((opt) => {
                  const selected = form.status === opt;
                  return (
                    <button
                      type="button"
                      key={opt}
                      onClick={() => setForm((f) => ({ ...f, status: opt }))}
                      className={
                        selected ? 'status-pill status-pill-selected' : 'status-pill'
                      }
                    >
                      {statusLabels[opt]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>{t('task.sizeLabel')}</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {sizeOptions.map((opt) => {
                  const selected = form.size === opt.value;
                  return (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setForm((f) => ({ ...f, size: opt.value }))}
                      className={
                        selected ? 'size-pill size-pill-selected' : 'size-pill'
                      }
                    >
                      {t(`task.size.${opt.value}` as const)}
                      <span style={{ display: 'block', fontSize: '0.7rem', opacity: 0.7 }}>
                        {opt.hours}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>{t('task.dueHard')}</label>
              <input
                type="date"
                value={form.dueHard}
                onChange={(e) => setForm((f) => ({ ...f, dueHard: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>{t('task.notes')}</label>
              <textarea
                rows={5}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </section>

          {/* === ADDITIONAL FIELDS === */}
          <section className="task-modal-section">
            <h4 className="task-modal-section-title">{t('task.modal.additional')}</h4>

            <div className="form-group">
              <label>{t('task.type')}</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value as Task['type'] }))
                }
              >
                {typeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(`task.typeLabels.${opt}` as const)}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>{t('task.dueSoft')}</label>
              <input
                type="date"
                value={form.dueSoft}
                onChange={(e) => setForm((f) => ({ ...f, dueSoft: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label>{t('task.milestone')}</label>
              <select
                value={form.milestoneId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, milestoneId: e.target.value }))
                }
              >
                <option value="">{t('common.none')}</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Parent task picker — set this task as a subtask of another.
                Self and descendants excluded (server also rejects but the
                client should not even offer them). Top-level = empty string. */}
            <div className="form-group">
              <label>{t('task.parentTask')}</label>
              <select
                value={form.parentTaskId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, parentTaskId: e.target.value }))
                }
              >
                <option value="">{t('task.parentNone')}</option>
                {tasks
                  .filter((tk) => {
                    if (!selectedTask) return true;
                    if (tk.id === selectedTask.id) return false;
                    // Exclude descendants (walk children of selectedTask).
                    const descendants = new Set<string>();
                    const stack = [selectedTask.id];
                    while (stack.length) {
                      const cur = stack.pop()!;
                      for (const child of tasks) {
                        if (
                          child.parentTaskId === cur &&
                          !descendants.has(child.id)
                        ) {
                          descendants.add(child.id);
                          stack.push(child.id);
                        }
                      }
                    }
                    return !descendants.has(tk.id);
                  })
                  .map((tk) => (
                    <option key={tk.id} value={tk.id}>
                      {tk.title}
                    </option>
                  ))}
              </select>
            </div>

            {selectedTask?.labels && selectedTask.labels.length > 0 && (
              <div className="form-group">
                <label>{t('task.tagsLabel')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selectedTask.labels.map((tag) => (
                    <span key={tag} className="tag-readonly">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* === DEADLINE-MODE-ONLY FIELDS === */}
          {isDeadlineMode && selectedTask && (
            <section className="task-modal-section">
              <h4 className="task-modal-section-title">
                {t('task.modal.scheduling')}
              </h4>

              <fieldset
                style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8 }}
              >
                <legend style={{ fontSize: 12 }}>{t('task.predecessors')}</legend>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {predecessors.map((dep) => {
                    const source = tasks.find((tk) => tk.id === dep.fromTaskId);
                    const lagStr =
                      dep.lag === 0 ? '' : ` ${dep.lag > 0 ? '+' : ''}${dep.lag}h`;
                    return (
                      <li
                        key={dep.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <span>
                          {source?.title || dep.fromTaskId}{' '}
                          <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>
                            [{dep.type}
                            {lagStr}]
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onRemoveDependency(dep.id)}
                          style={{ cursor: 'pointer', color: 'var(--danger-color)' }}
                        >
                          {t('common.remove')}
                        </button>
                      </li>
                    );
                  })}
                  {predecessors.length === 0 && (
                    <li style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {t('task.noPredecessors')}
                    </li>
                  )}
                </ul>
                {addableTasks.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      marginTop: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <select
                      value={newDepSourceId}
                      onChange={(e) => setNewDepSourceId(e.target.value)}
                      style={{ flex: '1 1 120px', minWidth: 100 }}
                    >
                      {addableTasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newDepType}
                      onChange={(e) =>
                        setNewDepType(e.target.value as 'FS' | 'SS' | 'FF' | 'SF')
                      }
                      title={t('task.dep.typeLabel')}
                      style={{ flex: '0 0 60px' }}
                    >
                      <option value="FS">{t('task.dep.type.FS')}</option>
                      <option value="SS">{t('task.dep.type.SS')}</option>
                      <option value="FF">{t('task.dep.type.FF')}</option>
                      <option value="SF">{t('task.dep.type.SF')}</option>
                    </select>
                    <input
                      type="number"
                      value={newDepLag}
                      onChange={(e) => setNewDepLag(Number(e.target.value) || 0)}
                      title={t('task.dep.lag')}
                      style={{ flex: '0 0 60px', width: 60 }}
                      step={1}
                    />
                    <button
                      type="button"
                      onClick={onAddDependency}
                      disabled={!canWriteActiveWorkspace}
                      style={{
                        cursor: canWriteActiveWorkspace ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {t('task.noAvailablePredecessors')}
                  </div>
                )}
              </fieldset>

              <details className="task-form-advanced" style={{ marginTop: '0.75rem' }}>
                <summary>{t('task.advanced')}</summary>
                <div
                  style={{
                    fontSize: '0.75rem',
                    opacity: 0.7,
                    margin: '0.25rem 0 0.5rem',
                  }}
                >
                  {t('task.advancedHint')}
                </div>
                <fieldset className="estimate-group">
                  <legend>{t('task.estimateLabel')}</legend>
                  <div className="estimate-inputs">
                    <div className="form-group">
                      <label>O</label>
                      <input
                        type="number"
                        min={1}
                        value={form.estimate.o}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            estimate: {
                              ...f.estimate,
                              o: Number(e.target.value) || 1,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>M</label>
                      <input
                        type="number"
                        min={1}
                        value={form.estimate.m}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            estimate: {
                              ...f.estimate,
                              m: Number(e.target.value) || 1,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>P</label>
                      <input
                        type="number"
                        min={1}
                        value={form.estimate.p}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            estimate: {
                              ...f.estimate,
                              p: Number(e.target.value) || 1,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </fieldset>
              </details>
            </section>
          )}
        </div>

        <div className="task-modal-footer">
          {selectedTask && canWriteActiveWorkspace && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(selectedTask.id)}
              className="btn-inline-delete"
            >
              {t('task.inlineEditor.delete')}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-inline-cancel"
            >
              {t('task.inlineEditor.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                onSave();
                onClose();
              }}
              disabled={saving || !canWriteActiveWorkspace}
              className="btn-inline-save"
            >
              {saving ? t('common.saving') : t('task.inlineEditor.save')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
