/**
 * Drop every `test_*` schema on the Postgres instance pointed at by
 * PG_BASE_URL. Manual rescue for schemas that leaked when a vitest run was
 * aborted mid-test.
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const baseUrl = process.env.PG_BASE_URL || process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('PG_BASE_URL (or DATABASE_URL) must be set');
  }

  const prisma = new PrismaClient({ datasourceUrl: baseUrl, log: ['error'] });
  try {
    const rows = await prisma.$queryRawUnsafe<{ schema_name: string }[]>(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test\\_%' ESCAPE '\\'`
    );
    if (rows.length === 0) {
      // eslint-disable-next-line no-console
      console.log('no orphaned test schemas found');
      return;
    }
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(`dropping schema ${r.schema_name}`);
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${r.schema_name}" CASCADE`);
    }
    // eslint-disable-next-line no-console
    console.log(`dropped ${rows.length} schema(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
