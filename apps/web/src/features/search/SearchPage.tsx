import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Project, SearchResults, Task } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { searchAll } from '../../api/search';
import { SkeletonList } from '../../components/Skeleton';
import { TimeframeBadge } from '../tasks/TimeframeBadge';
import { StaleBadge } from '../tasks/StaleBadge';
import { SizeChip } from '../tasks/SizeChip';

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
  artifacts: [],
};

// Emoji per artifact kind, mirroring the option labels in the Artifacts tab
// (artifact.option*). Used to give Sources rows a quick type cue.
const ARTIFACT_KIND_ICON: Record<string, string> = {
  link: '🔗',
  file: '📎',
  code: '💻',
  data: '📊',
  note: '📝',
};

// Static i18n keys per kind — literal keys so typed-i18next t() accepts them
// (a `t(`artifact.type${cap}`)` template collapses to `artifact.type${string}`
// and fails strict key typing). Mirrors ProjectArtifactsTab's kindLabel map.
const ARTIFACT_KIND_LABEL_KEY = {
  link: 'artifact.typeLink',
  file: 'artifact.typeFile',
  code: 'artifact.typeCode',
  data: 'artifact.typeData',
  note: 'artifact.typeNote',
} as const;

// Trim a notes/body field to a short snippet for result rows. Collapses
// whitespace so multi-line task notes don't blow up the row height.
function snippet(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed;
}

/**
 * Cross-entity search route. Calls GET /api/search?q=… on every debounced
 * query change. Server filters across tasks/notes/projects in every
 * workspace the caller is a member of.
 */
