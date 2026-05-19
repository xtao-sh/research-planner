import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

type Role = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer';

interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
}

interface MemberRow {
  userId: string;
  email: string;
  name?: string;
  role: Role;
}

describe('workspaces endpoints', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function get<T>(url: string, sid: string) {
    const res = await ctx.app.inject({
      method: 'GET',
      url,
      headers: cookieHeader(sid),
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function post<T>(url: string, payload: unknown, sid: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function del(url: string, sid: string) {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url,
      headers: cookieHeader(sid),
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : null,
    };
  }

  it('GET /api/workspaces returns demo workspace with role=owner', async () => {
    const sid = await loginDemo(ctx.app);
    const r = await get<WorkspaceSummary[]>('/api/workspaces', sid);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    const demo = r.body.find((w) => w.name === 'Demo Workspace');
    expect(demo).toBeTruthy();
    expect(demo!.role).toBe('owner');
    expect(demo!.memberCount).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/workspaces creates a workspace with creator as owner', async () => {
    const sid = await loginDemo(ctx.app);
    const c = await post<WorkspaceSummary>('/api/workspaces', { name: 'Team A' }, sid);
    expect(c.status).toBe(201);
    expect(c.body.name).toBe('Team A');
    expect(c.body.role).toBe('owner');
    expect(c.body.memberCount).toBe(1);

    const r = await get<WorkspaceSummary[]>('/api/workspaces', sid);
    expect(r.status).toBe(200);
    expect(r.body.some((w) => w.id === c.body.id && w.name === 'Team A')).toBe(true);
  });

  it('POST /api/workspaces with empty name returns 400 Zod', async () => {
    const sid = await loginDemo(ctx.app);
    const r = await post('/api/workspaces', { name: '' }, sid);
    expect(r.status).toBe(400);
  });

  it('GET /api/workspaces/:id/members includes the creator as owner', async () => {
    const sid = await loginDemo(ctx.app);
    const c = await post<WorkspaceSummary>('/api/workspaces', { name: 'Team Members' }, sid);
    expect(c.status).toBe(201);
    const r = await get<MemberRow[]>(`/api/workspaces/${c.body.id}/members`, sid);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].role).toBe('owner');
    expect(r.body[0].email).toBe('demo@local');
  });

  it('admin invites a registered user and invitee sees the workspace', async () => {
    const demoSid = await loginDemo(ctx.app);
    const bob = await registerUser(ctx.app, { email: 'bob-invite@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Team Invites' }, demoSid);
    expect(ws.status).toBe(201);

    const invite = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'bob-invite@test', role: 'editor' },
      demoSid
    );
    expect(invite.status).toBe(201);

    const bobList = await get<WorkspaceSummary[]>('/api/workspaces', bob.sid);
    expect(bobList.body.some((w) => w.id === ws.body.id)).toBe(true);
  });

  it('inviting a non-existent email returns 201 {kind: invite}', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Ghost' }, demoSid);
    const invite = await post<{ kind: string; invite: { token: string } }>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'nobody@test', role: 'editor' },
      demoSid
    );
    expect(invite.status).toBe(201);
    expect(invite.body.kind).toBe('invite');
    expect(typeof invite.body.invite.token).toBe('string');
  });

  it('inviting an already-member user returns 409', async () => {
    const demoSid = await loginDemo(ctx.app);
    const alice = await registerUser(ctx.app, { email: 'alice-dup@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Dup' }, demoSid);
    const first = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: alice.email, role: 'editor' },
      demoSid
    );
    expect(first.status).toBe(201);
    const second = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: alice.email, role: 'editor' },
      demoSid
    );
    expect(second.status).toBe(409);
  });

  it('a non-admin member cannot invite — returns 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const bob = await registerUser(ctx.app, { email: 'bob-member@test' });
    const carol = await registerUser(ctx.app, { email: 'carol-target@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'NoInvite' }, demoSid);
    const invite = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: bob.email, role: 'editor' },
      demoSid
    );
    expect(invite.status).toBe(201);
    // bob (member) tries to invite carol → 403
    const bobInvite = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: carol.email, role: 'editor' },
      bob.sid
    );
    expect(bobInvite.status).toBe(403);
  });

  it("cross-tenant: a new user cannot see demo's p1 project", async () => {
    const carol = await registerUser(ctx.app, { email: 'carol-cross@test' });
    const r = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects/p1',
      headers: cookieHeader(carol.sid),
    });
    expect(r.statusCode).toBe(404);
  });

  it('DELETE /members/:userId removes a member; cannot remove last admin', async () => {
    const demoSid = await loginDemo(ctx.app);
    const bob = await registerUser(ctx.app, { email: 'bob-remove@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Remove' }, demoSid);
    const invite = await post<{ userId: string }>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: bob.email, role: 'editor' },
      demoSid
    );
    expect(invite.status).toBe(201);

    const removeBob = await del(`/api/workspaces/${ws.body.id}/members/${bob.id}`, demoSid);
    expect(removeBob.status).toBe(204);

    // Demo tries to remove themselves (last admin) → 400.
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(demoSid),
    });
    const me = JSON.parse(meRes.body) as { id: string };
    const removeSelf = await del(`/api/workspaces/${ws.body.id}/members/${me.id}`, demoSid);
    expect(removeSelf.status).toBe(400);
  });

  async function put<T>(url: string, payload: unknown, sid: string) {
    const res = await ctx.app.inject({
      method: 'PUT',
      url,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  it('viewer cannot POST a task → 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const v = await registerUser(ctx.app, { email: 'view1@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'ViewerWS' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: v.email, role: 'viewer' },
      demoSid
    );
    const proj = await post<{ id: string }>(
      '/api/projects',
      { name: 'P', workspaceId: ws.body.id },
      demoSid
    );
    const r = await post(
      `/api/projects/${proj.body.id}/tasks`,
      { title: 'nope', estimate: { o: 1, m: 1, p: 1 } },
      v.sid
    );
    expect(r.status).toBe(403);
  });

  it('editor can POST a task → 201', async () => {
    const demoSid = await loginDemo(ctx.app);
    const e = await registerUser(ctx.app, { email: 'ed1@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'EditorWS' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: e.email, role: 'editor' },
      demoSid
    );
    const proj = await post<{ id: string }>(
      '/api/projects',
      { name: 'P', workspaceId: ws.body.id },
      demoSid
    );
    const r = await post(
      `/api/projects/${proj.body.id}/tasks`,
      { title: 'yes', estimate: { o: 1, m: 1, p: 1 } },
      e.sid
    );
    expect(r.status).toBe(201);
  });

  it('editor cannot invite members → 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const e = await registerUser(ctx.app, { email: 'ed2@test' });
    const x = await registerUser(ctx.app, { email: 'x2@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'EdNoInv' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: e.email, role: 'editor' },
      demoSid
    );
    const r = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: x.email, role: 'viewer' },
      e.sid
    );
    expect(r.status).toBe(403);
  });

  it('admin can change another member\'s role', async () => {
    const demoSid = await loginDemo(ctx.app);
    const adm = await registerUser(ctx.app, { email: 'adm1@test' });
    const tgt = await registerUser(ctx.app, { email: 'tgt1@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'AdmRole' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: adm.email, role: 'admin' },
      demoSid
    );
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: tgt.email, role: 'viewer' },
      demoSid
    );
    const r = await put(
      `/api/workspaces/${ws.body.id}/members/${tgt.id}`,
      { role: 'editor' },
      adm.sid
    );
    expect(r.status).toBe(200);
  });

  it('admin cannot set owner role → 400', async () => {
    const demoSid = await loginDemo(ctx.app);
    const adm = await registerUser(ctx.app, { email: 'adm2@test' });
    const tgt = await registerUser(ctx.app, { email: 'tgt2@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'NoOwnerSet' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: adm.email, role: 'admin' },
      demoSid
    );
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: tgt.email, role: 'editor' },
      demoSid
    );
    const r = await put(
      `/api/workspaces/${ws.body.id}/members/${tgt.id}`,
      { role: 'owner' },
      adm.sid
    );
    expect(r.status).toBe(400);
  });

  it('admin cannot remove the owner → 400', async () => {
    const demoSid = await loginDemo(ctx.app);
    const adm = await registerUser(ctx.app, { email: 'adm3@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'NoRemOwner' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: adm.email, role: 'admin' },
      demoSid
    );
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(demoSid),
    });
    const me = JSON.parse(meRes.body) as { id: string };
    const r = await del(`/api/workspaces/${ws.body.id}/members/${me.id}`, adm.sid);
    expect(r.status).toBe(400);
  });

  it('owner transfers ownership; old owner becomes admin; event emitted', async () => {
    const demoSid = await loginDemo(ctx.app);
    const neo = await registerUser(ctx.app, { email: 'neo@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Transfer' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: neo.email, role: 'editor' },
      demoSid
    );
    const r = await post(
      `/api/workspaces/${ws.body.id}/transfer`,
      { userId: neo.id },
      demoSid
    );
    expect(r.status).toBe(200);

    const members = await get<MemberRow[]>(
      `/api/workspaces/${ws.body.id}/members`,
      demoSid
    );
    const neoRow = members.body.find((m) => m.userId === neo.id)!;
    const demoRow = members.body.find((m) => m.email === 'demo@local')!;
    expect(neoRow.role).toBe('owner');
    expect(demoRow.role).toBe('admin');

    const activity = await get<Array<{ type: string }>>(
      `/api/workspaces/${ws.body.id}/activity`,
      demoSid
    );
    expect(activity.body.some((e) => e.type === 'workspace.owner.transferred')).toBe(true);
  });

  it('after transfer, former owner cannot re-transfer → 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const neo = await registerUser(ctx.app, { email: 'neo2@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'Transfer2' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: neo.email, role: 'editor' },
      demoSid
    );
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(demoSid),
    });
    const me = JSON.parse(meRes.body) as { id: string };

    const t1 = await post(
      `/api/workspaces/${ws.body.id}/transfer`,
      { userId: neo.id },
      demoSid
    );
    expect(t1.status).toBe(200);

    // Demo is now admin, cannot transfer again
    const t2 = await post(
      `/api/workspaces/${ws.body.id}/transfer`,
      { userId: me.id },
      demoSid
    );
    expect(t2.status).toBe(403);
  });

  it('invite with role=owner → 400 Zod', async () => {
    const demoSid = await loginDemo(ctx.app);
    const someone = await registerUser(ctx.app, { email: 'nope-owner@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'NoOwnerInv' }, demoSid);
    const r = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: someone.email, role: 'owner' },
      demoSid
    );
    expect(r.status).toBe(400);
  });
});
