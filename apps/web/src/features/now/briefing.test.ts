import { describe, it, expect } from 'vitest';
import type { Note, Task } from '@rp/shared';
import {
  countWeekPastWindow,
  resolveLastVisitMs,
  briefingLastSeenKey,
  summarizeMovement,
  summarizeOpenThreads,
  summarizeStuck,
  sumDoingIntensity,
} from './briefing';

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'task',
    type: 'research',
    status: 'todo',
    estimate: { o: 1, m: 1, p: 1 },
    priority: 1,
    size: 'm',
    ...overrides,
  };
}

function mkNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    workspaceId: 'w1',
    projectId: 'p1',
    createdById: 'u1',
    createdByEmail: 'u@x',
    body: 'thought',
    tags: [],
    createdAt: new Date('2026-05-18T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-05-18T00:00:00Z').toISOString(),
    ...overrides,
  };
}

const NOW = new Date('2026-05-21T00:00:00Z');
const LAST_VISIT_MS = new Date('2026-05-14T00:00:00Z').getTime();

describe('summarizeMovement', () => {
  it('returns null when nothing has moved', () => {
    const tasks = [mkTask({ status: 'todo' })];
    expect(summarizeMovement(tasks, LAST_VISIT_MS, NOW)).toBeNull();
  });

  it('counts started/finished/blocked transitions since lastVisit', () => {
    const tasks = [
      mkTask({
        id: 't-doing',
        status: 'doing',
        startedAt: '2026-05-17T00:00:00Z',
      }),
      mkTask({
        id: 't-done',
        status: 'done',
        title: 'Ship report',
        finishedAt: '2026-05-18T00:00:00Z',
      }),
      mkTask({
        id: 't-blocked',
        status: 'blocked',
        blockedAt: '2026-05-19T00:00:00Z',
      }),
    ];
    const r = summarizeMovement(tasks, LAST_VISIT_MS, NOW);
    expect(r).not.toBeNull();
    expect(r!.toDoing).toBe(1);
    expect(r!.toDone).toBe(1);
    expect(r!.toBlocked).toBe(1);
    expect(r!.lastShippedTitle).toBe('Ship report');
  });

  it('lists new tasks up to 3, else returns null titles', () => {
    const tasks = Array.from({ length: 5 }, (_, i) =>
      mkTask({
        id: `n${i}`,
        title: `new ${i}`,
        status: 'todo',
        updatedAt: '2026-05-19T00:00:00Z',
      })
    );
    const r = summarizeMovement(tasks, LAST_VISIT_MS, NOW);
    expect(r).not.toBeNull();
    expect(r!.newTaskCount).toBe(5);
    expect(r!.newTaskTitles).toBeNull();

    const few = tasks.slice(0, 2);
    const r2 = summarizeMovement(few, LAST_VISIT_MS, NOW);
    expect(r2!.newTaskTitles).toEqual(['new 0', 'new 1']);
  });

  it('finish beats start when both stamps post-date lastVisit', () => {
    const tasks = [
      mkTask({
        status: 'done',
        startedAt: '2026-05-15T00:00:00Z',
        finishedAt: '2026-05-18T00:00:00Z',
      }),
    ];
    const r = summarizeMovement(tasks, LAST_VISIT_MS, NOW);
    expect(r!.toDone).toBe(1);
    expect(r!.toDoing).toBe(0);
  });
});

describe('countWeekPastWindow', () => {
  it('counts only week-bucket tasks past their anchor + 7 days', () => {
    const tasks = [
      mkTask({
        timeframeBucket: 'week',
        timeframeAnchor: '2026-05-10T00:00:00Z', // 11d ago → past
      }),
      mkTask({
        timeframeBucket: 'week',
        timeframeAnchor: '2026-05-19T00:00:00Z', // 2d ago → in window
      }),
      mkTask({
        timeframeBucket: 'month', // not week
        timeframeAnchor: '2026-03-01T00:00:00Z',
      }),
      mkTask({
        status: 'done',
        timeframeBucket: 'week',
        timeframeAnchor: '2026-05-01T00:00:00Z',
      }),
    ];
    expect(countWeekPastWindow(tasks, NOW)).toBe(1);
  });
});

