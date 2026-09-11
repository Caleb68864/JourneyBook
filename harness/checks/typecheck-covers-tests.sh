#!/usr/bin/env bash
# harness/checks/typecheck-covers-tests.sh -- the static gate must actually see
# the test files.
#
# Every package tsconfig carried `exclude: ["**/*.test.ts"]` so the build would
# not emit test code into dist. But `typecheck` was `tsc --noEmit` against that
# same config, so no test file was ever typechecked -- a 100% blind spot over
# test code, in the only static gate this repo has. It hid nine real errors
# (unchecked index access in route.test.ts, an untyped fetch mock in
# panel.test.ts).
#
# The fix keeps tests out of the *build* (dist stays clean) and adds a
# tsconfig.test.json per workspace that includes them with `noEmit`. This check
# proves the program really contains the test files, by asking tsc what it
# loaded -- the same `--listFiles` evidence the audit used to prove the gap --
# rather than trusting that the config still says so.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Workspaces that own test files.
#
# Most need a separate `tsconfig.test.json` because their build config excludes
# `*.test.ts` so `dist` stays clean. `apps/web` does not: it emits nothing
# (`noEmit`) and its `include: ["src"]` already covers the tests, so its own
# config IS the test config. It was simply absent from this list, which meant
# the PASS line below claimed "every workspace" while never looking at the one
# workspace that now carries DOM tests.
WORKSPACES=(
  packages/atlas-core
  packages/map-sources
  packages/pdf-client
  packages/render-cli
  services/render-worker
  apps/web
)

# Workspaces whose main config already includes tests: config path, and the
# string their `typecheck` script must reference.
declare -A CONFIG_OVERRIDE=( [apps/web]=tsconfig.app.json )

failed=0

for ws in "${WORKSPACES[@]}"; do
  cfg="$ws/${CONFIG_OVERRIDE[$ws]:-tsconfig.test.json}"
  if [ ! -f "$cfg" ]; then
    echo "FAIL: $cfg is missing — $ws's tests are outside the static gate"
    failed=1
    continue
  fi

  # How many test files exist on disk vs how many tsc actually loaded.
  on_disk=$(find "$ws/src" -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$on_disk" -eq 0 ]; then
    echo "  skip: $ws has no test files"
    continue
  fi

  loaded=$(npx tsc -p "$cfg" --listFiles --noEmit 2>/dev/null \
    | grep -c "^$REPO_ROOT/$ws/src/.*\.test\.tsx\?$")

  if [ "$loaded" -lt "$on_disk" ]; then
    echo "FAIL: $ws typechecks $loaded of $on_disk test file(s) — the rest are unchecked"
    failed=1
  else
    echo "  ok: $ws — $loaded/$on_disk test file(s) in the typecheck program"
  fi

  # The typecheck script must actually run that config, or the file set above is
  # correct and still never evaluated. `apps/web` runs `tsc -b`, which resolves
  # tsconfig.json -> tsconfig.app.json, so the reference is indirect; what has to
  # be true there is that the script typechecks at all.
  if [ -n "${CONFIG_OVERRIDE[$ws]:-}" ]; then
    if ! grep -q '"typecheck"' "$ws/package.json"; then
      echo "FAIL: $ws has no typecheck script, so its tests are never evaluated"
      failed=1
    fi
  elif ! grep -q 'tsconfig.test.json' "$ws/package.json"; then
    echo "FAIL: $ws's typecheck script does not run tsconfig.test.json"
    failed=1
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "PASS: every workspace's test files are inside the typecheck program"
fi
exit "$failed"
