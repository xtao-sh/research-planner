import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestApp, loginDemo, cookieHeader, type TestApp } from './setup';

interface ScheduleResp {
  projectId: string;
  items: Array<{ taskId: string; startPlanned: string; endPlanned: string }>;
  criticalPath: string[];
}

describe('schedule endpoint', () => {
  let ctx: TestApp;
  let sid: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
    // The seed workspace calendar is Mon-Fri 9-18. That scrambles wall-clock
    // math in these tests (a 9h task starting Fri 14:00 ends Mon 14:00 = 72h
    // wall clock, while a 16h task starting Mon 09:00 ends Tue 16:00 = 31h).
    // Override to a true 24/7 calendar so wall-clock hours ≡ working hours
    // and the duration-mode assertions remain meaningful. Must be
    // "00:00-24:00" (not "00:00-23:59") — the latter leaves a 1-minute
    // closed window each midnight, so a task whose duration crosses
    // midnight (depends on the wall-clock projectStart) picks up an extra
    // minute and the exact-hour assertions flake.
    const always = JSON.stringify(new Array(7).fill('00:00-24:00'));
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/workspaces/ws-demo/calendar',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { weeklyHours: always } as Record<string, unknown>,
    });
    if (put.statusCode !== 200) {
      throw new Error(`test setup: PUT calendar returned ${put.statusCode}: ${put.body}`);
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function sched(payload: unknown = {}) {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/schedule',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: payload as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as ScheduleResp };
  }

  it('default schedule returns criticalPath [t1,t2,t3] for the demo project', async () => {
    const r = await sched({});
    expect(r.status).toBe(200);
    expect(r.body.criticalPath).toEqual(['t1', 't2', 't3']);
    expect(r.body.items).toHaveLength(3);
  });

  function hoursForTask(body: ScheduleResp, id: string): number {
    const it = body.items.find((x) => x.taskId === id)!;
    return (new Date(it.endPlanned).getTime() - new Date(it.startPlanned).getTime()) / 3_600_000;
  }

  it('optimistic durations are shorter than expected for the demo task t3', async () => {
    // Demo t3: O=4, M=8, P=16 → PERT expected=9h, optimistic=4h
    const exp = await sched({ durationMode: 'expected' });
    const opt = await sched({ durationMode: 'optimistic' });
    expect(hoursForTask(opt.body, 't3')).toBeLessThan(hoursForTask(exp.body, 't3'));
    expect(hoursForTask(opt.body, 't3')).toBe(4);
  });

  it('pessimistic uses the P estimate (>= 16 working hours)', async () => {
    // Demo t3 P=16. With the default workspace calendar (Mon-Fri 09:00-18:00)
    // the 16 working hours spread across multiple days, so wall-clock ≥ 16h.
    // We just assert it's strictly larger than expected-mode wall-clock.
    const exp = await sched({ durationMode: 'expected' });
    const pes = await sched({ durationMode: 'pessimistic' });
    expect(hoursForTask(pes.body, 't3')).toBeGreaterThanOrEqual(16);
    expect(hoursForTask(pes.body, 't3')).toBeGreaterThan(hoursForTask(exp.body, 't3'));
  });

  it('invalid durationMode returns 400', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects/p1/schedule',
      headers: { ...cookieHeader(sid), 'content-type': 'application/json' },
      payload: { durationMode: 'garbage' } as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(400);
  });
});
