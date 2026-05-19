// API client: base URL resolution + thin fetch wrappers used across the app.

const env = (import.meta as any).env ?? {};

// In a Tauri-bundled production build the web shell runs under the
// `tauri://` (or custom) protocol and there's no Vite dev-server proxy,
// so relative `/api` URLs would 404. The Rust setup hook spawns the
// Fastify sidecar on 127.0.0.1:4317; point the client at it directly.
const isTauri =
  typeof window !== 'undefined' &&
  ((window as any).__TAURI_INTERNALS__ !== undefined ||
    (window as any).__TAURI__ !== undefined ||
    (window as any).isTauri === true);

export const API_BASE =
  typeof env.VITE_API_BASE === 'string' && env.VITE_API_BASE.length > 0
    ? env.VITE_API_BASE
    : isTauri
    ? 'http://127.0.0.1:4317'
    : env.DEV
    ? 'http://127.0.0.1:4000'
    : '';

export function resolveApi(path: string) {
  if (typeof path !== 'string') return path;
  if (!path.startsWith('/api')) return path;
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

async function extractErrorMessage(res: Response): Promise<string> {
  let message = `请求失败（${res.status}）`;
  try {
    const data = await res.json();
    if (data && typeof data === 'object') {
      const value = (data as any).message || JSON.stringify(data);
      if (value) message = value;
    }
  } catch {
    try {
      const text = await res.text();
      if (text) message = text;
    } catch {
      // ignore
    }
  }
  return message;
}

// Error carrying the HTTP status so callers can branch on 401 etc.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const target = typeof input === 'string' ? resolveApi(input) : input;
  const res = await fetch(target, { credentials: 'include', ...(init || {}) });
  if (!res.ok) throw new ApiError(res.status, await extractErrorMessage(res));
  return res.json();
}

export async function sendJson(input: RequestInfo, init: RequestInit = {}) {
  const target = typeof input === 'string' ? resolveApi(input) : input;
  const res = await fetch(target, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new ApiError(res.status, await extractErrorMessage(res));
  return res;
}
