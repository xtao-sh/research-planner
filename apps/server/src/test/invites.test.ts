import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, registerUser, cookieHeader, type TestApp } from './setup';

type Role = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer';

interface WorkspaceSummary {
  id: string;
  name: string;
  role: Role;
  memberCount: number;
}

interface InviteCreated {
  kind: 'invite';
  invite: { id: string; email: string; role: Role; token: string; expiresAt: string };
}

interface MemberCreated {
  kind: 'member';
  member: { id: string; workspaceId: string; userId: string; role: Role };
}

describe('invite-by-email flow', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function get<T>(url: string, sid?: string) {
    const res = await ctx.app.inject({
      method: 'GET',
      url,
      headers: sid ? cookieHeader(sid) : {},
    });
    return { status: res.statusCode, body: JSON.parse(res.body || 'null') as T };
  }

  async function post<T>(url: string, payload: unknown, sid?: string) {
    const res = await ctx.app.inject({
      method: 'POST',
      url,
      headers: {
        ...(sid ? cookieHeader(sid) : {}),
        'content-type': 'application/json',
      },
      payload: payload as Record<string, unknown>,
    });
    return {
      status: res.statusCode,
      body: JSON.parse(res.body || 'null') as T,
      setCookie: res.headers['set-cookie'],
    };
  }

  async function del(url: string, sid: string) {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url,
      headers: cookieHeader(sid),
    });
    return { status: res.statusCode };
  }

  it('1. inviting a non-existent email returns 201 {kind:invite}', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvA' }, demoSid);
    const r = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'brandnew@invite.test', role: 'editor' },
      demoSid
    );
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('invite');
    expect(r.body.invite.email).toBe('brandnew@invite.test');
    expect(r.body.invite.role).toBe('editor');
    expect(r.body.invite.token.length).toBeGreaterThan(20);
  });

  it('2. inviting an existing user returns 201 {kind:member}', async () => {
    const demoSid = await loginDemo(ctx.app);
    const bob = await registerUser(ctx.app, { email: 'bob-kind@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvB' }, demoSid);
    const r = await post<MemberCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: bob.email, role: 'editor' },
      demoSid
    );
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe('member');
    expect(r.body.member.userId).toBe(bob.id);
  });

  it('3. duplicate pending invite returns 409', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvDup' }, demoSid);
    const first = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'dup-inv@test', role: 'editor' },
      demoSid
    );
    expect(first.status).toBe(201);
    const second = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'dup-inv@test', role: 'editor' },
      demoSid
    );
    expect(second.status).toBe(409);
  });

  it('4. non-admin cannot create an invite → 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const bob = await registerUser(ctx.app, { email: 'bob-noadmin@test' });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvNoAdm' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: bob.email, role: 'editor' },
      demoSid
    );
    const r = await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'someone-else@test', role: 'viewer' },
      bob.sid
    );
    expect(r.status).toBe(403);
  });

  it('5. GET /invites returns pending list; admin only', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvList' }, demoSid);
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'pending-1@test', role: 'editor' },
      demoSid
    );
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'pending-2@test', role: 'viewer' },
      demoSid
    );
    const list = await get<Array<{ email: string; role: Role }>>(
      `/api/workspaces/${ws.body.id}/invites`,
      demoSid
    );
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    const emails = list.body.map((i) => i.email).sort();
    expect(emails).toEqual(['pending-1@test', 'pending-2@test']);

    // Non-member cannot see invites.
    const stranger = await registerUser(ctx.app, { email: 'stranger-inv@test' });
    const forbidden = await get(
      `/api/workspaces/${ws.body.id}/invites`,
      stranger.sid
    );
    expect(forbidden.status).toBe(404);

    // Add stranger as editor (non-admin), then they should get 403.
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: stranger.email, role: 'editor' },
      demoSid
    );
    const forb2 = await get(
      `/api/workspaces/${ws.body.id}/invites`,
      stranger.sid
    );
    expect(forb2.status).toBe(403);
  });

  it('6. DELETE /invites/:id revokes; non-admin → 403', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvRev' }, demoSid);
    const inv = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'revoke-me@test', role: 'editor' },
      demoSid
    );
    const bob = await registerUser(ctx.app, { email: 'bob-rev@test' });
    await post(
      `/api/workspaces/${ws.body.id}/members`,
      { email: bob.email, role: 'editor' },
      demoSid
    );
    const f = await del(`/api/invites/${inv.body.invite.id}`, bob.sid);
    expect(f.status).toBe(403);

    const ok = await del(`/api/invites/${inv.body.invite.id}`, demoSid);
    expect(ok.status).toBe(204);

    const list = await get<unknown[]>(
      `/api/workspaces/${ws.body.id}/invites`,
      demoSid
    );
    expect(list.body.length).toBe(0);
  });

  it('7. GET /api/invites/token/:token returns preview (public)', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvPrev' }, demoSid);
    const inv = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'preview@test', role: 'commenter' },
      demoSid
    );
    const preview = await get<{ workspaceName: string; role: Role; email: string }>(
      `/api/invites/token/${inv.body.invite.token}`
    );
    expect(preview.status).toBe(200);
    expect(preview.body.workspaceName).toBe('InvPrev');
    expect(preview.body.role).toBe('commenter');
    expect(preview.body.email).toBe('preview@test');
  });

  it('8. POST /api/invites/accept creates user + member, logs in, activity visible', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvAccept' }, demoSid);
    const inv = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'accepter@test', role: 'editor' },
      demoSid
    );
    const res = await post<{ user: { id: string; email: string }; workspace: { id: string; name: string }; role: Role }>(
      '/api/invites/accept',
      { token: inv.body.invite.token, password: 'supersecret', name: 'Accepter' }
    );
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('accepter@test');
    expect(res.body.workspace.id).toBe(ws.body.id);
    expect(res.body.role).toBe('editor');
    const setCookie = res.setCookie;
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(first).toBeTruthy();
    const m = (first as string).match(/rp_sid=([^;]+)/);
    expect(m).toBeTruthy();
    const sid = m![1];

    const wsList = await get<WorkspaceSummary[]>('/api/workspaces', sid);
    expect(wsList.body.some((w) => w.id === ws.body.id)).toBe(true);
  });

  it('9. accept with wrong password for existing-email → 401', async () => {
    const demoSid = await loginDemo(ctx.app);
    const existing = await registerUser(ctx.app, {
      email: 'existing-accept@test',
      password: 'rightpass123',
    });
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvWrongPw' }, demoSid);
    // Manually create an invite via the members endpoint — but existing users
    // go straight to kind:member. So create an invite row directly via Prisma.
    const token = 'test-token-' + Date.now();
    await ctx.prisma.invite.create({
      data: {
        id: 'inv-wrongpw',
        workspaceId: ws.body.id,
        email: existing.email,
        role: 'editor',
        token,
        invitedById: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    const bad = await post(
      '/api/invites/accept',
      { token, password: 'wrongpass' }
    );
    expect(bad.status).toBe(401);

    const good = await post<{ user: { email: string } }>(
      '/api/invites/accept',
      { token, password: 'rightpass123' }
    );
    expect(good.status).toBe(200);
    expect(good.body.user.email).toBe(existing.email);
  });

  it('10. accepting an already-accepted token → 404', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvTwice' }, demoSid);
    const inv = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'oneshot@test', role: 'editor' },
      demoSid
    );
    const first = await post(
      '/api/invites/accept',
      { token: inv.body.invite.token, password: 'somepassword' }
    );
    expect(first.status).toBe(200);
    const second = await post(
      '/api/invites/accept',
      { token: inv.body.invite.token, password: 'somepassword' }
    );
    expect(second.status).toBe(404);
  });

  it('11. expired token → 404 on both token/:token and accept', async () => {
    const demoSid = await loginDemo(ctx.app);
    const ws = await post<WorkspaceSummary>('/api/workspaces', { name: 'InvExpired' }, demoSid);
    const inv = await post<InviteCreated>(
      `/api/workspaces/${ws.body.id}/members`,
      { email: 'expired-inv@test', role: 'editor' },
      demoSid
    );
    await ctx.prisma.invite.update({
      where: { id: inv.body.invite.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const preview = await get(`/api/invites/token/${inv.body.invite.token}`);
    expect(preview.status).toBe(404);
    const accept = await post(
      '/api/invites/accept',
      { token: inv.body.invite.token, password: 'hunter2abc' }
    );
    expect(accept.status).toBe(404);
  });
});
