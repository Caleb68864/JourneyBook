#!/usr/bin/env bash
# harness/init.sh -- idempotent environment setup
# Run before any work session to reach a testable state. Safe to re-run.
set -euo pipefail

echo "==> Harness init starting..."

# --- Git hooks ---
if [ -d scripts/hooks ]; then
  git config core.hooksPath scripts/hooks
fi

# --- Dependencies ---
pnpm install --frozen-lockfile
dotnet restore JourneyBook.slnx

# --- Verify ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/checks/build.sh" || { echo "FAIL: build check failed after init"; exit 1; }

echo "==> Harness init complete."
