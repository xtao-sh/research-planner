/**
 * Assert that schema.prisma and schema.postgres.prisma are identical except
 * for their `provider = "..."` line. Exit 0 on match, 1 with a diff on
 * mismatch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function normalize(path: string): string {
  const raw = readFileSync(path, 'utf-8');
  return raw.replace(/^\s*provider\s*=\s*"[^"]+"\s*$/m, 'provider = "X"');
}

const sqlitePath = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const pgPath = resolve(__dirname, '..', 'prisma', 'schema.postgres.prisma');

const a = normalize(sqlitePath);
const b = normalize(pgPath);

if (a === b) {
  // eslint-disable-next-line no-console
  console.log('schemas match (ignoring provider line)');
  process.exit(0);
}

// Minimal line-level diff
const aLines = a.split('\n');
const bLines = b.split('\n');
const max = Math.max(aLines.length, bLines.length);
// eslint-disable-next-line no-console
console.error('schemas differ:');
for (let i = 0; i < max; i++) {
  if (aLines[i] !== bLines[i]) {
    // eslint-disable-next-line no-console
    console.error(`  line ${i + 1}:`);
    // eslint-disable-next-line no-console
    console.error(`    sqlite:   ${aLines[i] ?? '<missing>'}`);
    // eslint-disable-next-line no-console
    console.error(`    postgres: ${bLines[i] ?? '<missing>'}`);
  }
}
process.exit(1);
