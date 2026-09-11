#!/usr/bin/env bash
# harness/checks/migrations-current.sh -- the EF model and the migration history
# must agree.
#
# EF Core ships exactly one command that answers this -- `dotnet ef migrations
# has-pending-model-changes` -- and it ran nowhere: not in CI, not in the
# harness, not in any test. Nothing in this repository could tell you that a
# change to an entity, a `HasData` seed or an `IEntityTypeConfiguration` had no
# migration behind it. The failure that produces is not a red build; it is a
# deploy where `Database__MigrateOnStartup` applies every migration, reports
# success, and leaves the database a column or a seed row short of the model the
# code is compiled against.
#
# This repo has already paid for that once: the decision log records an orphaned
# `AddTileSourceKind` migration with no matching entity property and no
# ModelSnapshot update, found by hand.
#
# What this does NOT do, deliberately: compare the scale-preset seed against the
# copy baked into `20260624165320_InitialSchema.cs`. A preset added properly
# arrives in a NEW migration, leaving the initial one untouched and correct, so
# that comparison would refuse a legitimate change. The pending-model-changes
# check is the one that catches a preset added to `HasData` with no migration at
# all, which is the real hazard.
#
# REFUSAL MACHINERY. `dotnet ef` exits non-zero for two very different reasons:
# the model has drifted, or the probe never got far enough to look (no tool
# manifest, a design-time factory that throws, an unbuilt solution). Those must
# not report the same thing. Drift FAILS with the drift message; anything else
# exits with NO VERDICT and says so, because "the check could not run" being
# indistinguishable from "the check found drift" is how a green gate turns into
# a gate nobody trusts.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PROJECT=dotnet/JourneyBook.Infrastructure
STARTUP=apps/api

# The exact sentences EF prints. Matching on these rather than on the exit code
# alone is what separates a verdict from a failure to reach the subject.
CLEAN_MARKER='No changes have been made to the model since the last migration'
DRIFT_MARKER='Changes have been made to the model since the last migration'

if ! dotnet tool restore >/dev/null 2>&1; then
  echo "NO VERDICT: 'dotnet tool restore' failed, so dotnet-ef is not available."
  echo "            This check reached nothing; it is not a statement about the model."
  exit 2
fi

# Deliberately NOT --no-build. `dotnet ef` reads the model out of a compiled
# assembly, so with --no-build a stale DLL answers instead of the source in front
# of you -- and it answers about the model as it was. Measured while writing
# this: after reverting a seed change, --no-build still reported drift from the
# old build. A check that can be wrong in the reassuring direction is worse than
# no check. The build is a no-op in CI (the job builds immediately before) and
# about 7s from warm locally.
output=$(dotnet ef migrations has-pending-model-changes \
  --project "$PROJECT" --startup-project "$STARTUP" 2>&1)
status=$?

if printf '%s' "$output" | grep -qF "$CLEAN_MARKER"; then
  echo "PASS: the EF model matches the migration history."
  exit 0
fi

if printf '%s' "$output" | grep -qF "$DRIFT_MARKER"; then
  echo "FAIL: the EF model has changed since the last migration."
  echo
  printf '%s\n' "$output"
  echo
  echo "      Add a migration for it:"
  echo "        dotnet ef migrations add <Name> -p $PROJECT -s $STARTUP"
  echo "      An entity, a HasData seed or an IEntityTypeConfiguration changed with"
  echo "      no migration behind it. On deploy that is a database missing a column"
  echo "      or a seed row, with every migration reporting success."
  exit 1
fi

# Neither sentence appeared: the command did not answer the question.
echo "NO VERDICT: 'dotnet ef migrations has-pending-model-changes' exited $status"
echo "            without answering. This says nothing about the model."
echo
printf '%s\n' "$output"
echo
echo "      The solution failed to build, or the startup project no longer"
echo "      references Microsoft.EntityFrameworkCore.Design. Try:"
echo "        dotnet build JourneyBook.slnx"
exit 2
