// Pure helpers for the project re-entry briefing card on /now. Each helper
// inspects the task list (or note list) for a single project and returns a
// small, presentation-friendly value: a count, a title, a snippet, etc.
//
// The briefing's design intent is "resuming a conversation" — every helper
// here is deliberately defensive: if there's nothing useful to say, we
// return null so the caller can skip rendering rather than show "0 things."

import type { Note, Task } from '@rp/shared';
import { computeTimeframeStatus } from '../tasks/timeframe';
import { deriveIntensity } from '../../shared/intensity';

const MS_PER_DAY = 86_400_000;

/** How long a task can sit in `doing` before we call it stuck. */
export const DOING_STUCK_DAYS = 7;
/** How recent a note must be to count as an "open thread." */
export const OPEN_THREAD_WINDOW_DAYS = 14;
/** New tasks become noise above this count — skip listing them. */
const MAX_NEW_TASK_LIST = 3;

export interface MovementSummary {
  /** Tasks whose status changed since lastVisit, by destination bucket. */
  toDoing: number;
  toDone: number;
  toBlocked: number;
  /** Title of the most-recently-finished task since lastVisit, if any. */
  lastShippedTitle: string | null;
  /** Titles of tasks created since lastVisit. Capped to MAX_NEW_TASK_LIST;
   *  set to null if there are more than that (too noisy to list). */
  newTaskTitles: string[] | null;
  /** Raw count of newly-created tasks (always set, even when titles is null). */
  newTaskCount: number;
}

/**
 * Inspect tasks for movement that happened since `lastVisitMs`. The check
 * is heuristic: we look at `finishedAt`, `startedAt`, `blockedAt`, and
 * `createdAt` timestamps and bucket each task into at most one of
 * {toDoing, toDone, toBlocked, newTask}. A task that was created _and_
 * moved counts as movement, not creation.
 *
 * Returns null when nothing moved (so callers can skip the section
 * entirely).
 */
export function summarizeMovement(
  tasks: ReadonlyArray<Task>,
  lastVisitMs: number,
  now: Date = new Date()
): MovementSummary | null {
  // Suppress unused-parameter lint without changing the signature.
  void now;

  let toDoing = 0;
  let toDone = 0;
  let toBlocked = 0;
  const newTitles: string[] = [];
  let lastFinishedTitle: string | null = null;
  let lastFinishedMs = 0;

  for (const task of tasks) {
    const startedMs = task.startedAt ? new Date(task.startedAt).getTime() : 0;
    const finishedMs = task.finishedAt ? new Date(task.finishedAt).getTime() : 0;
    const blockedMs = task.blockedAt ? new Date(task.blockedAt).getTime() : 0;
    const updatedMs = task.updatedAt
      ? new Date(task.updatedAt).getTime()
      : 0;

    // Track most-recent finish since lastVisit.
    if (finishedMs > lastVisitMs && finishedMs > lastFinishedMs) {
      lastFinishedMs = finishedMs;
      lastFinishedTitle = task.title;
    }

    // Bucket the movement. A task can only count once — finish wins over
    // start which wins over block which wins over creation.
    if (finishedMs > lastVisitMs) {
      toDone++;
      continue;
    }
    if (startedMs > lastVisitMs && task.status === 'doing') {
      toDoing++;
      continue;
    }
    if (blockedMs > lastVisitMs && task.status === 'blocked') {
      toBlocked++;
      continue;
    }
    // New-task heuristic: task is still `todo`, has no started/finished
    // stamps, and its updatedAt falls after lastVisit. The task could
    // legitimately have been *edited* (title/size) rather than created,
    // but for a todo task that's basically a near-create event.
    if (
      updatedMs > lastVisitMs &&
      task.status === 'todo' &&
      !startedMs &&
      !finishedMs
    ) {
      newTitles.push(task.title);
    }
  }

  const newTaskCount = newTitles.length;
  const totalMovement = toDoing + toDone + toBlocked + newTaskCount;
  if (totalMovement === 0 && !lastFinishedTitle) return null;

  return {
    toDoing,
    toDone,
    toBlocked,
    lastShippedTitle: lastFinishedTitle,
    newTaskTitles:
      newTaskCount > 0 && newTaskCount <= MAX_NEW_TASK_LIST ? newTitles : null,
    newTaskCount,
  };
}

/**
 * Count week-bucket tasks that have just slipped past their window. Filters
 * to the project's tasks already (caller responsibility) and excludes done.
 * Returns 0 when there are none — caller still gets a number so it can
 * decide whether to render.
 */
