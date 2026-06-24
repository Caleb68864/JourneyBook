# Stage 2C-2E: Persistence APIs (locations, tile-sources, generated-PDFs)

## Meta
- Client: (internal)
- Project: JourneyBook
- Repo: C:/Users/CalebBennett/Documents/GitHub/JourneyBook
- Date: 2026-06-24
- Author: Caleb Bennett
- Source design: docs/plans/2026-06-24-stage-2c-2e-persistence-api-design.md (evaluated)
- Quality scores (/35): Outcome 5 · Scope 5 · Decision guidance 5 · Edge coverage 4 · Acceptance criteria 5 · Decomposition 5 · Purpose alignment 4 = **33/35**

## Outcome

The JourneyBook .NET API gains three persistence features over the existing Stage 2A schema: important-locations (with stable L-series labels), a global tile-source registry, and generated-PDF records with retention/prune. Done means `dotnet build JourneyBook.slnx` is clean, `dotnet test JourneyBook.slnx` is green (existing 14 tests + new integration tests against Testcontainers PostGIS), and a fresh database migrates to the new schema with the `usgs-topo` source seeded.

## Intent

**Trade-off hierarchy:** consistency with the established Stage 2B pattern > cleverness. Every new service/endpoint/test should read as a near-verbatim sibling of `ProjectService`/`ProjectEndpoints`/`ProjectsApiTests`. Prefer the committed contracts in this spec over inventing new shapes.

**Decision boundaries (stop and ask):** if a second EF migration seems necessary (the wave structure has broken); if anything would require C# to do geometry/projection/rendering (violates ADR 0004); if a new NuGet package beyond those already referenced is needed.

## Context

JourneyBook is a printable land-nav atlas generator. The TS `atlas-core` engine owns all geometry; the .NET API owns persistence/metadata (ADR 0004). Stage 2A created the schema (entities `ImportantLocation`, `TileSource`, `GeneratedPdf`, etc.). Stage 2B established the feature pattern: DTOs + `I<X>Service` (Application) → `<X>Service` over `JourneyBookDbContext` (Infrastructure, registered in `AddInfrastructure`) → minimal-API endpoints in `apps/api/Endpoints/<X>Endpoints.cs` → integration test via `PostgisApiFactory` (Testcontainers PostGIS + WebApplicationFactory). See `CLAUDE.md` and `docs/decisions/0002-backend-layering.md` / `0004-persistence-vs-geometry-seam.md`.

## Requirements

1. A single EF migration (`Stage2Persistence`) adds `ImportantLocation.LocationNumber` (int) with a unique index `(ProjectId, LocationNumber)`, adds `GeneratedPdf.ExpiresAt` (nullable timestamptz), and seeds one `usgs-topo` `TileSource`. No other sub-spec adds a migration.
2. Locations API: nested CRUD under a project, assigning a stable per-project L-series (`L1`, `L2`, …) that never renumbers on delete, with `Point(4326)` geometry.
3. Tile-source registry API: global CRUD with a unique `key` (duplicate → 409) and a by-key lookup; the seeded `usgs-topo` is present.
4. Generated-PDF records API: lifecycle (`Pending`→`Rendering`→`Completed`/`Failed`), `jsonb` snapshot, `ExpiresAt` from config, and a manual `prune` that deletes expired records (best-effort deleting the on-disk artifact).
5. All new geometry uses SRID 4326 via `NtsGeometryServices`. Existing 14 backend tests stay green.

## Sub-Specs

---
sub_spec_id: SS-01
phase: run
depends_on: []
dispatch: factory
---

### 1. Schema deltas + tile-source seed (one migration)

- **Scope:** Add the two schema columns, the L-series unique index, and the seeded tile source — then generate and verify exactly one EF migration. No services or endpoints. This is Wave 1 and gates the others.
- **Files (modify):**
  - `dotnet/JourneyBook.Domain/Entities/ImportantLocation.cs`
  - `dotnet/JourneyBook.Domain/Entities/GeneratedPdf.cs`
  - `dotnet/JourneyBook.Infrastructure/Persistence/Configurations/ImportantLocationConfiguration.cs`
  - `dotnet/JourneyBook.Infrastructure/Persistence/Configurations/GeneratedPdfConfiguration.cs`
  - `dotnet/JourneyBook.Infrastructure/Persistence/Configurations/TileSourceConfiguration.cs`
