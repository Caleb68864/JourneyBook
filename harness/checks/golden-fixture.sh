#!/usr/bin/env bash
# harness/checks/golden-fixture.sh -- the committed golden fixture still matches
# what the geometry engine produces for its recorded parameters.
#
# `data/fixtures/sample-atlas.json` is the atlas the print-validation harness must
# keep accepting, and `scripts/regenerate-sample-atlas.mjs --check` rebuilds it from
# `buildPageGrid` and diffs. Until this script existed, that command appeared in no
# package script, no CI job and no harness check: it ran when a human remembered.
#
# It is the only thing in the repo that runs the engine against the fixture
# byte for byte, and it catches a class of change nothing else does -- a grid step
# 2% too large leaves a strip of ground on no page at all between every adjacent
# pair, and the whole TS suite lost exactly one (incidental) assertion to it.
# `packages/atlas-core/src/fixture.test.ts` now makes the same comparison
# in-process; this keeps the formatting/key-order half honest, and keeps the
# session loop honest about running it.
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

if node scripts/regenerate-sample-atlas.mjs --check >"$log" 2>&1; then
  echo "PASS: golden fixture matches the engine ($(head -1 "$log"))"
  exit 0
fi

echo "FAIL: the engine no longer reproduces data/fixtures/sample-atlas.json"
sed 's/^/    /' "$log"
echo "    Do NOT just regenerate -- see the header of scripts/regenerate-sample-atlas.mjs."
exit 1
