#!/usr/bin/env bash
# harness/checks/print-check.sh -- the web app's print-check PDF still matches the
# renderer. The same command CI runs (`pnpm check:print-check`).
#
# Requires a built pdf-client -- the script imports `packages/pdf-client/dist`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT" || exit 1

if [ ! -f packages/pdf-client/dist/index.js ]; then
  echo "FAIL: packages/pdf-client/dist missing (run 'pnpm -r build' first)"
  exit 1
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if node scripts/generate-print-check.mjs --check >"$log" 2>&1; then
  echo "PASS: $(head -1 "$log")"
  exit 0
fi

echo "FAIL: the committed print-check PDF no longer matches the renderer"
sed 's/^/    /' "$log"
exit 1
