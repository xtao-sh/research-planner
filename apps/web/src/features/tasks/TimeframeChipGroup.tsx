import { useTranslation } from 'react-i18next';
import { TIMEFRAME_BUCKETS, type TimeframeBucket } from '@rp/shared';

interface TimeframeChipGroupProps {
  value: TimeframeBucket | null | undefined;
  onChange: (next: TimeframeBucket | null) => void;
  /** When true, clicking the currently-selected chip clears the selection.
   *  Defaults to true. */
  allowClear?: boolean;
  /** Optional className applied to the outer container. */
  className?: string;
  /** Optional inline style on the container. */
  style?: React.CSSProperties;
  /** ARIA label for the group; defaults to the i18n timeframe label. */
  ariaLabel?: string;
}

/**
 * Five-chip picker for the Task.timeframeBucket field. Renders as a row
 * of toggle-style chips — clicking selects, clicking the selected chip
 * again clears (if `allowClear`).
 *
 * Visual + a11y notes:
 *  - aria-pressed conveys selection state to screen readers
 *  - the colored dot is decorative (aria-hidden) — the label carries meaning
 *  - keyboard: each chip is a real <button>, so Tab + Enter / Space works
 */
export function TimeframeChipGroup({
  value,
  onChange,
  allowClear = true,
  className,
  style,
  ariaLabel,
}: TimeframeChipGroupProps) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('timeframe.label')}
      className={['rd-tf-group', className].filter(Boolean).join(' ')}
      style={style}
    >
      {TIMEFRAME_BUCKETS.map((bucket) => {
        const active = value === bucket;
        return (
          <button
            key={bucket}
            type="button"
            className="rd-tf-chip"
            data-bucket={bucket}
            aria-pressed={active}
            onClick={() => {
              if (active && allowClear) onChange(null);
              else onChange(bucket);
            }}
          >
            <span className="rd-tf-chip-dot" data-bucket={bucket} aria-hidden="true" />
            <span>{t(`timeframe.buckets.${bucket}` as const)}</span>
          </button>
        );
      })}
    </div>
  );
}