export function SearchPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useAppData();

  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  // Project-scope filter — null = all projects. Purely client-side
  // post-filter; the server still returns matches across every workspace
  // the user is a member of. For a researcher with dozens of projects,
  // narrowing to one is the difference between "search is useful" and
  // "search is a wall of unrelated hits."
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

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
  // `#tag` queries hit the tag-only server path. The visible query
  // (used for highlighting) has the leading `#` stripped so we don't
  // mark up every hashtag in the result.
  const isTagMode = trimmed.startsWith('#') && trimmed.length > 1;
  const highlightQuery = isTagMode ? trimmed.slice(1) : trimmed;

  // Post-filter by project when set. Project results themselves only
  // make sense when no project filter is active (you searched for a
  // project but now narrowed to one).
  const taskMatches = projectFilter
    ? results.tasks.filter((tk) => tk.projectId === projectFilter)
    : results.tasks;
  const noteMatches = projectFilter
    ? results.notes.filter((n) => n.projectId === projectFilter)
    : results.notes;
  const artifactMatches = projectFilter
    ? results.artifacts.filter((a) => a.projectId === projectFilter)
    : results.artifacts;
  const projectMatches = projectFilter ? [] : results.projects;

  const totalMatches =
    taskMatches.length +
    noteMatches.length +
    artifactMatches.length +
    projectMatches.length;
  const hasResults = totalMatches > 0;

  // Per-project hit counts for the filter chip row. Counts come from
  // the unfiltered results so the chips don't blink when toggling.
  const projectHitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tk of results.tasks) {
      counts.set(tk.projectId, (counts.get(tk.projectId) ?? 0) + 1);
    }
    for (const n of results.notes) {
      if (!n.projectId) continue;
      counts.set(n.projectId, (counts.get(n.projectId) ?? 0) + 1);
    }
    for (const a of results.artifacts) {
      counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);
    }
    return counts;
  }, [results.tasks, results.notes, results.artifacts]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('nav.search')}</h1>
        {trimmed && (
          <span className="rd-meta" aria-live="polite" aria-atomic="true">
            {loading
              ? t('search.searching', { defaultValue: 'Searching…' })
              : t('search.resultCount', { n: totalMatches })}
            {isTagMode && (
              <span style={{ marginLeft: 8, color: 'var(--rd-ink-3)' }}>
                · {t('search.tagMode')}
              </span>
            )}
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

        {/* Project filter chips — visible only when there are results
            from more than one project. "All projects" + one chip per
            project that has at least one hit, with a hit count. */}
        {trimmed && !loading && projectHitCounts.size > 1 && (
          <div
            className="rd-tf-group"
            role="group"
            aria-label={t('search.projectFilter')}
            style={{ marginTop: 10, marginBottom: 4 }}
          >
            <button
              type="button"
              className="rd-tf-chip"
              aria-pressed={projectFilter === null}
              onClick={() => setProjectFilter(null)}
            >
              <span>{t('search.projectFilterAll')}</span>
            </button>
            {[...projectHitCounts.entries()]
              .map(([pid, count]) => {
                const proj = projectById.get(pid);
                return proj ? { proj, count } : null;
              })
              .filter((x): x is { proj: Project; count: number } => x !== null)
              .sort((a, b) => b.count - a.count)
              .map(({ proj, count }) => (
                <button
                  key={proj.id}
                  type="button"
                  className="rd-tf-chip"
                  aria-pressed={projectFilter === proj.id}
                  onClick={() =>
                    setProjectFilter(projectFilter === proj.id ? null : proj.id)
                  }
                >
                  <span
                    className="rd-pdot"
                    style={{ background: `var(--type-${proj.type})` }}
                    aria-hidden="true"
                  />
                  <span>{proj.name}</span>
                  <span style={{ opacity: 0.7, marginLeft: 2 }}>{count}</span>
                </button>
              ))}
          </div>
        )}

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
          <div className="rd-empty-state">
            <span className="rd-icon" aria-hidden="true">🔍</span>
            <h3>{t('search.noMatches')}</h3>
            <p>{t('search.noMatchesHint')}</p>
          </div>
        )}

        {taskMatches.length > 0 && (
          <div>
            <div className="rd-section-eyebrow">{t('search.groupTasks')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {taskMatches.map((task) => {
                const project = projectById.get(task.projectId);
                // Carry the task ID as a query param so the destination
                // page can scroll/highlight the specific row instead of
                // dumping the user at the top of a 30-task list.
                const goToTask = () =>
                  navigate(`/projects/${task.projectId}?task=${task.id}`);
                return (
                  <div
                    key={task.id}
                    className="rd-task-row"
                    role="button"
                    tabIndex={0}
                    onClick={goToTask}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        goToTask();
                      }
                    }}
                  >
                    <span className="rd-pill" data-status={task.status}>
                      <span className="rd-dot" />
                      {t(`task.statusLabels.${task.status}` as const)}
                    </span>
                    <div>
                      <div className="rd-title">
                        {highlightMatches(task.title, highlightQuery)}
                      </div>
                      {task.notes && task.notes.trim() && (
                        <div
                          className="rd-body"
                          style={{ marginTop: 2, color: 'var(--rd-ink-2)' }}
                        >
                          {highlightMatches(snippet(task.notes), highlightQuery)}
                        </div>
                      )}
                      <div className="rd-meta-line">
                        {project && (
                          <>
                            <span className="rd-project-tag">{project.name}</span>
                            <span className="rd-sep">·</span>
                          </>
                        )}
                        <SizeChip size={task.size} />
                        {task.timeframeBucket && (
                          <>
                            <span className="rd-sep">·</span>
                            <TimeframeBadge
                              bucket={task.timeframeBucket}
                              anchor={task.timeframeAnchor}
                              variant="compact"
                            />
                          </>
                        )}
                        {/* StaleBadge renders nothing for fresh tasks, so
                            it's always safe to include. Search benefits
                            especially from stale signals — cross-project
                            queries are when stale tasks hide. */}
                        <StaleBadge task={task as Task} />
                        {task.focusedAt && (
                          <span
                            className="rd-search-pin"
                            aria-label={t('task.todayFocus')}
                            title={t('task.todayFocus')}
                            style={{ color: 'var(--accent)' }}
                          >
                            ★
                          </span>
                        )}
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
                      <span>{new Date(note.createdAt).toLocaleString(i18n.language)}</span>
                      {projectName && <span>· {projectName}</span>}
                    </div>
                    <div className="rd-body">
                      {renderBodyWithHashtagsAndHighlight(note.body, highlightQuery)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {artifactMatches.length > 0 && (
          <div>
            <div className="rd-section-eyebrow">{t('search.groupArtifacts')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {artifactMatches.map((artifact) => {
                const project = projectById.get(artifact.projectId);
                // Click-through lands on the owning project's Artifacts tab.
                const goToArtifact = () =>
                  navigate(`/projects/${artifact.projectId}?tab=artifacts`);
                return (
                  <div
                    key={artifact.id}
                    className="rd-task-row"
                    role="button"
                    tabIndex={0}
                    onClick={goToArtifact}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        goToArtifact();
                      }
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: '1.1rem' }}>
                      {ARTIFACT_KIND_ICON[artifact.kind] ?? '🗂️'}
                    </span>
                    <div>
                      <div className="rd-title">
                        {highlightMatches(artifact.title, highlightQuery)}
                      </div>
                      {artifact.notes && artifact.notes.trim() && (
                        <div
                          className="rd-body"
                          style={{ marginTop: 2, color: 'var(--rd-ink-2)' }}
                        >
                          {highlightMatches(snippet(artifact.notes), highlightQuery)}
                        </div>
                      )}
                      <div className="rd-meta-line">
                        {project && (
                          <>
                            <span className="rd-project-tag">{project.name}</span>
                            <span className="rd-sep">·</span>
                          </>
                        )}
                        <span>{t(ARTIFACT_KIND_LABEL_KEY[artifact.kind])}</span>
                        {artifact.url && (
                          <>
                            <span className="rd-sep">·</span>
                            <span className="rd-meta">
                              {highlightMatches(artifact.url, highlightQuery)}
                            </span>
                          </>
                        )}
                      </div>
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
                      {highlightMatches(project.name, highlightQuery)}
                    </span>
                  </div>
                  {project.description && (
                    <div className="rd-proj-card-desc">
                      {highlightMatches(project.description, highlightQuery)}
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
