#!/usr/bin/env bash
# Bundle the Fastify+Prisma server into a self-contained Bun binary and
# stage it (plus the seeded SQLite database) where Tauri expects them.
#
# After this script runs, `cd apps/web && npm run tauri:build` produces
# a self-contained installer — no external `npm run dev:server` needed.
#
# Cross-platform env vars (set by CI; defaults target host macOS arm64):
#   TARGET_TRIPLE  Rust target triple, e.g. x86_64-pc-windows-msvc
#   BUN_TARGET     Bun --target, e.g. bun-windows-x64
# On Windows targets the binary gets a .exe suffix automatically.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"

# CI runners (especially Windows) put bun on PATH instead of ~/.bun.
if [ ! -x "$BUN_BIN" ]; then
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
  else
    echo "ERR: bun not found at $BUN_BIN or on PATH" >&2
    echo "     Set BUN_BIN to your bun executable." >&2
    exit 1
  fi
fi

# Tauri sidecar naming convention: <name>-<rust-target-triple>[.exe on Windows]
TARGET_TRIPLE="${TARGET_TRIPLE:-aarch64-apple-darwin}"
BUN_TARGET="${BUN_TARGET:-bun-darwin-arm64}"

# Append .exe for Windows targets (both Bun output and Tauri sidecar lookup).
SUFFIX=""
case "$TARGET_TRIPLE" in
  *windows*) SUFFIX=".exe" ;;
esac

SERVER_DIR="$REPO_ROOT/apps/server"
TAURI_DIR="$REPO_ROOT/apps/web/src-tauri"
OUT_BIN="$SERVER_DIR/dist-bin/research-planner-server${SUFFIX}"
SIDECAR_DST="$TAURI_DIR/binaries/research-planner-server-${TARGET_TRIPLE}${SUFFIX}"
SEED_DB_SRC="$SERVER_DIR/prisma/dev.db"
SEED_DB_DST="$TAURI_DIR/data/data.db"

echo "==> Compiling Bun standalone server (target=$BUN_TARGET, triple=$TARGET_TRIPLE)"
mkdir -p "$SERVER_DIR/dist-bin"
cd "$SERVER_DIR"
"$BUN_BIN" build src/app.ts \
  --compile \
  --target="$BUN_TARGET" \
  --outfile "$OUT_BIN"

echo "==> Staging sidecar at $SIDECAR_DST"
mkdir -p "$TAURI_DIR/binaries"
cp "$OUT_BIN" "$SIDECAR_DST"
# chmod +x is a no-op on Windows but harmless.
chmod +x "$SIDECAR_DST" 2>/dev/null || true

# Regenerate the seed database so the bundle always ships the CURRENT schema
# + demo seed, not whatever stale dev.db happens to sit in the working tree
# (dev.db is gitignored). `migrate deploy` applies all migrations forward
# (non-destructive); then the v2 demo seed runs against the empty DB. Skip
# with RP_SKIP_SEED_REGEN=1 to reuse an existing dev.db.
if [ "${RP_SKIP_SEED_REGEN:-0}" != "1" ]; then
  echo "==> Regenerating seed database ($SEED_DB_SRC) from migrations + seed"
  rm -f "$SEED_DB_SRC" "$SEED_DB_SRC-journal"
  # `file:` URLs resolve relative to the schema dir (prisma/), so this targets
  # prisma/dev.db. .env is gitignored, so set DATABASE_URL explicitly for CI.
  ( cd "$SERVER_DIR" \
      && DATABASE_URL="file:./dev.db" npx prisma migrate deploy \
      && DATABASE_URL="file:./dev.db" npm run db:seed )
fi

echo "==> Staging seeded SQLite database at $SEED_DB_DST"
echo "    SEED_DB_SRC=$SEED_DB_SRC"
echo "    Source exists? $([ -f "$SEED_DB_SRC" ] && echo yes || echo no)"
echo "    Source size: $(wc -c < "$SEED_DB_SRC" 2>/dev/null || echo 'n/a')"
mkdir -p "$TAURI_DIR/data"
if [ ! -f "$SEED_DB_SRC" ]; then
  # In CI we'd rather ship an empty bundle than fail the whole release.
  # Tauri's resource bundling needs the file to exist; the runtime
  # overwrites this on first launch from the app's own first-run copy.
  echo "WARN: seed DB not found at $SEED_DB_SRC — staging empty placeholder" >&2
  mkdir -p "$(dirname "$SEED_DB_SRC")"
  : > "$SEED_DB_SRC"
fi
cp "$SEED_DB_SRC" "$SEED_DB_DST"
echo "    Copied. Destination size: $(wc -c < "$SEED_DB_DST")"

echo "==> Done. Build the bundle with:  cd apps/web && npm run tauri:build"
