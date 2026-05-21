import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Milestone, ScheduleResult, Task } from '@rp/shared';
import { computeTimeframeEndMs } from '../tasks/timeframe';

// computeTimeframeEndMs and the short-label lookup both live in shared
// modules now — `features/tasks/timeframe.ts` and the `timeframe.bucketsShort`
// i18n namespace respectively — so the lane component no longer duplicates
// them.

interface UncertaintyLaneProps {
  items: ScheduleResult['items'];
  tasks: Task[];
  cpSet: Set<string>;
  milestones: Milestone[];
  /** Project start — anchor for the timeline. */
  projectStart?: string;
  /** Optional saved scenario snapshot drawn as a ghost overlay. */
  overlay?: { items: ScheduleResult['items']; name: string };
}

/**
 * Uncertainty Lane — the redesign's stated core innovation.
 *
 * Each task row renders a 3-layer bar:
 *   - dashed envelope spanning the optimistic→pessimistic range (O→P),
 *   - a solid most-likely core sitting inside the envelope (M),
 *   - O and P tick verticals at the boundaries.
 *
 * Together these encode "we don't know exactly when this finishes — here
 * is the band of plausible answers and where it lands most likely."
 *
 * Width math:
 *   Each task gets duration = scheduleItems.endPlanned − startPlanned (the
 *   M-mode duration the scheduler returned). We then synthesize O and P
 *   from the task's estimate ratios:
 *     ratioO = est.o / est.m,  ratioP = est.p / est.m
 *   so the envelope's width = duration × ratioP starting from O = duration
 *   × (1 − (1 − ratioO)) before the core. Edge cases (missing estimate,
 *   m=0) collapse the envelope onto the core.
 */
const ROW_H = 56;
const HEADER_H = 38;
const NAME_COL_W = 240;
const PAD_X = 16;
const CORE_H = 22;

