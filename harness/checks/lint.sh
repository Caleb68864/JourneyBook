#!/usr/bin/env bash
# harness/checks/lint.sh -- typecheck stands in for lint (no eslint configured yet)
set -euo pipefail
pnpm -r typecheck >/dev/null 2>&1 \
  && echo "PASS: TS typecheck (no eslint configured)" \
  || { echo "FAIL: typecheck failed (run 'pnpm -r typecheck')"; exit 1; }