- **Decisions:** Add `public int LocationNumber { get; set; }` to `ImportantLocation` and `public DateTimeOffset? ExpiresAt { get; set; }` to `GeneratedPdf`. In `ImportantLocationConfiguration`, add `builder.HasIndex(l => new { l.ProjectId, l.LocationNumber }).IsUnique();`. In `GeneratedPdfConfiguration`, map `ExpiresAt` (nullable). In `TileSourceConfiguration`, seed via `builder.HasData(new TileSource { Id = Guid.Parse("11111111-1111-1111-1111-111111111111"), Key = "usgs-topo", Provider = "USGS", SourceUrl = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}", Attribution = "USGS The National Map", MaxZoom = 16 });` and seed the owned `Cache` via `builder.OwnsOne(t => t.Cache).HasData(new { TileSourceId = Guid.Parse("11111111-1111-1111-1111-111111111111"), MaxAgeSeconds = 86400, OfflineAllowed = false });`. Generate the migration with `dotnet ef migrations add Stage2Persistence -p dotnet/JourneyBook.Infrastructure -s apps/api` (the timestamped files land under `dotnet/JourneyBook.Infrastructure/Migrations/`).
- **Acceptance criteria:**
  - `[MECHANICAL]` `dotnet ef migrations add Stage2Persistence -p dotnet/JourneyBook.Infrastructure -s apps/api` (after building) creates a migration; `dotnet build JourneyBook.slnx --nologo` exits 0.
  - `[STRUCTURAL]` `ImportantLocation.cs` declares `int LocationNumber` and `GeneratedPdf.cs` declares `DateTimeOffset? ExpiresAt`; `ImportantLocationConfiguration.cs` contains a unique `HasIndex` on `{ ProjectId, LocationNumber }`.
  - `[BEHAVIORAL]` `dotnet test JourneyBook.slnx --nologo` is green — the migration applies on the `PostgisApiFactory` PostGIS container and the existing 14 tests pass (no regression).
- **Dependencies:** none.

---
sub_spec_id: SS-02
phase: run
depends_on: ['SS-01']
dispatch: factory
---

### 2. Important-locations API + L-series labels

- **Scope:** Project-nested CRUD for important locations with stable L-series labels, mirroring the Stage 2B trio. No migration.
- **Files (new):**
  - `dotnet/JourneyBook.Application/Locations/LocationDtos.cs`
  - `dotnet/JourneyBook.Application/Locations/ILocationService.cs`
  - `dotnet/JourneyBook.Infrastructure/Locations/LocationService.cs`
  - `apps/api/Endpoints/LocationEndpoints.cs`
  - `dotnet/JourneyBook.Tests/Api/LocationsApiTests.cs`
- **Files (modify):**
  - `dotnet/JourneyBook.Infrastructure/DependencyInjection.cs`
  - `apps/api/Program.cs`
