import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Note } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import {
  deleteNote as apiDeleteNote,
  promoteNoteToTask,
  updateNote,
} from '../../api/notes';
import { getProjectTypeMeta } from '../projects/projectTypes';
import { formatRelative } from '../../utils/time';

type RowAction = 'idle' | 'file' | 'promote';

export function InboxPage() {
  const { t } = useTranslation();
  const { inbox, refreshInbox, projects, eventTick } = useAppData();

  // Re-fetch on real-time event tick.
  useEffect(() => {
    void refreshInbox();
  }, [eventTick, refreshInbox]);

  const [pendingAction, setPendingAction] = useState<Record<string, RowAction>>({});
  const [pickedProject, setPickedProject] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const visibleNotes = tagFilter
    ? inbox.filter((n) => n.tags.includes(tagFilter))
    : inbox;

  function setAction(id: string, action: RowAction) {
    setPendingAction((prev) => ({ ...prev, [id]: action }));
  }

  async function handleFile(note: Note, projectId: string) {
    setBusyId(note.id);
    setError(null);
    try {
      await updateNote(note.id, { projectId });
      const proj = projects.find((p) => p.id === projectId);
      setFeedback(t('inbox.fileSuccess', { project: proj?.name ?? '' }));
      await refreshInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setAction(note.id, 'idle');
    }
  }

  async function handlePromote(note: Note, projectId: string) {
    setBusyId(note.id);
    setError(null);
    try {
      await promoteNoteToTask(note.id, projectId);
      const proj = projects.find((p) => p.id === projectId);
      setFeedback(t('inbox.promoteSuccess', { project: proj?.name ?? '' }));
      await refreshInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setAction(note.id, 'idle');
    }
  }

  async function handleDelete(note: Note) {
    if (!confirm(t('inbox.confirmDelete'))) return;
    setBusyId(note.id);
    setError(null);
    try {
      await apiDeleteNote(note.id);
      await refreshInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (inbox.length === 0) {
    return (
      <>
        <div className="rd-topbar">
          <h1>{t('nav.inbox')}</h1>
          <span className="rd-meta">{t('inbox.count', { count: 0 })}</span>
          <span className="rd-spacer" />
        </div>
        <div className="rd-page">
          <div className="rd-empty-state">
            <span className="rd-icon" aria-hidden="true">📥</span>
            <h3>{t('inbox.emptyTitle')}</h3>
            <p>{t('inbox.emptySubtitle')}</p>
            <div className="rd-actions">
              <span className="rd-kbd">⌘⇧N</span>
              <span style={{ alignSelf: 'center', fontSize: 12 }}>
                {t('inbox.captureAnywhereCTA')}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('nav.inbox')}</h1>
        <span className="rd-meta">{t('inbox.count', { count: visibleNotes.length })}</span>
        <span className="rd-spacer" />
      </div>
      <div className="rd-page">
        <div>
          <div className="rd-section-eyebrow">{t('nav.inbox')}</div>
          <div className="rd-section-title">
            {t('inbox.count', { count: visibleNotes.length })}
          </div>
          <div className="rd-section-sub">{t('inbox.emptySubtitle')}</div>
        </div>

        {tagFilter && (
          <div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.75rem',
                background: 'var(--bg-secondary, #f3f4f6)',
                padding: '2px 8px',
                borderRadius: 999,
              }}
            >
              {t('inbox.filteredByTag', { tag: tagFilter })}
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary, #6b7280)',
                }}
              >
                {t('inbox.clearTagFilter')}
              </button>
            </span>
          </div>
        )}

        {error && (
          <div role="alert" style={{ color: 'var(--danger-color, #b91c1c)' }}>
            {error}
          </div>
        )}
        {feedback && !error && (
          <div role="status" style={{ color: 'var(--success-color, #047857)', fontSize: '0.875rem' }}>
            {feedback}
          </div>
        )}

        <div className="rd-inbox-list">
          {visibleNotes.map((note) => {
            const action = pendingAction[note.id] ?? 'idle';
            const picked = pickedProject[note.id] ?? '';
            const busy = busyId === note.id;
            const relative = (() => {
              const r = formatRelative(note.createdAt);
              return t(r.key, r.values ?? {});
            })();
            const bodyText =
              note.body.length > 200 ? note.body.slice(0, 200) + '…' : note.body;
            return (
              <div
                key={note.id}
                className="rd-inbox-row"
                style={{ opacity: busy ? 0.6 : 1 }}
              >
                <span className="rd-when">{relative}</span>
                <div className="rd-body">
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {bodyText}
                  </div>
                  {note.tags.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {note.tags.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          onClick={() => setTagFilter(tag)}
                          title={t('inbox.filteredByTag', { tag })}
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            background:
                              tagFilter === tag
                                ? 'var(--accent-color, #2563eb)'
                                : 'var(--bg-secondary, #f3f4f6)',
                            color: tagFilter === tag ? '#fff' : 'inherit',
                            border: '1px solid transparent',
                            borderRadius: 999,
                            fontSize: '0.75rem',
                            marginRight: 4,
                            cursor: 'pointer',
                          }}
                        >
                          #{tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {(action === 'file' || action === 'promote') && (
                    <div
                      style={{
                        marginTop: '0.5rem',
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <select
                        value={picked}
                        onChange={(e) =>
                          setPickedProject((prev) => ({ ...prev, [note.id]: e.target.value }))
                        }
                        style={{ fontSize: 13, padding: '4px 6px' }}
                      >
                        <option value="">{t('inbox.pickProject')}</option>
                        {projects.map((p) => {
                          const meta = getProjectTypeMeta(p.type);
                          return (
                            <option key={p.id} value={p.id}>
                              {meta.icon} {p.name}
                            </option>
                          );
                        })}
                      </select>
                      <button
                        type="button"
                        className="rd-btn rd-btn-sm"
                        onClick={() => {
                          if (!picked) return;
                          if (action === 'file') handleFile(note, picked);
                          else handlePromote(note, picked);
                        }}
                        disabled={busy || !picked}
                      >
                        {action === 'file' ? t('inbox.fileToProject') : t('inbox.promoteToTask')}
                      </button>
                      <button
                        type="button"
                        className="rd-btn rd-btn-ghost rd-btn-sm"
                        onClick={() => setAction(note.id, 'idle')}
                        disabled={busy}
                      >
                        {t('inbox.actionCancel')}
                      </button>
                    </div>
                  )}
                </div>
                <div className="rd-actions">
                  {action === 'idle' && (
                    <>
                      <button
                        type="button"
                        className="rd-btn rd-btn-sm"
                        onClick={() => setAction(note.id, 'file')}
                        disabled={busy || projects.length === 0}
                      >
                        → {t('inbox.fileToProject')}
                      </button>
                      <button
                        type="button"
                        className="rd-btn rd-btn-sm"
                        onClick={() => setAction(note.id, 'promote')}
                        disabled={busy || projects.length === 0}
                      >
                        ↑ {t('inbox.promoteToTask')}
                      </button>
                      <button
                        type="button"
                        className="rd-btn rd-btn-ghost rd-btn-sm"
                        onClick={() => handleDelete(note)}
                        disabled={busy}
                      >
                        {t('inbox.delete')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
