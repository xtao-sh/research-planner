import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Project, SearchResults } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { searchAll } from '../../api/search';
import { SkeletonList } from '../../components/Skeleton';

/**
 * Splits a #hashtag-aware string into React nodes (tags become
 * `.rd-tag-inline` spans). Mirrors the helper in ProjectNotesTab so this
 * page can render note bodies with hashtag highlighting without importing
 * the implementation across feature boundaries.
 */
function renderBodyWithHashtags(body: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
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
 * Highlight case-insensitive substring matches of `query` inside `text`
 * by wrapping each hit in `<mark className="rd-search-hit">`. Pass-through
 * when query is empty. Used for task titles + project names.
 */
function highlightMatches(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lowered = text.toLowerCase();
  const target = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const idx = lowered.indexOf(target, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark key={`hit-${key++}-${idx}`} className="rd-search-hit">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return <>{parts}</>;
}

/**
 * Same idea as `highlightMatches` but composes with
 * `renderBodyWithHashtags`: hashtags keep their `.rd-tag-inline` styling
 * and free-text segments get `<mark>` wrapping for query hits.
 */
function renderBodyWithHashtagsAndHighlight(
  body: string,
  query: string,
): React.ReactNode[] {
  const nodes = renderBodyWithHashtags(body);
  const q = query.trim();
  if (!q) return nodes;
  const out: React.ReactNode[] = [];
  nodes.forEach((node, i) => {
    if (typeof node === 'string') {
      out.push(<React.Fragment key={`s-${i}`}>{highlightMatches(node, query)}</React.Fragment>);
    } else {
      out.push(<React.Fragment key={`t-${i}`}>{node}</React.Fragment>);
    }
  });
  return out;
}

const EMPTY_RESULTS: SearchResults = {
  query: '',
  tasks: [],
  notes: [],
  projects: [],
};

/**
 * Cross-entity search route. Calls GET /api/search?q=… on every debounced
 * query change. Server filters across tasks/notes/projects in every
 * workspace the caller is a member of.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useAppData();

  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);

  // 250ms debounce — keep `rawQuery` in sync with the input but only
  // fire a new request when the user pauses typing.
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(rawQuery), 250);
    return () => window.clearTimeout(handle);
  }, [rawQuery]);

  // Fetch from /api/search whenever the debounced query changes. Use an
  // AbortController so a stale request can't race a fresh one onto the page.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    let cancelled = false;
    searchAll(trimmed, ctrl.signal)
      .then((res) => {
        if (cancelled) return;
        setResults(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Ignore abort errors (replaced by a newer query).
        if ((err as { name?: string })?.name === 'AbortError') return;
        setResults(EMPTY_RESULTS);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [query]);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  const trimmed = query.trim();

  const taskMatches = results.tasks;
  const noteMatches = results.notes;
  const projectMatches = results.projects;

  const totalMatches =
    taskMatches.length + noteMatches.length + projectMatches.length;
  const hasResults = totalMatches > 0;

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('nav.search')}</h1>
        {trimmed && (
          <span className="rd-meta">
            {loading
              ? t('search.searching', { defaultValue: 'Searching…' })
              : t('search.resultCount', { n: totalMatches })}
          </span>
        )}
        <span className="rd-spacer" />
      </div>
      <div className="rd-page">
        <div>
          <input
            ref={inputRef}
            type="text"
            className="rd-input"
            autoFocus
            value={rawQuery}
            placeholder={t('search.placeholder')}
            onChange={(e) => setRawQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1.1rem',
              borderRadius: 10,
              border: '1px solid var(--rd-line, #ddd)',
              background: 'var(--rd-surface, #fff)',
              color: 'var(--rd-ink, #111)',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {!trimmed && (
          <div className="rd-empty-state">
            <span className="rd-icon" aria-hidden="true">🔍</span>
            <p>{t('search.startTyping')}</p>
          </div>
        )}

        {trimmed && loading && !hasResults && (
          <SkeletonList rows={3} />
        )}

        {trimmed && !loading && !hasResults && (
          <div className="rd-empty-state rd-empty-state-sm">
            <p>{t('search.noMatches')}</p>
          </div>
        )}

        {taskMatches.length > 0 && (
          <div>
            <div className="rd-section-eyebrow">{t('search.groupTasks')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {taskMatches.map((task) => {
                const project = projectById.get(task.projectId);
                return (
                  <div
                    key={task.id}
                    className="rd-task-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/projects/${task.projectId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/projects/${task.projectId}`);
                      }
                    }}
                  >
                    <span className="rd-pill" data-status={task.status}>
                      <span className="rd-dot" />
                      {t(`task.statusLabels.${task.status}` as const)}
                    </span>
                    <div>
                      <div className="rd-title">
                        {highlightMatches(task.title, query)}
                      </div>
                      <div className="rd-meta-line">
                        {project && (
                          <>
                            <span className="rd-project-tag">{project.name}</span>
                            <span className="rd-sep">·</span>
                          </>
                        )}
                        <span className="rd-size-chip">{task.size}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {noteMatches.length > 0 && (
          <div>
            <div className="rd-section-eyebrow">{t('search.groupNotes')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {noteMatches.map((note) => {
                const projectName = note.projectId
                  ? projectById.get(note.projectId)?.name ?? null
                  : null;
                return (
                  <div
                    key={note.id}
                    className="rd-note"
                    role={note.projectId ? 'button' : undefined}
                    tabIndex={note.projectId ? 0 : undefined}
                    onClick={
                      note.projectId
                        ? () => navigate(`/projects/${note.projectId}`)
                        : undefined
                    }
                    onKeyDown={
                      note.projectId
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              navigate(`/projects/${note.projectId}`);
                            }
                          }
                        : undefined
                    }
                    style={note.projectId ? { cursor: 'pointer' } : undefined}
                  >
                    <div className="rd-stamp">
                      <span aria-hidden>📝</span>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                      {projectName && <span>· {projectName}</span>}
                    </div>
                    <div className="rd-body">
                      {renderBodyWithHashtagsAndHighlight(note.body, query)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {projectMatches.length > 0 && (
          <div>
            <div className="rd-section-eyebrow">{t('search.groupProjects')}</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
              }}
            >
              {projectMatches.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="rd-proj-card"
                  data-type={project.type}
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="rd-proj-card-head">
                    <span className="rd-name">
                      {highlightMatches(project.name, query)}
                    </span>
                  </div>
                  {project.description && (
                    <div className="rd-proj-card-desc">
                      {highlightMatches(project.description, query)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
