import type { PrismaClient, Prisma } from '@prisma/client';
import type { WorkspaceRole } from '@rp/shared';

export type { WorkspaceRole };

export const ALL_ROLES = ['owner', 'admin', 'editor', 'commenter', 'viewer'] as const;
export const INVITABLE_ROLES = ['admin', 'editor', 'commenter', 'viewer'] as const;

// --- Capability predicates -------------------------------------------------

export function canWrite(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function canManageMembers(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  // Workspace-settings scope: calendar, holidays. Same as member-mgmt for now.
  return role === 'owner' || role === 'admin';
}

export function isOwner(role: WorkspaceRole): boolean {
  return role === 'owner';
}

// --- Access helpers --------------------------------------------------------

/**
 * Return the project if the user is a member of its workspace, else null.
 * Read-only gate — does NOT enforce write. Use for GET endpoints or as a
 * lookup for membership role.
 */
export async function assertProjectAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string
): Promise<{ project: Prisma.ProjectGetPayload<{}>; role: WorkspaceRole } | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
  });
  if (!membership) return null;
  return { project, role: membership.role as WorkspaceRole };
}

/**
 * Return { role } if the user is a member of the workspace, else null.
 */
export async function assertWorkspaceAccess(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<{ role: WorkspaceRole } | null> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) return null;
  return { role: membership.role as WorkspaceRole };
}

/**
 * For endpoints that invite / remove / change-role / transfer.
 * Returns {role} if canManageMembers(role), else null.
 * A null return means either non-member (treat as 404) or insufficient role
 * (treat as 403). Callers can re-call assertWorkspaceAccess to disambiguate.
 */
export async function assertWorkspaceManagerRole(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<{ role: WorkspaceRole } | null> {
  const access = await assertWorkspaceAccess(prisma, workspaceId, userId);
  if (!access) return null;
  if (!canManageMembers(access.role)) return null;
  return access;
}

/**
 * For endpoints that mutate projects / tasks / deps / milestones / scenarios.
 * Returns {project, role} if the user can write, else null.
 * Callers should disambiguate 404 (non-member) vs 403 (viewer/commenter) using
 * assertProjectAccess.
 */
export async function assertProjectWriteAccess(
  prisma: PrismaClient,
  projectId: string,
  userId: string
): Promise<{ project: Prisma.ProjectGetPayload<{}>; role: WorkspaceRole } | null> {
  const access = await assertProjectAccess(prisma, projectId, userId);
  if (!access) return null;
  if (!canWrite(access.role)) return null;
  return access;
}

/**
 * @deprecated Use assertWorkspaceManagerRole / canManageWorkspace instead.
 * Returns true if the user is an owner or admin of the workspace.
 */
export async function assertWorkspaceAdmin(
  prisma: PrismaClient,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const access = await assertWorkspaceAccess(prisma, workspaceId, userId);
  return !!access && canManageMembers(access.role);
}
