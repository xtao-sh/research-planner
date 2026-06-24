import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Artifact, ArtifactKind } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import {
  createArtifact,
  deleteArtifact,
  getProjectArtifacts,
  updateArtifact,
} from '../../api/artifacts';
import { formatRelative } from '../../utils/time';
import { useToast } from '../../components/Toast';
import { SkeletonList } from '../../components/Skeleton';

interface ProjectArtifactsTabProps {
  projectId: string;
  /** Bumped whenever the parent wants the tab to refresh. */
  refreshTrigger?: number;
  /** Whether the current user may add/delete artifacts in this project. */
  canWrite: boolean;
}

const KINDS: ArtifactKind[] = ['link', 'file', 'code', 'data', 'note'];

// Kinds that take a URL (vs. a free-text content body).
const URL_KINDS: ArtifactKind[] = ['link', 'file'];

const KIND_ICON: Record<ArtifactKind, string> = {
  link: '🔗',
  file: '📎',
  code: '💻',
  data: '📊',
  note: '📝',
};

/**
 * Project Artifacts tab — recovers the orphaned artifact.* i18n. Lists the
 * project's attachments with a kind filter, an inline add form (URL field for
 * link/file, content textarea for code/data/note), and per-row delete. Mirrors
 * ProjectNotesTab's structure + rd-* classes.
 */
