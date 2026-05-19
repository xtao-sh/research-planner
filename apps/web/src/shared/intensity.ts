import type { Task } from '@rp/shared';

/** Map a task `size` (xs..xl) to its derived intensity (1..5).
 *  Used as the fallback whenever `task.intensity` is null/undefined. */
const SIZE_TO_INTENSITY: Record<string, number> = {
  xs: 1,
  s: 2,
  m: 3,
  l: 4,
  xl: 5,
};

/** Resolve a task's intensity — prefer the explicit field, fall back to
 *  size-derived, default 3 (medium). */
export function deriveIntensity(task: Task): number {
  return (
    task.intensity ?? SIZE_TO_INTENSITY[(task.size || 'm').toLowerCase()] ?? 3
  );
}
