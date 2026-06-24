import { useTranslation } from 'react-i18next';
import type { TaskSize } from '@rp/shared';

interface SizeChipProps {
  /** Falls back to 'm' when null/undefined — matches every previous
   *  inline usage of `(task.size ?? 'm').toUpperCase()`. */
  size: TaskSize | null | undefined;
  /** Optional className to merge onto the chip. */
  className?: string;
}

/**
 * Uppercase one-letter chip for a task's size. Extracted from the 5+
 * row surfaces that all inlined `(task.size ?? 'm').toUpperCase()` —
 * one of the drift hotspots flagged by the Round 15 audit.
 *
 * The chip itself is styled by the existing `.rd-size-chip` class in
 * App.css; this atom exists purely to enforce uppercase casing and to
 * carry an aria-label so screen-reader users hear the size *name*
 * (e.g. "Large") rather than just the letter "L".
 */
export function SizeChip({ size, className }: SizeChipProps) {
  const { t } = useTranslation();
  const v = size ?? 'm';
  const label = String(t(`task.size.${v}` as const));
  return (
    <span
      className={['rd-size-chip', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={label}
    >
      {v.toUpperCase()}
    </span>
  );
}
