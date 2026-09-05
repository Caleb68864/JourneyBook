#!/usr/bin/env bash
# harness/checks/test.sh -- run the fast TS test suite (vitest).
#
# NOTE: backend tests (`dotnet test`) use Testcontainers PostGIS and need a
# running Docker daemon; run them separately: dotnet test JourneyBook.slnx
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/env.sh
. "$SCRIPT_DIR/../lib/env.sh"

if ! jb_ensure_pnpm; then
  echo "FAIL: pnpm unavailable (run 'bash harness/checks/00-env.sh')"
  exit 1
fi

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if pnpm -r test >"$log" 2>&1; then
  echo "PASS: TS test suites (atlas-core, map-sources, render-cli, render-worker)"
else
  echo "FAIL: TS tests failed (run 'pnpm -r test'):"
  grep -E 'FAIL|✗|×|AssertionError|Error:' "$log" | head -15 | sed 's/^/    /'
  exit 1
fi
