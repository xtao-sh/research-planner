import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

describe('project endpoints — auth + scoping', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /api/projects without a session returns 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('demo user sees at least the seeded project', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(200);
    const projects = JSON.parse(res.body) as Array<{ id: string }>;
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((p) => p.id === 'p1')).toBe(true);
  });

  it('a brand-new user starts with zero projects', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it('a user can create a project and see it in their list', async () => {
    const { sid } = await registerUser(ctx.app);
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'New Project' },
    });
    expect(createRes.statusCode).toBe(201);
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: cookieHeader(sid),
    });
    const list = JSON.parse(listRes.body) as Array<{ name: string }>;
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('New Project');
  });

  it('POST /api/projects with empty name returns 400', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a user can create a project with type "research" and the response includes type', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'R-Project', type: 'research' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { name: string; type: string };
    expect(body.type).toBe('research');
  });

  it('a project created without type defaults to "other"', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Default Type Project' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { type: string };
    expect(body.type).toBe('other');
  });

  it('POST /api/projects with invalid type returns 400', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Bad', type: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a user can create a project with mode "deadline" and the response includes mode', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Submission', mode: 'deadline' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { name: string; mode: string };
    expect(body.mode).toBe('deadline');
  });

  it('a project created without mode defaults to "progress"', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Habits' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { mode: string };
    expect(body.mode).toBe('progress');
  });

  it('POST /api/projects with invalid mode returns 400', async () => {
    const { sid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Bad', mode: 'middle' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/projects/:id with mode toggles it; subsequent GET reflects update', async () => {
    const { sid } = await registerUser(ctx.app);
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'Toggle Me' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body) as { id: string; mode: string };
    expect(created.mode).toBe('progress');

    const putRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/projects/${created.id}`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { mode: 'deadline' },
    });
    expect(putRes.statusCode).toBe(200);
    const updated = JSON.parse(putRes.body) as { mode: string };
    expect(updated.mode).toBe('deadline');

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
      headers: cookieHeader(sid),
    });
    expect(getRes.statusCode).toBe(200);
    expect((JSON.parse(getRes.body) as { mode: string }).mode).toBe('deadline');
  });

  it("a user cannot read another user's project by id", async () => {
    const { sid: aliceSid } = await registerUser(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1', // owned by demo user
      headers: cookieHeader(aliceSid),
    });
    expect(res.statusCode).toBe(404);
  });

  it('filters projects by workspaceId; unknown/unauthorized workspace returns 404', async () => {
    const sid = await loginDemo(ctx.app);

    // Fetch the demo user's workspaces to find their default workspace id.
    const wsRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: cookieHeader(sid),
    });
    expect(wsRes.statusCode).toBe(200);
    const workspaces = JSON.parse(wsRes.body) as Array<{ id: string; name: string }>;
    expect(workspaces.length).toBeGreaterThan(0);
    const wsId = workspaces[0].id;

    // Filtering by the user's own workspace returns the expected projects.
    const okRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects?workspaceId=${wsId}`,
      headers: cookieHeader(sid),
    });
    expect(okRes.statusCode).toBe(200);
    const list = JSON.parse(okRes.body) as Array<{ id: string }>;
    expect(list.some((p) => p.id === 'p1')).toBe(true);

    // Filtering by an unknown workspace id returns 404 (no leak).
    const unknownRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects?workspaceId=ws-does-not-exist',
      headers: cookieHeader(sid),
    });
    expect(unknownRes.statusCode).toBe(404);

    // A different user cannot query demo's workspace — also 404.
    const { sid: otherSid } = await registerUser(ctx.app);
    const forbiddenRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects?workspaceId=${wsId}`,
      headers: cookieHeader(otherSid),
    });
    expect(forbiddenRes.statusCode).toBe(404);
  });

  it('GET /api/admin/dump returns a backup JSON document with the expected top-level keys', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/dump',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="rp-backup-/);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    for (const key of [
      'generatedAt', 'schemaVersion',
      'users', 'workspaces', 'memberships', 'projects', 'tasks',
      'dependencies', 'milestones', 'notes', 'scenarios', 'events',
    ]) {
      expect(body).toHaveProperty(key);
    }
    expect(Array.isArray(body.projects)).toBe(true);
    expect((body.projects as unknown[]).length).toBeGreaterThan(0);
  });

  it('DELETE /api/projects/:id removes the project + emits project.deleted; cross-user 404', async () => {
    const sid = await loginDemo(ctx.app);
    // Create a fresh project to delete (don't disturb seeded p1).
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { name: 'To be deleted' },
    });
    expect(create.statusCode).toBe(201);
    const project = JSON.parse(create.body) as { id: string };

    // Add a task so cascade behavior is observable.
    const taskCreate = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${project.id}/tasks`,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'Soon-to-be-orphan', size: 's' },
    });
    expect(taskCreate.statusCode).toBe(201);

    // Cross-user: different user cannot delete demo's project.
    const { sid: otherSid } = await registerUser(ctx.app);
    const forbiddenDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
      headers: cookieHeader(otherSid),
    });
    expect(forbiddenDel.statusCode).toBe(404);

    // Demo can delete it. 204.
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
      headers: cookieHeader(sid),
    });
    expect(del.statusCode).toBe(204);

    // Subsequent GET returns 404.
    const notFound = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
      headers: cookieHeader(sid),
    });
    expect(notFound.statusCode).toBe(404);

    // Workspace activity feed records the deletion with the captured name.
    const wsList = await ctx.app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: cookieHeader(sid),
    });
    const wsId = (JSON.parse(wsList.body) as Array<{ id: string }>)[0].id;
    const activityRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/workspaces/${wsId}/activity?limit=20`,
      headers: cookieHeader(sid),
    });
    expect(activityRes.statusCode).toBe(200);
    const events = JSON.parse(activityRes.body) as Array<{
      type: string;
      payload: { name?: string };
    }>;
    const deleteEvent = events.find((e) => e.type === 'project.deleted');
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent?.payload.name).toBe('To be deleted');
  });
});
