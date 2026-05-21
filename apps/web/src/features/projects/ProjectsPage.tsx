import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Project, ProjectType, Task, TimeframeBucket } from '@rp/shared';
import { TIMEFRAME_BUCKETS } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { PROJECT_TYPES, getProjectTypeMeta } from './projectTypes';
import { getStaleLevel } from './staleIndicator';

type Filter = 'all' | ProjectType;

// Module-scoped empty-array sentinel — passed as the `tasks` prop to
// ProjectCard for projects whose tasks haven't been fetched yet. Using
// the same reference across renders preserves prop identity, so any
// future React.memo on ProjectCard can actually skip work.
const EMPTY_TASKS: Task[] = [];

export function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects, projectTasks, fetchAllWorkspaceTasks } = useAppData();
  const [filter, setFilter] = useState<Filter>('all');
  // Empty projects (zero tasks across all statuses) accumulate from
  // testing / abandoned starts and crowd the gallery. Hide them by default;
  // the user can toggle visibility from the footer pill below the cards.
  const [showEmpty, setShowEmpty] = useState(false);

  // Lazy-load workspace tasks once when projects first arrive and the cache
  // is empty. Per-project updates after WS events are handled by
  // AppDataContext.refreshProjectTasks, so depending on `eventTick` here would
  // re-issue N parallel GETs for every mutation (the N+1 storm).
  const projectsLen = projects.length;
  const haveAnyTasks = useMemo(
    () => projects.some((p) => projectTasks[p.id] !== undefined),
    [projects, projectTasks]
  );
  useEffect(() => {
    if (projectsLen > 0 && !haveAnyTasks) {
      void fetchAllWorkspaceTasks();
    }
  }, [projectsLen, haveAnyTasks, fetchAllWorkspaceTasks]);

  // A project is "empty" if its task cache is loaded and has zero entries.
  // While the cache is still loading (undefined), treat as non-empty so we
  // don't briefly hide everything on first paint.
  const isEmpty = (id: string) => {
    const ts = projectTasks[id];
    return Array.isArray(ts) && ts.length === 0;
  };

  const filteredByType = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter((p) => p.type === filter);
  }, [projects, filter]);

  const emptyCount = useMemo(
    () => filteredByType.filter((p) => isEmpty(p.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredByType, projectTasks]
  );

  const nonEmpty = useMemo(
    () => filteredByType.filter((p) => !isEmpty(p.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredByType, projectTasks]
  );

  // If the user has nothing-but-empty projects, show them anyway so the
  // gallery isn't a confusing blank state for new users.
  const allAreEmpty = filteredByType.length > 0 && nonEmpty.length === 0;
  const filtered = showEmpty || allAreEmpty ? filteredByType : nonEmpty;

  const triggerNewProject = () => {
    window.dispatchEvent(new CustomEvent('rp:new-project'));
  };

  return (
    <div className="projects-page">
      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0 }}>{t('projectsPage.title')}</h2>
          <button
            type="button"
            className="export-button"
            onClick={triggerNewProject}
          >
            {t('projectsPage.newProject')}
          </button>
        </div>

        <div className="project-filter-pills">
          <FilterPill
            label={t('projectsPage.filterAll')}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {PROJECT_TYPES.map((meta) => (
            <FilterPill
              key={meta.type}
              label={t(meta.labelKey)}
              active={filter === meta.type}
              onClick={() => setFilter(meta.type)}
            />
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rd-empty-state">
            <span className="rd-icon" aria-hidden="true">📁</span>
            <h3>{t('projectsPage.noProjects')}</h3>
            <p>{t('projectsPage.noProjectsHint')}</p>
            <div className="rd-actions">
              <button
                type="button"
                className="rd-btn rd-btn-primary rd-btn-sm"
                onClick={triggerNewProject}
              >
                {t('projectsPage.newProject')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rd-proj-grid">
              {filtered.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  tasks={projectTasks[p.id] || EMPTY_TASKS}
                  onOpen={() => navigate(`/projects/${p.id}`)}
                />
              ))}
            </div>
            {emptyCount > 0 && !allAreEmpty && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  marginTop: '1rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowEmpty((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: '1px dashed var(--border-color, #d1d5db)',
                    borderRadius: 999,
                    padding: '4px 12px',
                    fontSize: '0.8rem',
                    color: 'var(--text-secondary, #6b7280)',
                    cursor: 'pointer',
                  }}
                >
                  {showEmpty
                    ? t('projectsPage.hideEmpty', { n: emptyCount })
                    : t('projectsPage.showEmpty', { n: emptyCount })}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'filter-pill active' : 'filter-pill'}
      style={
        active && color
          ? { borderColor: color, background: color, color: '#fff' }
          : color
          ? { borderColor: color, color }
          : undefined
      }
    >
      {label}
    </button>
  );
}

