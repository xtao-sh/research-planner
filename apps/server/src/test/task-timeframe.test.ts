import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, cookieHeader, type TestApp } from './setup';

/**
 * Round-trip + validation tests for the Task.timeframeBucket feature
 * (the fuzzy "finish-in-about" bucket). See @rp/shared TimeframeBucket.
 *
 * Covers:
 *  - create with bucket auto-anchors to ~now
 *  - create with bucket + explicit anchor preserves it
 *  - create without bucket leaves both fields null
 *  - update setting bucket from null auto-anchors
 *  - update changing bucket without anchor preserves the existing anchor
 *  - update sending bucket=null clears both fields
 *  - update sending only anchor re-anchors the existing bucket
 *  - invalid bucket value is rejected (400)
 */
describe('task timeframe bucket', () => {
  let ctx: TestApp;
  let sid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  type T = {
    id: string;
    timeframeBucket?: string;
    timeframeAnchor?: string;
  };

  async function post(body: Record<string, unknown>) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: body,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function put(taskId: string, body: Record<string, unknown>) {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: body,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  it('create without bucket leaves both fields undefined', async () => {
    const r = await post({ title: 'no-bucket' });
    expect(r.status).toBe(201);
    expect(r.body.timeframeBucket).toBeUndefined();
    expect(r.body.timeframeAnchor).toBeUndefined();
  });

  it('create with bucket auto-anchors to ~now', async () => {
    const before = Date.now();
    const r = await post({ title: 'auto-anchor', timeframeBucket: 'week' });
    const after = Date.now();
    expect(r.status).toBe(201);
    expect(r.body.timeframeBucket).toBe('week');
    expect(typeof r.body.timeframeAnchor).toBe('string');
    const anchored = new Date(r.body.timeframeAnchor!).getTime();
    // server-side `new Date()` should land in the request window (allow a
    // generous 5s slack for slow CI).
    expect(anchored).toBeGreaterThanOrEqual(before - 5000);
    expect(anchored).toBeLessThanOrEqual(after + 5000);
  });

  it('create with bucket + explicit anchor preserves the anchor', async () => {
    const explicit = '2026-01-15T08:00:00.000Z';
    const r = await post({
      title: 'explicit-anchor',
      timeframeBucket: 'month',
      timeframeAnchor: explicit,
    });
    expect(r.status).toBe(201);
    expect(r.body.timeframeBucket).toBe('month');
    expect(r.body.timeframeAnchor).toBe(explicit);
  });

  it('update setting bucket from null auto-anchors', async () => {
    const c = await post({ title: 'late-bucket' });
    expect(c.body.timeframeBucket).toBeUndefined();

    const before = Date.now();
    const u = await put(c.body.id, { timeframeBucket: 'quarter' });
    const after = Date.now();
    expect(u.status).toBe(200);
    expect(u.body.timeframeBucket).toBe('quarter');
    const anchored = new Date(u.body.timeframeAnchor!).getTime();
    expect(anchored).toBeGreaterThanOrEqual(before - 5000);
    expect(anchored).toBeLessThanOrEqual(after + 5000);
  });

  it('update changing bucket without anchor preserves the existing anchor', async () => {
    const original = '2025-12-01T00:00:00.000Z';
    const c = await post({
      title: 'preserve-anchor',
      timeframeBucket: 'week',
      timeframeAnchor: original,
    });
    expect(c.body.timeframeAnchor).toBe(original);

    const u = await put(c.body.id, { timeframeBucket: 'month' });
    expect(u.status).toBe(200);
    expect(u.body.timeframeBucket).toBe('month');
    expect(u.body.timeframeAnchor).toBe(original);
  });

  it('update with bucket=null clears both fields', async () => {
    const c = await post({
      title: 'will-clear',
      timeframeBucket: 'year',
    });
    expect(c.body.timeframeBucket).toBe('year');
    expect(c.body.timeframeAnchor).toBeTruthy();

    const u = await put(c.body.id, { timeframeBucket: null });
    expect(u.status).toBe(200);
    expect(u.body.timeframeBucket).toBeUndefined();
    expect(u.body.timeframeAnchor).toBeUndefined();
  });

  it('update sending only a new anchor re-anchors the existing bucket', async () => {
    const c = await post({
      title: 're-anchor',
      timeframeBucket: 'week',
      timeframeAnchor: '2025-01-01T00:00:00.000Z',
    });
    const fresh = '2026-05-01T00:00:00.000Z';
    const u = await put(c.body.id, { timeframeAnchor: fresh });
    expect(u.status).toBe(200);
    expect(u.body.timeframeBucket).toBe('week');
    expect(u.body.timeframeAnchor).toBe(fresh);
  });

  it('invalid bucket value is rejected with 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'bad-bucket', timeframeBucket: 'fortnight' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('"someday" is a valid bucket', async () => {
    const r = await post({ title: 'eventually', timeframeBucket: 'someday' });
    expect(r.status).toBe(201);
    expect(r.body.timeframeBucket).toBe('someday');
    // someday still anchors — the anchor is harmless metadata and lets
    // future UI show "added 3 weeks ago" if useful.
    expect(typeof r.body.timeframeAnchor).toBe('string');
  });
});