export function UncertaintyLane({ items, tasks, cpSet, milestones, projectStart, overlay }: UncertaintyLaneProps) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [chartW, setChartW] = useState(720);

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setChartW(Math.max(360, Math.floor(rect.width - NAME_COL_W)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable order: respect scheduler topology so predecessors come first.
  const orderedItems = items;
  const taskById = useMemo(() => new Map(tasks.map((tk) => [tk.id, tk])), [tasks]);

  const minStart = useMemo(() => {
    if (orderedItems.length === 0) return Date.now();
    const liveStarts = orderedItems.map((i) => new Date(i.startPlanned).getTime());
    const overlayStarts =
      overlay && overlay.items.length > 0
        ? overlay.items.map((i) => new Date(i.startPlanned).getTime())
        : [];
    return Math.min(...liveStarts, ...overlayStarts);
  }, [orderedItems, overlay]);

  // Synthetic per-row span: extend pessimistic past M by ratio P/M.
  const rowSpans = useMemo(() => {
    return orderedItems.map((it) => {
      const tk = taskById.get(it.taskId);
      const start = new Date(it.startPlanned).getTime();
      const end = new Date(it.endPlanned).getTime();
      const mDur = Math.max(1, end - start);
      const ratioO = tk && tk.estimate.m > 0 ? Math.max(0.3, tk.estimate.o / tk.estimate.m) : 0.85;
      const ratioP = tk && tk.estimate.m > 0 ? Math.max(1.05, tk.estimate.p / tk.estimate.m) : 1.4;
      const oEnd = start + mDur * ratioO;
      const pEnd = start + mDur * ratioP;
      return { start, mEnd: end, oEnd, pEnd };
    });
  }, [orderedItems, taskById]);

  const maxEnd = useMemo(() => {
    if (rowSpans.length === 0) return minStart + 86_400_000;
    const livePEnds = rowSpans.map((s) => s.pEnd);
    const overlayEnds =
      overlay && overlay.items.length > 0
        ? overlay.items.map((i) => new Date(i.endPlanned).getTime())
        : [];
    return Math.max(...livePEnds, ...overlayEnds);
  }, [rowSpans, minStart, overlay]);

  const span = Math.max(1, maxEnd - minStart);
  const innerW = Math.max(120, chartW - PAD_X * 2);
  const xFor = (t: number) => {
    const ratio = (t - minStart) / span;
    return PAD_X + Math.round(ratio * innerW);
  };

  // Today line (project start fallback when "now" sits outside chart range).
  const todayMs = Date.now();
  const todayX =
    todayMs >= minStart && todayMs <= maxEnd
      ? xFor(todayMs)
      : projectStart && new Date(projectStart).getTime() <= maxEnd
      ? xFor(new Date(projectStart).getTime())
      : null;

  // Date axis ticks: same adaptive cadence as the regular Gantt.
  const ticks = useMemo(() => {
    if (orderedItems.length === 0) return [] as Array<{ x: number; label: string }>;
    const days = Math.max(1, Math.ceil(span / 86_400_000));
    let stepDays = 7;
    if (days <= 7) stepDays = 1;
    else if (days <= 14) stepDays = 2;
    else if (days <= 30) stepDays = 3;
    else if (days <= 60) stepDays = 7;
    else if (days <= 120) stepDays = 14;
    else stepDays = Math.ceil(days / 12);

    const out: Array<{ x: number; label: string }> = [];
    // Forced first tick at min-start
    const first = new Date(minStart);
    out.push({ x: PAD_X, label: `${first.getMonth() + 1}/${first.getDate()}` });

    const dayFloor = new Date(minStart);
    dayFloor.setHours(0, 0, 0, 0);
    let cursor = dayFloor.getTime();
    while (cursor < minStart) cursor += 86_400_000;
    while (cursor <= maxEnd) {
      const x = xFor(cursor);
      if (x - PAD_X >= 24) {
        const d = new Date(cursor);
        out.push({ x, label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
      cursor += stepDays * 86_400_000;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedItems, minStart, maxEnd, span, innerW]);

  const visibleMilestones = useMemo(() => {
    const out: Array<{ m: Milestone; ms: number; isHard: boolean }> = [];
    for (const m of milestones) {
      const dateISO = m.dueHard || m.dueSoft;
      if (!dateISO) continue;
      const ms = new Date(dateISO).getTime();
      if (ms >= minStart && ms <= maxEnd) {
        out.push({ m, ms, isHard: !!m.dueHard });
      }
    }
    return out;
  }, [milestones, minStart, maxEnd]);

  if (orderedItems.length === 0) {
    return (
      <p style={{ color: 'var(--rd-ink-3)', textAlign: 'center', padding: '2rem' }}>
        {t('schedule.noSchedule')}
      </p>
    );
  }

  // Force re-render on resize — the SVG width prop reads chartW.
  useEffect(() => {}, [chartW]);

  return (
    <div className="rd-lane-view">
      <div className="rd-lane-header">
        <h2>{t('schedule.uncertaintyLane')}</h2>
        <div className="rd-unc-key">
          <span className="rd-demo">
            <span className="rd-lik" />
            <span className="rd-cor" />
          </span>
          <span><b>O</b>—{t('schedule.optimistic')}</span>
          <span style={{ color: 'var(--rd-ink-4)' }}>·</span>
          <span><b>M</b>—{t('schedule.likely')}</span>
          <span style={{ color: 'var(--rd-ink-4)' }}>·</span>
          <span><b>P</b>—{t('schedule.pessimistic')}</span>
        </div>
      </div>

      <div className="rd-lane-grid" ref={wrapRef}>
        {/* Axis */}
        <div className="rd-lane-axis">
          <div className="rd-left">{t('schedule.task')}</div>
          <div className="rd-ticks" style={{ position: 'relative' }}>
            {ticks.map((tk) => (
              <div key={`tick-${tk.x}-${tk.label}`} className="rd-tick" style={{ left: tk.x }}>
                {tk.label}
              </div>
            ))}
            {visibleMilestones.map(({ m, ms }) => {
              const x = xFor(ms);
              return (
                <div key={`ms-${m.id}`} className="rd-lane-milestone" style={{ left: x }}>
                  <div className="rd-label">◆ {m.title}</div>
                </div>
              );
            })}
            {todayX !== null && (
              <>
                <div className="rd-today-marker" style={{ left: todayX }} />
                <div className="rd-today-pill" style={{ left: todayX }}>
                  {t('schedule.now')}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Rows */}
        {orderedItems.map((it, i) => {
          const tk = taskById.get(it.taskId);
          if (!tk) return null;
          const span = rowSpans[i];
          const status = tk.status;
          const isCP = cpSet.has(it.taskId);
          const xStart = xFor(span.start);
          const xMEnd = xFor(span.mEnd);
          const xOEnd = xFor(span.oEnd);
          const xPEnd = xFor(span.pEnd);
          const coreW = Math.max(4, xMEnd - xStart);
          const envW = Math.max(coreW, xPEnd - xStart);
          const oTickX = xOEnd;
          const pTickX = xPEnd;
          const sizeChip = (tk.size || 'm').toUpperCase();
          const mDurH = Math.max(
            1,
            Math.round((span.mEnd - span.start) / 3_600_000)
          );

          // Timeframe-end tick: where the task's fuzzy "finish-in-about"
          // window closes. Skips tasks without a bucket, `someday` tasks
          // (no end), and ticks that fall past the visible range.
          const tfEndMs = computeTimeframeEndMs(tk.timeframeAnchor, tk.timeframeBucket);
          const tfBucket = tk.timeframeBucket;
          const showTfTick =
            tfEndMs != null &&
            tfBucket != null &&
            tfBucket !== 'someday' &&
            tfEndMs >= minStart &&
            tfEndMs <= maxEnd;
          const tfTickX = showTfTick && tfEndMs != null ? xFor(tfEndMs) : 0;
          // Source the short letter from i18n so en/zh-CN can localise the
          // label (e.g. zh: 周/月/季/年). Falls through to '' if bucket is
          // unset or 'someday' (the latter has no end position anyway).
          const tfTickLabel =
            tfBucket && tfBucket !== 'someday'
              ? (t(`timeframe.bucketsShort.${tfBucket}` as const) as string)
              : '';
          const tfTickTitle =
            showTfTick && tfEndMs != null
              ? t('lane.timeframeEnd', {
                  date: new Date(tfEndMs).toLocaleDateString(),
                })
              : '';

          const overlayItem =
            overlay && overlay.items.find((oi) => oi.taskId === it.taskId);
          let overlayLeft = 0;
          let overlayWidth = 0;
          if (overlayItem) {
            const oStart = xFor(new Date(overlayItem.startPlanned).getTime());
            const oEnd = xFor(new Date(overlayItem.endPlanned).getTime());
            overlayLeft = oStart - PAD_X;
            overlayWidth = Math.max(4, oEnd - oStart);
          }

          return (
            <div
              key={it.taskId}
              className="rd-lane-row"
              data-status={status}
              title={`${tk.title} · ${tk.estimate.o}–${tk.estimate.p}h (likely ${tk.estimate.m})`}
            >
              <div className="rd-left">
                <div className="rd-title">
                  {isCP && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: 'var(--focus)',
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                  )}
                  {tk.title}
                </div>
                <div className="rd-meta">
                  <span className="rd-pill" data-status={status}>
                    <span className="rd-dot" />
                    {t(`task.statusLabels.${status}`)}
                  </span>
                  <span className="rd-size-chip">{sizeChip}</span>
                </div>
              </div>
              <div className="rd-right">
                {/* Comparison overlay (saved scenario) — hollow grey ghost bar
                    drawn underneath the live envelope. */}
                {overlayItem && (
                  <div
                    className="rd-ubar-overlay"
                    style={{ left: overlayLeft, width: overlayWidth }}
                    aria-hidden="true"
                  />
                )}
                {/* Envelope (O→P) */}
                <div
                  className="rd-ubar-env"
                  style={{ left: xStart - PAD_X, width: envW }}
                />
                {/* Core (M) */}
                <div
                  className="rd-ubar-core"
                  style={{ left: xStart - PAD_X, width: coreW }}
                >
                  {coreW > 50 && `${mDurH}h`}
                </div>
                {/* O / P tick verticals */}
                <div
                  className="rd-ubar-tick"
                  style={{ left: oTickX - PAD_X }}
                >
                  <span className="rd-tick-lbl">O</span>
                </div>
                <div
                  className="rd-ubar-tick"
                  style={{ left: pTickX - PAD_X }}
                >
                  <span className="rd-tick-lbl">P</span>
                </div>
                {/* Timeframe-window-end tick — quieter than O/P, colored
                    per bucket. Skipped entirely for someday / out-of-range. */}
                {showTfTick && tfBucket && (
                  <div
                    className="rd-ubar-tf-tick"
                    style={{
                      left: tfTickX - PAD_X,
                      // Bucket color overrides the row status color here so
                      // the tick reads as timeframe-specific.
                      ['--rd-tf-color' as string]: `var(--tf-${tfBucket})`,
                    }}
                    title={tfTickTitle}
                    aria-label={tfTickTitle}
                  >
                    <span className="rd-tf-tick-lbl">{tfTickLabel}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {overlay && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: 'var(--fs-sm)',
            color: 'var(--rd-ink-3, var(--ink-500))',
          }}
        >
          {t('schedule.compareWith', { name: overlay.name })}
        </div>
      )}
    </div>
  );
}
