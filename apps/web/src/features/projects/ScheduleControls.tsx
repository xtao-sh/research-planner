import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DurationMode } from '@rp/scheduler';
import type { ScheduleResult } from '@rp/shared';

interface ScheduleControlsProps {
  durationMode: DurationMode;
  onDurationModeChange: (mode: DurationMode) => void;
  projectIdPresent: boolean;
  /** Latest schedule result for the active mode. Used to render a live
   *  duration / end-date readout so toggling modes produces an obvious
   *  visible delta (without the readout the change buries itself in tiny
   *  per-task date cells and feels broken). */
  schedule?: ScheduleResult | null;
}

/**
 * Schedule controls: duration-mode radios + live readout.
 *
 * Earlier this component was JUST the three radios with no feedback. The
 * Gantt auto-scales so bar widths look proportionally identical across
 * modes, and per-task date cells are too small to scan — meaning
 * toggling expected/optimistic/pessimistic appeared to do nothing. The
 * inline readout (right of the radios) shows project END date + total
 * working duration, which differs visibly per mode.
 */
export function ScheduleControls({
  durationMode,
  onDurationModeChange,
  schedule,
}: ScheduleControlsProps) {
  const { t, i18n } = useTranslation();

  const summary = useMemo(() => {
    if (!schedule || schedule.items.length === 0) return null;
    const starts = schedule.items
      .map((it) => new Date(it.startPlanned).getTime())
      .filter((n) => Number.isFinite(n));
    const ends = schedule.items
      .map((it) => new Date(it.endPlanned).getTime())
      .filter((n) => Number.isFinite(n));
    if (!starts.length || !ends.length) return null;
    const earliest = Math.min(...starts);
    const latest = Math.max(...ends);
    const days = Math.max(1, Math.ceil((latest - earliest) / 86_400_000));
    const cpCount = schedule.criticalPath?.length ?? 0;
    return {
      endDate: new Date(latest),
      days,
      cpCount,
    };
  }, [schedule]);

  return (
    <div
      role="radiogroup"
      aria-label={t('schedule.mode')}
      style={{
        display: 'flex',
        gap: '0.75rem',
        margin: '0.5rem 0 1rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <span style={{ color: 'var(--ink-500)' }}>
        {t('schedule.modeLabel')}
      </span>
      {(['expected', 'optimistic', 'pessimistic'] as DurationMode[]).map(
        (mode) => (
          <label
            key={mode}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              cursor: 'pointer',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--r-sm)',
              background:
                durationMode === mode ? 'var(--accent-soft)' : 'transparent',
              color:
                durationMode === mode ? 'var(--accent)' : 'var(--ink-700)',
              fontWeight: durationMode === mode ? 600 : 400,
              transition: 'background var(--transition-fast)',
            }}
          >
            <input
              type="radio"
              name="durationMode"
              checked={durationMode === mode}
              onChange={() => onDurationModeChange(mode)}
              style={{ accentColor: 'var(--accent)' }}
            />
            {t(`schedule.${mode}` as const)}
          </label>
        )
      )}
      {/* Live readout — the visible signal that the toggle actually does
          something. Updates in lockstep with the mode change. */}
      {summary && (
        <span
          aria-live="polite"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '0.625rem',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--fs-sm)',
            color: 'var(--ink-700)',
          }}
        >
          <span>
            <span style={{ color: 'var(--ink-500)' }}>
              {t('schedule.endLabel')}
            </span>{' '}
            <strong style={{ color: 'var(--ink-900)' }}>
              {summary.endDate.toLocaleDateString(i18n.language, {
                month: '2-digit',
                day: '2-digit',
              })}
            </strong>
          </span>
          <span>
            <span style={{ color: 'var(--ink-500)' }}>
              {t('schedule.durationLabel')}
            </span>{' '}
            <strong style={{ color: 'var(--ink-900)' }}>
              {summary.days}
            </strong>{' '}
            <span style={{ color: 'var(--ink-500)' }}>
              {t('schedule.daysUnit')}
            </span>
          </span>
          <span>
            <span style={{ color: 'var(--ink-500)' }}>
              {t('schedule.cpLabel')}
            </span>{' '}
            <strong style={{ color: 'var(--ink-900)' }}>
              {summary.cpCount}
            </strong>
          </span>
        </span>
      )}
    </div>
  );
}
