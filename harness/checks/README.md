# harness/checks/

Mechanical check scripts for JourneyBook. Each returns exit 0 (pass) / 1 (fail) with a one-line summary.

## Scripts

| Script | Verifies | Command |
|--------|----------|---------|
| build.sh | TS packages + .NET solution build | `pnpm -r build && dotnet build JourneyBook.slnx` |
| test.sh | TS test suites pass | `pnpm -r test` |
| lint.sh | TS typecheck (no eslint yet) | `pnpm -r typecheck` |
| secrets.sh | no local `.env` can reach a Docker build context | reads `.dockerignore` |
| golden-fixture.sh | the engine still reproduces `data/fixtures/sample-atlas.json` | `node scripts/regenerate-sample-atlas.mjs --check` (needs `pnpm -r build` first) |
| print-resolution.sh | the per-preset print-resolution table the scale picker shows (and `docs/print-resolution.md`) still matches the engine | `node scripts/generate-print-resolution.mjs --check` (needs `pnpm -r build` first) |
| migrations-current.sh | the EF model has a migration behind it | `dotnet ef migrations has-pending-model-changes` (needs no database) |

Backend tests (`dotnet test JourneyBook.slnx`) use Testcontainers PostGIS and require a running Docker daemon — run them separately, not in `test.sh`.

## Usage

```bash
for f in harness/checks/*.sh; do bash "$f"; done   # all
bash harness/checks/build.sh                        # one
```

## Adding checks

New `.sh` files must return exit 0/1, print `PASS: …` / `FAIL: …` as the last line, and be idempotent.

A check that can fail to *reach* its subject should say so instead of guessing: exit **2** with `NO VERDICT: …` when the probe never got far enough to have an opinion (`migrations-current.sh` does this when `dotnet ef` cannot run at all). "The check could not run" and "the check found a problem" are different facts, and a gate that reports them identically stops being read.
