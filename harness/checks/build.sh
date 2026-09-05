#!/usr/bin/env bash
# harness/checks/build.sh -- verify the monorepo + .NET solution build cleanly
#
# Failures print the tail of the real compiler output. Swallowing it into
# /dev/null turned every breakage into a bare "FAIL: build failed", which hides
# whether the cause was a code error or a missing prerequisite.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/env.sh
. "$SCRIPT_DIR/../lib/env.sh"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
failed=0

if ! jb_ensure_pnpm; then
  echo "FAIL: pnpm unavailable (run 'bash harness/checks/00-env.sh')"
  exit 1
fi

if pnpm -r build >"$log" 2>&1; then
  echo "PASS: TS packages build"
else
  echo "FAIL: TS build failed (run 'pnpm -r build'):"
  tail -20 "$log" | sed 's/^/    /'
  failed=1
fi

if jb_check_dotnet; then
  if dotnet build JourneyBook.slnx --nologo >"$log" 2>&1; then
    echo "PASS: .NET solution builds"
  else
    echo "FAIL: .NET build failed (run 'dotnet build JourneyBook.slnx'):"
    grep -E 'error|Error' "$log" | head -10 | sed 's/^/    /'
    failed=1
  fi
else
  echo "FAIL: .NET prerequisites missing (run 'bash harness/checks/00-env.sh')"
  failed=1
fi

exit "$failed"
