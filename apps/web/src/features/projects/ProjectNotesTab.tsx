import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Note } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { deleteNote, getProjectNotes, promoteNoteToTask } from '../../api/notes';
import { formatRelative } from '../../utils/time';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { SkeletonList } from '../../components/Skeleton';

interface ProjectNotesTabProps {
  projectId: string;
  /** Bumped whenever the parent wants the tab to refresh. */
  refreshTrigger?: number;
  /** Open the global quick-capture modal pre-filled with this project. */
  onOpenCapture: () => void;
}

/**
 * Inline #hashtag highlighter. Splits the body into tokens preserving
 * whitespace; any token starting with `#` (Unicode-letter/number/_/-)
 * becomes a `.rd-tag-inline` span. Surrounding text is rendered as-is so
 * `white-space: pre-wrap` (from `.rd-note .rd-body`) keeps newlines.
 */
export function renderBodyWithHashtags(body: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Match #tag with Unicode letters/numbers/_/-, but not when preceded by a non-space.
  const regex = /(^|\s)(#[\p{L}\p{N}_-]+)/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(body)) !== null) {
    const [, lead, tag] = match;
    const tagStart = match.index + lead.length;
    if (tagStart > lastIndex) {
      out.push(body.slice(lastIndex, tagStart));
    }
    out.push(
      <span key={`tag-${key++}-${tagStart}`} className="rd-tag-inline">
        {tag}
      </span>,
    );
    lastIndex = tagStart + tag.length;
  }
  if (lastIndex < body.length) {
    out.push(body.slice(lastIndex));
  }
  return out;
}

/**
 * Phase E: full Notes tab for a project — replaces the small `<ProjectNotesPanel>`
 * widget. Shows the entire notes feed for the project with filter, full body,
 * tag chips, author + relative time, and per-note delete (own notes only).
 */
export function ProjectNotesTab({
  projectId,
  refreshTrigger,
  onOpenCapture,
}: ProjectNotesTabProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { auth, projects } = useAppData();
  const toast = useToast();
  const project = projects.find((p) => p.id === projectId);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getProjectNotes(projectId);
      setNotes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTrigger]);

  async function handleDelete(noteId: string) {
    if (!(await confirm({ message: t('inbox.confirmDelete') }))) return;
    try {
      await deleteNote(noteId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handlePromote(noteId: string) {
    try {
      // Project is known on this tab — promote straight to a task here,
      // no picker needed. The note leaves the notes feed once promoted.
      await promoteNoteToTask(noteId, projectId);
      toast.push(
        t('inbox.promoteSuccess', { project: project?.name ?? '' }),
        { kind: 'success' },
      );
      await refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      if (n.body.toLowerCase().includes(q)) return true;
      return n.tags.some((tag) => tag.toLowerCase().includes(q));
    });
  }, [notes, filter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) for (const tag of n.tags) set.add(tag);
    return Array.from(set).sort();
  }, [notes]);

  // Eyebrow text — section name from existing i18n + simple count.
  const eyebrow = `${t('project.notesPanel')} · ${t('notesTab.eyebrowCount', {
    count: notes.length,
  })}`;

  return (
    <div className="rd-notes-grid">
      <div style={{ minWidth: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            flexWrap: 'wrap',
          }}
        >
          <div className="rd-section-eyebrow" style={{ margin: 0 }}>
            {eyebrow}
          </div>
          <span style={{ flex: 1 }} />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('notesTab.filterPlaceholder')}
            style={{
              padding: '0.4rem 0.6rem',
              border: '1px solid var(--border-color, #e5e7eb)',
              borderRadius: 4,
              fontSize: '0.875rem',
              minWidth: 220,
            }}
          />
          <button
            type="button"
            className="rd-btn rd-btn-primary rd-btn-sm"
            onClick={onOpenCapture}
          >
            {t('notesTab.addButton')}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{ color: 'var(--danger-color, #b91c1c)', marginBottom: '0.5rem' }}
          >
            {error}
          </div>
        )}

        {loading && <SkeletonList rows={4} />}

        {!loading && notes.length === 0 && !error && (
          <div className="rd-empty-state">
            <span className="rd-icon" aria-hidden="true">📝</span>
            <h3>{t('notesTab.emptyTitle')}</h3>
            <p>{t('notesTab.emptyHint')}</p>
            <div className="rd-actions">
              <button
                type="button"
                className="rd-btn rd-btn-primary rd-btn-sm"
                onClick={onOpenCapture}
              >
                {t('notesTab.addButton')}
              </button>
            </div>
          </div>
        )}

        {!loading && notes.length > 0 && filtered.length === 0 && (
          <p className="empty-hint">{t('notesTab.emptyHint')}</p>
        )}

        {filtered.length > 0 && (
          <div className="rd-note-list">
            {filtered.map((note) => {
              const isOwn = auth.user?.id === note.createdById;
              const r = formatRelative(note.createdAt);
              const when = t(r.key, r.values ?? {});
              const author = note.createdByEmail
                ? t('project.notesAuthor', { email: note.createdByEmail })
                : '';
              return (
                <div key={note.id} className="rd-note">
                  <div className="rd-stamp">
                    <span aria-hidden>📝</span>
                    <span>{when}</span>
                    {author && <span>· {author}</span>}
                    <span style={{ flex: 1 }} />
                    {isOwn && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePromote(note.id)}
                          className="rd-btn rd-btn-ghost rd-btn-sm"
                          title={t('notesTab.promoteToTask')}
                        >
                          ↑ {t('notesTab.promoteToTask')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(note.id)}
                          className="rd-btn rd-btn-ghost rd-btn-sm"
                          title={t('inbox.delete')}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                  <div className="rd-body">{renderBodyWithHashtags(note.body)}</div>
                  {note.tags.length > 0 && (
                    <div className="rd-tags">
                      {note.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rd-tag"
                          onClick={() => setFilter(tag)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(tag); } }}
                          role="button"
                          tabIndex={0}
                          title={t('search.openedFromTag', { tag })}
                          style={{ cursor: 'pointer' }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right rail — tags in this project */}
      <aside className="card" style={{ padding: 16, alignSelf: 'start' }}>
        <div className="rd-section-eyebrow" style={{ marginBottom: 10 }}>
          {t('notesTab.tagsInProject')}
        </div>
        {allTags.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {allTags.map((tag) => (
              <span
                key={tag}
                className="rd-tag"
                onClick={() => setFilter(tag)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilter(tag); } }}
                role="button"
                tabIndex={0}
                title={t('search.openedFromTag', { tag })}
                style={{ cursor: 'pointer' }}
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            —
          </p>
        )}
        <p
          className="muted"
          style={{ marginTop: 16, marginBottom: 0, fontSize: 11.5, lineHeight: 1.5 }}
        >
          {t('notesTab.tagsAutoExtractedBefore')} <code>#hashtags</code>{' '}
          {t('notesTab.tagsAutoExtractedAfter')}
        </p>
      </aside>
    </div>
  );
}
