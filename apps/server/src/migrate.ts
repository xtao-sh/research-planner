/**
 * Runtime schema reconciliation.
 *
 * The desktop (Tauri) build ships a *pre-seeded* SQLite database and copies it
 * into the user's data dir only on first launch — so an existing user's DB is
 * never touched on upgrade and silently lacks any columns/tables the new code
 * expects. The Bun-compiled sidecar carries the Prisma *client* but not the
 * Prisma CLI / migration engine, so `prisma migrate deploy` isn't available at
 * runtime.
 *
 * This module bridges that gap for ADDITIVE changes: on boot we check whether
 * each known delta is present and, if not, apply it with the Prisma client's
 * raw-SQL escape hatch. Every step is guarded by an existence check, so the
 * function is idempotent and safe to run on every start (fresh installs, where
 * the columns already exist, do nothing).
 *
 * Scope: additive tables/columns/indexes only. Destructive or table-rewrite
 * migrations still go through `prisma migrate` in development (see
 * prisma/migrations) — this is the upgrade safety net, not a general migration
 * framework. New additive deltas should be appended as a new guard below AND
 * captured as a normal Prisma migration.
 */
import type { PrismaClient } from '@prisma/client';

export type RawDb = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;

function isPostgres(): boolean {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

async function hasTable(db: RawDb, table: string, pg: boolean): Promise<boolean> {
  const rows = pg
    ? await db.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${table}'`
      )
    : await db.$queryRawUnsafe<unknown[]>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
      );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasColumn(
  db: RawDb,
  table: string,
  column: string,
  pg: boolean
): Promise<boolean> {
  if (pg) {
    const rows = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}' AND column_name = '${column}'`
    );
    return Array.isArray(rows) && rows.length > 0;
  }
  const rows = (await db.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA table_info("${table}")`
  )) as Array<{ name: string }>;
  return Array.isArray(rows) && rows.some((r) => r.name === column);
}

// --- Delta: the Artifact table (4th project tab) ---
const ARTIFACT_SQLITE = [
  `CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX "Artifact_projectId_idx" ON "Artifact"("projectId")`,
  `CREATE INDEX "Artifact_createdById_idx" ON "Artifact"("createdById")`,
];
const ARTIFACT_PG = [
  `CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX "Artifact_projectId_idx" ON "Artifact"("projectId")`,
  `CREATE INDEX "Artifact_createdById_idx" ON "Artifact"("createdById")`,
  `ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

// --- Delta: Note.taskId (attach a note to a task) ---
// SQLite allows adding a nullable column with a column-level REFERENCES clause
// (the added column must default to NULL, which it does).
const NOTE_TASKID_SQLITE = [
  `ALTER TABLE "Note" ADD COLUMN "taskId" TEXT REFERENCES "Task" ("id") ON DELETE SET NULL`,
  `CREATE INDEX "Note_taskId_idx" ON "Note"("taskId")`,
];
const NOTE_TASKID_PG = [
  `ALTER TABLE "Note" ADD COLUMN "taskId" TEXT`,
  `CREATE INDEX "Note_taskId_idx" ON "Note"("taskId")`,
  `ALTER TABLE "Note" ADD CONSTRAINT "Note_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

export interface EnsureSchemaResult {
  applied: string[];
}

/**
 * Bring the connected database up to the additive deltas the current code
 * requires. Idempotent: returns the list of deltas it actually applied (empty
 * when the DB was already current).
 */
export async function ensureRuntimeSchema(
  db: RawDb,
  log: (msg: string) => void = () => {}
): Promise<EnsureSchemaResult> {
  const pg = isPostgres();
  const applied: string[] = [];

  if (!(await hasTable(db, 'Artifact', pg))) {
    log('runtime-migrate: creating Artifact table');
    for (const stmt of pg ? ARTIFACT_PG : ARTIFACT_SQLITE) {
      await db.$executeRawUnsafe(stmt);
    }
    applied.push('artifact_table');
  }

  if (!(await hasColumn(db, 'Note', 'taskId', pg))) {
    log('runtime-migrate: adding Note.taskId');
    for (const stmt of pg ? NOTE_TASKID_PG : NOTE_TASKID_SQLITE) {
      await db.$executeRawUnsafe(stmt);
    }
    applied.push('note_task_id');
  }

  return { applied };
}
