import { describe, it, expect } from 'vitest';
import { getTaskStaleLevel } from './staleTask';
import type { Task } from '@rp/shared';

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: 'p1',
    title: 'test',
    type: 'research',
    status: 'todo',
    estimate: { o: 1, m: 1, p: 1 },
    priority: 1,
    size: 'm',
    ...overrides,
  };
}

describe('getTaskStaleLevel', () => {
  const now = new Date('2026-04-30T00:00:00Z');

  it('returns fresh for non-doing/blocked statuses', () => {
    const r = getTaskStaleLevel(mkTask({ status: 'todo' }), now);
    expect(r.level).toBe('fresh');
  });

  it('returns doing-stale when started >= 7 days ago', () => {
    const startedAt = new Date('2026-04-22T00:00:00Z').toISOString();
    const r = getTaskStaleLevel(
      mkTask({ status: 'doing', startedAt }),
      now
    );
    expect(r.level).toBe('doing-stale');
    expect(r.days).toBe(8);
  });

  it('returns fresh when doing for less than 7 days', () => {
    const startedAt = new Date('2026-04-26T00:00:00Z').toISOString();
    const r = getTaskStaleLevel(
      mkTask({ status: 'doing', startedAt }),
      now
    );
    expect(r.level).toBe('fresh');
  });

  it('returns blocked-stale via blockedAt when blocked >= 3 days ago', () => {
    const blockedAt = new Date('2026-04-25T00:00:00Z').toISOString();
    const r = getTaskStaleLevel(
      mkTask({ status: 'blocked', blockedAt }),
      now
    );
    expect(r.level).toBe('blocked-stale');
    expect(r.days).toBe(5);
  });

  it('falls back to updatedAt for blocked tasks without blockedAt (legacy)', () => {
    const updatedAt = new Date('2026-04-25T00:00:00Z').toISOString();
    const r = getTaskStaleLevel(
      mkTask({ status: 'blocked', updatedAt }),
      now
    );
    expect(r.level).toBe('blocked-stale');
  });
});
