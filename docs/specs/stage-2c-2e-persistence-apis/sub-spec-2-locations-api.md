---
sub_spec_id: SS-02
phase: run
depends_on: ['SS-01']
dispatch: factory
---

# SS-02: Important-locations API + L-series labels

## Scope
Project-nested CRUD for important locations with a stable per-project L-series (`L1`, `L2`, …) that never renumbers on delete. Mirror the Stage 2B trio. No migration.

## Shared Context
Copy the Stage 2B pattern: `dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs`, `apps/api/Endpoints/ProjectEndpoints.cs`, `dotnet/JourneyBook.Tests/Api/ProjectsApiTests.cs`. Reuse `PostgisApiFactory`. Geometry via `NtsGeometryServices.Instance.CreateGeometryFactory(4326).CreatePoint(new Coordinate(lng, lat))`. Requires SS-01's `LocationNumber` column.

## Implementation Steps (TDD)
1. **Failing test.** Create `dotnet/JourneyBook.Tests/Api/LocationsApiTests.cs` (copy `ProjectsApiTests`, `IClassFixture<PostgisApiFactory>`). First test: create a project, then `POST /api/projects/{id}/locations` → 201 with `Label == "L1"`; second create → `"L2"`. `dotnet test` → fails to compile (DTOs/endpoints absent).
2. **DTOs.** `dotnet/JourneyBook.Application/Locations/LocationDtos.cs` — records per master-spec Decisions (`CreateLocationRequest`, `UpdateLocationRequest`, `LocationResponse`).
3. **Interface.** `dotnet/JourneyBook.Application/Locations/ILocationService.cs` — methods per master-spec Decisions; `LocationValidationException`.
4. **Service.** `dotnet/JourneyBook.Infrastructure/Locations/LocationService.cs` — copy `ProjectService` shape. `CreateAsync` returns `null` if project missing; `LocationNumber = (await db.ImportantLocations.Where(l => l.ProjectId == projectId).Select(l => (int?)l.LocationNumber).MaxAsync()) ?? 0) + 1`; build `Point(4326)`; parse enums ignoreCase → `LocationValidationException` on bad value. Map to `LocationResponse` with `Label`/`ReferenceLabel`.
5. **Register.** Add `services.AddScoped<ILocationService, LocationService>();` to `dotnet/JourneyBook.Infrastructure/DependencyInjection.cs`.
6. **Endpoints.** `apps/api/Endpoints/LocationEndpoints.cs` — `MapLocationEndpoints(this IEndpointRouteBuilder)` with the routes; 404 when service returns null, 400 on `LocationValidationException` (copy `ProjectEndpoints` try/catch). Call `app.MapLocationEndpoints();` in `apps/api/Program.cs` next to `app.MapProjectEndpoints();`.
7. **Green.** `dotnet test JourneyBook.slnx --nologo` → all green (new tests + existing 14).
8. **Commit.** `git commit -m "factory(SS-02): important-locations API + L-series [factory-managed]"`.

## Interface Contracts
### Implements contract from SS-01
- Requires `ImportantLocation.LocationNumber` (int) + unique `(ProjectId, LocationNumber)` from SS-01.
### LocationResponse.Label
- Direction: SS-02 -> TS engine (`atlas-core` `buildLocationPage` id param) — cross-language, informational. Shape: `Label = "L" + LocationNumber`.

## Verification Commands
- Build: `dotnet build JourneyBook.slnx --nologo`
- Test: `dotnet test JourneyBook.slnx --nologo`

## Checks

| Criterion | Type | Command |
|-----------|------|---------|
| ILocationService exists | [STRUCTURAL] | `test -f dotnet/JourneyBook.Application/Locations/ILocationService.cs \|\| (echo "FAIL: ILocationService missing" && exit 1)` |
| LocationService registered | [STRUCTURAL] | `grep -q "AddScoped<ILocationService, LocationService>" dotnet/JourneyBook.Infrastructure/DependencyInjection.cs \|\| (echo "FAIL: not registered" && exit 1)` |
| Endpoints mapped | [STRUCTURAL] | `grep -q "MapLocationEndpoints" apps/api/Program.cs \|\| (echo "FAIL: endpoints not mapped" && exit 1)` |
| Tests exist | [STRUCTURAL] | `test -f dotnet/JourneyBook.Tests/Api/LocationsApiTests.cs \|\| (echo "FAIL: tests missing" && exit 1)` |
| Suite green | [MECHANICAL] | `dotnet test JourneyBook.slnx --nologo 2>&1 \| tail -1 ; [ ${PIPESTATUS[0]} -eq 0 ] \|\| (echo "FAIL: tests" && exit 1)` |
