# @rp/server

Fastify + Prisma API for the Research Planner.

## Default: SQLite

No external services required.

```sh
npm run dev             # boot dev server (SQLite file at prisma/dev.db)
npm test                # 90/90 tests against ephemeral per-file SQLite DBs
```

## Optional: Postgres (production parity)

The schema is mirrored in `prisma/schema.postgres.prisma`. Same 10 models, only
the `datasource db.provider` differs.

### One-time setup

Install Postgres 16 via Homebrew (no Docker required):

```sh
brew install postgresql@16
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Role + database
createuser -s rp
createdb -O rp research_planner
psql -d research_planner -c "ALTER USER rp WITH PASSWORD 'rp_dev';"
```

Apply the schema to the `public` schema of the `research_planner` database:

```sh
npm run postgres:push --workspace @rp/server
```

### Running the Postgres test suite

```sh
npm run test:postgres --workspace @rp/server
```

Each test file creates a uniquely-named ephemeral schema (`test_<ts>_<hex>`)
on the running Postgres, applies `src/test/schema.postgres.sql` into it,
seeds, then drops the schema on close.

If a run is killed mid-test and leaks schemas:

```sh
npm run postgres:cleanup --workspace @rp/server
```

### Gotchas

- The Prisma client is generated from whichever schema you most recently
  targeted. `npm test` runs `prisma generate` (SQLite) first, and
  `npm run test:postgres` runs `prisma generate --schema prisma/schema.postgres.prisma`
  first. Don't skip these wrappers.
- Any model change must be applied to **both** `schema.prisma` and
  `schema.postgres.prisma`. Run `npm run schemas:check --workspace @rp/server`
  to enforce parity; the postgres DDL must then be regenerated:
  `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.postgres.prisma --script > src/test/schema.postgres.sql`.
- SQLite migrations in `prisma/migrations/` are not mirrored for Postgres.
  Postgres uses `db push` + the generated `schema.postgres.sql` only.

## Backup

For single-user local mode (the default), the entire database is one SQLite
file. The location is whatever `DATABASE_URL` in `.env` resolves to; if unset,
Prisma falls back to `prisma/dev.db`.

While the server is running, the safe path is the SQLite online backup API:

```sh
sqlite3 apps/server/prisma/dev.db ".backup 'rp-backup-$(date +%F).db'"
```

If the server is stopped, a plain `cp prisma/dev.db prisma/dev.db.bak` is
fine — JSON-blob fields (`Note.tags`, `Scenario.snapshot`, `Task.labels`)
are stored as plain strings, so byte-for-byte file copy preserves them.

To restore: stop the server, replace the file, then run
`npx prisma migrate deploy` if the backup predates the current schema.

For a portable JSON dump (single-user mode only), `GET /api/admin/dump` from
the running server returns every row of every workspace-scoped table the
local user owns, with a `Content-Disposition: attachment` header so a browser
visit downloads it. This excludes sessions and invites by design.

Postgres deployments should use `pg_dump research_planner > rp.sql` for full
backups; restore with `psql research_planner < rp.sql` against an empty DB.
