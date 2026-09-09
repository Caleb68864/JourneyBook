#!/usr/bin/env bash
# harness/checks/compose-hardening.sh -- the documented run path must not ship a
# credential or a debug environment.
#
# infra/compose/docker-compose.yml IS the run path the README gives ("docker
# compose up --build"), so its defaults are what most people actually run. Two
# of them were wrong in a way no test could see: ASPNETCORE_ENVIRONMENT defaulted
# to Development (developer exception pages -- stack traces, file paths and
# framework versions -- served to anything that could reach the port), and
# POSTGRES_PASSWORD defaulted to "journeybook" on a host-published port, so every
# checkout of this repo knew the superuser password of every stack started from
# it.
#
# This check reads the compose file and the .env template the README tells people
# to copy, because fixing one and leaving the other still ships the weak config.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE="$REPO_ROOT/infra/compose/docker-compose.yml"
ENV_EXAMPLE="$REPO_ROOT/.env.example"

failed=0

if [ ! -f "$COMPOSE" ]; then
  echo "FAIL: $COMPOSE is missing"
  exit 1
fi

# 1. No default password anywhere. `${POSTGRES_PASSWORD:-...}` is the shipped
#    credential; `${POSTGRES_PASSWORD:?...}` is the required-variable form.
if grep -qE '\$\{POSTGRES_PASSWORD:-' "$COMPOSE"; then
  echo "FAIL: docker-compose.yml supplies a default POSTGRES_PASSWORD."
  echo "      A fallback password in a committed file is a published credential."
  echo "      Use \${POSTGRES_PASSWORD:?message} so compose refuses to start without one."
  grep -nE '\$\{POSTGRES_PASSWORD:-' "$COMPOSE" | sed 's/^/    /'
  failed=1
fi

# 2. Every use of the password must be the required form, including the api's
#    connection string -- a required db password with a defaulted connection
#    string still starts the api against the wrong credential.
password_uses=$(grep -cE '\$\{POSTGRES_PASSWORD' "$COMPOSE" || true)
required_uses=$(grep -cE '\$\{POSTGRES_PASSWORD:\?' "$COMPOSE" || true)
if [ "$password_uses" -ne "$required_uses" ]; then
  echo "FAIL: $password_uses POSTGRES_PASSWORD references but only $required_uses use the required (:?) form."
  failed=1
fi

# 3. Not Development by default.
if grep -qE '\$\{ASPNETCORE_ENVIRONMENT:-Development\}' "$COMPOSE"; then
  echo "FAIL: docker-compose.yml defaults ASPNETCORE_ENVIRONMENT to Development."
  echo "      The documented run path would serve developer exception pages."
  failed=1
fi

# 4. The Postgres port is for local inspection; the api reaches db:5432 on the
#    compose network. Publishing it on 0.0.0.0 exposes the database to the LAN.
if grep -qE '^\s*-\s*"\$\{DB_PORT:-[0-9]+\}:5432"' "$COMPOSE"; then
  echo "FAIL: the Postgres port is published on all interfaces."
  echo "      Bind it to loopback: \"127.0.0.1:\${DB_PORT:-5433}:5432\"."
  failed=1
fi

# 5. The README's setup step is `cp .env.example .env`, so a template carrying a
#    real-looking password or Development just reintroduces both defaults.
if [ -f "$ENV_EXAMPLE" ]; then
  if grep -qE '^POSTGRES_PASSWORD=.+' "$ENV_EXAMPLE"; then
    echo "FAIL: .env.example ships a POSTGRES_PASSWORD value; leave it empty so it must be set."
    failed=1
  fi
  if grep -qE '^ASPNETCORE_ENVIRONMENT=Development' "$ENV_EXAMPLE"; then
    echo "FAIL: .env.example sets ASPNETCORE_ENVIRONMENT=Development."
    failed=1
  fi
else
  echo "FAIL: .env.example is missing (the README's setup step copies it)"
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: compose ships no default DB password, no Development default, DB port on loopback"
fi
exit "$failed"
