import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Note, Project, Task, TimeframeBucket } from '@rp/shared';
import { TIMEFRAME_BUCKETS } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { getProjectTypeMeta } from '../projects/projectTypes';
import { setTaskFocus } from '../../api/tasks';
import { sendJson } from '../../api/client';
import { getProjectNotes } from '../../api/notes';
import { STATUS_COLOR, nextStatus } from '../tasks/statusMeta';
import { deriveIntensity } from '../../shared/intensity';
import { useIntensityBudget } from '../settings/settingsStore';
import { useToast } from '../../components/Toast';
import { computeTimeframeStatus, groupTasksByTimeframe } from '../tasks/timeframe';
import { TimeframeBadge } from '../tasks/TimeframeBadge';
import { StaleBadge } from '../tasks/StaleBadge';
import { SizeChip } from '../tasks/SizeChip';
import { IntensityBars } from '../tasks/IntensityBars';
import {
  briefingLastSeenKey,
  countWeekPastWindow,
  resolveLastVisitMs,
  summarizeMovement,
  summarizeOpenThreads,
  summarizeStuck,
  sumDoingIntensity,
} from './briefing';

interface TaskWithProject {
  task: Task;
  project: Project;
}

const BRIEFING_STALE_DAYS = 3;

function briefingDismissalKey(projectId: string) {
  return `rp.briefing.dismissed.${projectId}`;
}

