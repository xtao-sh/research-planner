/**
 * Working-calendar support for the scheduler (Phase 3b).
 *
 * All operations are in UTC. A `CalendarDescriptor` describes a workspace's
 * weekly working hours and blackout holidays. The scheduler uses
 * `advanceWorkingTime` to advance a task's start instant by its duration while
 * honoring the calendar — it skips closed weekdays, closed hours, and holiday
 * dates, stitching partial days together.
 *
 * Timezone simplification for MVP: both `weeklyHours` and `holidays` are
 * interpreted in UTC. A window "09:00-18:00" means 09:00 UTC to 18:00 UTC. A
 * holiday date "2026-07-04" means the UTC day 2026-07-04. This is a deliberate
 * future-hardening point — localized TZ support comes later.
 */

export interface WorkingWindow {
  /** Inclusive start hour, 0..24 (supports fractional hours like 9.5 for 09:30). */
  startHour: number;
  /** Exclusive end hour, 0..24. Must be > startHour. */
  endHour: number;
}

export interface CalendarDescriptor {
  /** 7 entries indexed by day-of-week (0=Sun..6=Sat). null = closed. */
  weeklyHours: Array<WorkingWindow | null>;
  /** Holiday dates as "YYYY-MM-DD" strings (UTC day). Closed regardless of weekday. */
  holidays: Set<string>;
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
// Safety cap: if we can't find a working window within 400 days, bail.
const MAX_FORWARD_DAYS = 400;

/** Format a Date (or ms) as "YYYY-MM-DD" in UTC. */
export function formatUtcDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Return the UTC day-of-week (0=Sun..6=Sat) for the given ms timestamp. */
export function utcDayOfWeek(ms: number): number {
  return new Date(ms).getUTCDay();
}

/** Return ms at 00:00:00.000 UTC of the same day as `ms`. */
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start of the next UTC day (00:00:00.000 UTC of day+1). */
function startOfNextUtcDay(ms: number): number {
  return startOfUtcDay(ms) + MS_PER_DAY;
}

/**
 * Parse "HH:MM-HH:MM" → { startHour, endHour } with fractional-hour support
 * ("09:30" → 9.5). Throws on malformed input.
 */
export function parseHhMmWindow(s: string): WorkingWindow {
  const m = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(s);
  if (!m) throw new Error(`Invalid working-hours window: ${s}`);
  const [, sh, sm, eh, em] = m;
  const startHour = Number(sh) + Number(sm) / 60;
  const endHour = Number(eh) + Number(em) / 60;
  if (
    !Number.isFinite(startHour) ||
    !Number.isFinite(endHour) ||
    startHour < 0 ||
    startHour > 24 ||
    endHour < 0 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new Error(`Invalid working-hours window: ${s}`);
  }
  return { startHour, endHour };
}

/**
 * Given an instant `ms`, return the earliest instant >= `ms` that falls inside
 * an open working window (per the calendar). Walks forward at most
 * MAX_FORWARD_DAYS days; returns `ms` unchanged if the calendar has no open
 * windows within that horizon.
 */
export function nextWorkingInstant(ms: number, calendar: CalendarDescriptor): number {
  let cur = ms;
  for (let i = 0; i < MAX_FORWARD_DAYS; i++) {
    const dayStart = startOfUtcDay(cur);
    const dateStr = formatUtcDate(cur);
    if (calendar.holidays.has(dateStr)) {
      cur = dayStart + MS_PER_DAY;
      continue;
    }
    const dow = utcDayOfWeek(cur);
    const window = calendar.weeklyHours[dow];
    if (!window) {
      cur = dayStart + MS_PER_DAY;
      continue;
    }
    const windowStartMs = dayStart + window.startHour * MS_PER_HOUR;
    const windowEndMs = dayStart + window.endHour * MS_PER_HOUR;
    if (cur < windowStartMs) return windowStartMs;
    if (cur < windowEndMs) return cur;
    // cur is at or after window end — jump to next day.
    cur = dayStart + MS_PER_DAY;
  }
  // Safety fallback — calendar had no open window within the horizon.
  // eslint-disable-next-line no-console
  console.warn('[scheduler] nextWorkingInstant: no working window found within horizon');
  return ms;
}

/**
 * Assuming `ms` is inside an open working window, return the end instant of
 * that window (same UTC day). Caller must have passed the instant through
 * `nextWorkingInstant` first.
 */
export function endOfCurrentWorkingWindow(
  ms: number,
  calendar: CalendarDescriptor
): number {
  const dow = utcDayOfWeek(ms);
  const window = calendar.weeklyHours[dow];
  if (!window) return ms; // shouldn't happen after nextWorkingInstant
  const dayStart = startOfUtcDay(ms);
  return dayStart + window.endHour * MS_PER_HOUR;
}

/**
 * Advance `startMs` by `hours` of *working time*. When `calendar` is undefined
 * this falls back to continuous wall-clock time (current behavior), i.e.
 * `startMs + hours * 3_600_000`.
 *
 * The calendar-aware path walks through working windows, accumulating hours
 * until the requested total is consumed.
 */
export function advanceWorkingTime(
  startMs: number,
  hours: number,
  calendar?: CalendarDescriptor
): number {
  if (!calendar) return startMs + hours * MS_PER_HOUR;
  if (hours <= 0) return nextWorkingInstant(startMs, calendar);

  let cur = nextWorkingInstant(startMs, calendar);
  let remainingMs = hours * MS_PER_HOUR;

  for (let i = 0; i < MAX_FORWARD_DAYS; i++) {
    const windowEndMs = endOfCurrentWorkingWindow(cur, calendar);
    const available = windowEndMs - cur;
    if (available >= remainingMs) {
      return cur + remainingMs;
    }
    remainingMs -= available;
    // Jump to the next open window.
    cur = nextWorkingInstant(windowEndMs, calendar);
  }
  // eslint-disable-next-line no-console
  console.warn('[scheduler] advanceWorkingTime: exceeded safety horizon, falling back to continuous time');
  return startMs + hours * MS_PER_HOUR;
}
