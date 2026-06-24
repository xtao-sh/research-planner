import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../../contexts/AppDataContext';
import { createNote } from '../../api/notes';
import { getProjectTypeMeta } from '../projects/projectTypes';
import { useToast } from '../../components/Toast';

interface QuickCaptureModalProps {
  open: boolean;
  defaultProjectId?: string | null;
  defaultTaskId?: string | null;
  onClose: () => void;
  onSaved?: (savedToProjectId: string | null) => void;
}

/**
 * Quick-capture modal — triggerable from anywhere via Cmd/Ctrl+Shift+N or
 * the "+ Capture" button. Saves a Note either to the active workspace's
 * inbox (projectId null) or to a chosen project.
 *
 * Hashtags in the body auto-extract on the server, so the user can just
 * type "#literature" inline rather than filling the tags field.
 */
export function QuickCaptureModal({
  open,
  defaultProjectId,
  defaultTaskId,
  onClose,
  onSaved,
}: QuickCaptureModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    activeWorkspaceId,
    projects,
    projectTasks,
    refreshProjectTasks,
    refreshInbox,
    refreshProjects,
    bumpEventTick,
  } = useAppData();

  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [taskId, setTaskId] = useState<string | null>(defaultTaskId ?? null);
  const [tagsRaw, setTagsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trapRef = useRef<HTMLDivElement | null>(null);
  // Track all pending setTimeout handles so they can be cancelled if the
  // modal closes (or unmounts) before they fire — otherwise the deferred
  // focus/close work runs against a stale modal instance.
  const timeoutsRef = useRef<Set<number>>(new Set());

  const scheduleTimeout = (fn: () => void, ms: number) => {
    const handle = window.setTimeout(() => {
      timeoutsRef.current.delete(handle);
      fn();
    }, ms);
    timeoutsRef.current.add(handle);
    return handle;
  };

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setBody('');
      setProjectId(defaultProjectId ?? null);
      setTaskId(defaultTaskId ?? null);
      setTagsRaw('');
      setError(null);
      setFeedback(null);
      // Autofocus the textarea after the next paint.
      scheduleTimeout(() => textareaRef.current?.focus(), 30);
    }
  }, [open, defaultProjectId, defaultTaskId]);

  // Lazily populate the chosen project's task list so the optional task picker
  // has options. Capture stays low-friction: this is best-effort and never
  // blocks saving.
  useEffect(() => {
    if (open && projectId) void refreshProjectTasks(projectId);
  }, [open, projectId, refreshProjectTasks]);

  // Cancel any pending timers when the modal closes or unmounts so that
  // late-firing focus/close handlers don't operate on a stale instance.
  useEffect(() => {
    if (open) return;
    const handles = timeoutsRef.current;
    handles.forEach((h) => window.clearTimeout(h));
    handles.clear();
  }, [open]);

  useEffect(() => {
    const handles = timeoutsRef.current;
    return () => {
      handles.forEach((h) => window.clearTimeout(h));
      handles.clear();
    };
  }, []);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap: keep Tab cycling inside the modal. The textarea is already
  // auto-focused by the open-effect above; this just wraps Tab/Shift+Tab.
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
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  if (!activeWorkspaceId) return null;

  const trimmed = body.trim();
  const canSave = trimmed.length > 0 && !saving;

  const parseTags = (raw: string): string[] =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  async function save(openAnother: boolean) {
    if (!canSave || !activeWorkspaceId) return;
    setSaving(true);
    setError(null);
    try {
      const note = await createNote({
        workspaceId: activeWorkspaceId,
        projectId: projectId ?? null,
        taskId: taskId ?? null,
        body: trimmed,
        tags: parseTags(tagsRaw),
      });
      // Refresh inbox if the note went to inbox.
      if (note.projectId === null) {
        await refreshInbox();
      }
      // Pulse so other panels (Top of Mind, project notes panel) refresh
      // immediately rather than waiting for the WS event round-trip.
      bumpEventTick();
      // If saved to a project, refresh the project list so lastTouchedAt
      // bumps the gallery ordering.
      if (note.projectId !== null) {
        void refreshProjects();
      }
      const projName =
        note.projectId !== null
          ? projects.find((p) => p.id === note.projectId)?.name
          : null;
      const msg = projName
        ? t('capture.savedToProject', { project: projName })
        : t('capture.savedToInbox');
      onSaved?.(note.projectId);

      if (openAnother) {
        // Stay open for rapid capture — keep the inline acknowledgment
        // visible since there's no modal-close to swallow it.
        setFeedback(msg);
        setBody('');
        setTagsRaw('');
        scheduleTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        // Fire a global toast (survives the close, stays readable) instead
        // of an in-modal flash that the 250ms close made unreadable.
        toast.push(msg, { kind: 'success' });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('capture.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDownTextarea(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save(e.shiftKey);
    }
  }

  // Redesign-styled modal: compact head with eyebrow + kbd hint, big
  // textarea, footer rail of project + tag chips. Hashtags inside the
  // body auto-extract on the server, so we don't need a separate tags
  // field for the common path — but we keep one for explicit tagging.
  const activeProject = projectId
    ? projects.find((p) => p.id === projectId)
    : null;
  const activeProjectMeta = activeProject ? getProjectTypeMeta(activeProject.type) : null;
  // Optional task picker: only available once a project with tasks is chosen.
  const taskOptions = projectId ? projectTasks[projectId] ?? [] : [];
  const activeTask = taskId ? taskOptions.find((tk) => tk.id === taskId) : null;

  return (
    <div className="rd-capture-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        tabIndex={-1}
        className="rd-capture-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('capture.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rd-capture-head">
          <span className="rd-lbl">+ {t('capture.title')}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {projectId ? '' : t('capture.inboxHint')}
          </span>
          <span className="rd-kbd">⌘⇧N</span>
        </div>
        <div className="rd-capture-body">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDownTextarea}
            placeholder={t('capture.placeholder')}
          />
        </div>
        {error && (
          <div
            role="alert"
            style={{
              padding: '6px 18px',
              color: 'var(--rd-st-blocked)',
              fontSize: 12,
              background: 'var(--rd-st-blocked-tint)',
            }}
          >
            {error}
          </div>
        )}
        {feedback && !error && (
          <div
            role="status"
            style={{
              padding: '6px 18px',
              color: 'var(--rd-st-done)',
              fontSize: 12,
              background: 'var(--rd-st-done-tint)',
            }}
          >
            {feedback}
          </div>
        )}
        <div className="rd-capture-foot">
          {/* Project picker chip — opens a small select. */}
          <label
            className="rd-chip"
            style={{ cursor: 'pointer', position: 'relative' }}
          >
            {activeProject && activeProjectMeta && (
              <span
                className="rd-pdot"
                style={{ background: `var(--type-${activeProject.type})` }}
                aria-hidden="true"
              />
            )}
            <span>
              {activeProject ? activeProject.name : t('capture.inboxOption')}
            </span>
            <select
              value={projectId ?? ''}
              onChange={(e) => {
                setProjectId(e.target.value || null);
                setTaskId(null);
              }}
              aria-label={t('capture.projectLabel')}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: 0,
                cursor: 'pointer',
              }}
            >
              <option value="">{t('capture.inboxOption')}</option>
              {projects.map((p) => {
                const meta = getProjectTypeMeta(p.type);
                return (
                  <option key={p.id} value={p.id}>
                    {meta.icon} {p.name}
                  </option>
                );
              })}
            </select>
          </label>
          {/* Optional task picker — only when a project with tasks is chosen.
              Capture stays structure-optional: this never blocks saving. */}
          {projectId && taskOptions.length > 0 && (
            <label
              className="rd-chip"
              style={{ cursor: 'pointer', position: 'relative' }}
            >
              <span>{activeTask ? activeTask.title : t('capture.taskOption')}</span>
              <select
                value={taskId ?? ''}
                onChange={(e) => setTaskId(e.target.value || null)}
                aria-label={t('capture.taskLabel')}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer',
                }}
              >
                <option value="">{t('capture.taskOption')}</option>
                {taskOptions.map((tk) => (
                  <option key={tk.id} value={tk.id}>
                    {tk.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Tags input as a chip — accepts comma-separated. Hashtags in
              the body auto-extract on the server too. */}
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder={t('capture.tagsPlaceholder')}
            className="rd-chip"
            style={{
              border: '1px solid var(--rd-line)',
              outline: 'none',
              minWidth: 140,
              fontFamily: 'inherit',
              fontSize: 12,
            }}
            aria-label={t('capture.tagsLabel')}
          />
          <span className="rd-grow" />
          <button
            type="button"
            className="rd-btn rd-btn-sm"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
          <button
            type="button"
            className="rd-btn rd-btn-sm"
            onClick={() => save(true)}
            disabled={!canSave}
          >
            {t('capture.saveAndAnother')}
            <kbd
              className="mono"
              style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}
            >
              ⌘⇧↵
            </kbd>
          </button>
          <button
            type="button"
            className="rd-btn rd-btn-primary rd-btn-sm"
            onClick={() => save(false)}
            disabled={!canSave}
          >
            {saving ? t('common.saving', { defaultValue: '…' }) : t('capture.save')}
            <kbd
              className="mono"
              style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}
            >
              ↵
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
