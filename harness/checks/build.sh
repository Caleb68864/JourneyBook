#!/usr/bin/env bash
# harness/checks/build.sh -- verify the monorepo + .NET solution build cleanly
set -euo pipefail
pnpm -r build >/dev/null 2>&1 && dotnet build JourneyBook.slnx --nologo >/dev/null 2>&1 \
  && echo "PASS: TS packages + .NET solution build" \
  || { echo "FAIL: build failed (run 'pnpm -r build' / 'dotnet build JourneyBook.slnx')"; exit 1; }
