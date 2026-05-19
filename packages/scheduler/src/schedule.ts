import type {
  Dependency,
  ID,
  ScheduleResult,
  ScheduleResultItem,
  Task,
} from '../../shared/src/types';
import { topoSort } from './topo';
import {
  advanceWorkingTime,
  nextWorkingInstant,
  type CalendarDescriptor,
} from './calendar';

function toISO(date: Date): string {
  return date.toISOString();
}

export type DurationMode = 'expected' | 'optimistic' | 'pessimistic';

export function taskDuration(t: Task, mode: DurationMode): number {
  const { o, m, p } = t.estimate;
  if (mode === 'optimistic') return Math.max(1, Math.round(o));
  if (mode === 'pessimistic') return Math.max(1, Math.round(p));
  // PERT expected value: E = (O + 4M + P) / 6
  const e = (o + 4 * m + p) / 6;
  return Math.max(1, Math.round(e));
}

export interface ScheduleOptions {
  projectId: ID;
  projectStart?: Date; // default: today
  durationMode?: DurationMode; // default: 'expected'
  /**
   * Optional working calendar. When absent the scheduler operates in
   * continuous wall-clock time (legacy behavior, preserved for backward
   * compat). When present, task durations advance only during open working
   * windows (see `advanceWorkingTime`). Lag is still applied as wall-clock
   * ms — see design notes.
   */
  calendar?: CalendarDescriptor;
}

export interface ScheduleComputation {
  items: ScheduleResultItem[];
  startTimes: Map<ID, Date>;
  endTimes: Map<ID, Date>;
  // For each task: which predecessor's constraint *bound* its start time.
  // null when the start was bound by projectStart (no pred or pred didn't push).
  predecessorBinding: Map<ID, ID | null>;
  order: ID[];
}

/**
 * Internal helper: compute per-task start/end times honoring all four PM dep
 * types (FS/SS/FF/SF) with a `lag` in hours (may be negative). Returns
 * binding info so criticalPath can trace the longest chain back.
 */
export function computeSchedule(
  tasks: Task[],
  deps: Dependency[],
  opts: ScheduleOptions
): ScheduleComputation {
  const projectStart = opts.projectStart ?? new Date();
  const durationMode: DurationMode = opts.durationMode ?? 'expected';
  const order = topoSort(tasks, deps);
  const byId = new Map<ID, Task>(tasks.map((t) => [t.id, t]));

  // Group inbound deps by successor for O(1) lookup during the sweep.
  const inboundDeps = new Map<ID, Dependency[]>();
  for (const d of deps) {
    const arr = inboundDeps.get(d.toTaskId) || [];
    arr.push(d);
    inboundDeps.set(d.toTaskId, arr);
  }

  const startTimes = new Map<ID, Date>();
  const endTimes = new Map<ID, Date>();
  const predecessorBinding = new Map<ID, ID | null>();
  const items: ScheduleResultItem[] = [];

  for (const id of order) {
    const t = byId.get(id)!;
    const durH = taskDuration(t, durationMode);
    // Start with project start as the floor.
    let bestMs = projectStart.getTime();
    let binding: ID | null = null;

    const preds = inboundDeps.get(id) || [];
    for (const d of preds) {
      const pStart = startTimes.get(d.fromTaskId);
      const pEnd = endTimes.get(d.fromTaskId);
      if (!pStart || !pEnd) continue; // topo order guarantees this, but be defensive
      const lagMs = d.lag * 3_600_000;
      const durMs = durH * 3_600_000;
      let candidateMs: number;
      switch (d.type) {
        case 'FS':
          // successor.start >= pred.end + lag
          candidateMs = pEnd.getTime() + lagMs;
          break;
        case 'SS':
          // successor.start >= pred.start + lag
          candidateMs = pStart.getTime() + lagMs;
          break;
        case 'FF':
          // successor.end >= pred.end + lag
          // => successor.start >= pred.end + lag - duration
          candidateMs = pEnd.getTime() + lagMs - durMs;
          break;
        case 'SF':
          // successor.end >= pred.start + lag
          // => successor.start >= pred.start + lag - duration
          candidateMs = pStart.getTime() + lagMs - durMs;
          break;
        default: {
          // Should be unreachable given the DepType union, but default to FS.
          candidateMs = pEnd.getTime() + lagMs;
        }
      }
      if (candidateMs > bestMs) {
        bestMs = candidateMs;
        binding = d.fromTaskId;
      }
    }
    // Clamp to projectStart — negative leads that push before it are pinned.
    if (bestMs < projectStart.getTime()) {
      bestMs = projectStart.getTime();
      binding = null;
    }

    // Slide start forward into the next open working window if the calendar
    // is present. If this moves the start, clear `binding` to match the
    // projectStart-clamp semantics.
    if (opts.calendar) {
      const slid = nextWorkingInstant(bestMs, opts.calendar);
      if (slid !== bestMs) {
        bestMs = slid;
        binding = null;
      }
    }

    const startAt = new Date(bestMs);
    const endAt = new Date(advanceWorkingTime(bestMs, durH, opts.calendar));
    startTimes.set(id, startAt);
    endTimes.set(id, endAt);
    predecessorBinding.set(id, binding);

    items.push({
      taskId: id,
      startPlanned: toISO(startAt),
      endPlanned: toISO(endAt),
      violatesHardDue:
        !!t.dueHard && new Date(t.dueHard).getTime() < endAt.getTime(),
      violatesSoftDue:
        !!t.dueSoft && new Date(t.dueSoft).getTime() < endAt.getTime(),
    });
  }

  return { items, startTimes, endTimes, predecessorBinding, order };
}

/**
 * Trace the critical path from a ScheduleComputation. Lives here (rather than
 * in critical-path.ts) so that `schedule()` can use it without a circular
 * import. `critical-path.ts` re-exports this.
 */
export function criticalPathFromComputation(comp: ScheduleComputation): ID[] {
  if (comp.order.length === 0) return [];
  let endId: ID | null = null;
  let bestEnd = -Infinity;
  // Tie-break: later in topo order wins (deeper task).
  for (const id of comp.order) {
    const e = comp.endTimes.get(id)!;
    const ms = e.getTime();
    if (ms >= bestEnd) {
      bestEnd = ms;
      endId = id;
    }
  }
  if (!endId) return [];
  const path: ID[] = [];
  const seen = new Set<ID>();
  let cur: ID | null = endId;
  while (cur && !seen.has(cur)) {
    path.push(cur);
    seen.add(cur);
    cur = comp.predecessorBinding.get(cur) ?? null;
  }
  return path.reverse();
}

export function schedule(
  tasks: Task[],
  deps: Dependency[],
  opts: ScheduleOptions
): ScheduleResult {
  const comp = computeSchedule(tasks, deps, opts);
  return {
    projectId: opts.projectId,
    items: comp.items,
    criticalPath: criticalPathFromComputation(comp),
  };
}
