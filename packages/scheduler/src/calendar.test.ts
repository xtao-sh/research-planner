import { describe, it, expect } from 'vitest';
import type { Dependency, Task } from '../../shared/src/types';
import { schedule } from './schedule';
import {
  advanceWorkingTime,
  retreatWorkingTime,
  nextWorkingInstant,
  parseHhMmWindow,
  type CalendarDescriptor,
} from './calendar';

function mkTask(
  id: string,
  estimate: { o: number; m: number; p: number },
  overrides: Partial<Task> = {}
): Task {
  return {
    id,
    projectId: 'p',
    title: id,
    type: 'research',
    status: 'todo',
    estimate,
    priority: 1,
    ...overrides,
  };
}

function mkDep(
  id: string,
  from: string,
  to: string,
  type: Dependency['type'] = 'FS',
  lag: number = 0
): Dependency {
  return { id, projectId: 'p', fromTaskId: from, toTaskId: to, type, lag };
}

/** Weekday 09:00-18:00 UTC, weekends closed. */
function weekdayCalendar(holidays: string[] = []): CalendarDescriptor {
  const win = parseHhMmWindow('09:00-18:00');
  return {
    weeklyHours: [null, win, win, win, win, win, null],
    holidays: new Set(holidays),
  };
}

describe('advanceWorkingTime — no calendar (backwards compat)', () => {
  it('returns startMs + hours*3.6M when calendar is undefined', () => {
    const start = Date.UTC(2026, 0, 5, 8, 0, 0); // arbitrary
    const end = advanceWorkingTime(start, 4, undefined);
    expect(end - start).toBe(4 * 3_600_000);
  });
});

describe('advanceWorkingTime — weekday calendar', () => {
  it('shifts a 4h task starting Mon 08:00 UTC to Mon 09:00-13:00 UTC', () => {
    const cal = weekdayCalendar();
    // Monday 2026-01-05 is a Monday.
    const monday08 = Date.UTC(2026, 0, 5, 8, 0, 0);
    const startAt = nextWorkingInstant(monday08, cal);
    expect(startAt).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
    const endAt = advanceWorkingTime(startAt, 4, cal);
    expect(endAt).toBe(Date.UTC(2026, 0, 5, 13, 0, 0));
  });

  it('spans a weekend: Fri 16:00 UTC + 4h → Mon 11:00 UTC', () => {
    const cal = weekdayCalendar();
    // Friday 2026-01-02, 16:00 UTC. Window ends at 18:00 Fri → 2h remain.
    const fri16 = Date.UTC(2026, 0, 2, 16, 0, 0);
    const endAt = advanceWorkingTime(fri16, 4, cal);
    // 2h Fri 16:00-18:00, then skip Sat+Sun, then 2h Mon 09:00-11:00.
    expect(endAt).toBe(Date.UTC(2026, 0, 5, 11, 0, 0));
  });

  it('jumps past a holiday on the start day', () => {
    // Holiday on Monday 2026-01-05 → 2h task starts Tue 09:00 UTC, ends 11:00.
    const cal = weekdayCalendar(['2026-01-05']);
    const mon09 = Date.UTC(2026, 0, 5, 9, 0, 0);
    const startAt = nextWorkingInstant(mon09, cal);
    expect(startAt).toBe(Date.UTC(2026, 0, 6, 9, 0, 0));
    const endAt = advanceWorkingTime(startAt, 2, cal);
    expect(endAt).toBe(Date.UTC(2026, 0, 6, 11, 0, 0));
  });

  it('partial-fills 20h across Mon/Tue/Wed ending Wed 11:00 UTC', () => {
    const cal = weekdayCalendar();
    const mon09 = Date.UTC(2026, 0, 5, 9, 0, 0);
    // Mon 9-18 (9h) + Tue 9-18 (9h) + Wed 9-11 (2h) = 20h.
    const endAt = advanceWorkingTime(mon09, 20, cal);
    expect(endAt).toBe(Date.UTC(2026, 0, 7, 11, 0, 0));
  });
});

