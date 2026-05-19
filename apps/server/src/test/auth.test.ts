import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, cookieHeader, type TestApp } from './setup';

describe('auth endpoints', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await setupTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('POST /api/auth/register returns 201 and sets rp_sid cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@test', password: 'alice12345', name: 'Alice' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { email: string };
    expect(body.email).toBe('alice@test');
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
    expect(cookieStr).toMatch(/rp_sid=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
  });

  it('POST /api/auth/register with duplicate email returns 409', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'alice@test', password: 'alice12345' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /api/auth/register with short password returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bob@test', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/auth/login with valid credentials returns 200', async () => {
    const sid = await loginDemo(ctx.app);
    expect(sid).toBeTruthy();
  });

  it('POST /api/auth/login with bad password returns 401', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'demo@local', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me without cookie returns 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me with valid cookie returns the user', async () => {
    const sid = await loginDemo(ctx.app);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(sid),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { email: string };
    expect(body.email).toBe('demo@local');
  });

  it('POST /api/auth/logout invalidates the session', async () => {
    const sid = await loginDemo(ctx.app);
    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: cookieHeader(sid),
    });
    expect(logoutRes.statusCode).toBe(204);

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: cookieHeader(sid),
    });
    expect(meRes.statusCode).toBe(401);
  });
});
