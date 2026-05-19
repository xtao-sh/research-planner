// Pure helpers for converting between the UI's weekly-schedule shape and the
// stringified "HH:MM-HH:MM" JSON array format the server accepts/returns.

export type DaySchedule = { startHour: number; endHour: number } | null;

/**
 * Convert a number of hours (possibly fractional) into an "HH:MM" string.
 *
 *   hourToHHMM(9)    === "09:00"
 *   hourToHHMM(17.5) === "17:30"
 */
export function hourToHHMM(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) {
    throw new Error(`Hour out of range: ${hour}`);
  }
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  // Handle rounding that bumps m to 60.
  const nh = m === 60 ? h + 1 : h;
  const nm = m === 60 ? 0 : m;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/**
 * Parse "HH:MM" back to a number of hours (fractional minutes supported).
 *
 *   hhmmToHour("09:00") === 9
 *   hhmmToHour("17:30") === 17.5
 */
export function hhmmToHour(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid time string: ${s}`);
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) {
    throw new Error(`Invalid time string: ${s}`);
  }
  if (h < 0 || h > 24 || mm < 0 || mm >= 60) {
    throw new Error(`Time out of range: ${s}`);
  }
  return h + mm / 60;
}

/**
 * Serialize a 7-entry weekly schedule to the JSON-string format the server
 * expects. Throws a descriptive Error on invalid input.
 */
export function serializeWeeklyHours(arr: DaySchedule[]): string {
  if (!Array.isArray(arr) || arr.length !== 7) {
    throw new Error(`weeklyHours must have exactly 7 entries (got ${arr?.length ?? 'n/a'})`);
  }
  const out: Array<string | null> = arr.map((entry, idx) => {
    if (entry === null) return null;
    if (
      typeof entry !== 'object' ||
      !Number.isFinite(entry.startHour) ||
      !Number.isFinite(entry.endHour)
    ) {
      throw new Error(`Day ${idx}: invalid schedule entry`);
    }
    if (entry.startHour >= entry.endHour) {
      throw new Error(`Day ${idx}: start time must be before end time`);
    }
    return `${hourToHHMM(entry.startHour)}-${hourToHHMM(entry.endHour)}`;
  });
  return JSON.stringify(out);
}