- **Decisions:** Records — `CreateLocationRequest(string Name, double Lng, double Lat, string Category = "Other", string? Notes = null, string SourceConfidence = "Unknown")`; `UpdateLocationRequest(string Name, double Lng, double Lat, string Category, string? Notes, string SourceConfidence)`; `LocationResponse(Guid Id, Guid ProjectId, string Name, double Lng, double Lat, string Category, string? Notes, string SourceConfidence, int LocationNumber, string Label, string ReferenceLabel, string? GeocodedFrom, string? GeocodeProvider)` where `Label = $"L{LocationNumber}"` and `ReferenceLabel = $"see page L{LocationNumber}"`. `ILocationService.CreateAsync(Guid projectId, CreateLocationRequest req, CancellationToken ct = default) -> Task<LocationResponse?>` returns `null` when the project doesn't exist (→ 404). `LocationNumber = (max existing for project) + 1`, starting at 1, never renumbered on delete. Build the point with `NtsGeometryServices.Instance.CreateGeometryFactory(4326).CreatePoint(new Coordinate(lng, lat))`. Enums parsed with `Enum.TryParse<LocationCategory|SourceConfidence>(value, ignoreCase: true, …)` → typed `LocationValidationException` (→ 400) on bad value. Routes: `POST|GET /api/projects/{projectId}/locations`, `GET|PUT|DELETE /api/locations/{id}`. Register `AddScoped<ILocationService, LocationService>()` in `AddInfrastructure`; call `app.MapLocationEndpoints()` in `Program.cs`.
- **Acceptance criteria:**
  - `[STRUCTURAL]` `ILocationService` exposes `CreateAsync(Guid projectId, CreateLocationRequest, CancellationToken) -> Task<LocationResponse?>`, `ListAsync(Guid projectId, …)`, `GetAsync(Guid id, …)`, `UpdateAsync(Guid id, UpdateLocationRequest, …)`, `DeleteAsync(Guid id, …) -> Task<bool>`; `LocationService` is registered in `AddInfrastructure`.
  - `[BEHAVIORAL]` `POST /api/projects/{id}/locations` returns 201 with `Label == "L1"`; a second returns `"L2"`; `ReferenceLabel == "see page L1"`. (Tested via `PostgisApiFactory`.)
  - `[BEHAVIORAL]` Lng/Lat round-trip through PostGIS `Point(4326)` (create then GET returns the same coordinates); unknown `projectId` → 404; deleting L1 leaves L2 still labeled `"L2"` (no renumber).
  - `[MECHANICAL]` `dotnet test JourneyBook.slnx --nologo` green.
- **Dependencies:** SS-01.

---
sub_spec_id: SS-03
phase: run
depends_on: ['SS-01']
dispatch: factory
---

### 3. Tile-source registry API

- **Scope:** Global (not project-scoped) CRUD for the tile-source registry with a unique key and by-key lookup. No migration.
- **Files (new):**
  - `dotnet/JourneyBook.Application/TileSources/TileSourceDtos.cs`
  - `dotnet/JourneyBook.Application/TileSources/ITileSourceService.cs`
  - `dotnet/JourneyBook.Infrastructure/TileSources/TileSourceService.cs`
  - `apps/api/Endpoints/TileSourceEndpoints.cs`
  - `dotnet/JourneyBook.Tests/Api/TileSourcesApiTests.cs`
- **Files (modify):**
  - `dotnet/JourneyBook.Infrastructure/DependencyInjection.cs`
  - `apps/api/Program.cs`
- **Decisions:** Records — `TileCachePolicyDto(int MaxAgeSeconds, bool OfflineAllowed)`; `CreateTileSourceRequest(string Key, string Provider, string SourceUrl, string Attribution, int MaxZoom, TileCachePolicyDto Cache, string? Version = null, DateOnly? SourceDate = null)`; `UpdateTileSourceRequest` same minus `Key`; `TileSourceResponse(Guid Id, string Key, string Provider, string SourceUrl, string? Version, DateOnly? SourceDate, string Attribution, int MaxZoom, TileCachePolicyDto Cache)`. `ITileSourceService.CreateAsync(CreateTileSourceRequest, CancellationToken) -> Task<TileSourceResponse>` throws `TileSourceValidationException` on duplicate `Key` (caught at the endpoint → `Results.Conflict`, 409). Add `GetByKeyAsync(string key, …) -> Task<TileSourceResponse?>`. Routes: `POST|GET /api/tile-sources`, `GET|PUT|DELETE /api/tile-sources/{id}`, `GET /api/tile-sources/by-key/{key}`. Register in `AddInfrastructure`; `app.MapTileSourceEndpoints()` in `Program.cs`.
- **Acceptance criteria:**
  - `[STRUCTURAL]` `ITileSourceService` exposes the CRUD methods plus `GetByKeyAsync(string, …) -> Task<TileSourceResponse?>`; `TileSourceService` registered in `AddInfrastructure`.
  - `[BEHAVIORAL]` `GET /api/tile-sources` includes the seeded `usgs-topo` row; `GET /api/tile-sources/by-key/usgs-topo` returns it with `Cache.MaxAgeSeconds == 86400`.
  - `[BEHAVIORAL]` Creating a second source with an existing `key` returns 409; the owned `Cache` (MaxAgeSeconds/OfflineAllowed) round-trips on create→GET.
  - `[MECHANICAL]` `dotnet test JourneyBook.slnx --nologo` green.
