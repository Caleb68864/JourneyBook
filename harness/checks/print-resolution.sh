#!/usr/bin/env bash
# harness/checks/print-resolution.sh -- the print-resolution table the scale
# picker shows still matches what the engine delivers.
#
# `scripts/generate-print-resolution.mjs --check` rebuilds
# `apps/web/src/generated/print-resolution.json` and `docs/print-resolution.md`
# from the engine and diffs both against the committed files. Same shape as
# golden-fixture.sh, and the same command CI runs (`pnpm check:print-resolution`).
#
# Why it matters: print resolution is not a property of this product (the
# renderer never resamples, so each preset delivers 1x-2x what it asks for,
# depending on latitude). The table is the one statement of it users see before
# printing; a stale table is a resolution promise the renderer does not keep.
#
# Requires a built map-sources -- the script imports `packages/map-sources/dist`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../lib/env.sh
. "$SCRIPT_DIR/../lib/env.sh"

cd "$REPO_ROOT" || exit 1

if [ ! -f packages/map-sources/dist/index.js ]; then
  echo "FAIL: packages/map-sources/dist missing (run 'pnpm -r build' first)"
  exit 1
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if node scripts/generate-print-resolution.mjs --check >"$log" 2>&1; then
  echo "PASS: $(head -1 "$log")"
  exit 0
fi

echo "FAIL: the committed print-resolution table no longer matches the engine"
sed 's/^/    /' "$log"
exit 1