describe('summarizeStuck', () => {
  it('returns null when nothing is stuck', () => {
    expect(
      summarizeStuck([mkTask({ status: 'todo' })], NOW)
    ).toBeNull();
  });

  it('counts doing >= 7 days and blocked separately', () => {
    const tasks = [
      mkTask({
        status: 'doing',
        startedAt: '2026-05-10T00:00:00Z', // 11d
      }),
      mkTask({
        status: 'doing',
        startedAt: '2026-05-18T00:00:00Z', // 3d — not stuck
      }),
      mkTask({ status: 'blocked' }),
    ];
    const r = summarizeStuck(tasks, NOW);
    expect(r).not.toBeNull();
    expect(r!.doingStuckCount).toBe(1);
    expect(r!.blockedCount).toBe(1);
    expect(r!.loneTitle).toBeNull();
  });

  it('surfaces the title when exactly one task is stuck', () => {
    const tasks = [
      mkTask({
        status: 'blocked',
        title: 'Waiting on Alice',
      }),
    ];
    const r = summarizeStuck(tasks, NOW);
    expect(r!.loneTitle).toBe('Waiting on Alice');
  });
});

describe('sumDoingIntensity', () => {
  it('sums intensity only for doing tasks', () => {
    const tasks = [
      mkTask({ status: 'doing', size: 'l' }), // 4
      mkTask({ status: 'doing', size: 'xs' }), // 1
      mkTask({ status: 'todo', size: 'xl' }), // ignored
    ];
    expect(sumDoingIntensity(tasks)).toBe(5);
  });
});

describe('summarizeOpenThreads', () => {
  it('returns null when no notes are recent', () => {
    const notes = [
      mkNote({ createdAt: '2026-04-01T00:00:00Z' }), // 50d old
    ];
    expect(summarizeOpenThreads(notes, NOW)).toBeNull();
  });

  it('truncates the most-recent body to 40 chars with ellipsis', () => {
    const notes = [
      mkNote({
        id: 'a',
        body: 'short note',
        createdAt: '2026-05-15T00:00:00Z',
      }),
      mkNote({
        id: 'b',
        body:
          'this is a much longer note that should definitely overflow the limit so it gets ellipsised',
        createdAt: '2026-05-20T00:00:00Z',
      }),
    ];
    const r = summarizeOpenThreads(notes, NOW);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(2);
    expect(r!.snippet).toMatch(/…$/);
    expect(r!.snippet!.length).toBeLessThanOrEqual(41);
  });

  it('collapses whitespace in the snippet', () => {
    const notes = [
      mkNote({
        body: 'line one\n\nline two',
        createdAt: '2026-05-20T00:00:00Z',
      }),
    ];
    const r = summarizeOpenThreads(notes, NOW);
    expect(r!.snippet).toBe('line one line two');
  });
});

describe('resolveLastVisitMs', () => {
  it('uses storage value when present', () => {
    const storage: Pick<Storage, 'getItem'> = {
      getItem: (k) =>
        k === briefingLastSeenKey('p1') ? String(LAST_VISIT_MS) : null,
    };
    const ms = resolveLastVisitMs(
      'p1',
      '2026-05-20T00:00:00Z',
      14,
      storage
    );
    expect(ms).toBe(LAST_VISIT_MS);
  });

  it('falls back to updatedAt minus window when storage empty', () => {
    const storage: Pick<Storage, 'getItem'> = { getItem: () => null };
    const updated = '2026-05-20T00:00:00Z';
    const ms = resolveLastVisitMs('p1', updated, 14, storage);
    expect(ms).toBe(
      new Date(updated).getTime() - 14 * 86_400_000
    );
  });
});
