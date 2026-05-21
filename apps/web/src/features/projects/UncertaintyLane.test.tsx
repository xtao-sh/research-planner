import { describe, it, expect } from 'vitest';
import { computeTimeframeEndMs } from '../tasks/timeframe';

const DAY = 86_400_000;

describe('computeTimeframeEndMs', () => {
  const anchor = '2026-01-01T00:00:00.000Z';
  const anchorMs = new Date(anchor).getTime();

  it('returns anchor + 7d for week', () => {
    expect(computeTimeframeEndMs(anchor, 'week')).toBe(anchorMs + 7 * DAY);
  });

  it('returns anchor + 30d for month', () => {
    expect(computeTimeframeEndMs(anchor, 'month')).toBe(anchorMs + 30 * DAY);
  });

  it('returns anchor + 90d for quarter', () => {
    expect(computeTimeframeEndMs(anchor, 'quarter')).toBe(anchorMs + 90 * DAY);
  });

  it('returns anchor + 365d for year', () => {
    expect(computeTimeframeEndMs(anchor, 'year')).toBe(anchorMs + 365 * DAY);
  });

  it('returns null for someday (no end)', () => {
    expect(computeTimeframeEndMs(anchor, 'someday')).toBeNull();
  });

  it('returns null when bucket is missing', () => {
    expect(computeTimeframeEndMs(anchor, null)).toBeNull();
    expect(computeTimeframeEndMs(anchor, undefined)).toBeNull();
  });

  it('returns null when anchor is missing', () => {
    expect(computeTimeframeEndMs(null, 'week')).toBeNull();
    expect(computeTimeframeEndMs(undefined, 'week')).toBeNull();
    expect(computeTimeframeEndMs('', 'week')).toBeNull();
  });

  it('returns null for unparseable anchor date', () => {
    expect(computeTimeframeEndMs('not-a-date', 'week')).toBeNull();
  });

  it('handles very-old anchors without overflow', () => {
    const old = '1970-01-01T00:00:00.000Z';
    expect(computeTimeframeEndMs(old, 'year')).toBe(365 * DAY);
  });

  it('handles year-long buckets producing future ms safely', () => {
    const result = computeTimeframeEndMs(anchor, 'year');
    expect(typeof result).toBe('number');
    expect(Number.isFinite(result as number)).toBe(true);
  });
});
