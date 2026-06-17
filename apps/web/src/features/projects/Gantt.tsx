import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Milestone, ScheduleResult, Task } from '@rp/shared';

interface GanttProps {
  items: ScheduleResult['items'];
  tasks: Task[];
  cpSet: Set<string>;
  milestones: Milestone[];
  overlay?: { items: ScheduleResult['items']; name: string };
}

const ROW_H = 36;             // px per task row
const HEADER_H = 44;          // top axis (months + days)
const NAME_COL_W = 280;       // left HTML column width for task names
const BAR_PAD_LEFT = 8;       // px padding inside SVG before first bar
const BAR_PAD_RIGHT = 32;     // px padding inside SVG after last bar (room for ⚠ markers)
const BAR_H = 22;

/**
 * Two-column Gantt:
 *   LEFT  — HTML column with task names (truncates with ellipsis)
 *   RIGHT — SVG timeline with date axis, dependency-ordered bars, and
 *           milestone markers
 *
 * The previous implementation rendered task names INSIDE narrow SVG bars
 * and used a fixed 800px chart width, so names overflowed badly and the
 * chart didn't use the available container width. This rewrite:
 *   - Puts names in a flexed HTML left column (consistent typography,
 *     proper truncation, accessible).
 *   - Measures the parent width and recomputes bar X coords on resize so
 *     the chart fills the card.
 *   - Adds a two-tier date axis (month + day-of-month tick).
 *   - Pulls milestone TITLES into a chip rail BELOW the chart so vertical
 *     dashed markers don't collide with task labels.
 */
