// Workspace API client: thin wrappers over /api/workspaces endpoints.

import type { InviteRecord } from '@rp/shared';
import { fetchJson, sendJson } from './client';

export type WorkspaceRole =
  | 'owner'
  | 'admin'
  | 'editor'
  | 'commenter'
  | 'viewer';

export const INVITABLE_ROLES: readonly WorkspaceRole[] = [
  'admin',
  'editor',
  'commenter',
  'viewer',
] as const;

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  name?: string;
  role: WorkspaceRole;
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  return fetchJson<WorkspaceSummary[]>('/api/workspaces');
}

/**
 * Restore the demo workspace's sample data (wipe + re-seed the two showcase
 * projects). Owner-only + double-confirmed on the server; the literal token
 * is echoed after the caller's own UI confirm.
 */
export async function restoreDemoData(): Promise<void> {
  await sendJson('/api/admin/reset-demo', {
    method: 'POST',
    body: JSON.stringify({ confirm: 'RESET_DEMO' }),
  });
}

export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  const res = await sendJson('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as WorkspaceSummary;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  return fetchJson<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`);
}

export type InviteMemberResult =
  | {
      kind: 'member';
      member: { id: string; workspaceId: string; userId: string; role: WorkspaceRole };
    }
  | {
      kind: 'invite';
      invite: {
        id: string;
        email: string;
        role: WorkspaceRole;
        token: string;
        expiresAt: string;
      };
    };

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: WorkspaceRole
): Promise<InviteMemberResult> {
  const res = await sendJson(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
  return (await res.json()) as InviteMemberResult;
}

export async function getWorkspaceInvites(
  workspaceId: string
): Promise<InviteRecord[]> {
  return fetchJson<InviteRecord[]>(`/api/workspaces/${workspaceId}/invites`);
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await sendJson(`/api/invites/${inviteId}`, { method: 'DELETE' });
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await sendJson(`/api/workspaces/${workspaceId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<void> {
  await sendJson(`/api/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function transferOwnership(
  workspaceId: string,
  userId: string
): Promise<void> {
  await sendJson(`/api/workspaces/${workspaceId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}
