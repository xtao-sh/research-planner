// API client for the public invite endpoints.

import type { InvitePreview } from '@rp/shared';
import { fetchJson, sendJson } from './client';

export type { InvitePreview };

export interface AcceptInviteResult {
  user: { id: string; email: string; name?: string | null };
  workspace: { id: string; name: string };
  role: 'admin' | 'editor' | 'commenter' | 'viewer';
}

export async function fetchInviteByToken(token: string): Promise<InvitePreview> {
  return fetchJson<InvitePreview>(
    `/api/invites/token/${encodeURIComponent(token)}`
  );
}

export async function acceptInvite(
  token: string,
  password: string,
  name?: string
): Promise<AcceptInviteResult> {
  const res = await sendJson('/api/invites/accept', {
    method: 'POST',
    body: JSON.stringify({
      token,
      password,
      ...(name ? { name } : {}),
    }),
  });
  return (await res.json()) as AcceptInviteResult;
}
