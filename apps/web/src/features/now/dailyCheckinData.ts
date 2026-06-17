// Derivations + per-day dismiss state for the daily check-in card on /now.
// Everything here is computed from data /now already has in memory — no new
// fetch, no DB. The only persisted bit is a per-calendar-day dismiss flag in
// localStorage so the card can be hidden for today yet return tomorrow.
//
// Mirrors features/now/briefing.ts conventions: defensive storage access
// (try/catch + SSR guard), and "return null when there's nothing useful to
// say" so the caller can skip rendering rather than show empty state.

import type { Task } from '@rp/shared';
import { summarizeMovement, type MovementSummary } from './briefing';

/** Lookback for "what moved since yesterday". 36h captures yesterday plus
 *  this morning regardless of when the check-in happens, sidestepping the
 *  midnight-boundary edge case a strict calendar-day window would hit. */
export const DAILY_LOOKBACK_MS = 36 * 60 * 60 * 1000;

/** Local-calendar-day stamp (YYYY-MM-DD). Local, NOT UTC, so "today" matches
 *  the user's wall clock — the same wall clock the greeting uses. */
export function localDayStamp(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DISMISS_PREFIX = 'rp.dailyCheckin.dismissed.';

function dismissKey(stamp: string): string {
  return `${DISMISS_PREFIX}${stamp}`;
}

/** Was the check-in already dismissed for `stamp` (default: today)? */
export function isDailyDismissed(
  stamp: string = localDayStamp(),
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined'
    ? null
    : window.localStorage
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(dismissKey(stamp)) === '1';
  } catch {
    return false;
  }
}

/** Mark the check-in dismissed for `stamp` (default: today). Also opportunistically
 *  prunes any stale dismiss keys from previous days so localStorage doesn't grow
 *  unbounded — a one-key-per-day GC the next read would otherwise leave behind. */
export function dismissDaily(
  stamp: string = localDayStamp(),
  storage: Storage | null = typeof window === 'undefined'
    ? null
    : window.localStorage
): void {
  if (!storage) return;
  try {
    storage.setItem(dismissKey(stamp), '1');
    pruneStaleDismissKeys(stamp, storage);
  } catch {
    // ignore — storage may throw in private mode / quota
  }
}

/** Remove dismiss keys for days other than `keepStamp`. Best-effort. */
export function pruneStaleDismissKeys(
  keepStamp: string,
  storage: Storage | null = typeof window === 'undefined'
    ? null
    : window.localStorage
): void {
  if (!storage) return;
  try {
    const keep = dismissKey(keepStamp);
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DISMISS_PREFIX) && k !== keep) toRemove.push(k);
    }
    for (const k of toRemove) storage.removeItem(k);
  } catch {
    // ignore
  }
}

export interface DailyCheckinData {
  /** What moved in the last DAILY_LOOKBACK_MS, or null if nothing did. */
  movement: MovementSummary | null;
  /** Count of tasks pinned for today (focusedAt set). */
  focusedCount: number;
  /** Title of the lead pinned task, when there is at least one. */
  focusedLeadTitle: string | null;
  /** Currently-blocked tasks (id + title), for the blockers line + unblock. */
  blocked: Array<{ id: string; title: string }>;
  /** True when there is at least one line worth showing. */
  hasAnything: boolean;
}

/**
 * Compose the three glance lines from the workspace task list. `focused` and
 * `blocked` are passed pre-derived by the caller (NowPage already computes
 * them) so we don't recompute; `allTasks` is only used for the movement scan.
 */
export function deriveDailyCheckin(
  allTasks: ReadonlyArray<Task>,
  focused: ReadonlyArray<Task>,
  blocked: ReadonlyArray<Task>,
  now: Date = new Date()
): DailyCheckinData {
  const movement = summarizeMovement(
    allTasks,
    now.getTime() - DAILY_LOOKBACK_MS,
    now
  );
  const focusedCount = focused.length;
  const focusedLeadTitle = focused[0]?.title ?? null;
  const blockedSlim = blocked.map((tk) => ({ id: tk.id, title: tk.title }));
  const hasAnything =
    movement !== null || focusedCount > 0 || blockedSlim.length > 0;
  return {
    movement,
    focusedCount,
    focusedLeadTitle,
    blocked: blockedSlim,
    hasAnything,
  };
}
