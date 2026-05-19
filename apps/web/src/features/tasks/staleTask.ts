// Computes a coarse "staleness" indicator for an in-flight task.
//
// - `doing` tasks running for >= 7 days raise a yellow flag.
// - `blocked` tasks idle for >= 3 days raise a red flag.
//
// `blockedAt` is the authoritative timestamp for entering the 'blocked' state
// (server-stamped on status transitions). For older rows that predate the
// column, we fall back to `updatedAt` and then planned dates so the badge
// still produces a reasonable signal.

import type { Task } from '@rp/shared';

export type TaskStaleLevel = 'fresh' | 'doing-stale' | 'blocked-stale';

const DAY_MS = 86_400_000;

export function getTaskStaleLevel(
  task: Task,
  now: Date = new Date()
): { level: TaskStaleLevel; days: number } {
  if (task.status === 'doing' && task.startedAt) {
    const days = Math.floor(
      (now.getTime() - new Date(task.startedAt).getTime()) / DAY_MS
    );
    if (days >= 7) return { level: 'doing-stale', days };
  }
  if (task.status === 'blocked') {
    const since =
      task.blockedAt ?? task.updatedAt ?? task.endPlanned ?? task.startPlanned;
    if (since) {
      const days = Math.floor(
        (now.getTime() - new Date(since).getTime()) / DAY_MS
      );
      if (days >= 3) return { level: 'blocked-stale', days };
    }
  }
  return { level: 'fresh', days: 0 };
}