describe('schedule() with calendar option', () => {
  it('backwards compat: scheduler without calendar matches legacy continuous time', () => {
    // Friday start, 4h task should run straight across wall-clock time.
    const tasks = [mkTask('a', { o: 4, m: 4, p: 4 })];
    const start = new Date(Date.UTC(2026, 0, 2, 16, 0, 0)); // Fri 16:00
    const res = schedule(tasks, [], { projectId: 'p', projectStart: start });
    const item = res.items[0];
    expect(new Date(item.startPlanned).getTime()).toBe(start.getTime());
    expect(
      new Date(item.endPlanned).getTime() - start.getTime()
    ).toBe(4 * 3_600_000);
  });

  it('calendar-aware schedule spans weekend on Fri 16:00 start', () => {
    const tasks = [mkTask('a', { o: 4, m: 4, p: 4 })];
    const start = new Date(Date.UTC(2026, 0, 2, 16, 0, 0)); // Fri 16:00
    const res = schedule(tasks, [], {
      projectId: 'p',
      projectStart: start,
      calendar: weekdayCalendar(),
    });
    const item = res.items[0];
    expect(new Date(item.startPlanned).toISOString()).toBe(start.toISOString());
    expect(new Date(item.endPlanned).toISOString()).toBe(
      new Date(Date.UTC(2026, 0, 5, 11, 0, 0)).toISOString()
    );
  });

  it('calendar-aware chained FS dep: b starts at a.end (next working instant)', () => {
    // a: 2h ending Fri 18:00 UTC (closed at end). Then b starts Mon 09:00 UTC.
    const cal = weekdayCalendar();
    const tasks = [
      mkTask('a', { o: 2, m: 2, p: 2 }),
      mkTask('b', { o: 3, m: 3, p: 3 }),
    ];
    const deps = [mkDep('d', 'a', 'b', 'FS', 0)];
    const start = new Date(Date.UTC(2026, 0, 2, 16, 0, 0)); // Fri 16:00
    const res = schedule(tasks, deps, {
      projectId: 'p',
      projectStart: start,
      calendar: cal,
    });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    // a: Fri 16:00 -> Fri 18:00
    expect(by.get('a')!.startPlanned).toBe(
      new Date(Date.UTC(2026, 0, 2, 16, 0, 0)).toISOString()
    );
    expect(by.get('a')!.endPlanned).toBe(
      new Date(Date.UTC(2026, 0, 2, 18, 0, 0)).toISOString()
    );
    // b must start Mon 09:00 (nextWorkingInstant slides it forward).
    expect(by.get('b')!.startPlanned).toBe(
      new Date(Date.UTC(2026, 0, 5, 9, 0, 0)).toISOString()
    );
    // b: 3h → Mon 12:00.
    expect(by.get('b')!.endPlanned).toBe(
      new Date(Date.UTC(2026, 0, 5, 12, 0, 0)).toISOString()
    );
  });
});

describe('retreatWorkingTime — backward mirror of advanceWorkingTime', () => {
  it('no calendar: endMs - hours*3.6M', () => {
    const end = Date.UTC(2026, 0, 5, 13, 0, 0);
    expect(retreatWorkingTime(end, 4, undefined)).toBe(end - 4 * 3_600_000);
  });

  it('inverts advanceWorkingTime within one window (Mon 13:00 - 4h = Mon 09:00)', () => {
    const cal = weekdayCalendar();
    const mon13 = Date.UTC(2026, 0, 5, 13, 0, 0);
    expect(retreatWorkingTime(mon13, 4, cal)).toBe(Date.UTC(2026, 0, 5, 9, 0, 0));
  });

  it('inverts a weekend span: Mon 11:00 - 4h = Fri 16:00', () => {
    const cal = weekdayCalendar();
    // advanceWorkingTime(Fri 16:00, 4h) === Mon 11:00 (existing test). Invert it.
    const mon11 = Date.UTC(2026, 0, 5, 11, 0, 0);
    expect(retreatWorkingTime(mon11, 4, cal)).toBe(Date.UTC(2026, 0, 2, 16, 0, 0));
  });

  it('round-trips advance∘retreat for an arbitrary working duration', () => {
    const cal = weekdayCalendar();
    const start = nextWorkingInstant(Date.UTC(2026, 0, 5, 14, 0, 0), cal); // Mon 14:00
    const end = advanceWorkingTime(start, 7, cal); // spans into Tue
    expect(retreatWorkingTime(end, 7, cal)).toBe(start);
  });
});

describe('schedule() calendar fixes (Round-17 audit)', () => {
  it('preserves the critical path across a weekend (binding not cleared on slide)', () => {
    // a: Fri 16:00 -> Fri 18:00 (2h). b: FS on a, slides to Mon 09:00 -> 11:00.
    // The critical path must include BOTH a and b — previously the calendar
    // slide cleared b's predecessor binding, truncating the trace to just [b].
    const cal = weekdayCalendar();
    const tasks = [
      mkTask('a', { o: 2, m: 2, p: 2 }),
      mkTask('b', { o: 2, m: 2, p: 2 }),
    ];
    const deps = [mkDep('d', 'a', 'b', 'FS', 0)];
    const start = new Date(Date.UTC(2026, 0, 2, 16, 0, 0)); // Fri 16:00
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start, calendar: cal });
    expect(res.criticalPath).toEqual(['a', 'b']);
  });

  it('FF dependency makes the successor END exactly with the predecessor under a calendar', () => {
    // a: 10h from Mon 09:00 -> Tue 10:00 (9h Mon + 1h Tue).
    // b: FF lag=0, 2h. Constraint is b.end >= a.end, intent "finish together".
    // Correct: b.start Mon 17:00, b.end Tue 10:00 (== a.end).
    // The OLD wall-clock subtraction put b at Tue 09:00 -> Tue 11:00 (1h late).
    const cal = weekdayCalendar();
    const tasks = [
      mkTask('a', { o: 10, m: 10, p: 10 }),
      mkTask('b', { o: 2, m: 2, p: 2 }),
    ];
    const deps = [mkDep('d', 'a', 'b', 'FF', 0)];
    const start = new Date(Date.UTC(2026, 0, 5, 9, 0, 0)); // Mon 09:00
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start, calendar: cal });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    expect(by.get('a')!.endPlanned).toBe(new Date(Date.UTC(2026, 0, 6, 10, 0, 0)).toISOString());
    expect(by.get('b')!.startPlanned).toBe(new Date(Date.UTC(2026, 0, 5, 17, 0, 0)).toISOString());
    expect(by.get('b')!.endPlanned).toBe(new Date(Date.UTC(2026, 0, 6, 10, 0, 0)).toISOString());
    // The FF constraint (b.end >= a.end) holds, and the dates finish together.
    expect(by.get('b')!.endPlanned).toBe(by.get('a')!.endPlanned);
  });
});
