import { describe, it, expect } from 'vitest';
import {
  computeTimeframeStatus,
  bucketRank,
  countPastTimeframe,
  groupTasksByTimeframe,
} from './timeframe';
import type { Task } from '@rp/shared';

const DAY = 86_400_000;

describe('computeTimeframeStatus', () => {
  it('returns null when bucket is missing', () => {
    expect(computeTimeframeStatus(null, '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(computeTimeframeStatus(undefined, '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('returns null when anchor is missing', () => {
    expect(computeTimeframeStatus('week', null)).toBeNull();
    expect(computeTimeframeStatus('week', undefined)).toBeNull();
  });

  it('returns null when anchor is unparseable', () => {
    expect(computeTimeframeStatus('week', 'not-a-date')).toBeNull();
  });

  it('week bucket, 3 days in: 4 days remaining', () => {
    const now = new Date('2026-01-04T12:00:00Z');
    const anchor = new Date(now.getTime() - 3 * DAY).toISOString();
    const status = computeTimeframeStatus('week', anchor, now);
    expect(status).not.toBeNull();
    expect(status!.totalDays).toBe(7);
    expect(status!.daysElapsed).toBe(3);
    expect(status!.daysRemaining).toBe(4);
    expect(status!.isPast).toBe(false);
  });

  it('week bucket, 10 days in: 3 days past, isPast=true', () => {
    const now = new Date('2026-01-11T00:00:00Z');
    const anchor = new Date(now.getTime() - 10 * DAY).toISOString();
    const status = computeTimeframeStatus('week', anchor, now);
    expect(status!.daysElapsed).toBe(10);
    expect(status!.daysRemaining).toBe(-3);
    expect(status!.isPast).toBe(true);
  });

  it('someday: totalDays null, never past', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const anchor = new Date(now.getTime() - 90 * DAY).toISOString();
    const status = computeTimeframeStatus('someday', anchor, now);
    expect(status!.totalDays).toBeNull();
    expect(status!.daysRemaining).toBeNull();
    expect(status!.isPast).toBe(false);
  });

  it.each([
    ['week', 7],
    ['month', 30],
    ['quarter', 90],
    ['year', 365],
  ] as const)('%s bucket has totalDays=%i', (bucket, days) => {
    const now = new Date('2026-01-01T00:00:00Z');
    const anchor = now.toISOString();
    const status = computeTimeframeStatus(bucket, anchor, now);
    expect(status!.totalDays).toBe(days);
  });

  it('anchor in the future yields negative elapsed', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const anchor = new Date(now.getTime() + 5 * DAY).toISOString();
    const status = computeTimeframeStatus('week', anchor, now);
    expect(status!.daysElapsed).toBe(-5);
    expect(status!.daysRemaining).toBe(12);
    expect(status!.isPast).toBe(false);
  });
});

describe('bucketRank', () => {
  it('orders buckets shortest-to-longest with someday last', () => {
    const buckets = ['someday', 'quarter', 'week', 'year', 'month'] as const;
    const sorted = [...buckets].sort((a, b) => bucketRank(a) - bucketRank(b));
    expect(sorted).toEqual(['week', 'month', 'quarter', 'year', 'someday']);
  });
});

// Helper for building minimal test tasks. Only the fields the helpers
// actually read are required; the rest are filled in to satisfy the
// shape if a caller passes a full Task.
function mkTask(o: Partial<Task> = {}): Task {
  return {
    id: 't', projectId: 'p', title: '', type: 'research',
    status: 'todo', estimate: { o: 1, m: 1, p: 1 }, priority: 1, size: 'm',
    ...o,
  };
}

describe('countPastTimeframe', () => {
  it('returns 0 for an empty list', () => {
    expect(countPastTimeframe([])).toBe(0);
  });

  it('ignores tasks without a bucket', () => {
    expect(
      countPastTimeframe([mkTask({ status: 'todo' }), mkTask({ status: 'doing' })])
    ).toBe(0);
  });

  it('ignores done tasks even when past their window', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const anchor = new Date(now.getTime() - 30 * DAY).toISOString();
    const tasks = [
      mkTask({ status: 'done', timeframeBucket: 'week', timeframeAnchor: anchor }),
    ];
    expect(countPastTimeframe(tasks, now)).toBe(0);
  });

  it('ignores someday tasks (never past)', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const anchor = new Date(now.getTime() - 365 * DAY).toISOString();
    const tasks = [
      mkTask({ status: 'todo', timeframeBucket: 'someday', timeframeAnchor: anchor }),
    ];
    expect(countPastTimeframe(tasks, now)).toBe(0);
  });

  it('counts non-done tasks past their bucket window', () => {
    const now = new Date('2026-02-01T00:00:00Z');
    const old = new Date(now.getTime() - 20 * DAY).toISOString();   // week-past
    const fresh = new Date(now.getTime() - 2 * DAY).toISOString();  // week-fresh
    const tasks = [
      mkTask({ status: 'doing', timeframeBucket: 'week', timeframeAnchor: old }),
      mkTask({ status: 'todo', timeframeBucket: 'week', timeframeAnchor: fresh }),
      mkTask({ status: 'blocked', timeframeBucket: 'week', timeframeAnchor: old }),
    ];
    expect(countPastTimeframe(tasks, now)).toBe(2);
  });
});

describe('groupTasksByTimeframe', () => {
  it('returns empty arrays for every bucket on empty input', () => {
    const g = groupTasksByTimeframe([]);
    expect(g.week).toEqual([]);
    expect(g.month).toEqual([]);
    expect(g.quarter).toEqual([]);
    expect(g.year).toEqual([]);
    expect(g.someday).toEqual([]);
  });

  it('groups by bucket and drops bucketless tasks', () => {
    const tasks = [
      mkTask({ id: 'a', timeframeBucket: 'week' }),
      mkTask({ id: 'b', timeframeBucket: 'month' }),
      mkTask({ id: 'c', timeframeBucket: 'week' }),
      mkTask({ id: 'd' }), // no bucket
      mkTask({ id: 'e', timeframeBucket: 'someday' }),
    ];
    const g = groupTasksByTimeframe(tasks);
    expect(g.week.map((t) => t.id)).toEqual(['a', 'c']);
    expect(g.month.map((t) => t.id)).toEqual(['b']);
    expect(g.someday.map((t) => t.id)).toEqual(['e']);
    expect(g.quarter).toEqual([]);
    expect(g.year).toEqual([]);
  });

  it('drops done tasks by default; includeDone keeps them', () => {
    const tasks = [
      mkTask({ id: 'a', status: 'todo', timeframeBucket: 'week' }),
      mkTask({ id: 'b', status: 'done', timeframeBucket: 'week' }),
    ];
    expect(groupTasksByTimeframe(tasks).week.map((t) => t.id)).toEqual(['a']);
    expect(groupTasksByTimeframe(tasks, true).week.map((t) => t.id)).toEqual([
      'a', 'b',
    ]);
  });
});
