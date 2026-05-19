import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestApp,
  loginDemo,
  registerUser,
  cookieHeader,
  type TestApp,
} from './setup';

interface CalendarShape {
  id: string;
  workspaceId: string;
  weeklyHours: Array<{ startHour: number; endHour: number } | null>;
  createdAt: string;
  updatedAt: string;
  holidays: Array<{ id: string; date: string; name: string }>;
}

interface HolidayShape {
  id: string;
  calendarId: string;
  date: string;
  name: string;
}

interface ScheduleResp {
  projectId: string;
  items: Array<{ taskId: string; startPlanned: string; endPlanned: string }>;
  criticalPath: string[];
}

describe('working calendar endpoints', () => {
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

  async function put<T>(url: string, payload: unknown, sid: string) {
    const res = await ctx.app.inject({
      method: 'PUT',
      url,
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
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
    return { status: res.statusCode };
  }

  it('seed creates default Mon-Fri 09-18 UTC calendar for demo workspace', async () => {
    const sid = await loginDemo(ctx.app);
    const r = await get<CalendarShape>(
      '/api/workspaces/ws-demo/calendar',
      sid
    );
    expect(r.status).toBe(200);
    expect(r.body.workspaceId).toBe('ws-demo');
    expect(r.body.weeklyHours).toHaveLength(7);
    expect(r.body.weeklyHours[0]).toBeNull(); // Sun
    expect(r.body.weeklyHours[6]).toBeNull(); // Sat
    for (let d = 1; d <= 5; d++) {
      expect(r.body.weeklyHours[d]).toEqual({ startHour: 9, endHour: 18 });
    }
  });

  it('non-admin member cannot PUT the calendar (403)', async () => {
    const admin = await loginDemo(ctx.app);
    const outsider = await registerUser(ctx.app);
    // Invite outsider as editor (non-admin member).
    await post(
      '/api/workspaces/ws-demo/members',
      { email: outsider.email, role: 'editor' },
      admin
    );
    const res = await put(
      '/api/workspaces/ws-demo/calendar',
      {
        weeklyHours: JSON.stringify([
          null,
          '10:00-17:00',
          '10:00-17:00',
          '10:00-17:00',
          '10:00-17:00',
          '10:00-17:00',
          null,
        ]),
      },
      outsider.sid
    );
    expect(res.status).toBe(403);
  });

  it('admin can PUT a calendar and GET reflects the change', async () => {
    const sid = await loginDemo(ctx.app);
    const newHours = JSON.stringify([
      null,
      '10:00-16:00',
      '10:00-16:00',
      '10:00-16:00',
      '10:00-16:00',
      '10:00-16:00',
      null,
    ]);
    const pr = await put<CalendarShape>(
      '/api/workspaces/ws-demo/calendar',
      { weeklyHours: newHours },
      sid
    );
    expect(pr.status).toBe(200);
    expect(pr.body.weeklyHours[1]).toEqual({ startHour: 10, endHour: 16 });
    const gr = await get<CalendarShape>(
      '/api/workspaces/ws-demo/calendar',
      sid
    );
    expect(gr.body.weeklyHours[1]).toEqual({ startHour: 10, endHour: 16 });

    // Restore for later tests in this file.
    await put(
      '/api/workspaces/ws-demo/calendar',
      {
        weeklyHours: JSON.stringify([
          null,
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          null,
        ]),
      },
      sid
    );
  });

  it('rejects invalid weeklyHours (400)', async () => {
    const sid = await loginDemo(ctx.app);
    // Length 8 instead of 7.
    const bad8 = await put(
      '/api/workspaces/ws-demo/calendar',
      {
        weeklyHours: JSON.stringify([null, null, null, null, null, null, null, null]),
      },
      sid
    );
    expect(bad8.status).toBe(400);
    // Bad regex.
    const badRe = await put(
      '/api/workspaces/ws-demo/calendar',
      {
        weeklyHours: JSON.stringify([
          null,
          'banana',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          null,
        ]),
      },
      sid
    );
    expect(badRe.status).toBe(400);
    // Start >= end.
    const badOrder = await put(
      '/api/workspaces/ws-demo/calendar',
      {
        weeklyHours: JSON.stringify([
          null,
          '18:00-09:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          '09:00-18:00',
          null,
        ]),
      },
      sid
    );
    expect(badOrder.status).toBe(400);
  });

  it('creates a holiday and rejects duplicates with 409', async () => {
    const sid = await loginDemo(ctx.app);
    const first = await post<HolidayShape>(
      '/api/workspaces/ws-demo/holidays',
      { date: '2026-07-04', name: 'Independence' },
      sid
    );
    expect(first.status).toBe(201);
    expect(first.body.date).toBe('2026-07-04');
    expect(first.body.name).toBe('Independence');

    const dup = await post(
      '/api/workspaces/ws-demo/holidays',
      { date: '2026-07-04', name: 'Independence Day' },
      sid
    );
    expect(dup.status).toBe(409);

    // Bad date format rejected.
    const bad = await post(
      '/api/workspaces/ws-demo/holidays',
      { date: '2026/07/05', name: 'x' },
      sid
    );
    expect(bad.status).toBe(400);
  });

  it('DELETE /api/holidays/:id returns 204 and scheduler jumps past the holiday', async () => {
    const sid = await loginDemo(ctx.app);

    // Create a fresh project that starts on a weekday 09:00 UTC with a task
    // that would finish well before the holiday we add. The holiday sits
    // *inside* the task's span when the estimate is long enough (we use 20h
    // spanning Mon 09-18 + Tue 09-18 + Wed 09-11).
    const projectResp = await post<{ id: string }>(
      '/api/projects',
      {
        name: 'cal-test',
        startDate: '2026-06-29T09:00:00.000Z', // Mon 2026-06-29
        workspaceId: 'ws-demo',
      },
      sid
    );
    expect(projectResp.status).toBe(201);
    const projectId = projectResp.body.id;
    const taskResp = await post<{ id: string }>(
      `/api/projects/${projectId}/tasks`,
      {
        title: 'long task',
        type: 'research',
        estimate: { o: 20, m: 20, p: 20 },
      },
      sid
    );
    expect(taskResp.status).toBe(201);

    // Schedule without the holiday first.
    const beforeSched = await post<ScheduleResp>(
      `/api/projects/${projectId}/schedule`,
      {},
      sid
    );
    expect(beforeSched.status).toBe(200);
    const endBefore = new Date(beforeSched.body.items[0].endPlanned).getTime();

    // Add a holiday on Tuesday 2026-06-30 (in the middle of the task).
    const hol = await post<HolidayShape>(
      '/api/workspaces/ws-demo/holidays',
      { date: '2026-06-30', name: 'Blackout' },
      sid
    );
    expect(hol.status).toBe(201);

    const afterSched = await post<ScheduleResp>(
      `/api/projects/${projectId}/schedule`,
      {},
      sid
    );
    expect(afterSched.status).toBe(200);
    const endAfter = new Date(afterSched.body.items[0].endPlanned).getTime();

    // Adding a full closed day in the middle of the task pushes the end at
    // least 24h later (it actually shifts by one working day = 9h).
    expect(endAfter - endBefore).toBeGreaterThanOrEqual(9 * 3_600_000);

    // Cleanup: remove the holiday; expect 204.
    const d = await del(`/api/holidays/${hol.body.id}`, sid);
    expect(d.status).toBe(204);
  });

  it('schedule respects weekday calendar: 4h task starting Sat noon ends Mon 13:00 UTC', async () => {
    const sid = await loginDemo(ctx.app);

    // Fresh project with start = Sat 2026-01-03 12:00 UTC.
    const pr = await post<{ id: string }>(
      '/api/projects',
      {
        name: 'weekend-test',
        startDate: '2026-01-03T12:00:00.000Z',
        workspaceId: 'ws-demo',
      },
      sid
    );
    const projectId = pr.body.id;
    await post<{ id: string }>(
      `/api/projects/${projectId}/tasks`,
      {
        title: 'one task',
        type: 'research',
        estimate: { o: 4, m: 4, p: 4 },
      },
      sid
    );
    const r = await post<ScheduleResp>(
      `/api/projects/${projectId}/schedule`,
      {},
      sid
    );
    expect(r.status).toBe(200);
    // With Mon-Fri 09-18 UTC, Sat 12:00 → first open instant is Mon 09:00,
    // +4h → Mon 13:00 UTC.
    expect(r.body.items[0].endPlanned).toBe(
      new Date(Date.UTC(2026, 0, 5, 13, 0, 0)).toISOString()
    );
    expect(r.body.items[0].startPlanned).toBe(
      new Date(Date.UTC(2026, 0, 5, 9, 0, 0)).toISOString()
    );
  });
});
