import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, cookieHeader, type TestApp } from './setup';

/**
 * Cross-entity search route. Covers the basic substring case plus the
 * tag-only `#query` mode added in Round 16. See app.ts /api/search for
 * the contract (200-char cap, three result buckets, capped at 50 each,
 * tag-mode strips '#' and matches tags+labels only).
 */
describe('GET /api/search', () => {
  let ctx: TestApp;
  let sid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);

    // Seed: two tasks, one with a label matching the tag query.
    await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'Untagged task here' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/tasks',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { title: 'Plain title — unrelated body', labels: ['literature', 'wip'] },
    });

    // A note that only carries the tag, no matching body text.
    await ctx.app.inject({
      method: 'POST',
      url: '/api/notes',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: {
        workspaceId: 'ws-demo',
        projectId: 'p1',
        body: 'random thought no match in here',
        tags: ['literature'],
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function search(q: string) {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent(q)}`,
      headers: cookieHeader(sid),
    });
    return {
      status: res.statusCode,
      body: JSON.parse(res.body) as {
        query: string;
        tasks: Array<{ id: string; title: string }>;
        notes: Array<{ id: string; body: string; tags: string[] }>;
        projects: Array<{ id: string; name: string }>;
      },
    };
  }

  it('empty query returns empty buckets', async () => {
    const r = await search('');
    expect(r.status).toBe(200);
    expect(r.body.tasks).toEqual([]);
    expect(r.body.notes).toEqual([]);
    expect(r.body.projects).toEqual([]);
  });

  it('substring query matches task titles', async () => {
    const r = await search('Untagged');
    expect(r.status).toBe(200);
    expect(r.body.tasks.some((t) => t.title === 'Untagged task here')).toBe(true);
  });

  it('substring query does NOT match a task whose only hit is in labels', async () => {
    // The literature-labeled task has "Plain title — unrelated body" as
    // its title; a plain substring search for "literature" should NOT
    // pick it up via the title path.
    const r = await search('literature');
    expect(r.status).toBe(200);
    // Tag-bearing note's body contains no "literature" — body should
    // not be in the matches via free-text. But tag column happens to
    // contain "literature", so the note IS matched via the `tags
    // contains` clause (current behaviour for mixed-mode queries).
    // The task's title also doesn't match, but its labels do — tasks
    // search by title only in mixed mode, so the literature-labeled
    // task should NOT appear.
    expect(
      r.body.tasks.some((t) => t.title === 'Plain title — unrelated body')
    ).toBe(false);
  });

  it('#tag query matches tasks by label only (title is irrelevant)', async () => {
    const r = await search('#literature');
    expect(r.status).toBe(200);
    expect(
      r.body.tasks.some((t) => t.title === 'Plain title — unrelated body')
    ).toBe(true);
    // Untagged task should not appear in tag-only mode.
    expect(r.body.tasks.some((t) => t.title === 'Untagged task here')).toBe(false);
  });

  it('#tag query matches notes by tags only (body is irrelevant)', async () => {
    const r = await search('#literature');
    expect(r.body.notes.some((n) => n.tags.includes('literature'))).toBe(true);
  });

  it('#tag query returns no projects (projects do not have tags)', async () => {
    const r = await search('#literature');
    expect(r.body.projects).toEqual([]);
  });

  it('rejects queries over 200 chars', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/search?q=${encodeURIComponent('x'.repeat(201))}`,
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(400);
  });
});
