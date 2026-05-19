export interface WorkspaceWithCount {
  id: string;
  memberCount: number;
}

/**
 * "Solo" = the active workspace has exactly one member. We use this to
 * trim collaboration-flavored UI (presence avatars, the connection dot,
 * the Members button) for users who haven't invited anyone yet.
 *
 * Returns false when:
 *   - no workspace is active (treat as not-solo so we don't surprise during loading)
 *   - the active workspace has memberCount > 1
 */
export function isActiveWorkspaceSolo(
  workspaces: WorkspaceWithCount[],
  activeWorkspaceId: string | null
): boolean {
  if (!activeWorkspaceId) return false;
  const ws = workspaces.find((w) => w.id === activeWorkspaceId);
  if (!ws) return false;
  return ws.memberCount <= 1;
}
