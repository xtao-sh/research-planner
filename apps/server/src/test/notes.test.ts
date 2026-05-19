import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

interface Note {
  id: string;
  workspaceId: string;
  projectId: string | null;
  createdById: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

describe('notes — Phase C quick-capture + inbox', () => {
  let ctx: TestApp;
  let demoSid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    demoSid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function asJson<T>(res: { body: string }): T {
    return JSON.parse(res.body) as T;
  }

  it('POST inbox capture (no projectId) creates note with hashtags extracted', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: 'random idea about #literature reviews' },
    });
    expect(res.statusCode).toBe(201);
    const note = asJson<Note>(res);
    expect(note.projectId).toBeNull();
    expect(note.tags).toContain('literature');
  });

  it('GET inbox returns the inbox capture', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces/ws-demo/inbox',
      headers: cookieHeader(demoSid),
    });
    expect(res.statusCode).toBe(200);
    const list = asJson<Note[]>(res);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((n) => n.projectId === null)).toBe(true);
  });

  it('POST project note attaches to the project (and shows in project notes)', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', projectId: 'p1', body: 'Note for the demo project' },
    });
    expect(create.statusCode).toBe(201);
    const note = asJson<Note>(create);
    expect(note.projectId).toBe('p1');

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1/notes',
      headers: cookieHeader(demoSid),
    });
    expect(list.statusCode).toBe(200);
    const notes = asJson<Note[]>(list);
    expect(notes.some((n) => n.id === note.id)).toBe(true);
  });

  it('POST with empty body returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('explicit + hashtag tags are merged and deduped', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: {
        workspaceId: 'ws-demo',
        body: 'check out #ml-papers and #literature',
        tags: ['literature', 'reading'],
      },
    });
    expect(res.statusCode).toBe(201);
    const note = asJson<Note>(res);
    expect(note.tags.sort()).toEqual(['literature', 'ml-papers', 'reading'].sort());
  });

  it('POST in a workspace the caller does not belong to returns 404', async () => {
    const { sid: aliceSid } = await registerUser(ctx.app, {
      email: 'alice-notes@test',
      password: 'alicepass',
      name: 'Alice',
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(aliceSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: 'sneaky' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Inbox isolation: alice does not see demo inbox notes', async () => {
    const { sid: aliceSid } = await registerUser(ctx.app, {
      email: 'bob-isolation@test',
      password: 'bobpass1',
      name: 'Bob',
    });
    // Register makes a personal workspace whose id we need.
    const wsList = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: cookieHeader(aliceSid),
    });
    const wss = asJson<Array<{ id: string }>>(wsList);
    expect(wss.length).toBeGreaterThan(0);
    const inbox = await ctx.app.inject({
      method: 'GET',
      url: `/api/workspaces/${wss[0].id}/inbox`,
      headers: cookieHeader(aliceSid),
    });
    expect(inbox.statusCode).toBe(200);
    expect(asJson<Note[]>(inbox)).toHaveLength(0);
  });

  it('PUT note moves it from inbox to a project', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: 'will be filed' },
    });
    const note = asJson<Note>(create);
    const move = await ctx.app.inject({
      method: 'PUT',
      url: `/api/notes/${note.id}`,
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { projectId: 'p1' },
    });
    expect(move.statusCode).toBe(200);
    const moved = asJson<Note>(move);
    expect(moved.projectId).toBe('p1');

    const inboxRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces/ws-demo/inbox',
      headers: cookieHeader(demoSid),
    });
    expect(asJson<Note[]>(inboxRes).some((n) => n.id === note.id)).toBe(false);
  });

  it('PUT note as non-author returns 403', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', projectId: 'p1', body: 'demo wrote this' },
    });
    const note = asJson<Note>(create);

    // Register a new editor and add to ws-demo.
    const { sid: charlieSid } = await registerUser(ctx.app, {
      email: 'charlie-noauth@test',
      password: 'charliepass',
      name: 'Charlie',
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/workspaces/ws-demo/members',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { email: 'charlie-noauth@test', role: 'editor' },
    });

    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/notes/${note.id}`,
      headers: { ...cookieHeader(charlieSid), 'content-type': 'application/json' },
      payload: { body: 'hijack' },
    });
    expect(put.statusCode).toBe(403);
  });

  it('promote-to-task creates a task and removes the note', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: 'rewrite the introduction with stronger framing' },
    });
    const note = asJson<Note>(create);

    const promote = await ctx.app.inject({
      method: 'POST',
      url: `/api/notes/${note.id}/promote-to-task`,
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { projectId: 'p1' },
    });
    expect(promote.statusCode).toBe(201);
    const task = asJson<{ id: string; title: string; notes: string }>(promote);
    expect(task.title.length).toBeGreaterThan(0);
    expect(task.notes).toContain('introduction');

    // The note should be gone from inbox.
    const inboxRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces/ws-demo/inbox',
      headers: cookieHeader(demoSid),
    });
    expect(asJson<Note[]>(inboxRes).some((n) => n.id === note.id)).toBe(false);
  });

  it('promote-to-task preserves note tags as the task labels', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: {
        workspaceId: 'ws-demo',
        body: 'review the experimental setup #lit #ml',
      },
    });
    const note = asJson<Note>(create);
    expect(note.tags).toEqual(expect.arrayContaining(['lit', 'ml']));

    const promote = await ctx.app.inject({
      method: 'POST',
      url: `/api/notes/${note.id}/promote-to-task`,
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { projectId: 'p1' },
    });
    expect(promote.statusCode).toBe(201);
    const task = asJson<{ id: string; labels?: string[] }>(promote);
    expect(task.labels).toBeDefined();
    expect(task.labels).toEqual(expect.arrayContaining(['lit', 'ml']));
  });

  it('DELETE note returns 204', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { workspaceId: 'ws-demo', body: 'to be deleted' },
    });
    const note = asJson<Note>(create);
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/notes/${note.id}`,
      headers: cookieHeader(demoSid),
    });
    expect(del.statusCode).toBe(204);
  });
});
