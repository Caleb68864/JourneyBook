---
sub_spec_id: SS-03
phase: run
depends_on: ['SS-01']
dispatch: factory
---

# SS-03: Tile-source registry API

## Scope
Global (not project-scoped) CRUD for the tile-source registry with a unique `key` (duplicate → 409) and a by-key lookup. No migration.

## Shared Context
Copy the Stage 2B pattern (`ProjectService`/`ProjectEndpoints`/`ProjectsApiTests`). Reuse `PostgisApiFactory`. The `TileSource` entity already exists (owned `TileCachePolicy`). Requires SS-01's seeded `usgs-topo` row.

## Implementation Steps (TDD)
1. **Failing test.** `dotnet/JourneyBook.Tests/Api/TileSourcesApiTests.cs`: `GET /api/tile-sources` includes seeded `usgs-topo`; create dup key → 409; create+get round-trips `Cache`. `dotnet test` fails to compile.
2. **DTOs.** `dotnet/JourneyBook.Application/TileSources/TileSourceDtos.cs` (`TileCachePolicyDto`, `CreateTileSourceRequest`, `UpdateTileSourceRequest`, `TileSourceResponse`).
3. **Interface.** `dotnet/JourneyBook.Application/TileSources/ITileSourceService.cs` — CRUD + `GetByKeyAsync`; `TileSourceValidationException`.
4. **Service.** `dotnet/JourneyBook.Infrastructure/TileSources/TileSourceService.cs` — CRUD over `db.TileSources`; on create, if `await db.TileSources.AnyAsync(t => t.Key == req.Key)` throw `TileSourceValidationException` (dup key). Map owned `Cache` to/from `TileCachePolicyDto`.
5. **Register.** `services.AddScoped<ITileSourceService, TileSourceService>();` in `DependencyInjection.cs`.
6. **Endpoints.** `apps/api/Endpoints/TileSourceEndpoints.cs` — routes per master spec; catch `TileSourceValidationException` → `Results.Conflict(new { error })` (409). `app.MapTileSourceEndpoints();` in `Program.cs`.
7. **Green.** `dotnet test JourneyBook.slnx --nologo`.
8. **Commit.** `git commit -m "factory(SS-03): tile-source registry API [factory-managed]"`.

## Interface Contracts
### Implements contract from SS-01
- Requires the seeded `usgs-topo` `TileSource` row from SS-01 (asserted present by `GET /api/tile-sources`).

## Verification Commands
- Build: `dotnet build JourneyBook.slnx --nologo`
- Test: `dotnet test JourneyBook.slnx --nologo`

## Checks

| Criterion | Type | Command |
|-----------|------|---------|
| ITileSourceService exists | [STRUCTURAL] | `test -f dotnet/JourneyBook.Application/TileSources/ITileSourceService.cs \|\| (echo "FAIL: ITileSourceService missing" && exit 1)` |
| GetByKeyAsync declared | [STRUCTURAL] | `grep -q "GetByKeyAsync" dotnet/JourneyBook.Application/TileSources/ITileSourceService.cs \|\| (echo "FAIL: GetByKeyAsync missing" && exit 1)` |
| Service registered | [STRUCTURAL] | `grep -q "AddScoped<ITileSourceService, TileSourceService>" dotnet/JourneyBook.Infrastructure/DependencyInjection.cs \|\| (echo "FAIL: not registered" && exit 1)` |
| Endpoints mapped | [STRUCTURAL] | `grep -q "MapTileSourceEndpoints" apps/api/Program.cs \|\| (echo "FAIL: endpoints not mapped" && exit 1)` |
| Suite green | [MECHANICAL] | `dotnet test JourneyBook.slnx --nologo 2>&1 \| tail -1 ; [ ${PIPESTATUS[0]} -eq 0 ] \|\| (echo "FAIL: tests" && exit 1)` |