export function ProjectArtifactsTab({
  projectId,
  refreshTrigger,
  canWrite,
}: ProjectArtifactsTabProps) {
  const { t } = useTranslation();
  const { auth } = useAppData();
  const toast = useToast();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeKind, setActiveKind] = useState<ArtifactKind | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which row (if any) is in inline-edit mode. Mutually exclusive with the
  // add form so the two free-text editors never compete for the screen.
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add-form state.
  const [formKind, setFormKind] = useState<ArtifactKind>('link');
  const [formTitle, setFormTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Edit-form state (separate from add so opening an edit never clobbers a
  // half-typed add and vice-versa).
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setArtifacts(await getProjectArtifacts(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('artifact.loadError'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTrigger]);

  function resetForm() {
    setFormKind('link');
    setFormTitle('');
    setFormUrl('');
    setFormNotes('');
  }

  const isUrlKind = URL_KINDS.includes(formKind);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const title = formTitle.trim();
    if (!title) {
      setError(t('artifact.nameRequiredAlert'));
      return;
    }
    if (isUrlKind && !formUrl.trim()) {
      setError(t('artifact.urlRequiredAlert'));
      return;
    }
    if (!isUrlKind && !formNotes.trim()) {
      setError(t('artifact.contentRequiredAlert'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createArtifact(projectId, {
        kind: formKind,
        title,
        url: isUrlKind ? formUrl.trim() : undefined,
        notes: !isUrlKind ? formNotes.trim() : undefined,
      });
      resetForm();
      setAdding(false);
      await refresh();
    } catch (err) {
      // API/network failure routes to the global toast (field validation
      // above stays inline). Keeps the error surface consistent with Inbox.
      toast.push(err instanceof Error ? err.message : String(err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function startEdit(a: Artifact) {
    setAdding(false);
    setError(null);
    setEditingId(a.id);
    setEditTitle(a.title);
    setEditUrl(a.url ?? '');
    setEditNotes(a.notes ?? '');
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function handleUpdate(a: Artifact) {
    const title = editTitle.trim();
    if (!title) {
      setError(t('artifact.nameRequiredAlert'));
      return;
    }
    const urlKind = URL_KINDS.includes(a.kind);
    if (urlKind && !editUrl.trim()) {
      setError(t('artifact.urlRequiredAlert'));
      return;
    }
    if (!urlKind && !editNotes.trim()) {
      setError(t('artifact.contentRequiredAlert'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateArtifact(a.id, {
        title,
        url: urlKind ? editUrl.trim() : null,
        notes: !urlKind ? editNotes.trim() : null,
      });
      setEditingId(null);
      await refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('artifact.deleteConfirm'))) return;
    try {
      await deleteArtifact(id);
      await refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : String(e), { kind: 'error' });
    }
  }

  const counts = useMemo(() => {
    const c: Record<ArtifactKind | 'all', number> = {
      all: artifacts.length,
      link: 0,
      file: 0,
      code: 0,
      data: 0,
      note: 0,
    };
    for (const a of artifacts) c[a.kind] += 1;
    return c;
  }, [artifacts]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (activeKind !== 'all' && a.kind !== activeKind) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.url ?? '').toLowerCase().includes(q) ||
        (a.notes ?? '').toLowerCase().includes(q)
      );
    });
  }, [artifacts, filter, activeKind]);

  const filterChips: Array<{ key: ArtifactKind | 'all'; label: string }> = [
    { key: 'all', label: t('artifact.filterAll', { count: counts.all }) },
    { key: 'link', label: t('artifact.filterLink', { count: counts.link }) },
    { key: 'file', label: t('artifact.filterFile', { count: counts.file }) },
    { key: 'code', label: t('artifact.filterCode', { count: counts.code }) },
    { key: 'data', label: t('artifact.filterData', { count: counts.data }) },
    { key: 'note', label: t('artifact.filterNote', { count: counts.note }) },
  ];

  const kindLabel: Record<ArtifactKind, string> = {
    link: t('artifact.typeLink'),
    file: t('artifact.typeFile'),
    code: t('artifact.typeCode'),
    data: t('artifact.typeData'),
    note: t('artifact.typeNote'),
  };

  return (
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
          <span aria-hidden="true">🗂️</span> {t('artifact.panel')}
        </div>
        <span style={{ flex: 1 }} />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('artifact.searchPlaceholder')}
          style={{
            padding: '0.4rem 0.6rem',
            border: '1px solid var(--border-color, #e5e7eb)',
            borderRadius: 4,
            fontSize: '0.875rem',
            minWidth: 220,
          }}
        />
        {canWrite && (
          <button
            type="button"
            className="rd-btn rd-btn-primary rd-btn-sm"
            onClick={() => {
              setAdding((v) => !v);
              setError(null);
            }}
          >
            {t('artifact.addArtifact')}
          </button>
        )}
      </div>

      {/* Kind filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {filterChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`rd-btn rd-btn-sm ${activeKind === chip.key ? 'rd-btn-primary' : 'rd-btn-ghost'}`}
            onClick={() => setActiveKind(chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{ color: 'var(--danger-color, #b91c1c)', marginBottom: '0.5rem' }}
        >
          {error}
        </div>
      )}

      {/* Inline add form */}
      {adding && canWrite && (
        <form className="card" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="rd-section-eyebrow" style={{ margin: 0 }}>
                {t('artifact.typeLabel')}
              </span>
              <select
                value={formKind}
                onChange={(e) => setFormKind(e.target.value as ArtifactKind)}
              >
                <option value="link">{t('artifact.optionLink')}</option>
                <option value="file">{t('artifact.optionFile')}</option>
                <option value="code">{t('artifact.optionCode')}</option>
                <option value="data">{t('artifact.optionData')}</option>
                <option value="note">{t('artifact.optionNote')}</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span className="rd-section-eyebrow" style={{ margin: 0 }}>
                {t('artifact.nameLabel')}
              </span>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t('artifact.namePlaceholder')}
              />
            </label>

            {isUrlKind ? (
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="rd-section-eyebrow" style={{ margin: 0 }}>
                  {formKind === 'link' ? t('artifact.urlLinkRequired') : t('artifact.urlFile')}
                </span>
                <input
                  type="text"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder={
                    formKind === 'link'
                      ? t('artifact.urlPlaceholderLink')
                      : t('artifact.urlPlaceholderFile')
                  }
                />
              </label>
            ) : (
              <label style={{ display: 'grid', gap: 4 }}>
                <span className="rd-section-eyebrow" style={{ margin: 0 }}>
                  {t('artifact.contentRequired')}
                </span>
                <textarea
                  rows={4}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder={
                    formKind === 'code'
                      ? t('artifact.contentPlaceholderCode')
                      : formKind === 'data'
                        ? t('artifact.contentPlaceholderData')
                        : t('artifact.contentPlaceholderNote')
                  }
                />
              </label>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="submit"
                className="rd-btn rd-btn-primary rd-btn-sm"
                disabled={saving}
              >
                {t('artifact.submit')}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && <SkeletonList rows={4} />}

      {!loading && artifacts.length === 0 && !error && (
        <div className="rd-empty-state">
          <span className="rd-icon" aria-hidden="true">🗂️</span>
          <h3>{t('artifactsTab.title')}</h3>
          <p>{t('artifact.empty')}</p>
        </div>
      )}

      {!loading && artifacts.length > 0 && filtered.length === 0 && (
        <p className="empty-hint">{t('artifact.noMatches')}</p>
      )}

      {filtered.length > 0 && (
        <div className="rd-note-list">
          {filtered.map((a) => {
            const isOwn = auth.user?.id === a.createdById;
            const r = formatRelative(a.createdAt);
            const when = t(r.key, r.values ?? {});
            const editing = editingId === a.id;
            const rowIsUrlKind = URL_KINDS.includes(a.kind);
            return (
              <div key={a.id} className="rd-note" data-kind={a.kind}>
                <div className="rd-stamp">
                  <span aria-hidden>{KIND_ICON[a.kind]}</span>
                  <span>{kindLabel[a.kind]}</span>
                  <span>· {when}</span>
                  <span style={{ flex: 1 }} />
                  {isOwn && canWrite && !editing && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="rd-btn rd-btn-ghost rd-btn-sm"
                        title={t('artifact.editTitle')}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        className="rd-btn rd-btn-ghost rd-btn-sm"
                        title={t('artifact.deleteTitle')}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
                {editing ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t('artifact.namePlaceholder')}
                    />
                    {rowIsUrlKind ? (
                      <input
                        type="text"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        placeholder={
                          a.kind === 'link'
                            ? t('artifact.urlPlaceholderLink')
                            : t('artifact.urlPlaceholderFile')
                        }
                      />
                    ) : (
                      <textarea
                        rows={4}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        placeholder={
                          a.kind === 'code'
                            ? t('artifact.contentPlaceholderCode')
                            : a.kind === 'data'
                              ? t('artifact.contentPlaceholderData')
                              : t('artifact.contentPlaceholderNote')
                        }
                      />
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="rd-btn rd-btn-primary rd-btn-sm"
                        onClick={() => handleUpdate(a)}
                        disabled={saving}
                      >
                        {t('common.save')}
                      </button>
                      <button
                        type="button"
                        className="rd-btn rd-btn-ghost rd-btn-sm"
                        onClick={cancelEdit}
                        disabled={saving}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rd-body" style={{ fontWeight: 600 }}>{a.title}</div>
                    {a.url && (
                      <div className="rd-body">
                        <a href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.url}
                        </a>
                      </div>
                    )}
                    {a.notes && <div className="rd-body">{a.notes}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

