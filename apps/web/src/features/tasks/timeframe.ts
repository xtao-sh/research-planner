// Pure helpers for the Task.timeframeBucket feature. No React; importable
// from anywhere (including unit tests).
//
// See @rp/shared TimeframeBucket for the enum and TIMEFRAME_DAYS for the
// per-bucket calendar-day length.

import type { Task, TimeframeBucket } from '@rp/shared';
import { TIMEFRAME_DAYS } from '@rp/shared';

/**
 * Compute the calendar millisecond at which a task's fuzzy timeframe
 * window ends, given its anchor date and bucket. Returns null when the
 * window has no end (no bucket, or `someday` which is intentionally
 * open-ended) or when the anchor itself is unusable. Used by the
 * UncertaintyLane tick marker.
 */
export function computeTimeframeEndMs(
  anchor: string | Date | null | undefined,
  bucket: TimeframeBucket | null | undefined
): number | null {
  if (!anchor || !bucket) return null;
  const days = TIMEFRAME_DAYS[bucket];
  if (days == null) return null;
  const anchorMs =
    typeof anchor === 'string' ? new Date(anchor).getTime() : anchor.getTime();
  if (!Number.isFinite(anchorMs)) return null;
  return anchorMs + days * 86_400_000;
}

const MS_PER_DAY = 86_400_000;

export interface TimeframeStatus {
  /** Days elapsed since the anchor (floored). May be negative if anchor is in the future. */
  daysElapsed: number;
  /**
   * Days remaining in the bucket window.
   *   - positive = inside the window
   *   - negative = past the window
   *   - null     = bucket is 'someday' (no window)
   */
  daysRemaining: number | null;
  /** True iff the window has elapsed. False for someday. */
  isPast: boolean;
  /** The bucket's day-length, or null for someday. */
  totalDays: number | null;
}

/**
 * Compute where a task sits in its timeframe window. Returns null when the
 * task has no bucket or no anchor (defensive — server normally fills anchor).
 */
export function computeTimeframeStatus(
  bucket: TimeframeBucket | null | undefined,
  anchor: string | Date | null | undefined,
  now: Date = new Date()
): TimeframeStatus | null {
  if (!bucket || !anchor) return null;
  const anchorMs =
    typeof anchor === 'string' ? new Date(anchor).getTime() : anchor.getTime();
  if (!Number.isFinite(anchorMs)) return null;
  const elapsedMs = now.getTime() - anchorMs;
  const daysElapsed = Math.floor(elapsedMs / MS_PER_DAY);
  const totalDays = TIMEFRAME_DAYS[bucket];
  if (totalDays === null) {
    return { daysElapsed, daysRemaining: null, isPast: false, totalDays: null };
  }
  const daysRemaining = totalDays - daysElapsed;
  return {
    daysElapsed,
    daysRemaining,
    isPast: daysRemaining < 0,
    totalDays,
  };
}

/**
 * Convenience: extract bucket + anchor from a Task into a status reading.
 * Returns null when the task has no bucket.
 */
export function timeframeStatusForTask(
  task: Pick<Task, 'timeframeBucket' | 'timeframeAnchor'>,
  now: Date = new Date()
): TimeframeStatus | null {
  return computeTimeframeStatus(task.timeframeBucket, task.timeframeAnchor, now);
}

/**
 * The "magnitude rank" for sorting / grouping. someday sorts last so it
 * doesn't crowd the dated buckets in /now grouping later.
 */
export function bucketRank(bucket: TimeframeBucket): number {
  switch (bucket) {
    case 'week': return 0;
    case 'month': return 1;
    case 'quarter': return 2;
    case 'year': return 3;
    case 'someday': return 99;
  }
}

/**
 * Count tasks past their timeframe window. Used by /review for the
 * weekly observation and (eventually) by /now's section header for the
 * "N past window" badge. Excludes:
 *  - done tasks (already finished)
 *  - someday (explicitly not on the clock)
 *  - bucketless tasks (no expectation set)
 */
export function countPastTimeframe(
  tasks: ReadonlyArray<Pick<Task, 'status' | 'timeframeBucket' | 'timeframeAnchor'>>,
  now: Date = new Date()
): number {
  let n = 0;
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (!t.timeframeBucket || t.timeframeBucket === 'someday') continue;
    const s = computeTimeframeStatus(t.timeframeBucket, t.timeframeAnchor, now);
    if (s?.isPast) n++;
  }
  return n;
}

/**
 * Group tasks by timeframe bucket. Tasks without a bucket are dropped.
 * Returns a fully-populated record so callers can iterate via
 * TIMEFRAME_BUCKETS deterministically.
 */
export function groupTasksByTimeframe<
  T extends Pick<Task, 'timeframeBucket' | 'status'>
>(tasks: ReadonlyArray<T>, includeDone = false): Record<TimeframeBucket, T[]> {
  const groups: Record<TimeframeBucket, T[]> = {
    week: [],
    month: [],
    quarter: [],
    year: [],
    someday: [],
  };
  for (const t of tasks) {
    if (!includeDone && t.status === 'done') continue;
    const b = t.timeframeBucket;
    if (!b) continue;
    groups[b].push(t);
  }
  return groups;
}
