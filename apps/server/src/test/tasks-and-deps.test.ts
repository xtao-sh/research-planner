import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, cookieHeader, type TestApp } from './setup';

describe('tasks, deps, milestones', () => {
  let ctx: TestApp;
  let sid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function post<T>(url: string, payload: unknown): Promise<{ status: number; body: T }> {
    const res = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function get<T>(url: string): Promise<{ status: number; body: T }> {
    const res = await ctx.app.inject({ method: 'GET', url, headers: cookieHeader(sid) });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  it('POST /api/projects/:id/tasks creates a task', async () => {
    const r = await post<{ id: string; title: string }>('/api/projects/p1/tasks', {
      title: 'New T',
      estimate: { o: 1, m: 2, p: 4 },
    });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('New T');
  });

  it('POST /api/projects/:id/tasks accepts explicit size', async () => {
    const r = await post<{ id: string; size: string }>('/api/projects/p1/tasks', {
      title: 'Sized L',
      size: 'l',
    });
    expect(r.status).toBe(201);
    expect(r.body.size).toBe('l');
  });

  it('POST /api/projects/:id/tasks defaults size to "m" when omitted', async () => {
    const r = await post<{ id: string; size: string }>('/api/projects/p1/tasks', {
      title: 'Default size',
    });
    expect(r.status).toBe(201);
    expect(r.body.size).toBe('m');
  });

  it('POST /api/projects/:id/tasks rejects invalid size', async () => {
    const r = await post<{ message: string }>('/api/projects/p1/tasks', {
      title: 'Bad size',
      size: 'huge',
    });
    expect(r.status).toBe(400);
  });

  it('PUT /api/tasks/:id updates size and persists', async () => {
    const created = await post<{ id: string; size: string }>('/api/projects/p1/tasks', {
      title: 'Resize me',
      size: 'm',
    });
    expect(created.status).toBe(201);
    const taskId = created.body.id;

    const putRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { size: 'xs' },
    });
    expect(putRes.statusCode).toBe(200);
    expect(JSON.parse(putRes.body).size).toBe('xs');

    const list = await get<Array<{ id: string; size: string }>>('/api/projects/p1/tasks');
    const found = list.body.find((t) => t.id === taskId);
    expect(found?.size).toBe('xs');
  });

  it('PUT task status todo→doing auto-sets startedAt', async () => {
    const c = await post<{ id: string; startedAt?: string | null }>('/api/projects/p1/tasks', {
      title: 'Auto-start me',
    });
    expect(c.status).toBe(201);
    expect(c.body.startedAt ?? null).toBeNull();

    const putRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'doing' },
    });
    const body = JSON.parse(putRes.body) as { startedAt?: string; finishedAt?: string };
    expect(putRes.statusCode).toBe(200);
    expect(typeof body.startedAt).toBe('string');
    expect(body.finishedAt ?? null).toBeNull();
  });

  it('PUT task status doing→done auto-sets finishedAt and preserves startedAt', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Move to done' });
    const taskId = c.body.id;
    const r1 = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'doing' },
    });
    const afterDoing = JSON.parse(r1.body) as { startedAt: string };
    const startedAt = afterDoing.startedAt;
    expect(typeof startedAt).toBe('string');

    const r2 = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'done' },
    });
    const afterDone = JSON.parse(r2.body) as { startedAt: string; finishedAt: string };
    expect(afterDone.startedAt).toBe(startedAt);
    expect(typeof afterDone.finishedAt).toBe('string');
  });

  it('PUT task status todo→done auto-sets BOTH startedAt and finishedAt', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Skip doing' });
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'done' },
    });
    const after = JSON.parse(r.body) as { startedAt: string; finishedAt: string };
    expect(typeof after.startedAt).toBe('string');
    expect(typeof after.finishedAt).toBe('string');
  });

  it('PUT task with explicit startedAt honors the override', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Backfill start' });
    const explicit = '2026-01-01T08:00:00.000Z';
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'doing', startedAt: explicit },
    });
    const after = JSON.parse(r.body) as { startedAt: string };
    expect(new Date(after.startedAt).toISOString()).toBe(explicit);
  });

  it('PUT {focused: true} sets focusedAt to a non-null ISO string', async () => {
    const c = await post<{ id: string; focusedAt?: string | null }>('/api/projects/p1/tasks', {
      title: 'Pin me',
    });
    expect(c.body.focusedAt ?? null).toBeNull();
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { focused: true },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { focusedAt?: string };
    expect(typeof body.focusedAt).toBe('string');
    expect(Number.isNaN(new Date(body.focusedAt!).getTime())).toBe(false);
  });

  it('PUT {focused: false} clears focusedAt to null', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Pin then unpin' });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { focused: true },
    });
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { focused: false },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { focusedAt?: string | null };
    expect(body.focusedAt ?? null).toBeNull();
  });

  it('PUT without focused field leaves focusedAt unchanged', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Keep pin' });
    const pinned = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { focused: true },
    });
    const before = (JSON.parse(pinned.body) as { focusedAt: string }).focusedAt;
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'Keep pin renamed' },
    });
    expect(r.statusCode).toBe(200);
    const after = (JSON.parse(r.body) as { focusedAt: string }).focusedAt;
    expect(after).toBe(before);
  });

  it('PUT task status todo→blocked auto-sets blockedAt', async () => {
    const c = await post<{ id: string; blockedAt?: string | null }>(
      '/api/projects/p1/tasks',
      { title: 'Block me' }
    );
    expect(c.body.blockedAt ?? null).toBeNull();
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'blocked' },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { status: string; blockedAt?: string };
    expect(body.status).toBe('blocked');
    expect(typeof body.blockedAt).toBe('string');
    expect(Number.isNaN(new Date(body.blockedAt!).getTime())).toBe(false);
  });

  it('PUT task status blocked→doing clears blockedAt', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Unblock me' });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'blocked' },
    });
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'doing' },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { blockedAt?: string | null };
    expect(body.blockedAt ?? null).toBeNull();
  });

  it('PUT title-only on a blocked task leaves blockedAt unchanged', async () => {
    const c = await post<{ id: string }>('/api/projects/p1/tasks', { title: 'Stuck' });
    const blocked = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { status: 'blocked' },
    });
    const before = (JSON.parse(blocked.body) as { blockedAt: string }).blockedAt;
    const r = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tasks/${c.body.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'Stuck renamed' },
    });
    expect(r.statusCode).toBe(200);
    const after = (JSON.parse(r.body) as { blockedAt: string }).blockedAt;
    expect(after).toBe(before);
  });

  it('POST /api/projects/:id/deps rejects a cycle', async () => {
    // Seed already has d1 (t1→t2) and d2 (t2→t3). Adding t3→t1 would close a cycle.
    const r = await post<{ message: string }>('/api/projects/p1/deps', {
      fromTaskId: 't3',
      toTaskId: 't1',
    });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/cycle/i);
  });

  it('deleting a task cascades to dependencies referencing it', async () => {
    const before = await get<Array<{ id: string; fromTaskId: string; toTaskId: string }>>(
      '/api/projects/p1/deps'
    );
    const depsWithT2 = before.body.filter((d) => d.fromTaskId === 't2' || d.toTaskId === 't2');
    expect(depsWithT2.length).toBeGreaterThan(0);

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/tasks/t2',
      headers: cookieHeader(sid),
    });
    expect(delRes.statusCode).toBe(204);

    const after = await get<Array<{ fromTaskId: string; toTaskId: string }>>(
      '/api/projects/p1/deps'
    );
    const stillThere = after.body.some((d) => d.fromTaskId === 't2' || d.toTaskId === 't2');
    expect(stillThere).toBe(false);
  });

  it('POST /api/projects/:id/deps creates an SS dep with lag=3', async () => {
    // Seed graph has t1→t2→t3 FS. Add a fresh predecessor to t3 via SS lag=3
    // from a brand-new task to avoid the unique-pair constraint and cycles.
    const src = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 'SS-source',
      estimate: { o: 1, m: 1, p: 1 },
    });
    expect(src.status).toBe(201);
    const r = await post<{
      id: string;
      type: string;
      lag: number;
      fromTaskId: string;
      toTaskId: string;
    }>('/api/projects/p1/deps', {
      fromTaskId: src.body.id,
      toTaskId: 't3',
      type: 'SS',
      lag: 3,
    });
    expect(r.status).toBe(201);
    expect(r.body.type).toBe('SS');
    expect(r.body.lag).toBe(3);
  });

  it('POST /api/projects/:id/deps without type defaults to FS, lag=0', async () => {
    const src = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 'FS-default-source',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const dst = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 'FS-default-dest',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const r = await post<{ type: string; lag: number }>('/api/projects/p1/deps', {
      fromTaskId: src.body.id,
      toTaskId: dst.body.id,
    });
    expect(r.status).toBe(201);
    expect(r.body.type).toBe('FS');
    expect(r.body.lag).toBe(0);
  });

  it('POST /api/projects/:id/deps rejects invalid type', async () => {
    const a = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 'bad-type-a',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const b = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 'bad-type-b',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const r = await post<{ message: string }>('/api/projects/p1/deps', {
      fromTaskId: a.body.id,
      toTaskId: b.body.id,
      type: 'XY',
    });
    expect(r.status).toBe(400);
  });

  it('scheduler honors an SS dep with lag=0: successor starts with predecessor', async () => {
    // Fresh pair of tasks, wire with SS lag=0, post a schedule, check.
    const a = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 't_a_sched',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const b = await post<{ id: string }>('/api/projects/p1/tasks', {
      title: 't_b_sched',
      estimate: { o: 4, m: 4, p: 4 },
    });
    const d = await post<{ id: string }>('/api/projects/p1/deps', {
      fromTaskId: a.body.id,
      toTaskId: b.body.id,
      type: 'SS',
      lag: 0,
    });
    expect(d.status).toBe(201);
    const sched = await post<{
      items: Array<{ taskId: string; startPlanned: string; endPlanned: string }>;
    }>('/api/projects/p1/schedule', {});
    expect(sched.status).toBe(200);
    const byId = new Map(sched.body.items.map((i) => [i.taskId, i]));
    const aStart = new Date(byId.get(a.body.id)!.startPlanned).getTime();
    const bStart = new Date(byId.get(b.body.id)!.startPlanned).getTime();
    expect(Math.abs(aStart - bStart)).toBeLessThan(2000); // within 2s
  });

  it('milestone can be created and referenced on a task', async () => {
    const m = await post<{ id: string; title: string }>('/api/projects/p1/milestones', {
      title: 'M-test',
    });
    expect(m.status).toBe(201);
    const t = await post<{ id: string; milestoneId?: string }>('/api/projects/p1/tasks', {
      title: 'WithMs',
      estimate: { o: 1, m: 1, p: 1 },
      milestoneId: m.body.id,
    });
    expect(t.status).toBe(201);
    expect(t.body.milestoneId).toBe(m.body.id);
  });

  it('deleting a milestone nulls milestoneId on related tasks', async () => {
    const m = await post<{ id: string }>('/api/projects/p1/milestones', { title: 'M-del' });
    const t = await post<{ id: string; milestoneId?: string }>('/api/projects/p1/tasks', {
      title: 'WillOrphan',
      estimate: { o: 1, m: 1, p: 1 },
      milestoneId: m.body.id,
    });
    expect(t.body.milestoneId).toBe(m.body.id);

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/milestones/${m.body.id}`,
      headers: cookieHeader(sid),
    });
    expect(delRes.statusCode).toBe(204);

    const tasksRes = await get<Array<{ id: string; milestoneId?: string | null }>>(
      '/api/projects/p1/tasks'
    );
    const stillReferencing = tasksRes.body.find((x) => x.id === t.body.id);
    expect(stillReferencing?.milestoneId ?? null).toBeNull();
  });

  it('POST /api/projects/:id/tasks/reorder resets priorities by array index', async () => {
    // Create three throwaway tasks; record their original priority/order.
    const a = await post<{ id: string; priority: number }>('/api/projects/p1/tasks', {
      title: 'reorder-a',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const b = await post<{ id: string; priority: number }>('/api/projects/p1/tasks', {
      title: 'reorder-b',
      estimate: { o: 1, m: 1, p: 1 },
    });
    const c = await post<{ id: string; priority: number }>('/api/projects/p1/tasks', {
      title: 'reorder-c',
      estimate: { o: 1, m: 1, p: 1 },
    });

    // Reorder them as [c, a, b] — priorities should become 1/2/3 in that order.
    const reorderRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks/reorder',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { taskIds: [c.body.id, a.body.id, b.body.id] },
    });
    expect(reorderRes.statusCode).toBe(204);

    const after = await get<Array<{ id: string; priority: number }>>(
      '/api/projects/p1/tasks'
    );
    const idToPri = new Map(after.body.map((t) => [t.id, t.priority]));
    expect(idToPri.get(c.body.id)).toBe(1);
    expect(idToPri.get(a.body.id)).toBe(2);
    expect(idToPri.get(b.body.id)).toBe(3);
  });

  it('POST .../reorder rejects taskIds from a different project (400)', async () => {
    // Make a fresh project + a task inside it.
    const otherProject = await post<{ id: string }>('/api/projects', {
      name: 'reorder-cross-project-trap',
    });
    const otherTask = await post<{ id: string }>(
      `/api/projects/${otherProject.body.id}/tasks`,
      { title: 'foreign', estimate: { o: 1, m: 1, p: 1 } }
    );

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks/reorder',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { taskIds: [otherTask.body.id] },
    });
    expect(res.statusCode).toBe(400);
  });
});