export function NowPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const {
    projects,
    projectTasks,
    fetchAllWorkspaceTasks,
    refreshProjectTasks,
  } = useAppData();

  // Lazy-load all workspace tasks once after projects are populated and we
  // don't yet have any cache. WS events trigger per-project refresh inside
  // AppDataContext (see refreshProjectTasks), so we don't re-fan-out N gets
  // on every eventTick — that was the N+1 storm.
  const projectsLen = projects.length;
  // Re-fan when *any* project hasn't been fetched yet (covers newly-created
  // projects mid-session — previously `some()` flipped true after the first
  // project and never re-triggered for new ones).
  const allProjectsCached = useMemo(
    () =>
      projects.length > 0 && projects.every((p) => projectTasks[p.id] !== undefined),
    [projects, projectTasks]
  );
  useEffect(() => {
    if (projectsLen > 0 && !allProjectsCached) {
      void fetchAllWorkspaceTasks();
    }
  }, [projectsLen, allProjectsCached, fetchAllWorkspaceTasks]);

  const allTasks = useMemo<TaskWithProject[]>(() => {
    const out: TaskWithProject[] = [];
    for (const project of projects) {
      const ts = projectTasks[project.id];
      if (!ts) continue;
      for (const task of ts) out.push({ task, project });
    }
    return out;
  }, [projects, projectTasks]);

  // Hoisted out of `timeframeGroups` below — projects change far less often
  // than `allTasks` (which churns on every WS event tick), so rebuilding this
  // Map per-tick was wasted work.
  const projectById = useMemo(
    () => new Map<string, Project>(projects.map((p) => [p.id, p])),
    [projects]
  );

  const doingTasks = useMemo(
    () => allTasks.filter((x) => x.task.status === 'doing'),
    [allTasks]
  );
  const blockedTasks = useMemo(
    () => allTasks.filter((x) => x.task.status === 'blocked'),
    [allTasks]
  );

  const focusedTasks = useMemo(
    () =>
      allTasks
        .filter((x) => Boolean(x.task.focusedAt))
        .sort(
          (a, b) =>
            new Date(b.task.focusedAt!).getTime() -
            new Date(a.task.focusedAt!).getTime()
        ),
    [allTasks]
  );
  const focusedShown = focusedTasks.slice(0, 5);
  const focusedExtra = Math.max(0, focusedTasks.length - focusedShown.length);

  // When the visible list is single-project we hide the project-name column —
  // it's just noise. Computed per-section.
  const focusedSingleProject =
    new Set(focusedShown.map((x) => x.project.id)).size <= 1;
  const doingSingleProject =
    new Set(doingTasks.map((x) => x.project.id)).size <= 1;
  const blockedSingleProject =
    new Set(blockedTasks.map((x) => x.project.id)).size <= 1;

  // Round 16 design call: a task already surfaced in an upstream
  // state-based section (Top of Mind / Doing / Blocked) is hidden from
  // its bucket section. The bucket section's purpose becomes "bucketed
  // tasks not currently on the radar" — typically todo/review work with
  // future-time commitment. The state-based row already carries the
  // bucket badge inline, so no info is lost; just no row duplication.
  const upstreamCoveredIds = useMemo(() => {
    const set = new Set<string>();
    for (const x of focusedTasks) set.add(x.task.id);
    for (const x of doingTasks) set.add(x.task.id);
    for (const x of blockedTasks) set.add(x.task.id);
    return set;
  }, [focusedTasks, doingTasks, blockedTasks]);

  // Group non-done, not-already-shown tasks with a timeframe bucket.
  const timeframeGroups = useMemo(() => {
    const taskGroups = groupTasksByTimeframe(allTasks.map((x) => x.task));
    const out: Record<TimeframeBucket, TaskWithProject[]> = {
      week: [],
      month: [],
      quarter: [],
      year: [],
      someday: [],
    };
    for (const bucket of Object.keys(taskGroups) as TimeframeBucket[]) {
      for (const tk of taskGroups[bucket]) {
        if (upstreamCoveredIds.has(tk.id)) continue;
        const proj = projectById.get(tk.projectId);
        if (proj) out[bucket].push({ task: tk, project: proj });
      }
    }
    return out;
  }, [allTasks, projectById, upstreamCoveredIds]);
  const hasAnyTimeframed = useMemo(
    () => Object.values(timeframeGroups).some((arr) => arr.length > 0),
    [timeframeGroups]
  );

  // Stable identities — every NowTaskRow gets these as props and would
  // otherwise rebind on every WS-event tick. Wrapped here so any future
  // React.memo on NowTaskRow actually skips re-renders when only the
  // tasks array reference changed (with no row data churn).
  const handleOpen = useCallback(
    (projectId: string) => navigate(`/projects/${projectId}`),
    [navigate]
  );

  const handleToggleFocus = useCallback(
    async (task: Task) => {
      try {
        await setTaskFocus(task.id, !task.focusedAt);
        await refreshProjectTasks(task.projectId);
      } catch (err) {
        toast.push(
          err instanceof Error ? err.message : t('now.errorToggleFocus'),
          { kind: 'error' },
        );
      }
    },
    [refreshProjectTasks, toast, t]
  );

  // handleApplyPatch closes over allTasks for the same-project refresh
  // shortcut. The dep here is `allTasks` rather than `projectTasks` so
  // the closure has the latest tasks-with-projects mapping.
  const handleApplyPatch = useCallback(
    async (taskId: string, patch: Partial<Task>) => {
      try {
        await sendJson(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        // The WS event tick will refresh, but kick the project tasks too so the
        // /now derived lists reflect immediately.
        const tx = allTasks.find((x) => x.task.id === taskId);
        if (tx) await refreshProjectTasks(tx.project.id);
      } catch (err) {
        toast.push(
          err instanceof Error ? err.message : t('now.errorApplyPatch'),
          { kind: 'error' },
        );
      }
    },
    [allTasks, refreshProjectTasks, toast, t]
  );

  // Greeting based on local time. Adopts the redesign's "Good morning."
  // pattern with the date appended in muted text.
  const now = new Date();
  const hour = now.getHours();
  const greetKey =
    hour < 5 ? 'now.greetNight'
    : hour < 12 ? 'now.greetMorning'
    : hour < 18 ? 'now.greetAfternoon'
    : 'now.greetEvening';
  const dateLine = now.toLocaleDateString(i18n.language, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  // Pick the briefing target — STALE-ONLY behavior. The briefing card is a
  // "you've been gone a while, here's where you left off" surface, so it only
  // shows when there's an idle project worth re-entering.
  //
  // Preference order:
  //   1. The focused-task's project, ONLY IF it's been idle >= 3 days.
  //   2. Otherwise the single most-stale project (highest idleDays) that's
  //      also past the 3-day threshold AND not dismissed via sessionStorage.
  //   3. Otherwise: render no briefing.
  const briefingProject: Project | null = useMemo(() => {
    function idleDaysFor(p: Project): number {
      return Math.floor(
        (Date.now() - new Date(p.updatedAt).getTime()) / 86_400_000
      );
    }
    function isDismissed(projectId: string): boolean {
      if (typeof window === 'undefined') return false;
      try {
        return (
          window.sessionStorage.getItem(briefingDismissalKey(projectId)) === '1'
        );
      } catch {
        return false;
      }
    }
    // 1. Focused-task project, if stale and not dismissed.
    if (focusedTasks.length > 0) {
      const fp = focusedTasks[0].project;
      if (idleDaysFor(fp) >= BRIEFING_STALE_DAYS && !isDismissed(fp.id)) {
        return fp;
      }
    }
    // 2. Most-stale non-dismissed project past the threshold.
    const candidates = projects
      .filter((p) => idleDaysFor(p) >= BRIEFING_STALE_DAYS && !isDismissed(p.id))
      .sort((a, b) => idleDaysFor(b) - idleDaysFor(a));
    return candidates[0] ?? null;
  }, [focusedTasks, projects]);

  const briefingTasks = useMemo(() => {
    if (!briefingProject) return [];
    return allTasks
      .filter((x) => x.project.id === briefingProject.id)
      .map((x) => x.task);
  }, [allTasks, briefingProject]);

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('nav.now')}</h1>
        <span className="rd-meta">{dateLine}</span>
        <span className="rd-spacer" />
      </div>
      <div className="rd-page">
        {/* Greeting band — friendly, time-aware. The accented date sits
            inline so the eye reads it as a single sentence. */}
        <div>
          <div className="rd-now-greeting">
            {t(greetKey)} <span className="rd-accent">{dateLine}.</span>
          </div>
          <div className="rd-now-sub">
            {projectsLen > 0 && !allProjectsCached
              ? // While the initial fetch is in flight, render a neutral
                // sub-line instead of "0 doing · 0 blocked · 0 pinned"
                // which would be a lie before the data arrives.
                t('now.loadingSummary')
              : t('now.summary', {
                  doing: doingTasks.length,
                  blocked: blockedTasks.length,
                  focused: focusedShown.length,
                })}
          </div>
        </div>

        {briefingProject && (
          <NowBriefingCard
            project={briefingProject}
            tasks={briefingTasks}
            onOpen={() => handleOpen(briefingProject.id)}
          />
        )}

        {/* Two-column grid: sections (left) + capacity rail (right). */}
        <div className="rd-now-grid">
          <div>
            <NowSection
              label={t('now.title')}
              count={focusedShown.length}
              color="var(--focus)"
              empty={
                <div className="rd-empty-state">
                  <span className="rd-icon" aria-hidden="true">⭐</span>
                  <p>{t('now.topOfMindEmpty')}</p>
                  <div className="rd-actions">
                    <button
                      type="button"
                      className="rd-btn rd-btn-ghost rd-btn-sm"
                      onClick={() => navigate('/projects')}
                    >
                      {t('now.topOfMindCta')}
                    </button>
                  </div>
                </div>
              }
            >
              {focusedShown.map(({ task, project }) => (
                <NowTaskRow
                  key={task.id}
                  task={task}
                  project={project}
                  showProject={!focusedSingleProject}
                  onClick={() => handleOpen(project.id)}
                  onToggleFocus={handleToggleFocus}
                  onApplyPatch={handleApplyPatch}
                />
              ))}
              {focusedExtra > 0 && (
                <p className="empty-hint" style={{ marginTop: 8 }}>
                  {t('now.topOfMindMoreCount', { n: focusedExtra })}
                </p>
              )}
            </NowSection>

            <NowSection
              label={t('now.doing')}
              count={doingTasks.length}
              color="var(--rd-st-doing)"
              empty={
                <div className="rd-empty-state">
                  <span className="rd-icon" aria-hidden="true">▶</span>
                  <p>{t('now.doingEmpty')}</p>
                  <p style={{ fontSize: 12 }}>{t('now.doingHint')}</p>
                </div>
              }
            >
              {doingTasks.map(({ task, project }) => (
                <NowTaskRow
                  key={task.id}
                  task={task}
                  project={project}
                  showProject={!doingSingleProject}
                  onClick={() => handleOpen(project.id)}
                  onToggleFocus={handleToggleFocus}
                  onApplyPatch={handleApplyPatch}
                />
              ))}
            </NowSection>

            {blockedTasks.length > 0 && (
              <NowSection
                label={t('now.blocked')}
                count={blockedTasks.length}
                color="var(--rd-st-blocked)"
              >
                {blockedTasks.map(({ task, project }) => (
                  <NowTaskRow
                    key={task.id}
                    task={task}
                    project={project}
                    showProject={!blockedSingleProject}
                    onClick={() => handleOpen(project.id)}
                    onToggleFocus={handleToggleFocus}
                    onApplyPatch={handleApplyPatch}
                  />
                ))}
              </NowSection>
            )}

            {hasAnyTimeframed && (
              // <details> wrapper: on desktop CSS forces it open + hides the
              // summary's chevron, so the bucket sections render flat as
              // before. On mobile (≤720px) the summary becomes a tappable
              // disclosure header so the 5 bucket sections collapse behind
              // one toggle — keeps above-the-fold real estate manageable.
              <details className="rd-now-tf-wrap" open>
                <summary className="rd-now-tf-summary">
                  {t('now.byTimeframeEyebrow')}
                </summary>
                {TIMEFRAME_BUCKETS.map((bucket) => {
                  const list = timeframeGroups[bucket];
                  if (list.length === 0) return null;
                  // Past-window count: tasks whose anchor + bucket.days has
                  // already elapsed. 'someday' never reads as past.
                  const pastCount =
                    bucket === 'someday'
                      ? 0
                      : list.filter(({ task }) => {
                          const s = computeTimeframeStatus(
                            task.timeframeBucket,
                            task.timeframeAnchor
                          );
                          return s?.isPast === true;
                        }).length;
                  const label = pastCount
                    ? `${t(`timeframe.buckets.${bucket}` as const)} · ${t(
                        'now.timeframePast',
                        { n: pastCount }
                      )}`
                    : t(`timeframe.buckets.${bucket}` as const);
                  const singleProject =
                    new Set(list.map((x) => x.project.id)).size <= 1;
                  return (
                    <NowSection
                      key={bucket}
                      label={label}
                      count={list.length}
                      color={`var(--tf-${bucket})`}
                    >
                      {list.map(({ task, project }) => (
                        <NowTaskRow
                          key={`tf-${bucket}-${task.id}`}
                          task={task}
                          project={project}
                          showProject={!singleProject}
                          onClick={() => handleOpen(project.id)}
                          onToggleFocus={handleToggleFocus}
                          onApplyPatch={handleApplyPatch}
                        />
                      ))}
                    </NowSection>
                  );
                })}
              </details>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <CapacityRail focused={focusedShown.map((x) => x.task)} />
            <Last14DaysCard tasks={allTasks.map((x) => x.task)} />
            <QuickCaptureCard
              onOpen={() =>
                window.dispatchEvent(new CustomEvent('rp:open-capture'))
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** Section block — eyebrow head + colored dot + count + sep line.
 *  Replaces the prior card-with-bottom-rule pattern. */
function NowSection({
  label,
  count,
  color,
  children,
  empty,
}: {
  label: string;
  count: number;
  color: string;
  children: React.ReactNode;
  empty?: React.ReactNode;
}) {
  const isEmpty =
    React.Children.count(children) === 0 ||
    (Array.isArray(children) && (children as unknown[]).every((c) => !c));
  return (
    <section className="rd-now-section">
      <div className="rd-now-section-head">
        <span className="rd-mark" style={{ background: color }} aria-hidden="true" />
        <h2>{label}</h2>
        {count > 0 && <span className="rd-count">{count}</span>}
        <div className="rd-sep" />
      </div>
      {isEmpty ? (
        typeof empty === 'string' || empty == null ? (
          <div className="muted" style={{ padding: '8px 4px', fontSize: 12 }}>
            {empty || ''}
          </div>
        ) : (
          empty
        )
      ) : (
        children
      )}
    </section>
  );
}

/** Capacity rail — right column on /now. Today's intensity-points used
 *  vs. budget, with a 14-day intensity heat strip below. Intensity is
 *  derived from task size (xs..xl → 1..5) since the schema doesn't yet
 *  carry a dedicated `intensity` column. The shape is what matters: the
 *  user sees a daily cognitive-load gauge instead of an hours-remaining
 *  count. */
function CapacityRail({ focused }: { focused: Task[] }) {
  const { t } = useTranslation();
  const intensities = focused.map(deriveIntensity);
  const used = intensities.reduce((a, b) => a + b, 0);
  const budget = useIntensityBudget();
  const overBudget = used > budget;
  const overshootPct = overBudget
    ? Math.min(60, ((used - budget) / budget) * 100)
    : 0;
  const denom = overBudget ? used : budget;
  const segs = focused.map((task, i) => ({
    id: task.id,
    width: (intensities[i] / denom) * 100,
    color: `var(--intens-${intensities[i]})`,
    title: task.title,
  }));
  const fillPct = (used / denom) * 100;
  return (
    <div className="rd-capacity-card">
      <div className="rd-capacity-title">{t('now.capacityTitle')}</div>
      <div className={`rd-capacity-num${overBudget ? ' over' : ''}`}>
        {used}
        <span className="rd-of">/{budget}</span>
        {overBudget && (
          <span className="rd-over-tag">
            {t('now.overBy', { n: used - budget })}
          </span>
        )}
      </div>
      <div className="rd-capacity-label">{t('now.intensityCommitted')}</div>
      <div
        className={`rd-capacity-track${overBudget ? ' over' : ''}`}
        aria-label={`${used} of ${budget} used`}
      >
        <div
          className="rd-capacity-track-inner"
          style={{ width: overBudget ? `${100 + overshootPct}%` : '100%' }}
        >
          {segs.map((s) => (
            <div
              key={s.id}
              className="rd-seg"
              style={{ width: `${s.width}%`, background: s.color }}
              title={s.title}
            />
          ))}
          {!overBudget && (
            <div
              className="rd-seg"
              style={{ width: `${100 - fillPct}%`, background: 'transparent' }}
            />
          )}
        </div>
        {overBudget && (
          <div
            className="rd-capacity-budget-line"
            style={{ left: `${(budget / used) * 100}%` }}
          >
            <span className="rd-capacity-budget-tag">
              {t('now.budget')}
            </span>
          </div>
        )}
      </div>
      {focused.length > 0 && (
        <div className="rd-capacity-legend">
          {focused.map((task, i) => (
            <div key={task.id} className="rd-row">
              <span
                className="rd-swatch"
                style={{ background: `var(--intens-${intensities[i]})` }}
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {task.title}
              </span>
              <span className="rd-val">×{intensities[i]}</span>
            </div>
          ))}
        </div>
      )}
      <div
        className="muted"
        style={{ marginTop: 14, fontSize: 11.5, lineHeight: 1.5 }}
      >
        {t('now.capacityHint')}
      </div>
    </div>
  );
}

/** 14-day intensity heat strip. Each cell is the summed intensity of tasks
 *  that "happened" that day (started, finished, or were focused) — capped
 *  to 1..5 for the colour scale. */
function Last14DaysCard({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation();
  const cells = useMemo(() => {
    const days: number[] = new Array(14).fill(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const task of tasks) {
      const intensity = deriveIntensity(task);
      const stamps = [task.startedAt, task.finishedAt, task.focusedAt];
      for (const s of stamps) {
        if (!s) continue;
        const d = new Date(s);
        d.setHours(0, 0, 0, 0);
        const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
        if (diff >= 0 && diff < 14) {
          // Index 0 is the leftmost = oldest day in the strip.
          const idx = 13 - diff;
          days[idx] = Math.min(5, days[idx] + intensity);
        }
      }
    }
    return days;
  }, [tasks]);

  return (
    <div className="rd-capacity-card" style={{ padding: 16 }}>
      <div className="rd-capacity-title" style={{ marginBottom: 10 }}>
        {t('now.last14Days')}
      </div>
      <div className="rd-heat">
        {cells.map((l, i) => (
          // eslint-disable-next-line react/no-array-index-key -- fixed 14-cell grid; index IS the day offset
          <div
            key={i}
            className="rd-cell"
            data-l={l > 0 ? String(l) : ''}
          />
        ))}
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>
        {t('now.last14DaysCaption')}
      </div>
    </div>
  );
}

/** Quick-capture entry card — fires the global rp:open-capture event so
 *  whatever capture surface is mounted (modal, sheet) opens. */
function QuickCaptureCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rd-capacity-card" style={{ padding: 16 }}>
      <div className="rd-capacity-title" style={{ marginBottom: 10 }}>
        {t('now.quickCapture')}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {t('now.quickCapturePrompt')}
      </div>
      <button
        type="button"
        className="rd-btn rd-btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={onOpen}
      >
        {t('now.quickCaptureCta')}{' '}
        <span
          className="mono"
          style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.7 }}
        >
          ⌘⇧N
        </span>
      </button>
    </div>
  );
}

/** Inline briefing card on /now. Only mounted when the gate in NowPage
 *  decides the focused (or most-stale) project has been idle >=3 days and
 *  hasn't already been dismissed for this session. Dismiss writes the same
 *  per-project sessionStorage key used by ProjectBriefing on /projects/:id,
 *  so the two surfaces stay in sync. */
function NowBriefingCard({
  project,
  tasks,
  onOpen,
}: {
  project: Project;
  tasks: Task[];
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const meta = getProjectTypeMeta(project.type);
  const budget = useIntensityBudget();

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return (
        window.sessionStorage.getItem(briefingDismissalKey(project.id)) === '1'
      );
    } catch {
      return false;
    }
  });

  // Reset the dismissal-state read when the targeted project changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDismissed(
        window.sessionStorage.getItem(briefingDismissalKey(project.id)) === '1'
      );
    } catch {
      setDismissed(false);
    }
  }, [project.id]);

  // Project-specific notes for the open-threads cell. The /now context
  // doesn't pre-fetch project notes (only the workspace inbox), so we go
  // direct here. Re-fetch on project change. Errors silently degrade to
  // "no open threads" so the rest of the card still renders.
  const [projectNotes, setProjectNotes] = useState<Note[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!project.id) return;
    void (async () => {
      try {
        const ns = await getProjectNotes(project.id);
        if (!cancelled) setProjectNotes(ns);
      } catch {
        if (!cancelled) setProjectNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Resolve the lastVisit anchor once per project. Pull from localStorage
  // (set on prior visits) or fall back to project.updatedAt − 14d. Memoized
  // so movement summary is stable across re-renders within the same visit.
  const lastVisitMs = useMemo(
    () => resolveLastVisitMs(project.id, project.updatedAt, 14),
    [project.id, project.updatedAt]
  );

  // Stamp this visit on the next-visit anchor. Run once when the card first
  // shows (effectively on mount) — we deliberately do NOT update on every
  // re-render so the comparison stays meaningful within the session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        briefingLastSeenKey(project.id),
        String(Date.now())
      );
    } catch {
      /* ignore */
    }
  }, [project.id]);

  if (dismissed) return null;

  function handleSnooze() {
    try {
      window.sessionStorage.setItem(briefingDismissalKey(project.id), '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  const blockedCount = tasks.filter((tk) => tk.status === 'blocked').length;
  const focusedTasks = tasks
    .filter((tk) => Boolean(tk.focusedAt))
    .sort((a, b) =>
      new Date(b.focusedAt!).getTime() - new Date(a.focusedAt!).getTime()
    );
  const lastTouchedRel = (() => {
    const days = Math.floor(
      (Date.now() - new Date(project.updatedAt).getTime()) / 86_400_000
    );
    if (days <= 0) return t('now.briefingDefaultHeadline');
    return t('briefing.lastTouched', {
      when:
        days === 1
          ? t('time.dayAgo', { defaultValue: 'a day ago' })
          : t('time.daysAgo', { count: days, defaultValue: `${days} days ago` }),
    });
  })();

  const lastActivityText = focusedTasks.length > 0
    ? focusedTasks[0].title
    : null;
  const looseEndText = blockedCount > 0
    ? t('briefing.looseEndBlocked', { count: blockedCount })
    : null;
  const openThoughtText = project.description
    ? `"${project.description.length > 110 ? `${project.description.slice(0, 110)}…` : project.description}"`
    : null;

  // --- Enriched briefing fields (PRD: "context on re-entry"). Each is null
  // when there's nothing useful to surface — we skip rendering the cell
  // entirely rather than show "0 tasks moved".

  // Movement since last visit. Three sub-lines: aggregate counts, last
  // shipped task title, freshly-created tasks.
  const movement = summarizeMovement(tasks, lastVisitMs);
  const movementLines: string[] = [];
  if (movement) {
    const { toDoing, toDone, toBlocked } = movement;
    const moveCount = (toDoing > 0 ? 1 : 0) + (toDone > 0 ? 1 : 0) + (toBlocked > 0 ? 1 : 0);
    if (moveCount >= 2) {
      movementLines.push(
        t('now.briefing.movedSummary', { toDoing, toDone, toBlocked })
      );
    } else if (toDoing > 0) {
      movementLines.push(t('now.briefing.movedDoingOnly', { n: toDoing }));
    } else if (toDone > 0) {
      movementLines.push(t('now.briefing.movedDoneOnly', { n: toDone }));
    } else if (toBlocked > 0) {
      movementLines.push(t('now.briefing.movedBlockedOnly', { n: toBlocked }));
    }
    if (movement.lastShippedTitle) {
      movementLines.push(
        t('now.briefing.lastShipped', { title: movement.lastShippedTitle })
      );
    }
  }
  // New tasks rendered as a separate cell — count or list, never both.
  const newTasksText = (() => {
    if (!movement) return null;
    if (movement.newTaskTitles && movement.newTaskTitles.length > 0) {
      return t('now.briefing.newTasksList', {
        titles: movement.newTaskTitles.map((tt) => `«${tt}»`).join(', '),
      });
    }
    if (movement.newTaskCount > 0) {
      return t('now.briefing.newTasksMany', { n: movement.newTaskCount });
    }
    return null;
  })();

  // Past-window week-bucket tasks.
  const pastWeek = countWeekPastWindow(tasks);
  const pastWeekText = pastWeek > 0
    ? t(
        pastWeek === 1
          ? 'now.briefing.pastWeekWindow'
          : 'now.briefing.pastWeekWindowPlural',
        { n: pastWeek }
      )
    : null;

  // Stuck — doing >7d or blocked.
  const stuck = summarizeStuck(tasks);
  const stuckText = (() => {
    if (!stuck) return null;
    if (stuck.loneTitle) return t('now.briefing.stuckLone', { title: stuck.loneTitle });
    if (stuck.doingStuckCount > 0 && stuck.blockedCount > 0) {
      return t('now.briefing.stuckBoth', {
        doing: stuck.doingStuckCount,
        blocked: stuck.blockedCount,
      });
    }
    if (stuck.doingStuckCount > 0) {
      return t('now.briefing.stuckDoingOnly', { n: stuck.doingStuckCount });
    }
    return t('now.briefing.stuckBlockedOnly', { n: stuck.blockedCount });
  })();

  // Over-capacity warning. Skipped when within budget.
  const doingIntensity = sumDoingIntensity(tasks);
  const overCapacityText = doingIntensity > budget
    ? t('now.briefing.overCapacity', { used: doingIntensity, budget })
    : null;

  // Open project-notes from the last 14d.
  const openThreads = summarizeOpenThreads(projectNotes);
  const openThreadsText = (() => {
    if (!openThreads) return null;
    const head =
      openThreads.count === 1
        ? t('now.briefing.openThreadsOne')
        : t('now.briefing.openThreadsMany', { n: openThreads.count });
    return openThreads.snippet ? `${head} · "${openThreads.snippet}"` : head;
  })();

  const hasAnyCell =
    lastActivityText ||
    looseEndText ||
    openThoughtText ||
    movementLines.length > 0 ||
    newTasksText ||
    pastWeekText ||
    stuckText ||
    overCapacityText ||
    openThreadsText;

  return (
    <section
      className="rd-briefing"
      role="region"
      aria-label={t('briefing.title')}
    >
      <button
        type="button"
        className="rd-briefing-close"
        onClick={handleSnooze}
        title={t('briefing.dismiss')}
        aria-label={t('briefing.dismiss')}
      >
        ×
      </button>
      <div className="rd-briefing-eyebrow">
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: meta.color,
          }}
          aria-hidden="true"
        />
        {t('briefing.title')} · {project.name}
      </div>
      <h2>{lastTouchedRel}</h2>
      {hasAnyCell && (
        <div className="rd-briefing-grid">
          {movementLines.length > 0 && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('now.briefing.sinceLastVisit')}</div>
              <div className="rd-val">
                {movementLines.map((line, i) => (
                  <div key={i} style={i > 0 ? { marginTop: 2 } : undefined}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
          {newTasksText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('now.briefing.newTasks')}</div>
              <div className="rd-val">{newTasksText}</div>
            </div>
          )}
          {lastActivityText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('briefing.recentActivity')}</div>
              <div className="rd-val">{lastActivityText}</div>
            </div>
          )}
          {stuckText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('now.briefing.stuck')}</div>
              <div className="rd-val">{stuckText}</div>
            </div>
          )}
          {looseEndText && !stuckText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('briefing.looseEnd')}</div>
              <div className="rd-val">{looseEndText}</div>
            </div>
          )}
          {pastWeekText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('timeframe.buckets.week')}</div>
              <div className="rd-val">{pastWeekText}</div>
            </div>
          )}
          {overCapacityText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('now.briefing.capacity')}</div>
              <div className="rd-val">{overCapacityText}</div>
            </div>
          )}
          {openThreadsText && (
            <button
              type="button"
              className="rd-briefing-cell rd-briefing-cell--action"
              onClick={() => navigate('/inbox')}
              title={t('now.briefing.openThreadsCta')}
            >
              <div className="rd-lbl">{t('now.briefing.openThreads')}</div>
              <div className="rd-val">{openThreadsText}</div>
            </button>
          )}
          {openThoughtText && (
            <div className="rd-briefing-cell">
              <div className="rd-lbl">{t('briefing.openThought')}</div>
              <div className="rd-val">{openThoughtText}</div>
            </div>
          )}
        </div>
      )}
      <div className="rd-briefing-actions">
        <button
          type="button"
          className="rd-btn rd-btn-primary rd-btn-sm"
          onClick={onOpen}
        >
          {t('briefing.backToWork')}
        </button>
        {/* Removed the no-op "Loose end" CTA — its intent was unclear and
            the actual loose-end signal is the "Loose end" / "Stuck" cell
            in the grid above. The user can click into the project (Back
            to work) and the task list will surface stuck tasks. */}
        <button
          type="button"
          className="rd-btn rd-btn-ghost rd-btn-sm"
          onClick={handleSnooze}
        >
          {t('briefing.dismiss')}
        </button>
      </div>
    </section>
  );
}

