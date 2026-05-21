import { describe, it, expect } from 'vitest';
import { computeTimeframeStatus, bucketRank } from './timeframe';

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
