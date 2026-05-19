import { useEffect, useRef, useState } from 'react';
import type { BroadcastEnvelope, PresenceMember, ClientFrame } from '@rp/shared';
import { API_BASE } from '../api/client';

export interface UseWorkspaceRealtimeArgs {
  workspaceId: string | null;
  activeProjectId: string | null;
  onEvent: (e: BroadcastEnvelope) => void;
  onPresence: (members: PresenceMember[]) => void;
}

export interface UseWorkspaceRealtimeReturn {
  connected: boolean;
  lastError: string | null;
}

// Backoff schedule matches the server-push spec: 1s, 2s, 4s, 8s, 16s, 30s cap.
// Uniform +/-20% jitter prevents multiple tabs from stampeding on server restart.
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

// Heartbeat interval. 25s is well under the typical 60s idle timeout of load
// balancers and also serves as a liveness signal to the server.
const HEARTBEAT_MS = 25_000;

function nextBackoff(attempt: number): number {
  const idx = Math.min(attempt, BACKOFF_STEPS_MS.length - 1);
  const base = BACKOFF_STEPS_MS[idx];
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

function resolveWsBase(): string {
  if (typeof API_BASE === 'string' && API_BASE.length > 0) {
    return API_BASE.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return '';
}

/**
 * Opens one WebSocket per active workspace and multiplexes event + presence
 * frames. Sends `hello` on open, `project` when the active project changes,
 * and a `ping` keepalive every 25s. Auto-reconnects with backoff + jitter;
 * stops reconnecting after a 4401 (auth invalidated).
 */
export function useWorkspaceRealtime(
  args: UseWorkspaceRealtimeArgs
): UseWorkspaceRealtimeReturn {
  const { workspaceId, activeProjectId, onEvent, onPresence } = args;
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Keep refs to the latest callbacks + active project so we never re-open the
  // socket when the parent passes a new inline function each render, and so
  // our heartbeat/project-change effects see the latest values.
  const onEventRef = useRef(onEvent);
  const onPresenceRef = useRef(onPresence);
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);
  useEffect(() => { onPresenceRef.current = onPresence; }, [onPresence]);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // Hold the live socket in a ref so effects outside the main open/close one
  // (project-change, unmount cleanup) can reach it.
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setConnected(false);
      setLastError(null);
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const base = resolveWsBase();
    const url = `${base}/ws/workspace/${encodeURIComponent(workspaceId)}`;

    const sendFrame = (frame: ClientFrame) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        // ignore — the socket will close and reconnect logic will take over
      }
    };

    const connect = () => {
      if (cancelled) return;
      // Clear any prior error (e.g. 'unauthorized') optimistically at the
      // start of each connection attempt. If construction throws below the
      // catch resets it; if it succeeds, onopen also clears it once the
      // socket transitions to OPEN. Without this, the UI surfaces a stale
      // error after a successful reconnect.
      setLastError(null);
      try {
        ws = new WebSocket(url);
        wsRef.current = ws;
      } catch (err) {
        setLastError(err instanceof Error ? err.message : String(err));
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setConnected(true);
        setLastError(null);
        sendFrame({ v: 1, type: 'hello', projectId: activeProjectIdRef.current });
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          sendFrame({ v: 1, type: 'ping' });
        }, HEARTBEAT_MS);
      };

      ws.onmessage = (evt: MessageEvent) => {
        if (cancelled) return;
        const raw = typeof evt.data === 'string' ? evt.data : '';
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return; // malformed frame — ignore
        }
        if (!parsed || typeof parsed !== 'object') return;
        const obj = parsed as { v?: unknown; kind?: unknown };
        if (obj.v !== 1) return;
        if (obj.kind === 'event') {
          onEventRef.current(parsed as BroadcastEnvelope);
        } else if (obj.kind === 'presence') {
          const members = (parsed as { members?: unknown }).members;
          if (Array.isArray(members)) {
            onPresenceRef.current(members as PresenceMember[]);
          }
        }
        // Unknown kinds: ignored (forward compatible).
      };

      ws.onerror = () => {
        // Browsers expose almost nothing on WS error events; onclose follows.
      };

      ws.onclose = (evt: CloseEvent) => {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        if (cancelled) return;
        setConnected(false);
        // Reset presence on disconnect so stale members don't linger.
        onPresenceRef.current([]);
        if (evt.code === 4401) {
          setLastError('unauthorized');
          return; // do not reconnect
        }
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = nextBackoff(attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === 0 || ws.readyState === 1) {
            ws.close(1000, 'client unmount');
          }
        } catch {
          // ignore
        }
        ws = null;
      }
      wsRef.current = null;
      setConnected(false);
    };
  }, [workspaceId]);

  // Push a `project` frame whenever the active project changes, independent
  // of the reconnect lifecycle. On a fresh connection, `hello` already
  // carries the current projectId, so this effect only fires on real changes.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const frame: ClientFrame = { v: 1, type: 'project', projectId: activeProjectId };
      ws.send(JSON.stringify(frame));
    } catch {
      // ignore — reconnect will re-send hello
    }
  }, [activeProjectId]);

  return { connected, lastError };
}
