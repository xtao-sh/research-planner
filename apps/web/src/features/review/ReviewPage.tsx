import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import { useAppData } from '../../contexts/AppDataContext';
import { computeTimeframeStatus } from '../tasks/timeframe';

/**
 * Weekly Retrospective — /review.
 *
 * Surfaces the past 7 days as momentum + capacity signals plus a small set
 * of dynamic observations. The intent (per design source) is "a reflection,
 * not a report card" — completion-rate alone is a vanity metric for
 * research, so we show movement, blocking, and intensity-distribution
 * instead.
 */
export function ReviewPage() {
  const { t } = useTranslation();
  const { projects, projectTasks, fetchAllWorkspaceTasks } = useAppData();

  // Lazy-load workspace tasks once if the cache is empty (mirrors NowPage).
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

  const allTasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const p of projects) {
      const ts = projectTasks[p.id];
      if (!ts) continue;
      out.push(...ts);
    }
    return out;
  }, [projects, projectTasks]);

  // Week window — today minus 6 days, through today (UTC date math).
  const { weekStart, weekEnd, weekStartLabel, weekEndLabel } = useMemo(() => {
    const now = new Date();
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
    );
    const start = new Date(end.getTime());
    start.setUTCDate(start.getUTCDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return {
      weekStart: start,
      weekEnd: end,
      weekStartLabel: fmt(start),
      weekEndLabel: fmt(end),
    };
  }, []);

  function inWeek(iso?: string): boolean {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= weekStart.getTime() && t <= weekEnd.getTime();
  }

  // ---- Momentum stats -----------------------------------------------------
  const tasksMoved = useMemo(
    () => allTasks.filter((t) => inWeek(t.startedAt) || inWeek(t.finishedAt)).length,
    [allTasks, weekStart, weekEnd]
  );
  const completed = useMemo(
    () => allTasks.filter((t) => inWeek(t.finishedAt)).length,
    [allTasks, weekStart, weekEnd]
  );
  const stillBlocked = useMemo(
    () => allTasks.filter((t) => t.status === 'blocked').length,
    [allTasks]
  );

  // ---- Capacity heatmap ---------------------------------------------------
  // 7 cells, indexed by Mon..Sun. For each task, bump the day-bucket if any
  // of its meaningful timestamps (started/finished/focused) fell on that
  // day. Then map count→intensity 1..5.
  const heatLevels = useMemo(() => {
    // Day buckets keyed by yyyy-mm-dd string for the 7-day window, in
    // weekStart..weekEnd order.
    const dayKeys: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart.getTime());
      d.setUTCDate(weekStart.getUTCDate() + i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const counts = new Map<string, number>();
    for (const key of dayKeys) counts.set(key, 0);
    function bumpFor(iso?: string) {
      if (!iso) return;
      const key = new Date(iso).toISOString().slice(0, 10);
      if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const task of allTasks) {
      bumpFor(task.startedAt);
      bumpFor(task.finishedAt);
      bumpFor(task.focusedAt);
    }
    // weekStart's weekday in local terms — we want Mon..Sun ordering. Our
    // window is "last 7 days ending today" so reordering by weekday makes
    // sense visually. Build Mon..Sun list mapped from the keys we have.
    const labels: string[] = [];
    const ordered: number[] = [];
    // Compute weekday index for each dayKey (0=Sun..6=Sat in JS); we want
    // Mon..Sun (1..6,0).
    const target = [1, 2, 3, 4, 5, 6, 0]; // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    for (const wd of target) {
      // Find the most recent dayKey within window matching this weekday.
      let pick = '';
      for (const k of dayKeys) {
        const d = new Date(k + 'T00:00:00Z');
        if (d.getUTCDay() === wd) pick = k;
      }
      const c = pick ? counts.get(pick) || 0 : 0;
      ordered.push(c);
      labels.push(pick);
    }
    // Map count → intensity 0..5.
    const intensities = ordered.map((n) => (n === 0 ? 0 : Math.min(5, n)));
    return intensities;
  }, [allTasks, weekStart]);

  // ---- Observations -------------------------------------------------------
  const observations: string[] = useMemo(() => {
    const out: string[] = [];
    if (stillBlocked > 0) {
      out.push(
        t('review.observationBlocked', {
          n: stillBlocked,
          defaultValue:
            stillBlocked === 1
              ? '1 task still blocked. Consider unblocking or splitting.'
              : `${stillBlocked} tasks still blocked. Consider unblocking or splitting.`,
        })
      );
    }
    if (completed > 0) {
      out.push(
        t('review.observationCompleted', {
          n: completed,
          defaultValue:
            completed === 1
              ? '1 task completed this week.'
              : `${completed} tasks completed this week.`,
        })
      );
    }
    // Tasks past their timeframe window (excluding 'someday' which is
    // explicitly not on the clock). This is an informational nudge — the
    // product stance is "silent on past-bucket" elsewhere, but a weekly
    // retrospective is exactly the place to surface accumulated drift.
    const now = new Date();
    let pastTimeframe = 0;
    for (const tk of allTasks) {
      if (tk.status === 'done') continue;
      if (!tk.timeframeBucket || tk.timeframeBucket === 'someday') continue;
      const s = computeTimeframeStatus(tk.timeframeBucket, tk.timeframeAnchor, now);
      if (s?.isPast) pastTimeframe++;
    }
    if (pastTimeframe > 0) {
      out.push(
        t('review.observationTimeframePast', {
          n: pastTimeframe,
          defaultValue:
            pastTimeframe === 1
              ? '1 task is past its timeframe window. Re-bucket or push forward.'
              : `${pastTimeframe} tasks are past their timeframe window. Re-bucket or push forward.`,
        })
      );
    }

    // Dormant project — last updatedAt > 14 days ago.
    const nowMs = Date.now();
    for (const p of projects) {
      const u = (p as { updatedAt?: string }).updatedAt;
      if (!u) continue;
      const days = Math.floor((nowMs - new Date(u).getTime()) / 86400000);
      if (days > 14) {
        out.push(
          t('review.observationDormant', {
            name: p.name,
            n: days,
            defaultValue: `Project '${p.name}' dormant ${days} days. Surface it.`,
          })
        );
        break; // one is enough — don't flood the card
      }
    }
    out.push(
      t('review.observationCapacity', {
        defaultValue:
          'Capacity is signal, not score. Use a low-intensity day to recover.',
      })
    );
    return out;
  }, [stillBlocked, completed, allTasks, projects, t]);

  const dayLabels = [
    t('review.weekdayMon'),
    t('review.weekdayTue'),
    t('review.weekdayWed'),
    t('review.weekdayThu'),
    t('review.weekdayFri'),
    t('review.weekdaySat'),
    t('review.weekdaySun'),
  ];

  return (
    <>
      <div className="rd-topbar">
        <h1>{t('nav.review')}</h1>
        <span className="rd-meta">
          {weekStartLabel} – {weekEndLabel}
        </span>
        <span className="rd-spacer" />
      </div>
      <div className="rd-page">
        <div>
          <div className="rd-section-eyebrow">
            {t('review.eyebrow', {
              start: weekStartLabel,
              end: weekEndLabel,
              defaultValue: `Weekly retrospective · ${weekStartLabel} – ${weekEndLabel}`,
            })}
          </div>
          <div className="rd-section-title">{t('review.title')}</div>
          <div className="rd-section-sub">{t('review.sub')}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Momentum card */}
          <div className="card" style={{ padding: 18 }}>
            <div className="rd-section-eyebrow" style={{ marginBottom: 10 }}>
              {t('review.momentum')}
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div className="rd-capacity-num">{tasksMoved}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {t('review.tasksMoved')}
                </div>
              </div>
              <div>
                <div className="rd-capacity-num" style={{ color: 'var(--st-done)' }}>
                  {completed}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {t('review.completed')}
                </div>
              </div>
              <div>
                <div
                  className="rd-capacity-num"
                  style={{ color: 'var(--st-blocked)' }}
                >
                  {stillBlocked}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {t('review.stillBlocked')}
                </div>
              </div>
            </div>
          </div>

          {/* Capacity heatmap card */}
          <div className="card" style={{ padding: 18 }}>
            <div className="rd-section-eyebrow" style={{ marginBottom: 10 }}>
              {t('review.capacityUsed')}
            </div>
            <div className="rd-heat" style={{ marginBottom: 8 }}>
              {heatLevels.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key -- fixed 7-day grid; index IS the day offset
                <div
                  key={i}
                  className="rd-cell"
                  data-l={l ? String(l) : ''}
                  style={{ height: 28 }}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {dayLabels.join(' · ')}
            </div>
          </div>

          {/* What this week showed — full-width card */}
          <div className="card" style={{ padding: 18, gridColumn: '1 / -1' }}>
            <div className="rd-section-eyebrow" style={{ marginBottom: 10 }}>
              {t('review.thisWeekShowed')}
            </div>
            <ul
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 13.5,
                color: 'var(--rd-ink-2, var(--ink-2))',
                paddingLeft: 18,
                margin: 0,
              }}
            >
              {observations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
