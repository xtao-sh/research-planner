import type { WorkspaceRole } from '../../api/workspaces';

export function canWrite(role: WorkspaceRole | undefined | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function canManageMembers(role: WorkspaceRole | undefined | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageWorkspace(role: WorkspaceRole | undefined | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function isOwner(role: WorkspaceRole | undefined | null): boolean {
  return role === 'owner';
}

export function roleI18nKey(role: WorkspaceRole): string {
  return `role.${role}`;
}