export function countWeekPastWindow(
  tasks: ReadonlyArray<Task>,
  now: Date = new Date()
): number {
  let n = 0;
  for (const t of tasks) {
    if (t.status === 'done') continue;
    if (t.timeframeBucket !== 'week') continue;
    const s = computeTimeframeStatus(t.timeframeBucket, t.timeframeAnchor, now);
    if (s?.isPast) n++;
  }
  return n;
}

export interface StuckSummary {
  /** Tasks `doing` for more than DOING_STUCK_DAYS. */
  doingStuckCount: number;
  /** Tasks currently `blocked`. */
  blockedCount: number;
  /** Title of the single stuck task, when there's exactly one across both
   *  categories. Null when zero or many. */
  loneTitle: string | null;
}

/**
 * Summarise "stuck" tasks. Single-row output: count of doing>=7d plus count
 * of blocked. When exactly one task is stuck across both buckets, returns
 * its title so the card can name it.
 */
export function summarizeStuck(
  tasks: ReadonlyArray<Task>,
  now: Date = new Date()
): StuckSummary | null {
  const doingStuck: Task[] = [];
  const blocked: Task[] = [];
  for (const t of tasks) {
    if (t.status === 'blocked') {
      blocked.push(t);
    } else if (t.status === 'doing' && t.startedAt) {
      const days = Math.floor(
        (now.getTime() - new Date(t.startedAt).getTime()) / MS_PER_DAY
      );
      if (days >= DOING_STUCK_DAYS) doingStuck.push(t);
    }
  }
  if (doingStuck.length === 0 && blocked.length === 0) return null;
  const combined = doingStuck.length + blocked.length;
  return {
    doingStuckCount: doingStuck.length,
    blockedCount: blocked.length,
    loneTitle:
      combined === 1
        ? doingStuck[0]?.title ?? blocked[0]?.title ?? null
        : null,
  };
}

/**
 * Sum of intensities for the project's currently-doing tasks. Compared by
 * the caller against the workspace's daily budget.
 */
export function sumDoingIntensity(tasks: ReadonlyArray<Task>): number {
  let sum = 0;
  for (const t of tasks) {
    if (t.status !== 'doing') continue;
    sum += deriveIntensity(t);
  }
  return sum;
}

export interface OpenThreadSummary {
  /** Notes added within OPEN_THREAD_WINDOW_DAYS that haven't been
   *  promoted/filed (we approximate: any project-note within the window
   *  counts, since once promoted the note moves projectId). */
  count: number;
  /** A 40-char snippet from the most-recent note, sanitised to a single
   *  line so it can render in a card cell. */
  snippet: string | null;
}

/**
 * Open project notes are "thoughts you wrote down but didn't act on."
 * We surface those younger than 14 days. The snippet is truncated and
 * single-lined for compact cell display.
 */
export function summarizeOpenThreads(
  notes: ReadonlyArray<Note>,
  now: Date = new Date()
): OpenThreadSummary | null {
  const cutoff = now.getTime() - OPEN_THREAD_WINDOW_DAYS * MS_PER_DAY;
  const recent = notes
    .filter((n) => {
      const ms = new Date(n.createdAt).getTime();
      return Number.isFinite(ms) && ms >= cutoff;
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  if (recent.length === 0) return null;
  const head = recent[0];
  const oneLine = head.body.replace(/\s+/g, ' ').trim();
  const snippet =
    oneLine.length <= 40 ? oneLine : `${oneLine.slice(0, 40).trimEnd()}…`;
  return {
    count: recent.length,
    snippet: snippet.length > 0 ? snippet : null,
  };
}

/** localStorage key for the project's last-seen-briefing timestamp. The
 *  card writes this when it mounts (so the *next* re-entry shows movement
 *  relative to this visit) and when the user clicks Open / Dismiss. */
export function briefingLastSeenKey(projectId: string): string {
  return `rp.briefing.lastSeenMs.${projectId}`;
}

/**
 * Resolve "the moment before this visit" for movement calculations. Prefers
 * the localStorage stamp written on prior visits. When none exists (first
 * re-entry on this device), falls back to "project.updatedAt − window" so
 * we still surface meaningful activity. `windowDays` is the lookback for
 * the fallback case.
 */
export function resolveLastVisitMs(
  projectId: string,
  projectUpdatedAt: string,
  windowDays = 14,
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined'
    ? null
    : window.localStorage
): number {
  if (storage) {
    try {
      const raw = storage.getItem(briefingLastSeenKey(projectId));
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
      }
    } catch {
      // ignore — storage may throw in private mode
    }
  }
  const updatedMs = new Date(projectUpdatedAt).getTime();
  if (!Number.isFinite(updatedMs)) return 0;
  return updatedMs - windowDays * MS_PER_DAY;
}

