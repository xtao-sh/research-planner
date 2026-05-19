import { describe, expect, it, vi } from 'vitest';
import { WorkspacePresence, type PresenceEntry } from './presence';
import type { SocketLike } from './broadcaster';

function makeSocket(): SocketLike {
  return {
    send: vi.fn(),
    readyState: 1,
    on: vi.fn(),
  };
}

function makeEntry(overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    socket: makeSocket(),
    userId: 'u1',
    email: 'u1@example.com',
    name: 'User One',
    projectId: null,
    sinceIso: '2026-04-23T00:00:00.000Z',
    ...overrides,
  };
}

describe('WorkspacePresence', () => {
  it('addSocket + listMembers returns one entry', () => {
    const p = new WorkspacePresence();
    p.addSocket('ws-a', 'sock-1', makeEntry({ projectId: 'p1' }));
    const members = p.listMembers('ws-a');
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      userId: 'u1',
      email: 'u1@example.com',
      name: 'User One',
      projectId: 'p1',
    });
  });

  it('two sockets for the same user produce two entries (per-socket design)', () => {
    const p = new WorkspacePresence();
    p.addSocket('ws-a', 'sock-1', makeEntry({ projectId: 'p1' }));
    p.addSocket('ws-a', 'sock-2', makeEntry({ projectId: 'p2' }));
    const members = p.listMembers('ws-a');
    expect(members).toHaveLength(2);
    const projectIds = members.map((m) => m.projectId).sort();
    expect(projectIds).toEqual(['p1', 'p2']);
  });

  it('updateProject changes the entry in place', () => {
    const p = new WorkspacePresence();
    p.addSocket('ws-a', 'sock-1', makeEntry({ projectId: null }));
    p.updateProject('ws-a', 'sock-1', 'p-new');
    expect(p.listMembers('ws-a')[0].projectId).toBe('p-new');
    p.updateProject('ws-a', 'sock-1', null);
    expect(p.listMembers('ws-a')[0].projectId).toBeNull();
    // Unknown socket: no throw, no change.
    expect(() => p.updateProject('ws-a', 'nope', 'x')).not.toThrow();
  });

  it('removeSocket removes and returns the entry', () => {
    const p = new WorkspacePresence();
    const entry = makeEntry();
    p.addSocket('ws-a', 'sock-1', entry);
    const removed = p.removeSocket('ws-a', 'sock-1');
    expect(removed).toBe(entry);
    expect(p.listMembers('ws-a')).toEqual([]);
    // Second remove is a no-op.
    expect(p.removeSocket('ws-a', 'sock-1')).toBeUndefined();
  });

  it('listMembers for an empty workspace returns []', () => {
    const p = new WorkspacePresence();
    expect(p.listMembers('ws-empty')).toEqual([]);
  });

  it('cross-workspace isolation', () => {
    const p = new WorkspacePresence();
    p.addSocket('ws-a', 'sock-1', makeEntry({ userId: 'ua' }));
    p.addSocket('ws-b', 'sock-2', makeEntry({ userId: 'ub' }));
    expect(p.listMembers('ws-a').map((m) => m.userId)).toEqual(['ua']);
    expect(p.listMembers('ws-b').map((m) => m.userId)).toEqual(['ub']);
  });
});