function NowTaskRow({
  task,
  project,
  showProject,
  onClick,
  onToggleFocus,
  onApplyPatch,
}: {
  task: Task;
  project: Project;
  showProject: boolean;
  onClick: () => void;
  onToggleFocus?: (task: Task) => void;
  onApplyPatch?: (taskId: string, patch: Partial<Task>) => void;
}) {
  const { t } = useTranslation();
  const meta = getProjectTypeMeta(project.type);
  const isFocused = Boolean(task.focusedAt);

  // (Previously computed `daysAgo` locally for the rightmost stale-text
  // slot — removed in Round 15. StaleBadge covers both doing- and blocked-
  // stale uniformly now.)

  const statusLabels: Record<Task['status'], string> = {
    todo: t('task.statusLabels.todo'),
    doing: t('task.statusLabels.doing'),
    blocked: t('task.statusLabels.blocked'),
    review: t('task.statusLabels.review'),
    done: t('task.statusLabels.done'),
  };

  // Leading vertical bar uses --focus when this task is pinned, otherwise
  // the status colour. Set inline as the CSS custom property.
  const rowStatusColor = isFocused
    ? 'var(--focus)'
    : STATUS_COLOR[task.status];

  return (
    <div
      className="rd-task-row"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ ['--rd-row-status' as string]: rowStatusColor } as React.CSSProperties}
    >
      <button
        type="button"
        className={`rd-pin${isFocused ? ' on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (onToggleFocus) onToggleFocus(task);
        }}
        aria-label={isFocused ? t('task.unpinFocus') : t('task.pinFocus')}
        aria-pressed={isFocused}
      >
        {isFocused ? '★' : '☆'}
      </button>

      {onApplyPatch ? (
        <button
          type="button"
          className="rd-pill"
          data-status={task.status}
          onClick={(e) => {
            e.stopPropagation();
            void onApplyPatch(task.id, { status: nextStatus(task.status) });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onClick();
          }}
          title={t('task.cycleStatus')}
          aria-label={`${statusLabels[task.status]} — ${t('task.cycleStatus')}`}
        >
          <span className="rd-dot" />
          {statusLabels[task.status]}
        </button>
      ) : (
        <span className="rd-pill" data-status={task.status}>
          <span className="rd-dot" />
          {statusLabels[task.status]}
        </span>
      )}

      <div>
        <div className="rd-title">{task.title}</div>
        {/* Atoms ordered per the canonical row schema documented in
            features/tasks/rowMetadata.ts: identity (project tag) ·
            size · intensity · timeframe · dueDate (here: estimate
            range) · stale. The focus pin is positioned at the LEADING
            edge of this row instead of trailing — see the docstring
            for the deliberate /now exception. */}
        <div className="rd-meta-line">
          {showProject && (
            <>
              <span className="rd-project-tag">
                <span
                  className="rd-pdot"
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                {project.name}
              </span>
              <span className="rd-sep">·</span>
            </>
          )}
          <SizeChip size={task.size} />
          <IntensityBars task={task} />
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
          {/* O/M/P estimate range is a deadline/advanced-mode concept
              (PRD §8.2 — PERT). Progress-mode projects deliberately hide
              hour ranges, so only render it (and its leading separator)
              for deadline-mode projects. `project` is the full Project in
              this row's scope, so project.mode is the in-scope signal — no
              data threading needed. */}
          {project.mode === 'deadline' && (
            <>
              <span className="rd-sep">·</span>
              <span className="mono" style={{ fontSize: 11 }}>
                {t('now.loadEstimateRange', {
                  o: task.estimate.o,
                  p: task.estimate.p,
                  m: task.estimate.m,
                })}
              </span>
            </>
          )}
          {/* StaleBadge covers both doing-stale AND blocked-stale states.
              Replaces the previous doing-only rightmost text — now NowTaskRow
              matches the other surfaces (Kanban, TaskListPanel, SearchPage). */}
          <StaleBadge task={task} />
        </div>
      </div>
      <span aria-hidden="true" />
    </div>
  );
}
