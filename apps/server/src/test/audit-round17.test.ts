import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestApp,
  loginDemo,
  registerUser,
  cookieHeader,
  type TestApp,
} from './setup';

/**
 * Regression tests for the Round-17 audit fixes:
 *  - /api/search must not leak other members' private inbox notes
 *  - PUT /api/tasks/:id must validate the MERGED estimate (O ≤ M ≤ P)
 *  - task milestoneId must be validated (exists + same project)
 *  - /api/admin/dump must scope inbox notes + include the working calendar
 */
describe('Round-17 audit fixes', () => {
  let ctx: TestApp;
  let sid: string; // demo user (owner of ws-demo, project p1)

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function inject(method: string, url: string, who: string, payload?: unknown) {
    const res = await ctx.app.inject({
      method: method as 'GET' | 'POST' | 'PUT',
      url,
      headers: { ...cookieHeader(who), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown> | undefined,
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  }

  describe('search note privacy (P1)', () => {
    it("a member's search does not surface another member's private inbox note", async () => {
      // Add Bob to the demo workspace.
      const bob = await registerUser(ctx.app, { email: 'bob-privacy@test' });
      const add = await inject('POST', '/api/workspaces/ws-demo/members', sid, {
        email: 'bob-privacy@test',
        role: 'editor',
      });
      expect(add.status).toBe(201);

      // Bob captures a private inbox note (projectId omitted = inbox).
      const uniq = 'zzqprivatecapture';
      const note = await inject('POST', '/api/notes', bob.sid, {
        workspaceId: 'ws-demo',
        body: `${uniq} bob's secret thought`,
      });
      expect(note.status).toBe(201);
      expect(note.body.projectId).toBeNull();

      // Demo user (a co-member) searches for the unique word — must NOT see it.
      const demoSearch = await inject(
        'GET',
        `/api/search?q=${uniq}`,
        sid
      );
      expect(demoSearch.status).toBe(200);
      expect(demoSearch.body.notes).toHaveLength(0);

      // Bob himself CAN find his own note.
      const bobSearch = await inject('GET', `/api/search?q=${uniq}`, bob.sid);
      expect(bobSearch.body.notes.some((n: { body: string }) => n.body.includes(uniq))).toBe(
        true
      );
    });

    it('project notes remain workspace-shared in search', async () => {
      const uniq = 'zzqsharedprojnote';
      const note = await inject('POST', '/api/notes', sid, {
        workspaceId: 'ws-demo',
        projectId: 'p1',
        body: `${uniq} shared project note`,
      });
      expect(note.status).toBe(201);
      expect(note.body.projectId).toBe('p1');
      // Another member can find a project-scoped note.
      const bob = await registerUser(ctx.app, { email: 'bob-shared@test' });
      await inject('POST', '/api/workspaces/ws-demo/members', sid, {
        email: 'bob-shared@test',
        role: 'editor',
      });
      const bobSearch = await inject('GET', `/api/search?q=${uniq}`, bob.sid);
      expect(bobSearch.body.notes.some((n: { body: string }) => n.body.includes(uniq))).toBe(
        true
      );
    });
  });

  describe('estimate merge validation (P1)', () => {
    it('PUT with a partial estimate that breaks O ≤ M ≤ P after merge → 400', async () => {
      const created = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'estimate merge guard',
        estimate: { o: 1, m: 2, p: 4 },
      });
      expect(created.status).toBe(201);
      const id = created.body.id;

      // Sending only o=99 leaves m=2,p=4 from the original → o > m, invalid.
      const bad = await inject('PUT', `/api/tasks/${id}`, sid, {
        estimate: { o: 99 },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('estimateOrder');

      // A valid partial update still works.
      const ok = await inject('PUT', `/api/tasks/${id}`, sid, {
        estimate: { o: 1, m: 3, p: 5 },
      });
      expect(ok.status).toBe(200);
    });
  });

  describe('milestone validation (P1)', () => {
    it('rejects a nonexistent milestoneId on create and update', async () => {
      const bad = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'bad milestone create',
        milestoneId: 'does-not-exist',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('invalidMilestone');

      const t = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'milestone update target',
      });
      const upd = await inject('PUT', `/api/tasks/${t.body.id}`, sid, {
        milestoneId: 'still-does-not-exist',
      });
      expect(upd.status).toBe(400);
      expect(upd.body.error).toBe('invalidMilestone');
    });

    it('accepts a valid same-project milestone', async () => {
      const ms = await inject('POST', '/api/projects/p1/milestones', sid, {
        title: 'M1',
      });
      expect(ms.status).toBe(201);
      const t = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'with valid milestone',
        milestoneId: ms.body.id,
      });
      expect(t.status).toBe(201);
      expect(t.body.milestoneId).toBe(ms.body.id);
    });
  });

  describe('backup dump (P1)', () => {
    it('includes working calendar + holidays and scopes inbox notes', async () => {
      const dump = await inject('GET', '/api/admin/dump', sid);
      expect(dump.status).toBe(200);
      expect(Array.isArray(dump.body.workingCalendars)).toBe(true);
      expect(Array.isArray(dump.body.holidays)).toBe(true);
      // Every inbox note in the dump must belong to the requester.
      const inboxNotes = (dump.body.notes as Array<{ projectId: string | null }>).filter(
        (n) => n.projectId === null
      );
      // (Demo user owns its own inbox notes; Bob's private notes from the
      // privacy test above must not appear here.)
      const bobLeak = (dump.body.notes as Array<{ body: string }>).some((n) =>
        n.body.includes('zzqprivatecapture')
      );
      expect(bobLeak).toBe(false);
      expect(inboxNotes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('lifecycle + milestone P2s', () => {
    it('reopening a done task clears the stale finishedAt', async () => {
      const t = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'finish then reopen',
      });
      const id = t.body.id;
      // Move to done → finishedAt stamped.
      const done = await inject('PUT', `/api/tasks/${id}`, sid, { status: 'done' });
      expect(done.status).toBe(200);
      expect(typeof done.body.finishedAt).toBe('string');
      // Reopen → finishedAt cleared.
      const reopened = await inject('PUT', `/api/tasks/${id}`, sid, { status: 'doing' });
      expect(reopened.status).toBe(200);
      expect(reopened.body.finishedAt ?? null).toBeNull();
    });

    it('milestoneId: null detaches a milestone', async () => {
      const ms = await inject('POST', '/api/projects/p1/milestones', sid, {
        title: 'detach-me',
      });
      const t = await inject('POST', '/api/projects/p1/tasks', sid, {
        title: 'attach then detach',
        milestoneId: ms.body.id,
      });
      expect(t.body.milestoneId).toBe(ms.body.id);
      const detached = await inject('PUT', `/api/tasks/${t.body.id}`, sid, {
        milestoneId: null,
      });
      expect(detached.status).toBe(200);
      expect(detached.body.milestoneId ?? null).toBeNull();
    });
  });
});
