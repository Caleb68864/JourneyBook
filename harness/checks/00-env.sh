#!/usr/bin/env bash
# harness/checks/00-env.sh -- preflight: are the tools this repo needs actually usable?
#
# Runs before the build/lint/test checks so a missing prerequisite reports itself
# as a prerequisite ("install the ASP.NET Core runtime") instead of surfacing as
# an opaque "FAIL: build failed" three checks later.
#
# pnpm and .NET are required (the monorepo and the API will not build without
# them). Docker is reported as a WARN, not a failure: the TS engine, the web app
# and the render worker all build and test without it - only the backend
# integration tests (Testcontainers PostGIS) need a live daemon.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/env.sh
. "$SCRIPT_DIR/../lib/env.sh"

failed=0

echo "  checking pnpm ..."
if jb_ensure_pnpm; then
  echo "  PASS: pnpm $(pnpm --version 2>/dev/null)"
else
  echo "  FAIL: pnpm unavailable"
  failed=1
fi

echo "  checking .NET ..."
if jb_check_dotnet; then
  echo "  PASS: .NET SDK $(dotnet --version 2>/dev/null) with ASP.NET Core runtime"
else
  echo "  FAIL: .NET cannot build apps/api"
  failed=1
fi

echo "  checking Docker ..."
if jb_check_docker; then
  echo "  PASS: Docker daemon reachable (backend integration tests can run)"
else
  echo "  WARN: Docker unavailable - skip 'dotnet test'; TS suites still run"
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: environment prerequisites"
else
  echo "FAIL: environment prerequisites (see remediation above)"
  exit 1
fi
