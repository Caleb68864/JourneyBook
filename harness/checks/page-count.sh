#!/usr/bin/env bash
# harness/checks/page-count.sh -- the page-count lever table still matches the
# engine.
#
# `scripts/generate-page-count.mjs --check` rebuilds `docs/page-count.md` from
# the engine and diffs it against the committed file. Same shape as
# print-resolution.sh, and the same command CI runs (`pnpm check:page-count`).
#
# Why it matters: "how do I get fewer pages?" has a counter-intuitive answer,
# and it had been measured once by hand and copied into a roadmap as a single
# pair of numbers -- which then disagreed with the engine. The table is now
# measured through `pageGridSize`, the same counting a real render uses. A stale
# table sends the next person trimming furniture that buys nothing.
#
# Requires a built atlas-core -- the script imports `packages/atlas-core/dist`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../lib/env.sh
. "$SCRIPT_DIR/../lib/env.sh"

cd "$REPO_ROOT" || exit 1

if [ ! -f packages/atlas-core/dist/index.js ]; then
  echo "FAIL: packages/atlas-core/dist missing (run 'pnpm -r build' first)"
  exit 1
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if node scripts/generate-page-count.mjs --check >"$log" 2>&1; then
  echo "PASS: $(head -1 "$log")"
  exit 0
fi

echo "FAIL: the committed page-count table no longer matches the engine"
sed 's/^/    /' "$log"
exit 1
