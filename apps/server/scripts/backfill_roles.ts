/**
 * One-off backfill script: widen workspace member roles from the old
 * {admin, member} pair to the new {owner, admin, editor, commenter, viewer}
 * enum. For each workspace:
 *
 *   - `member` -> `editor`
 *   - `admin`  -> `admin` (unchanged), except the earliest-created admin gets
 *                 promoted to `owner`. If there are no admins but there are
 *                 members, promote the earliest-created member to `owner`
 *                 and leave the rest as `editor`.
 *   - empty workspaces: skipped.
 *   - Unknown roles (not in the old two values): left alone.
 *
 * Idempotent: running again on a migrated DB is a no-op.
 */
import { PrismaClient } from '@prisma/client';

type MemberRow = {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  createdAt: Date;
};

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let workspacesProcessed = 0;
  let ownersPromoted = 0;
  let membersToEditor = 0;

  try {
    const workspaces = await prisma.workspace.findMany({ select: { id: true } });

    for (const ws of workspaces) {
      const members = (await prisma.workspaceMember.findMany({
        where: { workspaceId: ws.id },
        orderBy: { createdAt: 'asc' },
      })) as MemberRow[];

      if (members.length === 0) continue;
      workspacesProcessed++;

      // Already has an owner? Nothing to promote.
      const hasOwner = members.some((m) => m.role === 'owner');

      // Promote exactly one member to owner if we don't have one.
      let ownerId: string | null = null;
      if (!hasOwner) {
        const admins = members.filter((m) => m.role === 'admin');
        const pick = admins.length > 0 ? admins[0] : members[0];
        ownerId = pick.id;
        await prisma.workspaceMember.update({
          where: { id: pick.id },
          data: { role: 'owner' },
        });
        ownersPromoted++;
      }

      // Migrate `member` -> `editor`.
      for (const m of members) {
        if (m.id === ownerId) continue; // already updated above
        if (m.role === 'member') {
          await prisma.workspaceMember.update({
            where: { id: m.id },
            data: { role: 'editor' },
          });
          membersToEditor++;
        }
        // `admin`, `editor`, `commenter`, `viewer`, `owner` and unknowns are
        // left alone.
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[backfill_roles] workspaces processed: ${workspacesProcessed}, ` +
        `owners promoted: ${ownersPromoted}, members -> editor: ${membersToEditor}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
