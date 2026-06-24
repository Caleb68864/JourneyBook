# harness/checks/

Mechanical check scripts for JourneyBook. Each returns exit 0 (pass) / 1 (fail) with a one-line summary.

## Scripts

| Script | Verifies | Command |
|--------|----------|---------|
| build.sh | TS packages + .NET solution build | `pnpm -r build && dotnet build JourneyBook.slnx` |
| test.sh | TS test suites pass | `pnpm -r test` |
| lint.sh | TS typecheck (no eslint yet) | `pnpm -r typecheck` |

Backend tests (`dotnet test JourneyBook.slnx`) use Testcontainers PostGIS and require a running Docker daemon — run them separately, not in `test.sh`.

## Usage

```bash
for f in harness/checks/*.sh; do bash "$f"; done   # all
bash harness/checks/build.sh                        # one
```

## Adding checks

New `.sh` files must return exit 0/1, print `PASS: …` / `FAIL: …` as the last line, and be idempotent.
