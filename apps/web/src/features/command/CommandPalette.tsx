import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Project, SearchResults } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { searchAll } from '../../api/search';

/**
 * Highlight case-insensitive substring matches by wrapping each hit in
 * `<mark className="rd-search-hit">`. Pass-through when query is empty.
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
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={`hit-${key++}-${idx}`} className="rd-search-hit">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return <>{parts}</>;
}

type RouteKey = 'now' | 'inbox' | 'projects' | 'review' | 'search' | 'settings';
type ActionKey = 'newProject' | 'capture' | 'help';
type SearchTask = SearchResults['tasks'][number];
type SearchNote = SearchResults['notes'][number];
type SearchProject = SearchResults['projects'][number];
interface RouteResult {
  kind: 'route';
  id: string;
  to: string;
  label: string;
  glyph: string;
}
interface ProjectResult {
  kind: 'project';
  id: string;
  to: string;
  project: Project | SearchProject;
}
interface TaskResult {
  kind: 'task';
  id: string;
  to: string;
  task: SearchTask;
  projectName: string | null;
}
interface NoteResult {
  kind: 'note';
  id: string;
  to: string | null;
  note: SearchNote;
  projectName: string | null;
}
interface SearchFallbackResult {
  kind: 'searchFallback';
  id: 'search-fallback';
  to: string;
  query: string;
}
interface ActionResult {
  kind: 'action';
  id: string;
  label: string;
  glyph: string;
  run: () => void;
}
type Result =
  | RouteResult
  | ActionResult
  | ProjectResult
  | TaskResult
  | NoteResult
  | SearchFallbackResult;

const PER_GROUP_LIMIT = 6;
const ROUTE_DEFS: Array<{ key: RouteKey; to: string; glyph: string }> = [
  { key: 'now', to: '/now', glyph: '●' },
  { key: 'inbox', to: '/inbox', glyph: '↓' },
  { key: 'projects', to: '/projects', glyph: '▦' },
  { key: 'review', to: '/review', glyph: '◔' },
  { key: 'search', to: '/search', glyph: '⌕' },
  { key: 'settings', to: '/settings', glyph: '⚙' },
];
const ACTION_DEFS: Array<{ key: ActionKey; glyph: string; event: string }> = [
  { key: 'newProject', glyph: '＋', event: 'rp:new-project' },
  { key: 'capture', glyph: '✎', event: 'rp:open-capture' },
  { key: 'help', glyph: '?', event: 'rp:open-shortcuts' },
];

const EMPTY_RESULTS: SearchResults = {
  query: '',
  tasks: [],
  notes: [],
  projects: [],
  artifacts: [],
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useAppData();

  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset state on open and focus the input. Re-focus + clear stale state
  // every time the palette is opened so it always feels fresh.
  useEffect(() => {
    if (!open) {
      setRawQuery('');
      setQuery('');
      setHighlightIndex(0);
      setResults(EMPTY_RESULTS);
      return;
    }
    // Remember the element that had focus before the palette opened so we
    // can restore it on close (WCAG 2.4.3 Focus Order).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus shortly after mount so the input exists in the DOM.
    const handle = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(handle);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // 100ms debounce — power-user speed.
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => setQuery(rawQuery), 100);
    return () => window.clearTimeout(handle);
  }, [rawQuery, open]);

  // Hit /api/search whenever the debounced query changes (and palette is
  // open). AbortController keeps stale responses from clobbering newer ones.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults(EMPTY_RESULTS);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;
    searchAll(trimmed, ctrl.signal)
      .then((res) => {
        if (cancelled) return;
        setResults(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: string })?.name === 'AbortError') return;
        setResults(EMPTY_RESULTS);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [open, query]);

  const projectById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) map.set(p.id, p);
    return map;
  }, [projects]);

  // Build groups based on the current query.
  const trimmed = query.trim();
  const lowered = trimmed.toLowerCase();

  const routeResults = useMemo<RouteResult[]>(() => {
    const list: RouteResult[] = ROUTE_DEFS.map((r) => ({
      kind: 'route',
      id: `route:${r.key}`,
      to: r.to,
      label: t(`nav.${r.key}` as const),
      glyph: r.glyph,
    }));
    if (!trimmed) return list;
    return list.filter((r) => r.label.toLowerCase().includes(lowered));
  }, [trimmed, lowered, t]);

  const actionResults = useMemo<ActionResult[]>(() => {
    const list: ActionResult[] = ACTION_DEFS.map((a) => ({
      kind: 'action',
      id: `action:${a.key}`,
      label: t(`palette.action_${a.key}` as const),
      glyph: a.glyph,
      run: () => window.dispatchEvent(new CustomEvent(a.event)),
    }));
    if (!trimmed) return list;
    return list.filter((a) => a.label.toLowerCase().includes(lowered));
  }, [trimmed, lowered, t]);

  const projectResults = useMemo<ProjectResult[]>(() => {
    if (!trimmed) {
      // Empty query: show top 5 pinned (the first 5 from useAppData().projects).
      // No server roundtrip needed — these are pure navigational shortcuts.
      return projects.slice(0, 5).map((p) => ({
        kind: 'project',
        id: `project:${p.id}`,
        to: `/projects/${p.id}`,
        project: p,
      }));
    }
    return results.projects.map((p) => ({
      kind: 'project',
      id: `project:${p.id}`,
      to: `/projects/${p.id}`,
      project: p,
    }));
  }, [trimmed, projects, results.projects]);

  const taskResults = useMemo<TaskResult[]>(() => {
    if (!trimmed) return [];
    return results.tasks.map((task) => ({
      kind: 'task',
      id: `task:${task.id}`,
      to: `/projects/${task.projectId}`,
      task,
      projectName: projectById.get(task.projectId)?.name ?? null,
    }));
  }, [trimmed, results.tasks, projectById]);

  const noteResults = useMemo<NoteResult[]>(() => {
    if (trimmed.length < 2) return [];
    return results.notes.map((note) => ({
      kind: 'note',
      id: `note:${note.id}`,
      to: note.projectId ? `/projects/${note.projectId}` : null,
      note,
      projectName: note.projectId
        ? projectById.get(note.projectId)?.name ?? null
        : null,
    }));
  }, [trimmed, results.notes, projectById]);

  const searchFallback = useMemo<SearchFallbackResult | null>(() => {
    if (!trimmed) return null;
    return {
      kind: 'searchFallback',
      id: 'search-fallback',
      to: `/search?q=${encodeURIComponent(trimmed)}`,
      query: trimmed,
    };
  }, [trimmed]);

  // Cap each group at PER_GROUP_LIMIT for the visible list, but keep the
  // total count for the "+N more" hint.
  interface Group {
    key: 'actions' | 'routes' | 'projects' | 'tasks' | 'notes' | 'search';
    label: string;
    visible: Result[];
    extra: number;
  }
  const groups = useMemo<Group[]>(() => {
    const g: Group[] = [];
    if (actionResults.length > 0) {
      g.push({
        key: 'actions',
        label: t('palette.groupActions'),
        visible: actionResults.slice(0, PER_GROUP_LIMIT),
        extra: Math.max(0, actionResults.length - PER_GROUP_LIMIT),
      });
    }
    if (routeResults.length > 0) {
      g.push({
        key: 'routes',
        label: t('palette.groupRoutes'),
        visible: routeResults.slice(0, PER_GROUP_LIMIT),
        extra: Math.max(0, routeResults.length - PER_GROUP_LIMIT),
      });
    }
    if (projectResults.length > 0) {
      g.push({
        key: 'projects',
        label: t('palette.groupProjects'),
        visible: projectResults.slice(0, PER_GROUP_LIMIT),
        extra: Math.max(0, projectResults.length - PER_GROUP_LIMIT),
      });
    }
    if (taskResults.length > 0) {
      g.push({
        key: 'tasks',
        label: t('palette.groupTasks'),
        visible: taskResults.slice(0, PER_GROUP_LIMIT),
        extra: Math.max(0, taskResults.length - PER_GROUP_LIMIT),
      });
    }
    if (noteResults.length > 0) {
      g.push({
        key: 'notes',
        label: t('palette.groupNotes'),
        visible: noteResults.slice(0, PER_GROUP_LIMIT),
        extra: Math.max(0, noteResults.length - PER_GROUP_LIMIT),
      });
    }
    if (searchFallback) {
      g.push({
        key: 'search',
        label: t('palette.groupSearch'),
        visible: [searchFallback],
        extra: 0,
      });
    }
    return g;
  }, [actionResults, routeResults, projectResults, taskResults, noteResults, searchFallback, t]);

  // Flatten visible results into a single navigable array.
  const flat = useMemo<Result[]>(() => {
    const out: Result[] = [];
    for (const grp of groups) out.push(...grp.visible);
    return out;
  }, [groups]);

  // Keep highlight in range when results change.
  useEffect(() => {
    if (highlightIndex >= flat.length) {
      setHighlightIndex(0);
    }
  }, [flat.length, highlightIndex]);

  const activate = useCallback(
    (r: Result) => {
      if (r.kind === 'action') {
        onClose();
        r.run();
        return;
      }
      if (r.kind === 'note' && r.to == null) return;
      if (r.kind === 'note' && r.to) {
        navigate(r.to);
      } else if (r.kind !== 'note') {
        navigate(r.to);
      }
      onClose();
    },
    [navigate, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (flat.length === 0) return;
        setHighlightIndex((idx) => (idx + 1) % flat.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (flat.length === 0) return;
        setHighlightIndex((idx) => (idx - 1 + flat.length) % flat.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = flat[highlightIndex];
        if (target) activate(target);
        return;
      }
    },
    [flat, highlightIndex, activate, onClose],
  );

  if (!open) return null;

  // Render rows with a running absolute index so the highlight bar can
  // line up across groups.
  let absIdx = 0;

  return (
    <div
      className="rd-capture-backdrop"
      onClick={onClose}
      onKeyDown={onKeyDown}
      aria-hidden="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Trap Tab inside the palette — bounce focus back to the input,
          // which is the only meaningful focusable affordance (list items
          // are role="option" navigated via ArrowKeys + Enter).
          if (e.key === 'Tab') {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
        style={{
          position: 'fixed',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: '70vh',
          background: 'var(--rd-surface)',
          color: 'var(--rd-ink)',
          border: '1px solid var(--rd-line)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 12,
            borderBottom: '1px solid var(--rd-line)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: 'var(--rd-ink-3)', fontSize: 14 }}>⌕</span>
          <input
            ref={inputRef}
            type="text"
            className="rd-input"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="rd-cmd-listbox"
            aria-activedescendant={
              flat.length > 0 ? `rd-cmd-opt-${highlightIndex}` : undefined
            }
            aria-autocomplete="list"
            value={rawQuery}
            placeholder={t('palette.placeholder')}
            onChange={(e) => {
              setRawQuery(e.target.value);
              setHighlightIndex(0);
            }}
            onKeyDown={onKeyDown}
            style={{
              flex: 1,
              padding: '0.5rem 0.5rem',
              fontSize: '1rem',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--rd-ink)',
            }}
          />
          <span className="rd-kbd">Esc</span>
        </div>

        <div
          ref={listRef}
          id="rd-cmd-listbox"
          role="listbox"
          aria-label={t('palette.title')}
          style={{
            overflow: 'auto',
            flex: 1,
            padding: '8px 0',
          }}
        >
          {!trimmed && groups.length === 0 && (
            <div
              style={{
                color: 'var(--rd-ink-3)',
                padding: '1rem',
                fontSize: 13,
              }}
            >
              {t('palette.empty')}
            </div>
          )}

          {trimmed && flat.length === 0 && (
            <div
              style={{
                color: 'var(--rd-ink-3)',
                padding: '1rem',
                fontSize: 13,
              }}
            >
              {t('palette.noMatches')}
            </div>
          )}

          {groups.map((group) => (
            <div key={group.key} style={{ padding: '6px 0' }}>
              <div
                className="rd-section-eyebrow"
                style={{ padding: '4px 14px' }}
              >
                {group.label}
              </div>
              <div>
                {group.visible.map((r) => {
                  const isActive = absIdx === highlightIndex;
                  const myIdx = absIdx;
                  absIdx += 1;
                  return (
                    <CommandRow
                      key={r.id}
                      id={`rd-cmd-opt-${myIdx}`}
                      result={r}
                      query={query}
                      active={isActive}
                      onMouseEnter={() => setHighlightIndex(myIdx)}
                      onClick={() => activate(r)}
                    />
                  );
                })}
                {group.extra > 0 && (
                  <div
                    style={{
                      padding: '4px 14px',
                      fontSize: 11.5,
                      color: 'var(--rd-ink-3)',
                    }}
                  >
                    {t('palette.moreCount', { n: group.extra })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface CommandRowProps {
  id: string;
  result: Result;
  query: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}

function CommandRow({
  id,
  result,
  query,
  active,
  onMouseEnter,
  onClick,
}: CommandRowProps) {
  const { t } = useTranslation();
  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: active ? 'var(--rd-surface-2)' : 'transparent',
    cursor: 'pointer',
    fontSize: 13.5,
    minHeight: 32,
  };

  let leftIcon: React.ReactNode = null;
  let title: React.ReactNode = null;
  let meta: React.ReactNode = null;

  if (result.kind === 'route' || result.kind === 'action') {
    leftIcon = (
      <span className="rd-glyph" aria-hidden="true" style={{ fontSize: 14 }}>
        {result.glyph}
      </span>
    );
    title = highlightMatches(result.label, query);
  } else if (result.kind === 'project') {
    const p = result.project;
    leftIcon = (
      <span
        className="rd-pdot"
        style={{ background: `var(--type-${p.type})` }}
        aria-hidden="true"
      />
    );
    title = highlightMatches(p.name, query);
  } else if (result.kind === 'task') {
    const task = result.task;
    leftIcon = (
      <span className="rd-pill" data-status={task.status}>
        <span className="rd-dot" />
        {t(`task.statusLabels.${task.status}` as const)}
      </span>
    );
    title = highlightMatches(task.title, query);
    if (result.projectName) {
      meta = (
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--rd-ink-3)',
            marginLeft: 6,
          }}
        >
          {result.projectName}
        </span>
      );
    }
  } else if (result.kind === 'note') {
    leftIcon = (
      <span aria-hidden="true" style={{ fontSize: 14 }}>
        📝
      </span>
    );
    const snippet = result.note.body.slice(0, 80);
    title = highlightMatches(snippet, query);
    if (result.projectName) {
      meta = (
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--rd-ink-3)',
            marginLeft: 6,
          }}
        >
          {result.projectName}
        </span>
      );
    }
  } else if (result.kind === 'searchFallback') {
    leftIcon = (
      <span className="rd-glyph" aria-hidden="true" style={{ fontSize: 14 }}>
        ⌕
      </span>
    );
    title = t('palette.searchFor', { query: result.query });
  }

  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={baseStyle}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 22,
          justifyContent: 'center',
        }}
      >
        {leftIcon}
      </span>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {title}
        {meta}
      </span>
      {active && (
        <span className="rd-kbd" style={{ fontFamily: 'monospace' }}>
          ↵
        </span>
      )}
    </div>
  );
}
