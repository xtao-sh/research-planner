import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import {
  TaskFormState,
  statusOptions,
  sizeOptions,
  parseDateInput,
} from '../task-form/form';

interface TaskInlineEditorProps {
  form: TaskFormState;
  setForm: React.Dispatch<React.SetStateAction<TaskFormState>>;
  selectedTask: Task | null;
  saving: boolean;
  canWriteActiveWorkspace: boolean;
  onSave: () => void;
  onDelete: (taskId: string) => void;
  onCancel: () => void;
  onOpenDrawer: () => void;
  /**
   * Auto-commit hook for small-field edits (status, size, dueHard) on
   * existing tasks. Title and notes still require explicit save — typing
   * free text shouldn't roundtrip on every keystroke. For new tasks
   * `selectedTask` is null and this is a no-op.
   */
  onApplyPatch?: (taskId: string, patch: Partial<Task>) => void;
  /** All tasks in the project — used to populate the parent picker.
   *  Excludes self and descendants client-side; server validates again. */
  tasks?: Task[];
  /** Re-parent hook — same shape as the drag gesture's onReparent. When
   *  invoked from the picker, newSiblingIds is computed by the caller. */
  onReparent?: (
    taskId: string,
    newParentId: string | null,
    newSiblingIds: string[]
  ) => void;
}

/**
 * Inline task editor that expands underneath the clicked row in the task
 * list. Shows only the most-edited fields: title, status, size, hard due,
 * notes. Advanced fields live in the right-side <TaskDetailsDrawer>.
 */
export function TaskInlineEditor({
  form,
  setForm,
  selectedTask,
  saving,
  canWriteActiveWorkspace,
  onSave,
  onDelete,
  onCancel,
  onOpenDrawer,
  onApplyPatch,
  tasks,
  onReparent,
}: TaskInlineEditorProps) {
  const { t } = useTranslation();

  const statusLabels: Record<Task['status'], string> = {
    todo: t('task.statusLabels.todo'),
    doing: t('task.statusLabels.doing'),
    blocked: t('task.statusLabels.blocked'),
    review: t('task.statusLabels.review'),
    done: t('task.statusLabels.done'),
  };
  return (
    <div className="task-inline-editor" role="region" aria-label={t('task.inlineEditor.region')}>
      <div className="form-group">
        <label>{t('task.title')}</label>
        <input
          value={form.title}
          onChange={(e) =>
            setForm((f) => ({ ...f, title: e.target.value }))
          }
          autoFocus
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
                onClick={() => {
                  setForm((f) => ({ ...f, status: opt }));
                  if (selectedTask && onApplyPatch)
                    onApplyPatch(selectedTask.id, { status: opt });
                }}
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
                onClick={() => {
                  setForm((f) => ({ ...f, size: opt.value }));
                  if (selectedTask && onApplyPatch)
                    onApplyPatch(selectedTask.id, { size: opt.value });
                }}
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
        <label>{t('task.intensityLabel')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4, 5].map((level) => {
            const active = form.intensity === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => {
                  const next = active ? null : level;
                  setForm((f) => ({ ...f, intensity: next }));
                  if (selectedTask && onApplyPatch)
                    onApplyPatch(selectedTask.id, { intensity: next ?? undefined });
                }}
                className={active ? 'rd-btn rd-btn-primary rd-btn-sm' : 'rd-btn rd-btn-sm'}
                title={t('task.intensityHint', { n: level })}
              >
                ×{level}
              </button>
            );
          })}
          {form.intensity != null && (
            <button
              type="button"
              className="rd-btn rd-btn-ghost rd-btn-sm"
              onClick={() => {
                setForm((f) => ({ ...f, intensity: null }));
                if (selectedTask && onApplyPatch)
                  onApplyPatch(selectedTask.id, { intensity: undefined });
              }}
            >
              {t('task.intensityAuto')}
            </button>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>{t('task.dueHard')}</label>
        <input
          type="date"
          value={form.dueHard}
          onChange={(e) =>
            setForm((f) => ({ ...f, dueHard: e.target.value }))
          }
          onBlur={(e) => {
            if (selectedTask && onApplyPatch) {
              onApplyPatch(selectedTask.id, {
                dueHard: parseDateInput(e.target.value),
              });
            }
          }}
        />
      </div>

      {/* Parent picker — direct & bulletproof. Prefer this over the
          drag-to-nest gesture if you can't get the gesture to fire. */}
      {selectedTask && tasks && onReparent && (
        <div className="form-group">
          <label>{t('task.parentTask')}</label>
          <select
            value={form.parentTaskId}
            onChange={(e) => {
              const newParentId = e.target.value || null;
              setForm((f) => ({ ...f, parentTaskId: e.target.value }));
              if (selectedTask) {
                // Build new sibling list (other children of newParentId) so
                // the dropped task lands at the bottom of its new sibling
                // group. Same shape as the drag gesture.
                const newSiblings = [
                  ...tasks
                    .filter(
                      (t) =>
                        (t.parentTaskId ?? null) === newParentId &&
                        t.id !== selectedTask.id
                    )
                    .sort((a, b) => a.priority - b.priority)
                    .map((t) => t.id),
                  selectedTask.id,
                ];
                onReparent(selectedTask.id, newParentId, newSiblings);
              }
            }}
          >
            <option value="">{t('task.parentNone')}</option>
            {tasks
              .filter((tk) => {
                if (tk.id === selectedTask.id) return false;
                // Exclude descendants (BFS).
                const descendants = new Set<string>();
                const stack = [selectedTask.id];
                while (stack.length) {
                  const cur = stack.pop()!;
                  for (const child of tasks) {
                    if (child.parentTaskId === cur && !descendants.has(child.id)) {
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
      )}

      <div className="form-group">
        <label>{t('task.notes')}</label>
        <textarea
          rows={2}
          value={form.notes}
          onChange={(e) =>
            setForm((f) => ({ ...f, notes: e.target.value }))
          }
        />
      </div>

      <div className="task-inline-editor-actions">
        {selectedTask && canWriteActiveWorkspace && (
          <button
            type="button"
            onClick={() => onDelete(selectedTask.id)}
            className="btn-inline-delete"
          >
            {t('task.inlineEditor.delete')}
          </button>
        )}
        <div className="task-inline-editor-actions-right">
          <button
            type="button"
            onClick={onCancel}
            className="btn-inline-cancel"
          >
            {t('task.inlineEditor.cancel')}
          </button>
          <button
            type="button"
            onClick={onOpenDrawer}
            className="btn-inline-more"
          >
            {t('task.inlineEditor.moreDetails')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !canWriteActiveWorkspace}
            title={!canWriteActiveWorkspace ? t('role.viewer') : undefined}
            className="btn-inline-save"
          >
            {saving ? t('common.saving') : t('task.inlineEditor.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
