import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';
import type { EventRecord } from '@rp/shared';

describe('event sourcing / activity feed', () => {
  let ctx: TestApp;
  let sid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function post<T>(url: string, payload: unknown, asSid = sid): Promise<{ status: number; body: T }> {
    const res = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { ...cookieHeader(asSid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function put<T>(url: string, payload: unknown): Promise<{ status: number; body: T }> {
    const res = await ctx.app.inject({
      method: 'PUT',
      url,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function del(url: string, asSid = sid): Promise<{ status: number }> {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url,
      headers: cookieHeader(asSid),
    });
    return { status: res.statusCode };
  }

  async function get<T>(url: string, asSid = sid): Promise<{ status: number; body: T }> {
    const res = await ctx.app.inject({
      method: 'GET',
      url,
      headers: cookieHeader(asSid),
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  it('POST /api/projects emits project.created visible in workspace feed', async () => {
    const c = await post<{ id: string; name: string }>('/api/projects', {
      name: 'Event Proj A',
    });
    expect(c.status).toBe(201);
    const feed = await get<EventRecord[]>('/api/workspaces/ws-demo/activity');
    expect(feed.status).toBe(200);
    const hit = feed.body.find(
      (e) => e.type === 'project.created' && (e.payload as { id: string }).id === c.body.id
    );
    expect(hit).toBeTruthy();
    expect(hit!.userEmail).toBe('demo@local');
    expect((hit!.payload as { name: string }).name).toBe('Event Proj A');
  });

  it('creating a task emits task.created visible via BOTH workspace and project feeds', async () => {
    const tc = await post<{ id: string; title: string }>('/api/projects/p1/tasks', {
      title: 'Audit-visible task',
      estimate: { o: 1, m: 2, p: 3 },
    });
    expect(tc.status).toBe(201);

    const wsFeed = await get<EventRecord[]>('/api/workspaces/ws-demo/activity');
    const projFeed = await get<EventRecord[]>('/api/projects/p1/activity');
    const byId = (arr: EventRecord[]) =>
      arr.find((e) => e.type === 'task.created' && (e.payload as { id: string }).id === tc.body.id);
    expect(byId(wsFeed.body)).toBeTruthy();
    expect(byId(projFeed.body)).toBeTruthy();
  });

  it('updating a task title emits task.updated with changes.title.{from,to}', async () => {
    const tc = await post<{ id: string; title: string }>('/api/projects/p1/tasks', {
      title: 'Original Title',
      estimate: { o: 1, m: 1, p: 1 },
    });
    expect(tc.status).toBe(201);
    const upd = await put<{ id: string; title: string }>(`/api/tasks/${tc.body.id}`, {
      title: 'Renamed Title',
    });
    expect(upd.status).toBe(200);

    const feed = await get<EventRecord[]>('/api/projects/p1/activity');
    const evt = feed.body.find(
      (e) => e.type === 'task.updated' && (e.payload as { id: string }).id === tc.body.id
    );
    expect(evt).toBeTruthy();
    const changes = (evt!.payload as { changes: Record<string, { from: unknown; to: unknown }> }).changes;
    expect(changes.title).toBeTruthy();
    expect(changes.title.from).toBe('Original Title');
    expect(changes.title.to).toBe('Renamed Title');
  });

  it('deleting a task emits task.deleted; prior task.created remains queryable', async () => {
    const tc = await post<{ id: string; title: string }>('/api/projects/p1/tasks', {
      title: 'Ephemeral',
      estimate: { o: 1, m: 1, p: 1 },
    });
    expect(tc.status).toBe(201);
    const d = await del(`/api/tasks/${tc.body.id}`);
    expect(d.status).toBe(204);

    const feed = await get<EventRecord[]>('/api/projects/p1/activity');
    const createdEvt = feed.body.find(
      (e) => e.type === 'task.created' && (e.payload as { id: string }).id === tc.body.id
    );
    const deletedEvt = feed.body.find(
      (e) => e.type === 'task.deleted' && (e.payload as { id: string }).id === tc.body.id
    );
    expect(createdEvt).toBeTruthy();
    expect(deletedEvt).toBeTruthy();
    expect((deletedEvt!.payload as { title: string }).title).toBe('Ephemeral');
  });

  it('non-member cannot read a workspace activity feed (404)', async () => {
    const alice = await registerUser(ctx.app, { email: `alice-${Date.now()}@test` });
    const r = await get('/api/workspaces/ws-demo/activity', alice.sid);
    expect(r.status).toBe(404);
  });

  it('?limit=300 returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces/ws-demo/activity?limit=300',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(400);
  });

  it('pagination: limit=2 then fetch older events with before=oldest.createdAt', async () => {
    // Create a fresh workspace so we have a controlled number of events.
    const ws = await post<{ id: string; name: string }>('/api/workspaces', { name: 'PagTest' });
    expect(ws.status).toBe(201);
    // Create 3 projects => 3 project.created events + 1 workspace.created from the POST above.
    const p1 = await post<{ id: string }>('/api/projects', { name: 'p-a', workspaceId: ws.body.id });
    const p2 = await post<{ id: string }>('/api/projects', { name: 'p-b', workspaceId: ws.body.id });
    const p3 = await post<{ id: string }>('/api/projects', { name: 'p-c', workspaceId: ws.body.id });
    expect([p1.status, p2.status, p3.status]).toEqual([201, 201, 201]);

    const first = await get<EventRecord[]>(`/api/workspaces/${ws.body.id}/activity?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.length).toBe(2);
    const oldestShown = first.body[first.body.length - 1];
    const rest = await get<EventRecord[]>(
      `/api/workspaces/${ws.body.id}/activity?limit=10&before=${encodeURIComponent(oldestShown.createdAt)}`
    );
    expect(rest.status).toBe(200);
    // Combining the two pages must recover all events.
    const combinedIds = new Set([...first.body, ...rest.body].map((e) => e.id));
    const full = await get<EventRecord[]>(`/api/workspaces/${ws.body.id}/activity?limit=50`);
    for (const e of full.body) expect(combinedIds.has(e.id)).toBe(true);
    // And `before` page should not include any event from the first page.
    for (const e of rest.body) {
      expect(first.body.find((f) => f.id === e.id)).toBeFalsy();
    }
  });
});
