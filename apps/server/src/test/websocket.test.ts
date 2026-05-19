import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { setupTestApp, loginDemo, type TestApp } from './setup';

/**
 * End-to-end test of the real-time sync path:
 *   1. Spin up Fastify on a random port.
 *   2. Log in as demo user to get rp_sid.
 *   3. Open a WebSocket to /ws/workspace/ws-demo with the cookie.
 *   4. Trigger a project creation via REST.
 *   5. Assert the WS receives a BroadcastEnvelope referencing that event.
 *
 * Held to a tight (~3s) timeout. If it proves flaky or slow on CI, convert to
 * `it.skip` — the broadcaster unit tests remain the deterministic guarantee.
 */
describe('WebSocket real-time sync (integration)', () => {
  let ctx: TestApp;
  let sid: string;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    sid = await loginDemo(ctx.app);
    // Bind to a random port on loopback.
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = ctx.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = `ws://127.0.0.1:${addr.port}/ws/workspace/ws-demo`;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('pushes a BroadcastEnvelope to subscribers when an event is emitted', async () => {
    const ws = new WebSocket(wsUrl, {
      headers: { cookie: `rp_sid=${sid}` },
    });

    const opened = new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    await opened;

    // Presence frames arrive on connect/disconnect; skip past them and wait
    // for the actual event envelope triggered by the REST mutation below.
    const messageP = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for WS message')), 4000);
      const onMsg = (data: WebSocket.RawData) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.kind === 'event') {
            clearTimeout(timer);
            ws.off('message', onMsg);
            resolve(text);
            return;
          }
        } catch {
          // fall through — ignore unparseable frames
        }
      };
      ws.on('message', onMsg);
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Trigger a mutation; seed's demo workspace is 'ws-demo'.
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `rp_sid=${sid}` },
      body: JSON.stringify({ name: 'ws-test-proj', workspaceId: 'ws-demo' }),
    });
    expect(res.status).toBe(201);

    const raw = await messageP;
    const env = JSON.parse(raw);
    expect(env).toMatchObject({
      v: 1,
      workspaceId: 'ws-demo',
      eventType: 'project.created',
    });
    expect(typeof env.eventId).toBe('string');
    expect(typeof env.at).toBe('string');

    ws.close();
  }, 8000);

  it('closes with 4401 when there is no session cookie', async () => {
    const ws = new WebSocket(wsUrl); // no cookie

    const closedCode: number = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for close')), 4000);
      ws.once('close', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      ws.once('error', () => { /* close event still fires */ });
    });
    expect(closedCode).toBe(4401);
  }, 6000);
});
