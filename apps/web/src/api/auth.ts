import { fetchJson, sendJson } from './client';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  /** True when the server is running in MULTI_USER mode. Controls whether
   *  workspace/presence/WS-status chrome appears in the UI. */
  multiUser?: boolean;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await sendJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()) as AuthUser;
}

export async function register(
  email: string,
  password: string,
  name?: string
): Promise<AuthUser> {
  const res = await sendJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
  });
  return (await res.json()) as AuthUser;
}

export async function logout(): Promise<void> {
  await sendJson('/api/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<AuthUser> {
  return fetchJson<AuthUser>('/api/auth/me');
}
