import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';

import { buildServer } from '../app';
import { seed } from '../seed';

/**
 * Test DB strategy
 * ----------------
 * Two supported engines, selected via env:
 *
 *  SQLite (default): each test file writes to a unique temp file. Schema is
 *  applied from `schema.sql` (generated from schema.prisma).
 *
 *  Postgres (when PG_BASE_URL or DATABASE_URL starts with `postgresql://`):
 *  each test file creates a unique schema on the already-running Postgres
 *  instance and applies `schema.postgres.sql` into it. The schema is dropped
 *  on close(). `scripts/cleanup_test_schemas.ts` rescues any orphans.
 */

export function dbEngine(): 'sqlite' | 'postgres' {
  const url = process.env.PG_BASE_URL || process.env.DATABASE_URL || '';
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
    ? 'postgres'
    : 'sqlite';
}

// Statements in schema.sql are separated by blank lines; each "-- CreateX"
// block is one statement ending in `);`. We split carefully: on a top-level
// `;` followed by newline. Prisma's `$executeRawUnsafe` accepts one statement
// at a time.
function loadSchemaStatements(sqlPath: string): string[] {
  const raw = readFileSync(sqlPath, 'utf-8');
  return raw
    .split(/;\s*\n/g)
    .map((s) => s.replace(/^\s*--[^\n]*\n/gm, '').trim())
    .filter((s) => s.length > 0);
}

async function applySqliteSchema(prisma: PrismaClient): Promise<void> {
  const statements = loadSchemaStatements(resolve(__dirname, 'schema.sql'));
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
}

async function applyPostgresSchema(prisma: PrismaClient): Promise<void> {
  const statements = loadSchemaStatements(
    resolve(__dirname, 'schema.postgres.sql')
  )
    // The per-test client has its search_path pinned to our ephemeral schema.
    // Strip any "public". qualifiers so tables land in the right place.
    .map((s) => s.replace(/"public"\./g, ''))
    // Skip the `CREATE SCHEMA IF NOT EXISTS "public"` line Prisma emits — we
    // are writing into our own schema, not public.
    .filter((s) => !/^CREATE SCHEMA\s/i.test(s));
  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }
}

export interface TestApp {
  app: FastifyInstance;
  prisma: PrismaClient;
  dbPath: string;
  dbUrl: string;
  close: () => Promise<void>;
}

export async function setupTestApp(): Promise<TestApp> {
  if (dbEngine() === 'postgres') {
    return setupPostgresTestApp();
  }
  return setupSqliteTestApp();
}

async function setupSqliteTestApp(): Promise<TestApp> {
  const id = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const dbPath = resolve(__dirname, '..', '..', `test-${id}.db`);
  const dbUrl = `file:${dbPath}`;
  process.env.DATABASE_URL = dbUrl;
  // Test suite covers the multi-user auth/invite flows. Single-user mode
  // (the default) gates them behind 410.
  process.env.MULTI_USER = '1';

  const prisma = new PrismaClient({ datasourceUrl: dbUrl, log: ['error'] });
  await applySqliteSchema(prisma);
  await seed(prisma);

  const app = await buildServer(prisma);
  await app.ready();

  const close = async (): Promise<void> => {
    await app.close();
    await prisma.$disconnect();
    await unlink(dbPath).catch(() => { /* ignore */ });
    await unlink(`${dbPath}-journal`).catch(() => { /* ignore */ });
  };

  return { app, prisma, dbPath, dbUrl, close };
}

async function setupPostgresTestApp(): Promise<TestApp> {
  const baseUrl = process.env.PG_BASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('PG_BASE_URL must be set for postgres test setup');
  }

  const schemaName = `test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const testUrl = appendSchema(baseUrl, schemaName);

  // 1) Create the schema via an admin client against the base URL.
  const admin = new PrismaClient({ datasourceUrl: baseUrl, log: ['error'] });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  } finally {
    await admin.$disconnect();
  }

  // 2) Open the per-test client with search_path pinned to our schema, then
  //    apply the DDL statement-by-statement.
  process.env.DATABASE_URL = testUrl;
  // Tests exercise multi-user auth/invite flows.
  process.env.MULTI_USER = '1';
  const prisma = new PrismaClient({ datasourceUrl: testUrl, log: ['error'] });
  try {
    await applyPostgresSchema(prisma);
    await seed(prisma);
  } catch (err) {
    await prisma.$disconnect().catch(() => { /* ignore */ });
    await dropSchema(baseUrl, schemaName);
    throw err;
  }

  const app = await buildServer(prisma);
  await app.ready();

  const close = async (): Promise<void> => {
    try {
      await app.close();
    } catch { /* ignore */ }
    await prisma.$disconnect().catch(() => { /* ignore */ });
    try {
      await dropSchema(baseUrl, schemaName);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`warning: failed to drop test schema ${schemaName}:`, err);
    }
  };

  return { app, prisma, dbPath: schemaName, dbUrl: testUrl, close };
}

function appendSchema(baseUrl: string, schemaName: string): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}schema=${encodeURIComponent(schemaName)}`;
}

async function dropSchema(baseUrl: string, schemaName: string): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: baseUrl, log: ['error'] });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
  } finally {
    await admin.$disconnect();
  }
}

/** Login the demo user and return the raw `rp_sid` cookie value. */
export async function loginDemo(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'demo@local', password: 'demo123' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  return extractSid(res.headers['set-cookie']);
}

/**
 * Register a brand-new user (unique email by default) and return their
 * `rp_sid` cookie + id/email. Use in cross-user / empty-project tests.
 */
export async function registerUser(
  app: FastifyInstance,
  opts: { email?: string; password?: string; name?: string } = {}
): Promise<{ sid: string; id: string; email: string }> {
  const email = opts.email ?? `user-${randomBytes(4).toString('hex')}@test`;
  const password = opts.password ?? 'supersecret';
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, name: opts.name },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  }
  const body = JSON.parse(res.body) as { id: string; email: string };
  return { sid: extractSid(res.headers['set-cookie']), id: body.id, email: body.email };
}

/** Convenience: build a Cookie header from an sid. */
export function cookieHeader(sid: string): { cookie: string } {
  return { cookie: `rp_sid=${sid}` };
}

function extractSid(setCookie: string | string[] | undefined): string {
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!first) throw new Error('no Set-Cookie header in response');
  const m = first.match(/rp_sid=([^;]+)/);
  if (!m) throw new Error(`no rp_sid in Set-Cookie: ${first}`);
  return m[1];
}
