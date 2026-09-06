#!/usr/bin/env bash
# harness/init.sh -- idempotent environment setup
# Run before any work session to reach a testable state. Safe to re-run.
#
# Bootstraps its own tooling: pnpm is installed locally when missing (corepack,
# else a user-local npm prefix), because `npm install -g` is denied on a machine
# where the user does not own /usr. Missing .NET/Docker prerequisites are
# reported with the exact command to fix them rather than failing opaquely.
set -euo pipefail

echo "==> Harness init starting..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/env.sh
. "$SCRIPT_DIR/lib/env.sh"

# --- Git hooks ---
if [ -d scripts/hooks ]; then
  git config core.hooksPath scripts/hooks
  # A hook that is not executable is silently ignored by git, so the decision-log
  # enforcement would quietly stop running. Keep them executable.
  chmod +x scripts/hooks/* 2>/dev/null || true
fi

# --- Toolchain ---
echo "--> Resolving toolchain..."
if ! jb_ensure_pnpm; then
  echo "FAIL: pnpm is required to install dependencies."
  exit 1
fi

dotnet_ok=1
jb_check_dotnet || dotnet_ok=0

docker_ok=1
jb_check_docker || docker_ok=0

# --- Dependencies ---
echo "--> Installing dependencies..."
pnpm install --frozen-lockfile

if [ "$dotnet_ok" -eq 1 ]; then
  dotnet restore JourneyBook.slnx
  # Local tool manifest (.config/dotnet-tools.json) pins dotnet-ef, so the
  # documented `dotnet ef migrations add ...` works on a fresh clone.
  dotnet tool restore
else
  echo "    Skipping 'dotnet restore' (see the .NET remediation above)."
fi

# --- Verify ---
bash "$SCRIPT_DIR/checks/build.sh" || { echo "FAIL: build check failed after init"; exit 1; }

if [ "$docker_ok" -eq 0 ]; then
  echo "NOTE: Docker is unavailable, so backend integration tests"
  echo "      ('dotnet test JourneyBook.slnx') cannot run in this session."
fi

echo "==> Harness init complete."
