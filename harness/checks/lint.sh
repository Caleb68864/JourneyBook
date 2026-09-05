#!/usr/bin/env bash
# harness/checks/lint.sh -- typecheck stands in for lint (no eslint configured yet)
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

if pnpm -r typecheck >"$log" 2>&1; then
  echo "PASS: TS typecheck (no eslint configured)"
else
  echo "FAIL: typecheck failed (run 'pnpm -r typecheck'):"
  tail -20 "$log" | sed 's/^/    /'
  exit 1
fi
