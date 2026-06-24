import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

interface ProjectRow {
  id: string;
  name: string;
}

describe('POST /api/admin/reset-demo — restore sample data', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function demoProjects(sid: string): Promise<ProjectRow[]> {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects?workspaceId=ws-demo',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ProjectRow[];
  }

  it('400s without the confirm token', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/reset-demo',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('403s for a non-owner of the demo workspace', async () => {
    const outsider = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/reset-demo',
      headers: { ...cookieHeader(outsider.sid), 'content-type': 'application/json' },
      payload: { confirm: 'RESET_DEMO' },
    });
    // Non-member of ws-demo => 404 (membership gate); never 200.
    expect(res.statusCode).toBe(404);
  });

  it('owner reset wipes the existing demo projects and re-seeds the showcase set', async () => {
    const sid = await loginDemo(ctx.app);

    const before = await demoProjects(sid);
    // The base seed creates p1/p2/p3 in ws-demo.
    expect(before.some((p) => p.id === 'p1')).toBe(true);
    expect(before.some((p) => p.id === 'p-climate')).toBe(false);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/reset-demo',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { confirm: 'RESET_DEMO' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const after = await demoProjects(sid);
    const ids = after.map((p) => p.id).sort();
    expect(ids).toEqual(['p-climate', 'p-move']);
    // Old seed projects are gone.
    expect(after.some((p) => p.id === 'p1')).toBe(false);
  });

  it('is idempotent — a second reset still yields exactly the two showcase projects', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/admin/reset-demo',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { confirm: 'RESET_DEMO' },
    });
    expect(res.statusCode).toBe(200);
    const after = await demoProjects(sid);
    expect(after.map((p) => p.id).sort()).toEqual(['p-climate', 'p-move']);
  });
});
