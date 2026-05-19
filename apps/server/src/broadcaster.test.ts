import { describe, expect, it, vi } from 'vitest';
import { WorkspaceBroadcaster, type BroadcastEnvelope, type SocketLike } from './broadcaster';

function makeSocket(overrides: Partial<SocketLike> = {}): SocketLike & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn(),
    readyState: 1,
    on: vi.fn(),
    ...overrides,
  } as SocketLike & { send: ReturnType<typeof vi.fn> };
}

function envelope(workspaceId: string, eventType: BroadcastEnvelope['eventType'] = 'task.created'): BroadcastEnvelope {
  return {
    v: 1,
    kind: 'event',
    workspaceId,
    projectId: 'p1',
    eventType,
    eventId: 'evt-1',
    at: '2026-04-15T00:00:00.000Z',
  };
}

describe('WorkspaceBroadcaster', () => {
  it('add / broadcast / remove: basic dispatch', () => {
    const b = new WorkspaceBroadcaster();
    const a1 = makeSocket();
    const a2 = makeSocket();
    b.addClient('ws-a', a1);
    b.addClient('ws-a', a2);

    const env = envelope('ws-a');
    b.broadcast('ws-a', env);

    expect(a1.send).toHaveBeenCalledTimes(1);
    expect(a2.send).toHaveBeenCalledTimes(1);
    expect(a1.send.mock.calls[0][0]).toBe(JSON.stringify(env));

    b.removeClient('ws-a', a1);
    b.broadcast('ws-a', env);
    expect(a1.send).toHaveBeenCalledTimes(1); // unchanged
    expect(a2.send).toHaveBeenCalledTimes(2);
  });

  it('broadcast to empty workspace is a no-op', () => {
    const b = new WorkspaceBroadcaster();
    // Must not throw and must not touch any socket (there are none).
    expect(() => b.broadcast('ws-empty', envelope('ws-empty'))).not.toThrow();
  });

  it('cleans up a closed socket when send fails', () => {
    const b = new WorkspaceBroadcaster();
    const good = makeSocket();
    const bad = makeSocket({
      send: vi.fn(() => { throw new Error('socket closed'); }),
    });
    b.addClient('ws-a', good);
    b.addClient('ws-a', bad);

    b.broadcast('ws-a', envelope('ws-a'));

    expect(good.send).toHaveBeenCalledTimes(1);
    expect(bad.send).toHaveBeenCalledTimes(1);
    // Bad socket should be dropped — a second broadcast must only touch `good`.
    b.broadcast('ws-a', envelope('ws-a'));
    expect(good.send).toHaveBeenCalledTimes(2);
    expect(bad.send).toHaveBeenCalledTimes(1);

    // Also: a socket whose readyState isn't OPEN is skipped and removed.
    const closing = makeSocket({ readyState: 2 });
    b.addClient('ws-a', closing);
    b.broadcast('ws-a', envelope('ws-a'));
    expect(closing.send).not.toHaveBeenCalled();
    expect(b._countClients('ws-a')).toBe(1); // only `good` remains
  });

  it('cross-workspace isolation: envelope for A is not delivered to B subscribers', () => {
    const b = new WorkspaceBroadcaster();
    const socketInA = makeSocket();
    const socketInB = makeSocket();
    b.addClient('ws-a', socketInA);
    b.addClient('ws-b', socketInB);

    b.broadcast('ws-a', envelope('ws-a'));

    expect(socketInA.send).toHaveBeenCalledTimes(1);
    expect(socketInB.send).not.toHaveBeenCalled();

    b.broadcast('ws-b', envelope('ws-b'));
    expect(socketInA.send).toHaveBeenCalledTimes(1);
    expect(socketInB.send).toHaveBeenCalledTimes(1);
  });

  it('removeClient is idempotent', () => {
    const b = new WorkspaceBroadcaster();
    const s = makeSocket();
    b.addClient('ws-a', s);
    b.removeClient('ws-a', s);
    // Second remove is a no-op.
    expect(() => b.removeClient('ws-a', s)).not.toThrow();
    // Remove from a workspace that never existed.
    expect(() => b.removeClient('ws-zzz', s)).not.toThrow();
  });
});
