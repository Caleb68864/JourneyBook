#!/usr/bin/env bash
# harness/checks/test-filter-partitions.sh -- the two .NET CI jobs must, between
# them, run every test exactly once.
#
# `dotnet-unit` runs a filtered subset (the Docker-free tests) and
# `dotnet-integration` runs everything. A test that the unit filter excludes but
# that is not actually a Docker-gated integration test does not fail anything --
# it simply stops being part of the suite a contributor without Docker runs, in
# complete silence.
#
# That is not hypothetical. The filter was `FullyQualifiedName!~Api`. VSTest's
# `~` is a case-insensitive SUBSTRING match, and `Api` is a substring of ordinary
# names -- rapid, capital, therapies, and here `AdminApiKeyGateTests`. Four tests
# gating the admin API key, in namespace `JourneyBook.Tests`, needing no Docker,
# were being excluded from `dotnet-unit` and from the command CLAUDE.md tells a
# contributor without Docker to run. Measured: 197 total, 114 under `!~Api`, 118
# under `!~JourneyBook.Tests.Api.` -- a difference of exactly those four.
#
# So this check does not care what the filter IS. It asserts the arithmetic:
#   (tests the unit job runs) + (tests it excludes) == (all tests)
# and that everything excluded really is in the integration namespace. Change the
# filter however you like; lose a test and the build says so.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Keep in step with .github/workflows/ci.yml's dotnet-unit job.
UNIT_FILTER='FullyQualifiedName!~JourneyBook.Tests.Api.'
INTEGRATION_NAMESPACE='JourneyBook.Tests.Api.'

list() {
  if [ -z "${1:-}" ]; then
    dotnet test JourneyBook.slnx --no-build --list-tests 2>/dev/null
  else
    dotnet test JourneyBook.slnx --no-build --list-tests --filter "$1" 2>/dev/null
  fi | grep -E '^    [A-Za-z]' | sed 's/^    //' | sort -u
}

all=$(list "")
unit=$(list "$UNIT_FILTER")

n_all=$(printf '%s\n' "$all" | grep -c .)
n_unit=$(printf '%s\n' "$unit" | grep -c .)

# Guard the guard: a --list-tests that returns nothing would satisfy every
# comparison below by comparing nothing.
if [ "$n_all" -lt 50 ]; then
  echo "FAIL: --list-tests returned $n_all test(s); the suite could not be enumerated"
  echo "      (build the solution first: dotnet build JourneyBook.slnx)"
  exit 1
fi

excluded=$(comm -23 <(printf '%s\n' "$all") <(printf '%s\n' "$unit"))
n_excluded=$(printf '%s\n' "$excluded" | grep -c .)

failed=0

if [ "$(( n_unit + n_excluded ))" -ne "$n_all" ]; then
  echo "FAIL: $n_unit unit + $n_excluded excluded != $n_all total"
  failed=1
fi

# Every excluded test must be a real integration test, i.e. in the namespace the
# integration job exists for. Anything else is a test nobody without Docker runs.
stray=$(printf '%s\n' "$excluded" | grep -v "^${INTEGRATION_NAMESPACE//./\\.}" | grep . || true)
if [ -n "$stray" ]; then
  echo "FAIL: excluded from the unit job but not an integration test:"
  printf '  %s\n' $stray
  echo "      These run only in dotnet-integration, so a contributor without Docker"
  echo "      never runs them. Rename the test or fix the filter in ci.yml."
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: $n_unit unit + $n_excluded integration == $n_all total, and every excluded test is in $INTEGRATION_NAMESPACE"
fi
exit "$failed"
