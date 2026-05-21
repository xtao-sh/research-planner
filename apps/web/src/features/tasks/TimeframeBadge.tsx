import { useTranslation } from 'react-i18next';
import type { TimeframeBucket } from '@rp/shared';
import { computeTimeframeStatus, type TimeframeStatus } from './timeframe';

interface TimeframeBadgeProps {
  bucket: TimeframeBucket;
  /** ISO date-time string. Optional — without it, no countdown is shown. */
  anchor?: string | null;
  /** Compact ('dot' = colored dot + short letter, fits cards) or full
   *  pill with the bucket name. */
  variant?: 'compact' | 'full';
  /** Show "Nd left" / "Nd past" countdown next to the badge. Defaults to
   *  true for `full` variant and false for `compact`. */
  showCountdown?: boolean;
  className?: string;
}

/**
 * Read-only timeframe indicator. The compact variant is meant for dense
 * surfaces (kanban cards, task rows) — a single colored dot + short letter
 * label. The full variant is a pill with the bucket name, optionally
 * followed by a countdown ("3d left" / "5d past").
 */
export function TimeframeBadge({
  bucket,
  anchor,
  variant = 'compact',
  showCountdown,
  className,
}: TimeframeBadgeProps) {
  const { t } = useTranslation();
  const status: TimeframeStatus | null = anchor
    ? computeTimeframeStatus(bucket, anchor)
    : null;
  const fullLabel = String(t(`timeframe.buckets.${bucket}` as const));
  const shortLabel = String(t(`timeframe.bucketsShort.${bucket}` as const));
  const label = variant === 'compact' ? shortLabel : fullLabel;
  const showCD = showCountdown ?? variant === 'full';

  // Tooltip text — pre-rendered so we don't pass the t function around
  // (its inferred return type explodes when threaded through helpers).
  let title = fullLabel;
  if (status && status.totalDays !== null) {
    title = `${fullLabel} · ${String(
      t('timeframe.windowDays', {
        elapsed: Math.max(0, status.daysElapsed),
        total: status.totalDays,
      })
    )}`;
  }

  // Countdown caption — only when requested AND we have anchor-based status.
  let countdown: string | null = null;
  if (showCD && status) {
    if (bucket === 'someday') {
      countdown = `· ${String(t('timeframe.somedayCaption'))}`;
    } else if (status.totalDays !== null) {
      countdown = status.isPast
        ? `· ${String(
            t('timeframe.windowPast', { n: Math.abs(status.daysRemaining ?? 0) })
          )}`
        : `· ${String(t('timeframe.windowSoon', { n: status.daysRemaining ?? 0 }))}`;
    }
  }

  return (
    <span
      className={[
        'rd-tf-badge',
        variant === 'full' ? 'rd-tf-badge--full' : '',
        status?.isPast ? 'is-past' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-bucket={bucket}
      aria-label={fullLabel}
      title={title}
    >
      <span className="rd-tf-chip-dot" data-bucket={bucket} aria-hidden="true" />
      <span>{label}</span>
      {countdown && (
        <span
          className={`rd-tf-countdown${status?.isPast ? ' is-past' : ''}`}
        >
          {countdown}
        </span>
      )}
    </span>
  );
}
