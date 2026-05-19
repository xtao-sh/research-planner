import { describe, it, expect } from 'vitest';
import type { Dependency, Task } from '../../shared/src/types';
import { topoSort, CycleError } from './topo';
import { criticalPath } from './critical-path';
import { schedule } from './schedule';

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

describe('topoSort', () => {
  it('returns a valid topological order for a linear chain', () => {
    const tasks = [mkTask('a', { o: 1, m: 1, p: 1 }), mkTask('b', { o: 1, m: 1, p: 1 }), mkTask('c', { o: 1, m: 1, p: 1 })];
    const deps = [mkDep('d1', 'a', 'b'), mkDep('d2', 'b', 'c')];
    expect(topoSort(tasks, deps)).toEqual(['a', 'b', 'c']);
  });

  it('handles independent tasks (no deps)', () => {
    const tasks = [mkTask('a', { o: 1, m: 1, p: 1 }), mkTask('b', { o: 1, m: 1, p: 1 })];
    const order = topoSort(tasks, []);
    expect(order).toHaveLength(2);
    expect(new Set(order)).toEqual(new Set(['a', 'b']));
  });

  it('throws CycleError on a cyclic graph', () => {
    const tasks = [mkTask('a', { o: 1, m: 1, p: 1 }), mkTask('b', { o: 1, m: 1, p: 1 })];
    const deps = [mkDep('d1', 'a', 'b'), mkDep('d2', 'b', 'a')];
    expect(() => topoSort(tasks, deps)).toThrow(CycleError);
  });

  it('respects precedence in a diamond graph', () => {
    const tasks = ['a', 'b', 'c', 'd'].map((id) => mkTask(id, { o: 1, m: 1, p: 1 }));
    const deps = [mkDep('1', 'a', 'b'), mkDep('2', 'a', 'c'), mkDep('3', 'b', 'd'), mkDep('4', 'c', 'd')];
    const order = topoSort(tasks, deps);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });
});

describe('schedule', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');

  it('computes PERT expected value E=(O+4M+P)/6', () => {
    // O=4, M=8, P=16 → E = (4+32+16)/6 = 52/6 ≈ 8.67 → rounds to 9h
    const tasks = [mkTask('t1', { o: 4, m: 8, p: 16 })];
    const result = schedule(tasks, [], { projectId: 'p', projectStart: start });
    const item = result.items[0];
    const hours = (new Date(item.endPlanned).getTime() - new Date(item.startPlanned).getTime()) / 3_600_000;
    expect(hours).toBe(9);
  });

  it('chains start times via FS dependencies', () => {
    const tasks = [mkTask('a', { o: 2, m: 4, p: 6 }), mkTask('b', { o: 1, m: 2, p: 3 })]; // E=4, E=2
    const deps = [mkDep('d1', 'a', 'b')];
    const result = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const byId = new Map(result.items.map((i) => [i.taskId, i]));
    expect(byId.get('a')!.startPlanned).toBe(start.toISOString());
    expect(byId.get('b')!.startPlanned).toBe(byId.get('a')!.endPlanned);
  });

  it('clamps tiny estimates to a 1-hour minimum', () => {
    const tasks = [mkTask('a', { o: 0, m: 0, p: 0 })];
    const result = schedule(tasks, [], { projectId: 'p', projectStart: start });
    const hours = (new Date(result.items[0].endPlanned).getTime() - new Date(result.items[0].startPlanned).getTime()) / 3_600_000;
    expect(hours).toBe(1);
  });

  it('flags hard-due violations', () => {
    // Task runs 8h from start; hard due is 4h after start → violation
    const hardDue = new Date(start.getTime() + 4 * 3600_000).toISOString();
    const tasks = [mkTask('a', { o: 6, m: 8, p: 10 }, { dueHard: hardDue })];
    const result = schedule(tasks, [], { projectId: 'p', projectStart: start });
    expect(result.items[0].violatesHardDue).toBe(true);
  });

  it('flags soft-due violations independently of hard-due', () => {
    const softDue = new Date(start.getTime() + 2 * 3600_000).toISOString();
    // No hard due; 8h task finishes past the 2h soft due
    const tasks = [mkTask('a', { o: 6, m: 8, p: 10 }, { dueSoft: softDue })];
    const result = schedule(tasks, [], { projectId: 'p', projectStart: start });
    expect(result.items[0].violatesSoftDue).toBe(true);
    expect(result.items[0].violatesHardDue).toBe(false);
  });

  it('does not flag soft-due when task finishes on time', () => {
    const softDue = new Date(start.getTime() + 10 * 3600_000).toISOString();
    const tasks = [mkTask('a', { o: 2, m: 4, p: 6 }, { dueSoft: softDue })];
    const result = schedule(tasks, [], { projectId: 'p', projectStart: start });
    expect(result.items[0].violatesSoftDue).toBe(false);
  });

  it('supports durationMode optimistic/expected/pessimistic', () => {
    // O=2, M=4, P=12 → expected=(2+16+12)/6=5, optimistic=2, pessimistic=12
    const tasks = [mkTask('t1', { o: 2, m: 4, p: 12 })];
    const hoursFor = (mode: 'expected' | 'optimistic' | 'pessimistic') => {
      const res = schedule(tasks, [], { projectId: 'p', projectStart: start, durationMode: mode });
      const it = res.items[0];
      return (new Date(it.endPlanned).getTime() - new Date(it.startPlanned).getTime()) / 3_600_000;
    };
    expect(hoursFor('expected')).toBe(5);
    expect(hoursFor('optimistic')).toBe(2);
    expect(hoursFor('pessimistic')).toBe(12);
  });

  it('uses the later predecessor endPlanned when joining branches', () => {
    // a (E=4h) and b (E=10h) both feed c; c must start after max
    const tasks = [mkTask('a', { o: 2, m: 4, p: 6 }), mkTask('b', { o: 8, m: 10, p: 12 }), mkTask('c', { o: 1, m: 2, p: 3 })];
    const deps = [mkDep('d1', 'a', 'c'), mkDep('d2', 'b', 'c')];
    const result = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const byId = new Map(result.items.map((i) => [i.taskId, i]));
    expect(byId.get('c')!.startPlanned).toBe(byId.get('b')!.endPlanned);
  });
});

