import { useTranslation } from 'react-i18next';
import type { Task } from '@rp/shared';
import { deriveIntensity } from '../../shared/intensity';

interface IntensityBarsProps {
  task: Pick<Task, 'intensity' | 'size'>;
  /**
   * When `false` (the default), the bars render only when the user has
   * explicitly set `task.intensity` — i.e. they're saying "this task
   * has a cognitive load different from what its size implies." When
   * intensity is null (size-derived), nothing renders, since the size
   * chip alone already conveys that signal.
   *
   * Set to `true` on surfaces that always want to show the bars (e.g.
   * the inline editor, where the bars are the editing affordance).
   */
  alwaysRender?: boolean;
  className?: string;
}

/**
 * Five-bar cognitive-load indicator. Visible only when the user has
 * explicitly overridden `task.intensity` (separate from size).
 *
 * Background — the Round 15 audit found that intensity bars and the
 * size chip rendered the same magnitude on every row (intensity is
 * size-derived when null). Showing both is informative iff they can
 * differ; on most tasks they don't, so the bars are visual noise. By
 * suppressing the bars when intensity is null, the bars become a
 * meaningful signal: "this task has a deliberate non-default load."
 *
 * For edit surfaces where you always need the bars (so the user can
 * see what they're adjusting), pass `alwaysRender`.
 */
export function IntensityBars({
  task,
  alwaysRender = false,
  className,
}: IntensityBarsProps) {
  const { t } = useTranslation();
  const explicit = task.intensity != null;
  if (!alwaysRender && !explicit) return null;
  const level = deriveIntensity(task as Task);
  return (
    <span
      className={['rd-intensity', className].filter(Boolean).join(' ')}
      data-level={level}
      aria-label={String(t('task.intensityHint', { n: level }))}
    >
      <span className="rd-bar" />
      <span className="rd-bar" />
      <span className="rd-bar" />
      <span className="rd-bar" />
      <span className="rd-bar" />
    </span>
  );
}
