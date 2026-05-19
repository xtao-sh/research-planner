import type { PresenceMember } from '@rp/shared';
import type { SocketLike } from './broadcaster';

/**
 * Internal per-socket presence record. Stored by socketId (a UUID minted at
 * connect time) so a single user with multiple tabs appears as multiple
 * entries — that's deliberate (MVP, Google-Docs-style per-socket presence).
 */
export interface PresenceEntry {
  socket: SocketLike;
  userId: string;
  email: string;
  name: string | null;
  projectId: string | null;
  sinceIso: string;
}

/**
 * In-memory registry of who is connected to each workspace. Purely runtime
 * state — never persisted. Closes drive removal; there is no heartbeat-based
 * expiry by design (dead TCP sockets eventually fail on send and the
 * broadcaster drops them on the next broadcast).
 */
export class WorkspacePresence {
  private registry = new Map<string, Map<string, PresenceEntry>>();

  addSocket(workspaceId: string, socketId: string, entry: PresenceEntry): void {
    let inner = this.registry.get(workspaceId);
    if (!inner) {
      inner = new Map<string, PresenceEntry>();
      this.registry.set(workspaceId, inner);
    }
    inner.set(socketId, entry);
  }

  removeSocket(workspaceId: string, socketId: string): PresenceEntry | undefined {
    const inner = this.registry.get(workspaceId);
    if (!inner) return undefined;
    const entry = inner.get(socketId);
    inner.delete(socketId);
    if (inner.size === 0) this.registry.delete(workspaceId);
    return entry;
  }

  updateProject(workspaceId: string, socketId: string, projectId: string | null): void {
    const entry = this.registry.get(workspaceId)?.get(socketId);
    if (!entry) return;
    entry.projectId = projectId;
  }

  /**
   * Return every socket currently registered for `userId` in `workspaceId`.
   * Used after removing a workspace member so callers can forcibly close
   * those sockets — otherwise they would keep receiving broadcasts until
   * the client noticed it had been kicked.
   */
  getSocketsForUser(workspaceId: string, userId: string): SocketLike[] {
    const inner = this.registry.get(workspaceId);
    if (!inner) return [];
    const out: SocketLike[] = [];
    for (const entry of inner.values()) {
      if (entry.userId === userId) out.push(entry.socket);
    }
    return out;
  }

  listMembers(workspaceId: string): PresenceMember[] {
    const inner = this.registry.get(workspaceId);
    if (!inner) return [];
    const out: PresenceMember[] = [];
    for (const entry of inner.values()) {
      out.push({
        userId: entry.userId,
        email: entry.email,
        name: entry.name,
        projectId: entry.projectId,
        sinceIso: entry.sinceIso,
      });
    }
    return out;
  }
}

export const presence = new WorkspacePresence();
