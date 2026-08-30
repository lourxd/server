#!/usr/bin/env bash
# Build into a staging directory, then swap it in atomically.
#
# `vite build` writes into build/ incrementally, deleting and rewriting hashed
# chunks. Doing that under a running panel leaves it importing chunk names that
# no longer exist -- a 500 on every route, and sirv aborting the process on a
# missing precompressed asset. Staging keeps the live build whole until the
# moment it is replaced.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAGE="$ROOT/.build-staging"
LIVE="$ROOT/build"
OLD="$ROOT/.build-previous"

rm -rf "$STAGE" "$OLD"
SCP_BUILD_OUT="$STAGE" npx vite build "$@"

[[ -f "$STAGE/index.js" ]] || { echo "build produced no index.js; keeping the current build" >&2; rm -rf "$STAGE"; exit 1; }

if [[ -d "$LIVE" ]]; then mv "$LIVE" "$OLD"; fi
mv "$STAGE" "$LIVE"
rm -rf "$OLD"

echo "build swapped in"
