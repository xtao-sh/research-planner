import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CalendarDescriptor } from '@rp/scheduler';
import type { WorkingCalendar } from '@rp/shared';

type CalendarRow = Prisma.WorkingCalendarGetPayload<{}>;
type HolidayRow = Prisma.HolidayGetPayload<{}>;

/**
 * Default working-hours JSON: Mon-Fri 09:00-18:00 UTC, weekends closed.
 * Indexed by UTC day-of-week: 0=Sun..6=Sat.
 */
export const defaultWeeklyHoursJSON = JSON.stringify([
  null,
  '09:00-18:00',
  '09:00-18:00',
  '09:00-18:00',
  '09:00-18:00',
  '09:00-18:00',
  null,
]);

/**
 * Parse a weeklyHours JSON string into a validated array of
 * `{startHour,endHour}|null` entries. Throws on malformed input.
 *
 * `HH:MM` supports fractional hours (e.g. "09:30" → 9.5).
 */
export function parseWeeklyHoursString(
  s: string
): Array<{ startHour: number; endHour: number } | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    throw new Error('weeklyHours is not valid JSON');
  }
  if (!Array.isArray(raw) || raw.length !== 7) {
    throw new Error('weeklyHours must be an array of length 7');
  }
  const re = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/;
  return raw.map((entry, idx) => {
    if (entry === null) return null;
    if (typeof entry !== 'string' || !re.test(entry)) {
      throw new Error(`weeklyHours[${idx}] must be null or "HH:MM-HH:MM"`);
    }
    const m = re.exec(entry)!;
    const startHour = Number(m[1]) + Number(m[2]) / 60;
    const endHour = Number(m[3]) + Number(m[4]) / 60;
    if (
      !Number.isFinite(startHour) ||
      !Number.isFinite(endHour) ||
      startHour < 0 ||
      endHour > 24 ||
      startHour >= endHour
    ) {
      throw new Error(`weeklyHours[${idx}] has invalid start/end times`);
    }
    return { startHour, endHour };
  });
}

/** Serialize back to the storage form. Currently just echoes the string. */
export function serializeWeeklyHours(
  arr: Array<{ startHour: number; endHour: number } | null>
): string {
  const out = arr.map((w) => {
    if (!w) return null;
    const fmt = (h: number) => {
      const hh = String(Math.floor(h)).padStart(2, '0');
      const mm = String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0');
      return `${hh}:${mm}`;
    };
    return `${fmt(w.startHour)}-${fmt(w.endHour)}`;
  });
  return JSON.stringify(out);
}

/** Build a scheduler-facing CalendarDescriptor from DB rows. */
export function toCalendarDescriptor(
  calendar: CalendarRow,
  holidays: HolidayRow[]
): CalendarDescriptor {
  return {
    weeklyHours: parseWeeklyHoursString(calendar.weeklyHours),
    holidays: new Set(holidays.map((h) => h.date)),
  };
}

/** Shape returned to API clients. */
export function toWorkingCalendarShape(
  calendar: CalendarRow,
  holidays: HolidayRow[]
): WorkingCalendar {
  return {
    id: calendar.id,
    workspaceId: calendar.workspaceId,
    weeklyHours: parseWeeklyHoursString(calendar.weeklyHours),
    createdAt: calendar.createdAt.toISOString(),
    updatedAt: calendar.updatedAt.toISOString(),
    holidays: holidays.map((h) => ({
      id: h.id,
      calendarId: h.calendarId,
      date: h.date,
      name: h.name,
    })),
  };
}

/**
 * Idempotently ensure a workspace has a WorkingCalendar. Returns the calendar
 * row (existing or newly created with defaults).
 */
export async function ensureWorkspaceCalendar(
  prisma: PrismaClient,
  workspaceId: string
): Promise<CalendarRow> {
  const existing = await prisma.workingCalendar.findUnique({
    where: { workspaceId },
  });
  if (existing) return existing;
  return prisma.workingCalendar.create({
    data: {
      id: randomUUID(),
      workspaceId,
      weeklyHours: defaultWeeklyHoursJSON,
    },
  });
}

/**
 * Load a workspace's calendar + its holidays, returning a scheduler-ready
 * descriptor. Returns `undefined` if no calendar is configured (in which case
 * the scheduler falls back to continuous time).
 */
export async function loadCalendarDescriptorForWorkspace(
  prisma: PrismaClient,
  workspaceId: string
): Promise<CalendarDescriptor | undefined> {
  const cal = await prisma.workingCalendar.findUnique({
    where: { workspaceId },
  });
  if (!cal) return undefined;
  const holidays = await prisma.holiday.findMany({
    where: { calendarId: cal.id },
  });
  try {
    return toCalendarDescriptor(cal, holidays);
  } catch {
    // If the stored weeklyHours is somehow malformed, fall through to
    // continuous-time scheduling rather than 500ing the request.
    return undefined;
  }
}