function ProjectCard({
  project,
  tasks,
  onOpen,
}: {
  project: Project;
  tasks: { status: string; timeframeBucket?: TimeframeBucket | null }[];
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const meta = getProjectTypeMeta(project.type);

  const counts = useMemo(() => {
    let doing = 0;
    let todo = 0;
    let blocked = 0;
    let done = 0;
    for (const tk of tasks) {
      if (tk.status === 'doing') doing++;
      else if (tk.status === 'todo') todo++;
      else if (tk.status === 'blocked') blocked++;
      else if (tk.status === 'done') done++;
    }
    return { doing, todo, blocked, done };
  }, [tasks]);

  // Per-bucket counts for the small "active buckets" strip below the stats.
  // Only non-done tasks count — we're showing live commitments, not history.
  const bucketCounts = useMemo(() => {
    const out: Record<TimeframeBucket, number> = {
      week: 0, month: 0, quarter: 0, year: 0, someday: 0,
    };
    for (const tk of tasks) {
      if (tk.status === 'done') continue;
      if (tk.timeframeBucket) out[tk.timeframeBucket]++;
    }
    return out;
  }, [tasks]);
  const hasAnyBucket = useMemo(
    () => Object.values(bucketCounts).some((n) => n > 0),
    [bucketCounts]
  );

  const stale = getStaleLevel(project.updatedAt);
  const staleLabel =
    stale.level === 'fresh'
      ? t('projectsPage.stale.fresh')
      : t(`projectsPage.stale.${stale.level}` as const, { n: stale.days });

  // Mini-flow bar — ratio of doing / blocked / todo / done across this
  // project's tasks. Empty projects show no bar.
  const total = counts.doing + counts.blocked + counts.todo + counts.done;
  const seg = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0');

  return (
    <button
      type="button"
      className="rd-proj-card"
      data-type={project.type}
      onClick={onOpen}
    >
      <div className="rd-proj-card-head">
        <span className="rd-name">{project.name}</span>
        <span className="rd-type-chip">{t(meta.labelKey)}</span>
      </div>
      {project.description && (
        <div className="rd-proj-card-desc">{project.description}</div>
      )}

      <div className="rd-proj-stats">
        <div className="rd-stat">
          <span className="rd-num">{counts.doing}</span>
          {t('projectsPage.stats.doing')}
        </div>
        <div className="rd-stat">
          <span className="rd-num">{counts.blocked}</span>
          {t('projectsPage.stats.blocked')}
        </div>
        <div className="rd-stat">
          <span className="rd-num">{counts.todo}</span>
          {t('projectsPage.stats.todo')}
        </div>
        <div className="rd-stat">
          <span className="rd-num">{counts.done}</span>
          {t('projectsPage.stats.done')}
        </div>
      </div>

      {hasAnyBucket && (
        <div
          className="rd-proj-buckets"
          role="group"
          aria-label={t('timeframe.label')}
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 6,
            fontSize: 11.5,
            color: 'var(--rd-ink-3)',
            flexWrap: 'wrap',
          }}
        >
          {TIMEFRAME_BUCKETS.map((b) => {
            const n = bucketCounts[b];
            if (n === 0) return null;
            return (
              <span
                key={b}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span
                  className="rd-tf-chip-dot"
                  data-bucket={b}
                  aria-hidden="true"
                />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n}</span>
              </span>
            );
          })}
        </div>
      )}

      {total > 0 && (
        <div className="rd-proj-flow" aria-hidden="true">
          {counts.doing > 0 && (
            <div
              className="rd-seg"
              style={{ width: seg(counts.doing), background: 'var(--rd-st-doing)' }}
            />
          )}
          {counts.blocked > 0 && (
            <div
              className="rd-seg"
              style={{ width: seg(counts.blocked), background: 'var(--rd-st-blocked)' }}
            />
          )}
          {counts.todo > 0 && (
            <div
              className="rd-seg"
              style={{ width: seg(counts.todo), background: 'var(--rd-st-todo)' }}
            />
          )}
          {counts.done > 0 && (
            <div
              className="rd-seg"
              style={{ width: seg(counts.done), background: 'var(--rd-st-done)' }}
            />
          )}
        </div>
      )}

      <div className="rd-proj-card-foot">
        <span>{staleLabel}</span>
        {stale.level === 'dormant' && (
          <span className="rd-dormant">{t('projectsPage.stats.dormant') || 'dormant'}</span>
        )}
        {project.mode === 'deadline' && (
          <span style={{ marginLeft: 'auto', color: 'oklch(0.55 0.13 70)', fontWeight: 600 }}>
            ⌛ {t('project.mode.deadline')}
          </span>
        )}
      </div>
    </button>
  );
}
