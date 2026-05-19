/**
 * One-off backfill script: populate personal workspaces for users and set
 * Project.workspaceId from Project.ownerId. Run AFTER migration
 * 20260416100000_add_workspaces and BEFORE migration
 * 20260416100500_require_workspace_and_drop_owner.
 *
 * Safe to run multiple times; uses upserts and null-checks.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

type UserRow = { id: string; email: string; defaultWorkspaceId: string | null };
type ProjectRow = { id: string; ownerId: string | null; workspaceId: string | null };

async function main() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.$queryRawUnsafe<UserRow[]>(
      'SELECT id, email, defaultWorkspaceId FROM User'
    );

    for (const u of users) {
      // If user already has a default workspace and is a member, skip provisioning.
      if (u.defaultWorkspaceId) {
        // Make sure membership row exists
        const memberRows = await prisma.$queryRawUnsafe<{ c: number }[]>(
          `SELECT COUNT(*) as c FROM WorkspaceMember WHERE workspaceId = ? AND userId = ?`,
          u.defaultWorkspaceId,
          u.id
        );
        if ((memberRows[0]?.c ?? 0) === 0) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO WorkspaceMember (id, workspaceId, userId, role, createdAt) VALUES (?, ?, ?, 'admin', CURRENT_TIMESTAMP)`,
            randomUUID(),
            u.defaultWorkspaceId,
            u.id
          );
        }
        continue;
      }

      const wsId = randomUUID();
      const wsName = `${u.email}'s workspace`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO Workspace (id, name, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)`,
        wsId,
        wsName
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO WorkspaceMember (id, workspaceId, userId, role, createdAt) VALUES (?, ?, ?, 'admin', CURRENT_TIMESTAMP)`,
        randomUUID(),
        wsId,
        u.id
      );
      await prisma.$executeRawUnsafe(
        `UPDATE User SET defaultWorkspaceId = ? WHERE id = ?`,
        wsId,
        u.id
      );
    }

    // Backfill project.workspaceId from owner's personal workspace
    const projects = await prisma.$queryRawUnsafe<ProjectRow[]>(
      'SELECT id, ownerId, workspaceId FROM Project WHERE workspaceId IS NULL'
    );
    for (const p of projects) {
      if (!p.ownerId) {
        // Orphan project with no owner — skip; will be handled later if needed.
        continue;
      }
      const owners = await prisma.$queryRawUnsafe<{ defaultWorkspaceId: string | null }[]>(
        'SELECT defaultWorkspaceId FROM User WHERE id = ?',
        p.ownerId
      );
      const ws = owners[0]?.defaultWorkspaceId;
      if (!ws) continue;
      await prisma.$executeRawUnsafe(
        'UPDATE Project SET workspaceId = ? WHERE id = ?',
        ws,
        p.id
      );
    }

    // eslint-disable-next-line no-console
    console.log('[backfill] done');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
