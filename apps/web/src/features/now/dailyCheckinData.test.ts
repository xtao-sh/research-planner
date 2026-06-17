import { describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '@rp/shared';
import {
  deriveDailyCheckin,
  dismissDaily,
  isDailyDismissed,
  localDayStamp,
  pruneStaleDismissKeys,
  DAILY_LOOKBACK_MS,
} from './dailyCheckinData';

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

const NOW = new Date('2026-05-21T12:00:00Z');

describe('deriveDailyCheckin', () => {
  it('hasAnything is false when nothing moved, pinned, or blocked', () => {
    const tasks = [mkTask({ status: 'todo' })];
    const d = deriveDailyCheckin(tasks, [], [], NOW);
    expect(d.hasAnything).toBe(false);
    expect(d.movement).toBeNull();
  });

  it('counts a finish inside the 36h window as movement', () => {
    const finishedAt = new Date(NOW.getTime() - 10 * 3600 * 1000).toISOString();
    const tasks = [
      mkTask({ id: 't-done', status: 'done', title: 'Ship', finishedAt }),
    ];
    const d = deriveDailyCheckin(tasks, [], [], NOW);
    expect(d.hasAnything).toBe(true);
    expect(d.movement?.toDone).toBe(1);
    expect(d.movement?.lastShippedTitle).toBe('Ship');
  });

  it('ignores a finish older than the 36h window', () => {
    const old = new Date(NOW.getTime() - DAILY_LOOKBACK_MS - 3600 * 1000).toISOString();
    const tasks = [mkTask({ status: 'done', finishedAt: old })];
    const d = deriveDailyCheckin(tasks, [], [], NOW);
    expect(d.movement).toBeNull();
  });

  it('surfaces focused lead title and blocked list', () => {
    const focused = [mkTask({ id: 'f1', title: 'Pinned A', focusedAt: NOW.toISOString() })];
    const blocked = [mkTask({ id: 'b1', title: 'Blocked X', status: 'blocked' })];
    const d = deriveDailyCheckin([...focused, ...blocked], focused, blocked, NOW);
    expect(d.focusedCount).toBe(1);
    expect(d.focusedLeadTitle).toBe('Pinned A');
    expect(d.blocked).toEqual([{ id: 'b1', title: 'Blocked X' }]);
    expect(d.hasAnything).toBe(true);
  });
});

describe('per-day dismiss', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('isDailyDismissed reflects dismissDaily for the same day', () => {
    const stamp = localDayStamp(new Date('2026-05-21T12:00:00Z'));
    expect(isDailyDismissed(stamp)).toBe(false);
    dismissDaily(stamp);
    expect(isDailyDismissed(stamp)).toBe(true);
  });

  it('a different day is NOT dismissed (card returns next day)', () => {
    const today = localDayStamp(new Date('2026-05-21T12:00:00Z'));
    const tomorrow = localDayStamp(new Date('2026-05-22T12:00:00Z'));
    dismissDaily(today);
    expect(isDailyDismissed(today)).toBe(true);
    expect(isDailyDismissed(tomorrow)).toBe(false);
  });

  it('pruneStaleDismissKeys keeps only the current day', () => {
    dismissDaily('2026-05-19');
    dismissDaily('2026-05-20');
    dismissDaily('2026-05-21');
    pruneStaleDismissKeys('2026-05-21');
    expect(isDailyDismissed('2026-05-19')).toBe(false);
    expect(isDailyDismissed('2026-05-20')).toBe(false);
    expect(isDailyDismissed('2026-05-21')).toBe(true);
  });
});
