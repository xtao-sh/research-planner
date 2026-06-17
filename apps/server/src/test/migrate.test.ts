import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { ensureRuntimeSchema } from '../migrate';

/**
 * Verifies the runtime upgrade safety net against a database at the PREVIOUS
 * schema version: we build the DB from the current SQLite DDL with the
 * Artifact table + Note.taskId stripped out (i.e. what a pre-upgrade user's DB
 * looks like), then assert ensureRuntimeSchema brings it current, is
 * idempotent, and that the resulting schema is actually usable.
 */

/** Current SQLite DDL with the two new deltas removed → the "old" schema. */
function oldSchemaStatements(): string[] {
  let ddl = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8');
  // Drop the whole Artifact CREATE TABLE block.
  ddl = ddl.replace(/CREATE TABLE "Artifact"[\s\S]*?\n\);\n/, '');
  // Drop Artifact indexes.
  ddl = ddl.replace(/CREATE INDEX "Artifact_[^"]+"[^;]*;\n/g, '');
  // Drop the Note.taskId column + its inline FK constraint.
  ddl = ddl.replace(/\n\s*"taskId" TEXT,/, '');
  ddl = ddl.replace(/\n\s*CONSTRAINT "Note_taskId_fkey"[^\n]*,/, '');
  // Drop the Note.taskId index.
  ddl = ddl.replace(/CREATE INDEX "Note_taskId_idx"[^;]*;\n/g, '');
  return ddl
    .split(/;\s*\n/g)
    .map((s) => s.replace(/^\s*--[^\n]*\n/gm, '').trim())
    .filter((s) => s.length > 0);
}

describe('ensureRuntimeSchema (runtime upgrade safety net)', () => {
  let prisma: PrismaClient;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = resolve(__dirname, '..', '..', `migtest-${randomBytes(4).toString('hex')}.db`);
    const url = `file:${dbPath}`;
    process.env.DATABASE_URL = url; // force the SQLite branch of the runner
    prisma = new PrismaClient({ datasourceUrl: url, log: ['error'] });
    for (const stmt of oldSchemaStatements()) {
      await prisma.$executeRawUnsafe(stmt);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await unlink(dbPath).catch(() => { /* ignore */ });
    await unlink(`${dbPath}-journal`).catch(() => { /* ignore */ });
  });

  async function hasTable(name: string): Promise<boolean> {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`
    )) as unknown[];
    return rows.length > 0;
  }
  async function noteHasTaskId(): Promise<boolean> {
    const rows = (await prisma.$queryRawUnsafe(
      `PRAGMA table_info("Note")`
    )) as Array<{ name: string }>;
    return rows.some((r) => r.name === 'taskId');
  }

  it('starts at the OLD schema (no Artifact table, no Note.taskId)', async () => {
    expect(await hasTable('Artifact')).toBe(false);
    expect(await noteHasTaskId()).toBe(false);
  });

  it('applies both deltas and reports them', async () => {
    const { applied } = await ensureRuntimeSchema(prisma);
    expect(applied.sort()).toEqual(['artifact_table', 'note_task_id']);
    expect(await hasTable('Artifact')).toBe(true);
    expect(await noteHasTaskId()).toBe(true);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const { applied } = await ensureRuntimeSchema(prisma);
    expect(applied).toEqual([]);
  });

  it('the upgraded schema is actually usable (FK insert end-to-end)', async () => {
    // Minimal object graph: user → workspace → project → task → note(taskId) + artifact.
    await prisma.user.create({
      data: { id: 'u1', email: 'm@x', passwordHash: 'h' },
    });
    await prisma.workspace.create({ data: { id: 'w1', name: 'W' } });
    await prisma.project.create({
      data: { id: 'p1', name: 'P', createdAt: new Date(), updatedAt: new Date(), workspaceId: 'w1' },
    });
    await prisma.task.create({
      data: {
        id: 't1', projectId: 'p1', title: 'T', type: 'reading', status: 'todo',
        estimateO: 1, estimateM: 2, estimateP: 3, priority: 1,
      },
    });
    const note = await prisma.note.create({
      data: { id: 'n1', workspaceId: 'w1', projectId: 'p1', taskId: 't1', createdById: 'u1', body: 'hi' },
    });
    expect(note.taskId).toBe('t1');
    const artifact = await prisma.artifact.create({
      data: { id: 'a1', projectId: 'p1', kind: 'link', title: 'Doc', createdById: 'u1' },
    });
    expect(artifact.kind).toBe('link');

    // The Note.taskId FK is ON DELETE SET NULL: deleting the task nulls it.
    await prisma.task.delete({ where: { id: 't1' } });
    const after = await prisma.note.findUnique({ where: { id: 'n1' } });
    expect(after?.taskId ?? null).toBeNull();
  });
});
