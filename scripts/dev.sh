#!/usr/bin/env bash
set -euo pipefail

# Run server and web concurrently using npm workspaces
npm run dev --workspace @rp/server &
SERVER_PID=$!

npm run dev --workspace @rp/web &
WEB_PID=$!

trap 'kill $SERVER_PID $WEB_PID 2>/dev/null || true' INT TERM EXIT
wait $SERVER_PID $WEB_PID
