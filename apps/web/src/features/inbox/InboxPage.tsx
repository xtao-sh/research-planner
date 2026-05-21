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
import { useToast } from '../../components/Toast';
import { SkeletonList } from '../../components/Skeleton';

type RowAction = 'idle' | 'file' | 'promote';

export function InboxPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { inbox, refreshInbox, projects, eventTick } = useAppData();

  // Re-fetch on real-time event tick. `hasFetched` flips true after the
  // first refresh resolves so we can distinguish "still loading" from
  // "truly empty" — without it, slow networks show the empty-state UI
  // for the first 100-500ms (flash-of-empty), which is misleading.
  const [hasFetched, setHasFetched] = useState(inbox.length > 0);
  useEffect(() => {
    let cancelled = false;
    void refreshInbox().finally(() => {
      if (!cancelled) setHasFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [eventTick, refreshInbox]);

  const [pendingAction, setPendingAction] = useState<Record<string, RowAction>>({});
  const [pickedProject, setPickedProject] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Confirm-delete is a two-click flow now (no native confirm() — those
  // dialogs are awful on macOS and don't match the toast/modal aesthetic
  // of the rest of the app). Clicking Delete once arms the row; the
  // button label flips to "Confirm delete" + danger style for ~4 seconds.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const visibleNotes = tagFilter
    ? inbox.filter((n) => n.tags.includes(tagFilter))
    : inbox;

  function setAction(id: string, action: RowAction) {
    setPendingAction((prev) => ({ ...prev, [id]: action }));
  }

  async function handleFile(note: Note, projectId: string) {
    setBusyId(note.id);
    try {
      await updateNote(note.id, { projectId });
      const proj = projects.find((p) => p.id === projectId);
      toast.push(
        t('inbox.fileSuccess', { project: proj?.name ?? '' }),
        { kind: 'success' }
      );
      await refreshInbox();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setBusyId(null);
      setAction(note.id, 'idle');
    }
  }

  async function handlePromote(note: Note, projectId: string) {
    setBusyId(note.id);
    try {
      await promoteNoteToTask(note.id, projectId);
      const proj = projects.find((p) => p.id === projectId);
      toast.push(
        t('inbox.promoteSuccess', { project: proj?.name ?? '' }),
        { kind: 'success' }
      );
      await refreshInbox();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), { kind: 'error' });
    } finally {
      setBusyId(null);
      setAction(note.id, 'idle');
    }
  }

  // First click: arm. Second click within the 4s window: execute.
  // Auto-disarms via a timeout so the danger state doesn't linger.
  function armOrConfirmDelete(note: Note) {
    if (pendingDelete === note.id) {
      void executeDelete(note);
      return;
    }
    setPendingDelete(note.id);
    window.setTimeout(() => {
      setPendingDelete((cur) => (cur === note.id ? null : cur));
    }, 4000);
  }
  async function executeDelete(note: Note) {
    setBusyId(note.id);
    setPendingDelete(null);
    try {
      await apiDeleteNote(note.id);
      await refreshInbox();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), { kind: 'error' });
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
          {!hasFetched ? (
            // Inbox hasn't been fetched yet — render a skeleton instead
            // of the "your inbox is empty" empty state so we don't lie
            // to the user during the first fetch.
            <SkeletonList rows={4} />
          ) : (
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
          )}
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

        {/* Errors + success feedback go through the global toast system
            now (the inline status div used to flash, drift, and
            disagree with the rest of the app). */}

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
                        className={
                          pendingDelete === note.id
                            ? 'rd-btn rd-btn-sm rd-btn-danger'
                            : 'rd-btn rd-btn-ghost rd-btn-sm'
                        }
                        onClick={() => armOrConfirmDelete(note)}
                        disabled={busy}
                        aria-label={
                          pendingDelete === note.id
                            ? t('inbox.confirmDeleteCta')
                            : t('inbox.delete')
                        }
                      >
                        {pendingDelete === note.id
                          ? t('inbox.confirmDeleteCta')
                          : t('inbox.delete')}
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
