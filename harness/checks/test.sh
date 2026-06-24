#!/usr/bin/env bash
# harness/checks/test.sh -- run the fast TS test suite (vitest).
# NOTE: backend tests (`dotnet test`) use Testcontainers PostGIS and need a
# running Docker daemon; run them separately: dotnet test JourneyBook.slnx
set -euo pipefail
pnpm -r test >/dev/null 2>&1 \
  && echo "PASS: TS test suites (atlas-core, map-sources)" \
  || { echo "FAIL: TS tests failed (run 'pnpm -r test')"; exit 1; }
