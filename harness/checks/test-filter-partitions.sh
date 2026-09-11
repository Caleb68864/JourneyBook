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
# names -- rapid, capital, therapies, and here `AdminApiKeyGateTests`. Tests
# gating the admin API key, in namespace `JourneyBook.Tests`, needing no Docker,
# were being excluded from `dotnet-unit` and from the command CLAUDE.md tells a
# contributor without Docker to run.
#
# No count is written down here. The last version of this comment claimed the
# difference was "exactly those four", measured when the suite held 197 tests;
# by the time anyone read it the suite held 309 and the difference was ten. A
# number that has to be maintained by hand drifts away from the behaviour it
# describes, and prose drifting is how this check came to claim more than it did.
# The check DERIVES the difference and prints it; run it if you want the number.
#
# So this check does not care what the filter IS. It asserts the arithmetic:
#   (tests the unit job runs) + (tests it excludes) == (all tests)
# and that everything excluded really is in the integration namespace. Change the
# filter however you like; lose a test and the build says so.
#
# WHERE THE FILTER COMES FROM -- and why it is not written down here either.
# This check used to keep its own copy of the filter under a comment reading
# "keep in step with .github/workflows/ci.yml". That made it a guard against a
# rule maintained in two places, itself maintained in two places: changing the
# filter in the workflow -- the exact drift this check exists to catch -- left it
# passing on its private copy. Measured: with ci.yml reverted to
# `FullyQualifiedName!~Api`, the old script still reported
# `PASS: 216 unit + 93 integration == 309`.
#
# "Keep in step with X" is a confession, not a mechanism. The filter is now READ
# OUT OF ci.yml, so the workflow is the only place it exists and this check tests
# what CI actually runs. Every step below refuses rather than degrades: a missing
# workflow, a filter it cannot find, or more than one candidate all exit non-zero,
# because a partition check that runs an empty filter partitions nothing and says
# PASS.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

WORKFLOW=".github/workflows/ci.yml"
CONTRIBUTOR_DOC="CLAUDE.md"

# The namespace the `dotnet-integration` job exists for. This is NOT a copy of
# anything in ci.yml -- the workflow never states it -- it is this check's own
# definition of "a test that legitimately needs Docker". Anything excluded from
# the unit job that is not in here is a test nobody without Docker runs.
INTEGRATION_NAMESPACE='JourneyBook.Tests.Api.'

# --- Read the filter out of the workflow ------------------------------------
# One `--filter "..."` in the whole file today: the dotnet-unit job's. If a
# second filtered job ever appears this refuses, because guessing which one is
# the unit job is how a guard comes to police the wrong string.
extract_filter() {
  local file="$1" label="$2"
  if [ ! -f "$file" ]; then
    echo "FAIL: $label ($file) does not exist, so the filter could not be read." >&2
    return 1
  fi
  local found
  found=$(grep -oE -- '--filter "[^"]+"' "$file" | sed 's/^--filter "//; s/"$//')
  local n
  n=$(printf '%s\n' "$found" | grep -c . )
  if [ "$n" -ne 1 ]; then
    echo "FAIL: found $n '--filter \"...\"' occurrences in $file; expected exactly 1." >&2
    echo "      This check reads the filter from there rather than keeping a copy." >&2
    echo "      If a second filtered command is legitimate, teach this parser which" >&2
    echo "      one is the dotnet-unit job -- do not let it guess." >&2
    return 1
  fi
  printf '%s\n' "$found"
}

UNIT_FILTER=$(extract_filter "$WORKFLOW" "the CI workflow") || exit 1
DOC_FILTER=$(extract_filter "$CONTRIBUTOR_DOC" "the contributor doc") || exit 1

# Guard the parse itself: a filter that is not a FullyQualifiedName expression
# means the regex above matched something else, and every comparison below would
# then be measuring the wrong thing.
case "$UNIT_FILTER" in
  FullyQualifiedName*) ;;
  *)
    echo "FAIL: parsed '$UNIT_FILTER' out of $WORKFLOW, which is not a FullyQualifiedName filter."
    echo "      The parser matched something other than the unit job's test filter."
    exit 1
    ;;
esac

echo "filter read from $WORKFLOW: $UNIT_FILTER"

failed=0

# CLAUDE.md tells a contributor without Docker to run this filter, and that
# instruction is documentation that executes: if it drifts from CI, the suite a
# contributor runs locally is a weaker private variant of the gate, silently.
if [ "$DOC_FILTER" != "$UNIT_FILTER" ]; then
  echo "FAIL: $CONTRIBUTOR_DOC tells contributors to run a different filter from CI:"
  echo "      $WORKFLOW       : $UNIT_FILTER"
  echo "      $CONTRIBUTOR_DOC: $DOC_FILTER"
  failed=1
fi

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

if [ "$(( n_unit + n_excluded ))" -ne "$n_all" ]; then
  echo "FAIL: $n_unit unit + $n_excluded excluded != $n_all total"
  failed=1
fi

# Every excluded test must be a real integration test, i.e. in the namespace the
# integration job exists for. Anything else is a test nobody without Docker runs.
stray=$(printf '%s\n' "$excluded" | grep -v "^${INTEGRATION_NAMESPACE//./\\.}" | grep . || true)
if [ -n "$stray" ]; then
  n_stray=$(printf '%s\n' "$stray" | grep -c .)
  echo "FAIL: $n_stray test(s) excluded from the unit job but not integration tests:"
  # Quoted and line-wise: a parameterised test name contains spaces, and word
  # splitting here would report one test as several.
  printf '%s\n' "$stray" | sed 's/^/  /'
  echo "      These run only in dotnet-integration, so a contributor without Docker"
  echo "      never runs them. Rename the test or fix the filter in $WORKFLOW."
  failed=1
fi

if [ "$failed" -eq 0 ]; then
  echo "PASS: $n_unit unit + $n_excluded integration == $n_all total, and every excluded test is in $INTEGRATION_NAMESPACE"
fi
exit "$failed"
