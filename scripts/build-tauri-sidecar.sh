#!/usr/bin/env bash
# Bundle the Fastify+Prisma server into a self-contained Bun binary and
# stage it (plus the seeded SQLite database) where Tauri expects them.
#
# After this script runs, `cd apps/web && npm run tauri:build` produces
# a self-contained .app — no external `npm run dev:server` needed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"

if [ ! -x "$BUN_BIN" ]; then
  echo "ERR: bun not found at $BUN_BIN" >&2
  echo "     Set BUN_BIN to your bun executable." >&2
  exit 1
fi

# Tauri sidecar naming convention: <name>-<rust-target-triple>
# darwin-arm64 = aarch64-apple-darwin
TARGET_TRIPLE="${TARGET_TRIPLE:-aarch64-apple-darwin}"
BUN_TARGET="${BUN_TARGET:-bun-darwin-arm64}"

SERVER_DIR="$REPO_ROOT/apps/server"
TAURI_DIR="$REPO_ROOT/apps/web/src-tauri"
OUT_BIN="$SERVER_DIR/dist-bin/research-planner-server"
SIDECAR_DST="$TAURI_DIR/binaries/research-planner-server-${TARGET_TRIPLE}"
SEED_DB_SRC="$SERVER_DIR/prisma/dev.db"
SEED_DB_DST="$TAURI_DIR/data/data.db"

echo "==> Compiling Bun standalone server (target=$BUN_TARGET)"
mkdir -p "$SERVER_DIR/dist-bin"
cd "$SERVER_DIR"
"$BUN_BIN" build src/app.ts \
  --compile \
  --target="$BUN_TARGET" \
  --outfile "$OUT_BIN"

echo "==> Staging sidecar at $SIDECAR_DST"
mkdir -p "$TAURI_DIR/binaries"
cp "$OUT_BIN" "$SIDECAR_DST"
chmod +x "$SIDECAR_DST"

echo "==> Staging seeded SQLite database at $SEED_DB_DST"
mkdir -p "$TAURI_DIR/data"
if [ ! -f "$SEED_DB_SRC" ]; then
  echo "ERR: seed DB not found at $SEED_DB_SRC" >&2
  echo "     Run apps/server prisma migrate + seed first." >&2
  exit 1
fi
cp "$SEED_DB_SRC" "$SEED_DB_DST"

echo "==> Done. Build the .app with:  cd apps/web && npm run tauri:build"
