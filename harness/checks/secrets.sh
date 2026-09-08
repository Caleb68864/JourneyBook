#!/usr/bin/env bash
# harness/checks/secrets.sh -- no local .env can reach a Docker build context.
#
# The README's setup step is `cp .env.example .env`, and both web.Dockerfile and
# render-worker.Dockerfile `COPY . .` from the repo root, so a .dockerignore that
# does not exclude .env bakes real credentials into two published images. This
# check evaluates the .dockerignore rules the way Docker does (last matching
# pattern wins) against the paths that matter.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IGNORE_FILE="$REPO_ROOT/.dockerignore"

if [ ! -f "$IGNORE_FILE" ]; then
  echo "FAIL: .dockerignore is missing — a Docker build context would include every local file"
  exit 1
fi

# Decide whether Docker would exclude PATH, honouring '!' re-includes and the
# last-match-wins rule. Patterns are shell globs; '**/' means "any depth".
would_exclude() {
  local target="$1" line pattern verdict=excluded_no
  while IFS= read -r line; do
    line="${line%%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    pattern="$line"
    local negated=no
    case "$pattern" in '!'*) negated=yes; pattern="${pattern#!}" ;; esac

    local matched=no
    # shellcheck disable=SC2254
    case "$target" in $pattern) matched=yes ;; esac
    if [ "$matched" = no ]; then
      case "$pattern" in
        '**/'*)
          local bare="${pattern#**/}"
          # shellcheck disable=SC2254
          case "$target" in $bare|*/"$bare") matched=yes ;; esac
          ;;
      esac
    fi

    if [ "$matched" = yes ]; then
      if [ "$negated" = yes ]; then verdict=excluded_no; else verdict=excluded_yes; fi
    fi
  done < "$IGNORE_FILE"
  [ "$verdict" = excluded_yes ]
}

fail=0

for secret in .env .env.local .env.production apps/web/.env services/render-worker/.env; do
  if ! would_exclude "$secret"; then
    echo "FAIL: .dockerignore would let '$secret' into the build context"
    fail=1
  fi
done

# The committed template must still reach the context — it is documentation, and
# excluding it would break nothing loudly but silently change what ships.
for template in .env.example apps/web/.env.example; do
  if would_exclude "$template"; then
    echo "FAIL: .dockerignore excludes the committed template '$template'"
    fail=1
  fi
done

# A real .env must never be tracked either.
if git -C "$REPO_ROOT" ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "FAIL: .env is tracked in git"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

echo "PASS: local .env files are kept out of Docker build contexts (template still included)"
