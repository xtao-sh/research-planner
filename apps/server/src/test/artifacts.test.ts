import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

interface Artifact {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  url: string | null;
  notes: string | null;
  createdById: string;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

describe('artifacts — project attachments (Artifacts tab)', () => {
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

  it('GET artifacts is empty for the demo project initially', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1/artifacts',
      headers: cookieHeader(demoSid),
    });
    expect(res.statusCode).toBe(200);
    expect(asJson<Artifact[]>(res)).toEqual([]);
  });

  it('POST a link artifact returns 201 and appears in the list', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'link', title: 'Project DOI', url: 'https://doi.org/10.1/abc' },
    });
    expect(create.statusCode).toBe(201);
    const a = asJson<Artifact>(create);
    expect(a.projectId).toBe('p1');
    expect(a.kind).toBe('link');
    expect(a.url).toBe('https://doi.org/10.1/abc');
    expect(a.createdByEmail).toBe('demo@local');

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1/artifacts',
      headers: cookieHeader(demoSid),
    });
    expect(list.statusCode).toBe(200);
    expect(asJson<Artifact[]>(list).some((x) => x.id === a.id)).toBe(true);
  });

  it('POST a code artifact (notes, no url) works', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'code', title: 'snippet', notes: 'print(42)' },
    });
    expect(create.statusCode).toBe(201);
    const a = asJson<Artifact>(create);
    expect(a.url).toBeNull();
    expect(a.notes).toBe('print(42)');
  });

  it('POST with empty title returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'link', title: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST with an invalid kind returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'paper', title: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT updates an artifact title; DELETE removes it (404 after)', async () => {
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'data', title: 'orig', notes: '{}' },
    });
    const a = asJson<Artifact>(create);

    const upd = await ctx.app.inject({
      method: 'PUT',
      url: `/api/artifacts/${a.id}`,
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { title: 'renamed' },
    });
    expect(upd.statusCode).toBe(200);
    expect(asJson<Artifact>(upd).title).toBe('renamed');

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/artifacts/${a.id}`,
      headers: cookieHeader(demoSid),
    });
    expect(del.statusCode).toBe(204);

    const missing = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/artifacts/${a.id}`,
      headers: cookieHeader(demoSid),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('non-member cannot list or create artifacts on the demo project (404)', async () => {
    const { sid: aliceSid } = await registerUser(ctx.app, { email: 'alice-art@test' });
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1/artifacts',
      headers: cookieHeader(aliceSid),
    });
    expect(list.statusCode).toBe(404);

    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(aliceSid), 'content-type': 'application/json' },
      payload: { kind: 'link', title: 'sneaky', url: 'https://x' },
    });
    expect(create.statusCode).toBe(404);
  });

  it("cross-project: cannot mutate another project's artifact via flat route", async () => {
    // Demo creates an artifact under p1.
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/artifacts',
      headers: { ...cookieHeader(demoSid), 'content-type': 'application/json' },
      payload: { kind: 'link', title: 'demo-owned', url: 'https://x' },
    });
    const a = asJson<Artifact>(create);

    // A user with no access to p1's workspace tries to PUT/DELETE it -> 404.
    const { sid: otherSid } = await registerUser(ctx.app);
    const put = await ctx.app.inject({
      method: 'PUT',
      url: `/api/artifacts/${a.id}`,
      headers: { ...cookieHeader(otherSid), 'content-type': 'application/json' },
      payload: { title: 'hijack' },
    });
    expect(put.statusCode).toBe(404);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/artifacts/${a.id}`,
      headers: cookieHeader(otherSid),
    });
    expect(del.statusCode).toBe(404);
  });
});