- **Dependencies:** SS-01.

---
sub_spec_id: SS-04
phase: run
depends_on: ['SS-01']
dispatch: factory
---

### 4. Generated-PDF records API + retention/prune

- **Scope:** Project-nested generated-PDF record lifecycle, jsonb snapshot, `ExpiresAt` from config, and a manual prune. No migration.
- **Files (new):**
  - `dotnet/JourneyBook.Application/GeneratedPdfs/GeneratedPdfDtos.cs`
  - `dotnet/JourneyBook.Application/GeneratedPdfs/IGeneratedPdfService.cs`
  - `dotnet/JourneyBook.Infrastructure/GeneratedPdfs/GeneratedPdfService.cs`
  - `apps/api/Endpoints/GeneratedPdfEndpoints.cs`
  - `dotnet/JourneyBook.Tests/Api/GeneratedPdfsApiTests.cs`
- **Files (modify):**
  - `dotnet/JourneyBook.Infrastructure/DependencyInjection.cs`
  - `apps/api/Program.cs`
  - `apps/api/appsettings.json`
- **Decisions:** Records — `CreateGeneratedPdfRequest(string? SourceMetadataSnapshot = null)`; `UpdateGeneratedPdfStatusRequest(string Status, string? FilePath = null)`; `GeneratedPdfResponse(Guid Id, Guid ProjectId, string Status, string? FilePath, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, string? SourceMetadataSnapshot)`; `PruneResult(int Deleted)`. On create: `Status = Pending`, `CreatedAt = UtcNow`, `ExpiresAt = CreatedAt + RetentionDays`. Config (in `appsettings.json` under a `"GeneratedPdf"` section): `RetentionDays = 30`, `GeneratedDir = "data/generated"`. `UpdateStatusAsync` parses `Status` to `PdfStatus` (enum, ignoreCase) and sets `FilePath`. `PruneExpiredAsync(…) -> Task<int>` deletes records with `ExpiresAt < UtcNow`; for each, best-effort delete of the artifact, **path-confined** (resolve `Path.GetFullPath(Path.Combine(GeneratedDir, FilePath))` and only `File.Delete` when it `StartsWith` the resolved `GeneratedDir` root) and wrapped in try/catch (missing file never throws; a `../` traversal in `FilePath` is skipped, not deleted). Routes: `POST|GET /api/projects/{projectId}/generated-pdfs`, `GET|DELETE /api/generated-pdfs/{id}`, `PUT /api/generated-pdfs/{id}/status`, `POST /api/generated-pdfs/prune`. Register in `AddInfrastructure`; `app.MapGeneratedPdfEndpoints()` in `Program.cs`.
- **Acceptance criteria:**
  - `[STRUCTURAL]` `IGeneratedPdfService` exposes `CreateAsync(Guid projectId, CreateGeneratedPdfRequest, …) -> Task<GeneratedPdfResponse?>`, `ListAsync(Guid projectId, …)`, `GetAsync(Guid id, …)`, `UpdateStatusAsync(Guid id, UpdateGeneratedPdfStatusRequest, …)`, `DeleteAsync(Guid id, …) -> Task<bool>`, `PruneExpiredAsync(…) -> Task<int>`; registered in `AddInfrastructure`.
  - `[BEHAVIORAL]` Create returns 201 with `Status == "Pending"` and a non-null `ExpiresAt`; `PUT …/status` to `Completed` with a `FilePath` persists; a `jsonb` `SourceMetadataSnapshot` round-trips on create→GET.
  - `[BEHAVIORAL]` `POST /api/generated-pdfs/prune` returns `{ deleted: N }` and removes records whose `ExpiresAt` is in the past (seed an expired record in the test); deleting a project cascades to its generated-PDF records.
  - `[MECHANICAL]` `dotnet test JourneyBook.slnx --nologo` green.