export function Gantt({ items, tasks, cpSet, milestones, overlay }: GanttProps) {
  const { t, i18n } = useTranslation();
  const hasItems = items.length > 0;

  // Measure available width for the timeline area.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [chartW, setChartW] = useState(720);
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // available timeline width = container width - left names col
      setChartW(Math.max(360, Math.floor(rect.width - NAME_COL_W)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const minStart = useMemo(() => {
    if (!hasItems) return Date.now();
    const base = Math.min(...items.map((i) => new Date(i.startPlanned).getTime()));
    if (overlay && overlay.items.length > 0) {
      const ob = Math.min(
        ...overlay.items.map((i) => new Date(i.startPlanned).getTime())
      );
      return Math.min(base, ob);
    }
    return base;
  }, [items, hasItems, overlay]);
  const maxEnd = useMemo(() => {
    if (!hasItems) return minStart + 3600 * 1000;
    const base = Math.max(...items.map((i) => new Date(i.endPlanned).getTime()));
    if (overlay && overlay.items.length > 0) {
      const oe = Math.max(
        ...overlay.items.map((i) => new Date(i.endPlanned).getTime())
      );
      return Math.max(base, oe);
    }
    return base;
  }, [items, hasItems, minStart, overlay]);
  const totalH = hasItems
    ? Math.max(1, Math.ceil((maxEnd - minStart) / (3600 * 1000)))
    : 0;

  // Pixels-per-millisecond for the timeline. We carve BAR_PAD_LEFT +
  // BAR_PAD_RIGHT off so the first/last bar don't kiss the edges.
  const innerW = Math.max(120, chartW - BAR_PAD_LEFT - BAR_PAD_RIGHT);
  const span = Math.max(1, maxEnd - minStart);
  const xFor = (dateISO: string) => {
    const d = new Date(dateISO).getTime();
    const ratio = (d - minStart) / span;
    return BAR_PAD_LEFT + Math.round(ratio * innerW);
  };

  const taskById = useMemo(() => new Map(tasks.map((tk) => [tk.id, tk])), [tasks]);

  // Stable display order: respect the order the scheduler returned (which
  // is topological — predecessors first), so the bars cascade visually.
  const orderedItems = items;

  // Compute date-axis ticks. We aim for ~8-12 ticks spread evenly across
  // the timeline span. The tick CADENCE adapts to span: if the project
  // is < 21 days we tick every day (or every 2-3 days), otherwise weekly.
  //
  // Subtle but important: the project may start mid-day (e.g. 9 AM) but we
  // tick on calendar-day boundaries (midnight). That makes the *first*
  // calendar-day boundary fall BEFORE minStart, which would land its
  // label at a negative x — clipped off the left edge of the chart.
  // To fix: skip any tick whose midnight is before minStart, and ALWAYS
  // emit an explicit first tick at x=BAR_PAD_LEFT carrying the project's
  // actual start date so users see "where 'now' sits" without hunting.
  const ticks = useMemo(() => {
    if (!hasItems) return [] as Array<{ x: number; label: string; major: boolean; sub?: string }>;
    const days = Math.max(1, Math.ceil(span / 86_400_000));
    let stepDays = 7;
    if (days <= 7) stepDays = 1;
    else if (days <= 14) stepDays = 2;
    else if (days <= 30) stepDays = 3;
    else if (days <= 60) stepDays = 7;
    else if (days <= 120) stepDays = 14;
    else stepDays = Math.ceil(days / 12);

    const out: Array<{ x: number; label: string; major: boolean; sub?: string }> = [];

    // Forced first tick at the project's actual start date, pinned to the
    // chart's left edge.
    const startD = new Date(minStart);
    out.push({
      x: BAR_PAD_LEFT,
      label: `${startD.getMonth() + 1}/${startD.getDate()}`,
      major: true,
      sub: `${startD.getFullYear()}`,
    });

    // Subsequent ticks march forward day-by-step starting from midnight of
    // the day AFTER the project starts (so we never collide with the
    // forced first tick or render a label off the left edge).
    const dayFloor = new Date(minStart);
    dayFloor.setHours(0, 0, 0, 0);
    let cursor = dayFloor.getTime();
    while (cursor < minStart) cursor += 86_400_000; // skip the leading partial day
    let lastMonth = startD.getMonth();
    while (cursor <= maxEnd) {
      const d = new Date(cursor);
      const ratio = (cursor - minStart) / span;
      const x = BAR_PAD_LEFT + Math.round(ratio * innerW);
      // De-duplicate against the forced first tick if they land within
      // a few px of each other.
      if (x - BAR_PAD_LEFT < 24) {
        cursor += stepDays * 86_400_000;
        continue;
      }
      const isFirstOfMonth = d.getDate() === 1;
      const monthChanged = d.getMonth() !== lastMonth;
      lastMonth = d.getMonth();
      out.push({
        x,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        major: isFirstOfMonth || monthChanged,
        sub: isFirstOfMonth ? `${d.getFullYear()}` : undefined,
      });
      cursor += stepDays * 86_400_000;
    }
    return out;
  }, [hasItems, minStart, maxEnd, span, innerW]);

  const visibleMilestones = useMemo(() => {
    if (!hasItems) return [] as Array<{ m: Milestone; dateISO: string; isHard: boolean }>;
    const out: Array<{ m: Milestone; dateISO: string; isHard: boolean }> = [];
    for (const m of milestones) {
      const dateISO = m.dueHard || m.dueSoft;
      if (!dateISO) continue;
      const tt = new Date(dateISO).getTime();
      if (tt >= minStart && tt <= maxEnd) {
        out.push({ m, dateISO, isHard: !!m.dueHard });
      }
    }
    return out;
  }, [milestones, hasItems, minStart, maxEnd]);

  if (!hasItems) {
    return (
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
        {t('schedule.noSchedule')}
      </p>
    );
  }

  const chartH = HEADER_H + orderedItems.length * ROW_H + 12;

  return (
    <div>
      <div className="schedule-meta">
        <div>{t('schedule.totalHours', { hours: totalH })}</div>
      </div>

      <div
        ref={wrapRef}
        className="gantt-chart"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: 'var(--paper-2)',
          border: '1px solid var(--ink-100)',
          borderRadius: 'var(--r-md)',
          overflow: 'hidden',
        }}
      >
        {/* LEFT — task name column */}
        <div
          style={{
            flex: `0 0 ${NAME_COL_W}px`,
            borderRight: '1px solid var(--ink-100)',
            background: 'var(--paper)',
          }}
        >
          {/* Spacer matching the SVG header */}
          <div
            style={{
              height: HEADER_H,
              borderBottom: '1px solid var(--ink-300)',
              display: 'flex',
              alignItems: 'flex-end',
              padding: '0 0.875rem 0.5rem',
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
              color: 'var(--ink-500)',
              textTransform: 'uppercase',
            }}
          >
            {t('task.list')}
          </div>
          {orderedItems.map((it) => {
            const tk = taskById.get(it.taskId);
            const isCP = cpSet.has(it.taskId);
            return (
              <div
                key={`name-${it.taskId}`}
                style={{
                  height: ROW_H,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 0.875rem',
                  borderBottom: '1px solid var(--ink-100)',
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--ink-900)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: isCP ? 600 : 400,
                }}
                title={tk?.title || it.taskId}
              >
                {isCP && (
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      marginRight: 8,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tk?.title || it.taskId}
                </span>
              </div>
            );
          })}
        </div>

        {/* RIGHT — timeline SVG. width=100% so it fills the remaining
            flex space; we still compute pixel offsets via xFor() against
            the measured chartW so bars sit precisely under axis ticks. */}
        <div style={{ flex: '1 1 auto', overflowX: 'auto' }}>
          <svg width={chartW} height={chartH} role="presentation">
            {/* Axis background */}
            <rect
              x={0}
              y={0}
              width={chartW}
              height={HEADER_H}
              fill="var(--paper)"
            />
            {/* Vertical tick lines spanning the full chart, faint */}
            {ticks.map((tk) => (
              <line
                key={`tick-${tk.x}-${tk.label}`}
                x1={tk.x}
                y1={HEADER_H}
                x2={tk.x}
                y2={chartH - 12}
                stroke="var(--ink-100)"
                strokeWidth={1}
              />
            ))}
            {/* Axis labels */}
            {ticks.map((tk) => (
              <g key={`tick-lbl-${tk.x}-${tk.label}`}>
                {tk.major && (
                  <line
                    x1={tk.x}
                    y1={4}
                    x2={tk.x}
                    y2={HEADER_H - 4}
                    stroke="var(--ink-300)"
                    strokeWidth={1}
                  />
                )}
                <text
                  x={tk.x + 4}
                  y={HEADER_H - 16}
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  fill={tk.major ? 'var(--ink-700)' : 'var(--ink-300)'}
                  fontWeight={tk.major ? 600 : 400}
                >
                  {tk.label}
                </text>
              </g>
            ))}
            {/* Bottom rule between axis and rows */}
            <line
              x1={0}
              y1={HEADER_H}
              x2={chartW}
              y2={HEADER_H}
              stroke="var(--ink-300)"
              strokeWidth={1}
            />

            {/* Milestone vertical lines (dashed, color-coded). The text
                label sits in the chip rail BELOW the chart, not inside
                the chart — saves them from collisions with bars. */}
            {visibleMilestones.map(({ m, dateISO, isHard }) => {
              const mx = xFor(dateISO);
              const color = isHard ? 'var(--accent)' : 'var(--rd-gantt-soft)';
              return (
                <g key={`m-${m.id}`}>
                  <line
                    x1={mx}
                    y1={HEADER_H}
                    x2={mx}
                    y2={chartH - 12}
                    stroke={color}
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    opacity={0.7}
                  />
                  <polygon
                    points={`${mx - 5},${HEADER_H} ${mx + 5},${HEADER_H} ${mx},${HEADER_H + 8}`}
                    fill={color}
                  />
                </g>
              );
            })}

            {/* Comparison overlay (saved scenario) — hollow grey bars */}
            {overlay &&
              overlay.items.map((oi) => {
                const rowIdx = orderedItems.findIndex((it) => it.taskId === oi.taskId);
                if (rowIdx < 0) return null;
                const x = xFor(oi.startPlanned);
                const w = Math.max(4, xFor(oi.endPlanned) - xFor(oi.startPlanned));
                const y = HEADER_H + 6 + rowIdx * ROW_H;
                return (
                  <rect
                    key={`ov-${oi.taskId}`}
                    x={x}
                    y={y}
                    width={w}
                    height={BAR_H}
                    rx={4}
                    fill="var(--ink-300)"
                    opacity={0.32}
                    stroke="var(--ink-500)"
                    strokeDasharray="3 2"
                  />
                );
              })}

            {/* Active bars */}
            {orderedItems.map((it, idx) => {
              const x = xFor(it.startPlanned);
              const w = Math.max(4, xFor(it.endPlanned) - xFor(it.startPlanned));
              const y = HEADER_H + (ROW_H - BAR_H) / 2 + idx * ROW_H;
              const isCP = cpSet.has(it.taskId);
              const fill = isCP ? 'var(--accent)' : 'var(--rd-gantt-bar)';
              return (
                <g key={it.taskId} className="task-bar">
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={BAR_H}
                    rx={4}
                    fill={fill}
                    opacity={0.92}
                  />
                  {it.violatesHardDue && (
                    <text
                      x={x + w + 6}
                      y={y + BAR_H - 6}
                      fontSize={13}
                      fill="var(--accent)"
                      aria-label="hard-due violation"
                    >
                      ⚠︎
                    </text>
                  )}
                  {!it.violatesHardDue && it.violatesSoftDue && (
                    <text
                      x={x + w + 6}
                      y={y + BAR_H - 6}
                      fontSize={13}
                      fill="var(--rd-gantt-soft)"
                      aria-label="soft-due violation"
                    >
                      ⚠
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Milestone chip rail — names live here so they never collide
          with bars or each other. Color-coded to match the verticals. */}
      {visibleMilestones.length > 0 && (
        <div
          style={{
            marginTop: '0.625rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.4rem 0.625rem',
            alignItems: 'center',
            fontSize: 'var(--fs-sm)',
          }}
        >
          {visibleMilestones.map(({ m, dateISO, isHard }) => {
            const color = isHard ? 'var(--accent)' : '#B68A14';
            const d = new Date(dateISO);
            return (
              <span
                key={`m-chip-${m.id}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.18rem 0.6rem',
                  borderRadius: 'var(--r-pill)',
                  background: isHard
                    ? 'var(--accent-soft)'
                    : 'rgba(229, 178, 58, 0.16)',
                  color,
                  fontWeight: 600,
                }}
              >
                ◆ {m.title}
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--ink-700)',
                    fontWeight: 400,
                    fontSize: 'var(--fs-xs)',
                  }}
                >
                  {d.toLocaleDateString(i18n.language, {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {overlay && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-500)',
          }}
        >
          {t('schedule.compareWith', { name: overlay.name })}
        </div>
      )}
    </div>
  );
}
