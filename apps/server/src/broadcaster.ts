import type { BroadcastEnvelope } from '@rp/shared';

// Re-export so existing imports from './broadcaster' keep working.
export type { BroadcastEnvelope } from '@rp/shared';

/**
 * Minimal shape the broadcaster needs from a socket. We avoid importing the
 * ws or @fastify/websocket types here so this module stays easy to unit-test
 * with plain fakes.
 */
export interface SocketLike {
  send(data: string): void;
  readyState: number; // 1 = OPEN (same in both `ws` and browser WebSocket)
  on(event: 'close', listener: () => void): void;
  /** Optional — present on real `ws` and browser WebSocket; the broadcaster
   *  itself never calls this, but callers that need to forcibly disconnect
   *  a client (e.g. after a workspace member is removed) do. */
  close?(code?: number, reason?: string): void;
}

const WS_OPEN = 1;

export class WorkspaceBroadcaster {
  private byWorkspace = new Map<string, Set<SocketLike>>();

  addClient(workspaceId: string, ws: SocketLike): void {
    let set = this.byWorkspace.get(workspaceId);
    if (!set) {
      set = new Set<SocketLike>();
      this.byWorkspace.set(workspaceId, set);
    }
    set.add(ws);
  }

  /** Idempotent — removing a non-tracked socket is a no-op. */
  removeClient(workspaceId: string, ws: SocketLike): void {
    const set = this.byWorkspace.get(workspaceId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.byWorkspace.delete(workspaceId);
    }
  }

  /**
   * Send the envelope to every currently-registered client for the workspace.
   * If a socket is not OPEN, or `send()` throws, that socket is dropped.
   * Never throws; callers should treat broadcast as fire-and-forget.
   */
  broadcast(workspaceId: string, envelope: BroadcastEnvelope): void {
    const set = this.byWorkspace.get(workspaceId);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(envelope);
    // Snapshot to avoid mutation-during-iteration when a failed send causes
    // removeClient() to be called back into us.
    const sockets = Array.from(set);
    for (const ws of sockets) {
      if (ws.readyState !== WS_OPEN) {
        this.removeClient(workspaceId, ws);
        continue;
      }
      try {
        ws.send(data);
      } catch {
        this.removeClient(workspaceId, ws);
      }
    }
  }

  /**
   * Return the live Set of sockets currently subscribed to a workspace, or
   * an empty Set if none. The returned Set is the internal storage — do not
   * mutate it. Used by the presence emitter so it can reach every client
   * without each module re-implementing its own connection map.
   */
  getClients(workspaceId: string): Set<SocketLike> {
    return this.byWorkspace.get(workspaceId) ?? new Set<SocketLike>();
  }

  /** Test helper — do not use in production paths. */
  _countClients(workspaceId: string): number {
    return this.byWorkspace.get(workspaceId)?.size ?? 0;
  }
}

export const broadcaster = new WorkspaceBroadcaster();