- **Dependencies:** SS-01.

## Edge Cases

- **"Stable L-series"** → on delete, do NOT renumber remaining locations; `LocationNumber` is assigned once at create as `max+1` and the unique index `(ProjectId, LocationNumber)` guards against a concurrent collision (the second insert fails rather than duplicating).
- **"Validates" / "invalid input"** → strict: reject unknown enum values (category/confidence/status) and missing parent project with a specific 4xx, never silently coerce.
- **"Prune"** → idempotent: returns a count; a missing on-disk artifact is ignored (best-effort delete in try/catch), never throws.
- **Duplicate tile-source key** → 409 Conflict (mirrors the unique index), not a 500.

## Out of Scope

- No render endpoint that invokes the Node engine (ADR 0004 — rendering stays in `render-cli`/TS). SS-04 stores records; it does not render.
- No tile proxy/caching (Stage 3). SS-03 is registry CRUD + seed only.
- No background/scheduled prune — prune is a manual `POST` endpoint.
- No geocoder wiring (`GeocodedFrom`/`GeocodeProvider` stay nullable; Stage 9).
- No web UI (Phase C); no landmark/route entities (Stage 6).
- No re-implementation of location-page rendering — `atlas-core` `buildLocationPage` already does it.

## Constraints

**Musts:**
- Follow the Stage 2B feature pattern verbatim (DTOs → `IXService` → `XService` registered in `AddInfrastructure` → `apps/api/Endpoints/<X>Endpoints.cs` → `PostgisApiFactory` test).
- Exactly one migration, in SS-01 only. All geometry SRID 4326 via `NtsGeometryServices`.
- Existing 14 backend tests stay green.

**Must-Nots:**
- Do not reimplement TS geometry/projection/grid math in C# (ADR 0004).
- Do not add a second EF migration in SS-02/03/04 (single shared `ModelSnapshot`).
- Do not create a new `PostgisApiFactory` — reuse the existing one.

**Preferences:**
- Prefer copying `ProjectService`/`ProjectEndpoints`/`ProjectsApiTests` over writing fresh.
- Prefer minimal-API endpoint groups (`MapGroup`) as in `ProjectEndpoints`.

**Escalation Triggers:**
- A second migration appears necessary, or a new NuGet package is needed, or ADR 0004 would be violated → stop and ask.

## Verification

End-to-end: on a fresh checkout with Docker running, `dotnet build JourneyBook.slnx` is clean and `dotnet test JourneyBook.slnx` is green — the `PostgisApiFactory` spins a PostGIS container, applies the `Stage2Persistence` migration (seeding `usgs-topo`), and the new `LocationsApiTests`, `TileSourcesApiTests`, and `GeneratedPdfsApiTests` exercise full CRUD + L-series + 409 + prune through real HTTP + PostGIS, alongside the existing 14 tests.

## Phase Specs

Refined by `/forge-prep` on 2026-06-24.

| Sub-Spec | Phase Spec |
|----------|------------|
| SS-01. Schema deltas + tile-source seed | `docs/specs/stage-2c-2e-persistence-apis/sub-spec-1-schema-deltas.md` |
| SS-02. Important-locations API + L-series | `docs/specs/stage-2c-2e-persistence-apis/sub-spec-2-locations-api.md` |
| SS-03. Tile-source registry API | `docs/specs/stage-2c-2e-persistence-apis/sub-spec-3-tile-source-registry.md` |
| SS-04. Generated-PDF records + retention | `docs/specs/stage-2c-2e-persistence-apis/sub-spec-4-generated-pdf-records.md` |

Index: `docs/specs/stage-2c-2e-persistence-apis/index.md`