describe('schedule with SS/FF/SF and lag', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const H = 3_600_000;

  it('SS dep with lag=0: successor starts when predecessor starts', () => {
    const tasks = [mkTask('a', { o: 4, m: 4, p: 4 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'SS', 0)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    expect(by.get('b')!.startPlanned).toBe(by.get('a')!.startPlanned);
  });

  it('SS dep with lag=2: successor starts 2h after predecessor starts', () => {
    const tasks = [mkTask('a', { o: 10, m: 10, p: 10 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'SS', 2)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    const aStart = new Date(by.get('a')!.startPlanned).getTime();
    const bStart = new Date(by.get('b')!.startPlanned).getTime();
    expect(bStart - aStart).toBe(2 * H);
  });

  it('FF dep with lag=0: successor ends when predecessor ends', () => {
    // a: 10h, b: 2h. Without deps, b would finish at +2h. FF forces b.end = a.end = +10h,
    // so b.start = +8h.
    const tasks = [mkTask('a', { o: 10, m: 10, p: 10 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'FF', 0)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    expect(by.get('b')!.endPlanned).toBe(by.get('a')!.endPlanned);
    const bStart = new Date(by.get('b')!.startPlanned).getTime();
    expect(bStart - start.getTime()).toBe(8 * H);
  });

  it('SF dep: successor.end = predecessor.start + lag', () => {
    // a: 4h, b: 2h, SF lag=6. b.end = a.start + 6h = start + 6h; b.start = start + 4h.
    const tasks = [mkTask('a', { o: 4, m: 4, p: 4 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'SF', 6)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    const bEnd = new Date(by.get('b')!.endPlanned).getTime();
    const aStart = new Date(by.get('a')!.startPlanned).getTime();
    expect(bEnd - aStart).toBe(6 * H);
  });

  it('negative lag (FS, lag=-1): successor starts 1h before predecessor ends', () => {
    // a: 5h, b: 2h, FS with lag=-1. b.start = a.end - 1h = start + 4h.
    const tasks = [mkTask('a', { o: 5, m: 5, p: 5 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'FS', -1)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    const bStart = new Date(by.get('b')!.startPlanned).getTime();
    expect(bStart - start.getTime()).toBe(4 * H);
  });

  it('clamps successor.start to projectStart when negative lag would push before it', () => {
    // a: 2h, b: 2h, FS with lag=-100. b.start would be start - 98h → clamp to start.
    const tasks = [mkTask('a', { o: 2, m: 2, p: 2 }), mkTask('b', { o: 2, m: 2, p: 2 })];
    const deps = [mkDep('d', 'a', 'b', 'FS', -100)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    expect(by.get('b')!.startPlanned).toBe(start.toISOString());
  });

  it('FS with lag=0 matches pre-refactor behavior (regression)', () => {
    const tasks = [mkTask('a', { o: 2, m: 4, p: 6 }), mkTask('b', { o: 1, m: 2, p: 3 })];
    const deps = [mkDep('d', 'a', 'b', 'FS', 0)];
    const res = schedule(tasks, deps, { projectId: 'p', projectStart: start });
    const by = new Map(res.items.map((i) => [i.taskId, i]));
    expect(by.get('a')!.startPlanned).toBe(start.toISOString());
    expect(by.get('b')!.startPlanned).toBe(by.get('a')!.endPlanned);
  });
});

describe('criticalPath', () => {
  it('returns the longest weighted path', () => {
    // Two paths from a: a→b→d (E: 2+2+2=6) vs a→c→d (E: 2+8+2=12). CP should be a,c,d.
    const tasks = [
      mkTask('a', { o: 2, m: 2, p: 2 }),
      mkTask('b', { o: 2, m: 2, p: 2 }),
      mkTask('c', { o: 8, m: 8, p: 8 }),
      mkTask('d', { o: 2, m: 2, p: 2 }),
    ];
    const deps = [mkDep('1', 'a', 'b'), mkDep('2', 'a', 'c'), mkDep('3', 'b', 'd'), mkDep('4', 'c', 'd')];
    expect(criticalPath(tasks, deps)).toEqual(['a', 'c', 'd']);
  });

  it('returns a single-node path when no deps', () => {
    const tasks = [mkTask('a', { o: 1, m: 1, p: 1 }), mkTask('b', { o: 10, m: 10, p: 10 })];
    const cp = criticalPath(tasks, []);
    expect(cp).toEqual(['b']);
  });

  it('returns empty array when given no tasks', () => {
    expect(criticalPath([], [])).toEqual([]);
  });

  it('picks the longest-end path through mixed dep types', () => {
    // a(10h) → SS lag=2 → b(8h). b.end = start+10h.
    // a(10h) → FS lag=0 → c(3h). c.end = start+13h. (This is the longest.)
    const tasks = [
      mkTask('a', { o: 10, m: 10, p: 10 }),
      mkTask('b', { o: 8, m: 8, p: 8 }),
      mkTask('c', { o: 3, m: 3, p: 3 }),
    ];
    const deps = [mkDep('d1', 'a', 'b', 'SS', 2), mkDep('d2', 'a', 'c', 'FS', 0)];
    const cp = criticalPath(tasks, deps);
    expect(cp).toEqual(['a', 'c']);
  });
});
