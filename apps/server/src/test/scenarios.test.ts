import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

describe('scenarios', () => {
  let ctx: TestApp;
  let demoSid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    demoSid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET scenarios is empty for the demo project initially', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1/scenarios',
      headers: cookieHeader(demoSid),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('POST a scenario with a valid durationMode returns 201 with a snapshot', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/scenarios',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { name: 'Baseline', durationMode: 'expected' } as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      id: string;
      name: string;
      durationMode: string;
      snapshot: { items: unknown[]; criticalPath: string[] };
    };
    expect(body.name).toBe('Baseline');
    expect(body.durationMode).toBe('expected');
    expect(body.snapshot.items.length).toBeGreaterThan(0);
    expect(body.snapshot.criticalPath.length).toBeGreaterThan(0);
  });

  it('POST scenario with empty name returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/scenarios',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { name: '', durationMode: 'expected' } as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE an existing scenario returns 204, and nonexistent returns 404', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/scenarios',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { name: 'ToDelete', durationMode: 'optimistic' } as Record<string, unknown>,
    });
    const created = JSON.parse(create.body) as { id: string };

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/scenarios/${created.id}`,
      headers: cookieHeader(demoSid),
    });
    expect(del.statusCode).toBe(204);

    const missing = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/scenarios/does-not-exist',
      headers: cookieHeader(demoSid),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("a user cannot delete another user's scenario", async () => {
    // Demo user creates a scenario
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/scenarios',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { name: 'Mine', durationMode: 'expected' } as Record<string, unknown>,
    });
    const scenario = JSON.parse(create.body) as { id: string };

    // A different user tries to delete it
    const { sid: otherSid } = await registerUser(ctx.app);
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/scenarios/${scenario.id}`,
      headers: cookieHeader(otherSid),
    });
    expect(del.statusCode).toBe(404);
  });
});
