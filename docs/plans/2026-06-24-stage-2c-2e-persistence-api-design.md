---
date: 2026-06-24
topic: "Stage 2C-2E: important-locations API + location-page labels, tile-source registry, generated-PDF records + retention"
author: Caleb Bennett
status: evaluated
evaluated_date: 2026-06-24
tags:
  - design
  - stage-2c-2e
  - journeybook
---

# Stage 2C-2E: Persistence APIs (locations, tile-sources, generated-PDFs) -- Design

## Summary

Complete Phase B persistence by adding three CRUD/registry features over the existing Stage 2A schema, each following the proven Stage 2B feature pattern (DTOs -> `IXService` -> `XService`/DbContext -> minimal-API endpoints -> `PostgisApiFactory` integration tests). The work is structured so a **single foundation migration** lands first and the **three feature APIs then build in parallel** without touching EF Core's shared model snapshot.

## Approach Selected

**Approach A -- one schema migration first, then three parallel API features.** A foundation sub-spec adds every schema delta (location numbering, PDF expiry) plus the tile-source seed in one EF migration. The three feature sub-specs add only DTOs/services/endpoints/tests. This is the only approach that is safely parallelizable: EF Core regenerates one shared `JourneyBookDbContextModelSnapshot.cs`, so three workers each adding a migration would conflict. Serializing the schema change removes that hazard and matches Stage 2B exactly.

## Architecture

Two dependency-ordered waves (ideal for a dark-factory build):

```
Wave 1 (serial):
  SS0  Schema deltas + seed (ONE migration)
         - ImportantLocation.LocationNumber (int)      -> stable L-series labels
         - GeneratedPdf.ExpiresAt (timestamptz, null)  -> retention
         - seed TileSource "usgs-topo" (matches map-sources USGS_TOPO)

Wave 2 (parallel, all depend only on SS0):
  SS1 (2C)  Important-locations API + L-series labels
  SS2 (2D)  Tile-source registry API
  SS3 (2E)  Generated-PDF records API + retention/prune
```

All three features reuse the established layering and the `PostgisApiFactory` (Testcontainers PostGIS + WebApplicationFactory) acceptance harness. No new infrastructure. ADR 0004 holds throughout: the C# API persists metadata only; geometry/rendering stays in the TS `atlas-core`/`render-cli` engine.

## Components

**SS0 -- Schema + seed (Infrastructure)**
- One EF migration adding `LocationNumber` to `ImportantLocation` and `ExpiresAt` to `GeneratedPdf`; `IEntityTypeConfiguration` updates; `HasData` seed for the `usgs-topo` tile source (provider/url/attribution/maxZoom + owned cache policy mirroring `map-sources/panel.ts` `USGS_TOPO`).
- Owns: the schema delta and seed. Does NOT add services/endpoints.

**SS1 -- Locations (2C)**
- `ILocationService` (Application) + `LocationService` (Infrastructure) + `LocationDtos`.
- Endpoints nested under a project: `POST/GET /api/projects/{projectId}/locations`, `GET/PUT/DELETE /api/locations/{id}`.
- Owns: location CRUD; building the `Point` (4326) via `NtsGeometryServices`; assigning a **stable per-project L-series** (`LocationNumber = max(existing for project) + 1`; never renumber on delete); exposing `label` ("L1") and `referenceLabel` ("see page L1").
- Does NOT own: rendering the location page -- that is the TS engine's `buildLocationPage(center, scale, page, "L"+n, tier)`. `label` feeds that `id` param (the cross-language contract).

**SS2 -- Tile-source registry (2D)**
- `ITileSourceService` + `TileSourceService` + `TileSourceDtos`.
- Endpoints: `POST/GET /api/tile-sources`, `GET/PUT/DELETE /api/tile-sources/{id}`, `GET /api/tile-sources/by-key/{key}`.
- Owns: global (not project-scoped) registry CRUD; unique `key` enforcement; the owned `TileCachePolicy` round-trip; attribution.
- Does NOT own: tile fetching/proxy/caching (Stage 3) -- though the seeded `usgs-topo` row is what a future Stage 3 proxy and `renderMapPanel` will read instead of the current hardcoded constant.

**SS3 -- Generated-PDF records + retention (2E)**
- `IGeneratedPdfService` + `GeneratedPdfService` + `GeneratedPdfDtos`.
- Endpoints: `POST/GET /api/projects/{projectId}/generated-pdfs`, `GET/DELETE /api/generated-pdfs/{id}`, `PUT /api/generated-pdfs/{id}/status`, `POST /api/generated-pdfs/prune`.
- Owns: render-record lifecycle (`Pending` -> `Rendering` -> `Completed`/`Failed`), `FilePath`, the `jsonb` `SourceMetadataSnapshot`, `ExpiresAt` (default from config `GeneratedPdf:RetentionDays`, e.g. 30), and `PruneExpiredAsync` (deletes expired DB records + best-effort deletes the on-disk file under `data/generated/`).
- Does NOT own: invoking the renderer. A future render worker/endpoint creates the `Pending` record and flips status; that wiring is out of scope here (ADR 0004 seam).

## Data Flow

- **Locations:** client POSTs name + lng/lat (+ category/notes/confidence) to a project -> service builds `Point(4326)`, assigns next `LocationNumber`, persists -> response carries `label`/`referenceLabel`. The TS engine later consumes the location + scale to render an `L{n}` page.
- **Tile-sources:** admin POSTs/edits source rows; `renderMapPanel` (today) and the Stage 3 proxy (future) read them by key. Seeded `usgs-topo` works out of the box.
- **Generated-PDFs:** a render orchestrator (future) creates a `Pending` record, updates status + `FilePath` on completion, snapshots source metadata as jsonb. `prune` removes expired records and their files.

## Error Handling

- Unknown `projectId` on a nested create/list -> **404** (project must exist).
- Duplicate tile-source `key` -> **409 Conflict** (mirrors the unique index; surfaced as a `ProjectValidationException`-style typed error -> 4xx, consistent with Stage 2B's 400-on-bad-input).
- Invalid enum (category/confidence/status) or out-of-range lng/lat -> **400** with `{ error }`.
- `prune` is idempotent: returns a count; missing on-disk files are ignored (best-effort), never throws.
- Cascade: deleting a project already cascades to its locations and generated-PDFs (existing FK config) -- integration test asserts this still holds.

## Success Criteria

Each sub-spec is "done" when its `PostgisApiFactory` integration tests pass against real PostGIS, the full solution builds, and the existing 14 backend tests stay green.

- **SS0:** migration applies on a fresh PostGIS container; `ImportantLocation.LocationNumber` and `GeneratedPdf.ExpiresAt` columns exist; exactly one seeded `usgs-topo` tile source row is present; `dotnet build JourneyBook.slnx` clean.
- **SS1 (2C):** first location for a project returns `label "L1"`, second `"L2"`; `referenceLabel` reads "see page L1"; lng/lat round-trips through PostGIS `Point(4326)`; list-by-project, get, update, delete work; deleting L1 leaves L2 labeled "L2" (no renumber); unknown project -> 404.
- **SS2 (2D):** create/list/get/update/delete; duplicate `key` -> 409; `by-key` lookup works; seeded `usgs-topo` appears in the list; owned `cache` (maxAgeSeconds/offlineAllowed) round-trips.
- **SS3 (2E):** create record defaults to `Pending` with an `ExpiresAt` set from config; status update -> `Completed` + `FilePath`; list-by-project; `jsonb` `SourceMetadataSnapshot` round-trips; `prune` deletes records whose `ExpiresAt` is in the past and returns the count; deleting a project cascades to its records.

## Exclusions

- **No render endpoint that invokes the Node engine** (ADR 0004 -- rendering stays in `render-cli`/TS). SS3 stores records; it does not render.
- **No tile proxy or caching** (Stage 3). SS2 is registry CRUD + seed only.
- **No background/scheduled prune** -- pruning is a manual `POST /prune` endpoint call (a scheduler is later).
- **No geocoder wiring** (the `GeocodedFrom`/`GeocodeProvider` fields stay nullable; UI/geocode is Stage 9).
- **No web UI** (Phase C) and **no landmark/route entities** (Stage 6).
- **No re-implementation of location-page rendering** -- that already exists in `atlas-core` `buildLocationPage`.

## Open Questions

- **Prune file deletion scope:** delete both the DB record and the on-disk `data/generated/` artifact (design assumes yes, best-effort on the file). If artifacts should be retained for audit, prune should soft-delete instead -- would change SS3's prune semantics.
- **Default retention window:** design assumes `GeneratedPdf:RetentionDays = 30` via config. Confirm the number; it only changes a default, not the shape.

## Approaches Considered

- **A (selected) -- one migration first, then 3 parallel features.** Safe parallelization; matches 2B. Chosen.
- **B -- three vertical slices each with its own migration.** Conceptually clean but three parallel EF `ModelSnapshot` regenerations conflict; would force serial execution and lose the parallelism benefit.
- **C -- minimal (locations + tile-sources, defer generated-PDFs).** Smaller, but leaves 2E unbuilt and the retention story open; no real saving since SS3 mirrors the same cheap pattern.

## Commander's Intent

**Desired End State:** Four sub-specs land on the canonical branch. `dotnet build JourneyBook.slnx` is clean and `dotnet test JourneyBook.slnx` is green (existing 14 tests + new integration tests) against a Testcontainers PostGIS. The API exposes working locations, tile-source, and generated-PDF endpoints; a fresh DB migrates to the new schema with the `usgs-topo` source seeded and stable L-series labels.

**Purpose:** Finish Phase B persistence so the (later) web UI and render worker have a real metadata store — projects, the places that matter to a family, the basemap registry, and a record of every rendered atlas.

**Constraints:**
- MUST follow the Stage 2B pattern verbatim (DTOs → `IXService` → `XService`/DbContext registered in `AddInfrastructure` → minimal-API `apps/api/Endpoints` → `PostgisApiFactory` test).
- MUST NOT reimplement TS geometry/projection/grid math in C# (ADR 0004). Location-page *rendering* stays in `atlas-core`.
- MUST keep all geometry SRID 4326 via `NtsGeometryServices.Instance.CreateGeometryFactory(4326)`.
- MUST add exactly one migration, in SS0 only. SS1–SS3 MUST NOT run `dotnet ef migrations add` (single shared `ModelSnapshot`).
- MUST enforce L-series uniqueness with a DB unique index `(ProjectId, LocationNumber)` (gap fix).

**Freedoms:**
- The agent MAY choose internal method/variable names, test case design, and file organization within the established folders.
- The agent MAY add private helpers and DTO mapping however it likes, as long as the committed contracts below hold.

**Committed interface/contract defaults** (use these unless told otherwise):
- **Routes (SS1):** `POST /api/projects/{projectId}/locations`, `GET /api/projects/{projectId}/locations`, `GET|PUT|DELETE /api/locations/{id}`.
- **Routes (SS2):** `POST|GET /api/tile-sources`, `GET|PUT|DELETE /api/tile-sources/{id}`, `GET /api/tile-sources/by-key/{key}`.
- **Routes (SS3):** `POST|GET /api/projects/{projectId}/generated-pdfs`, `GET|DELETE /api/generated-pdfs/{id}`, `PUT /api/generated-pdfs/{id}/status`, `POST /api/generated-pdfs/prune`.
- **DTOs (records):**
  - `CreateLocationRequest(string Name, double Lng, double Lat, string Category = "Other", string? Notes = null, string SourceConfidence = "Unknown")`; `UpdateLocationRequest` same minus defaults.
  - `LocationResponse(Guid Id, Guid ProjectId, string Name, double Lng, double Lat, string Category, string? Notes, string SourceConfidence, int LocationNumber, string Label, string ReferenceLabel, string? GeocodedFrom, string? GeocodeProvider)` where `Label = $"L{LocationNumber}"`, `ReferenceLabel = $"see page L{LocationNumber}"`.
  - `TileCachePolicyDto(int MaxAgeSeconds, bool OfflineAllowed)`; `CreateTileSourceRequest(string Key, string Provider, string SourceUrl, string Attribution, int MaxZoom, TileCachePolicyDto Cache, string? Version = null, DateOnly? SourceDate = null)`; `TileSourceResponse(Guid Id, string Key, string Provider, string SourceUrl, string? Version, DateOnly? SourceDate, string Attribution, int MaxZoom, TileCachePolicyDto Cache)`.
  - `CreateGeneratedPdfRequest(string? SourceMetadataSnapshot = null)`; `UpdateGeneratedPdfStatusRequest(string Status, string? FilePath = null)`; `GeneratedPdfResponse(Guid Id, Guid ProjectId, string Status, string? FilePath, DateTimeOffset CreatedAt, DateTimeOffset? ExpiresAt, string? SourceMetadataSnapshot)`; `PruneResult(int Deleted)`.
- **Service signatures:** mirror `IProjectService` — `Task<T?> CreateAsync(Guid projectId, …Request, CancellationToken ct = default)` returning `null` when the parent project is missing (→ 404); `ListAsync(Guid projectId)`, `GetAsync(Guid id)`, `UpdateAsync`, `DeleteAsync(…)->bool`. Typed `…ValidationException` for bad input → 400; duplicate tile-source key → **409** (`Results.Conflict`).
- **SS0 migration `Stage2Persistence`:** `ImportantLocations.LocationNumber int NOT NULL`, unique index `(ProjectId, LocationNumber)`; `GeneratedPdfs.ExpiresAt timestamptz NULL`; seed one `TileSource` (fixed Guid `11111111-1111-1111-1111-111111111111`, key `usgs-topo`, provider `USGS`, url `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}`, attribution `USGS The National Map`, maxZoom 16, cache `{86400, false}`).
- **Config defaults:** `GeneratedPdf:RetentionDays = 30`, `GeneratedPdf:GeneratedDir = "data/generated"`. `ExpiresAt = CreatedAt + RetentionDays`. Prune best-effort-deletes the on-disk file; missing file never throws.

## Execution Guidance

**Observe:** `dotnet build JourneyBook.slnx --nologo` (0 errors); `dotnet test JourneyBook.slnx` (all green, incl. existing 14); the migration applying on the Testcontainers PostGIS in `PostgisApiFactory.InitializeAsync`.
**Orient:** copy `dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs`, `apps/api/Endpoints/ProjectEndpoints.cs`, and `dotnet/JourneyBook.Tests/Api/ProjectsApiTests.cs` as the templates. Reuse `PostgisApiFactory` (don't create a new one). Geometry via `NtsGeometryServices`.
**Escalate When:** a second migration seems necessary (means the wave structure broke); ADR 0004 would be violated (C# doing geometry/rendering); a new NuGet/library is needed beyond what's already referenced.
**Shortcuts (apply without deliberation):**
- Register each new service in `Infrastructure/DependencyInjection.cs` `AddInfrastructure` (`services.AddScoped<IXService, XService>()`).
- Map endpoints in a `…Endpoints.cs` `MapXEndpoints(this IEndpointRouteBuilder)` and call it from `Program.cs` next to `MapProjectEndpoints()`.
- Enum DTO fields are strings parsed with `Enum.TryParse<…>(value, ignoreCase: true, …)` (as in `ProjectService`).
- `*.test.ts` exclusion does not apply here (C#); xUnit `[Fact]`/`[Theory]`, `IClassFixture<PostgisApiFactory>`.

## Decision Authority

**Agent decides autonomously:** internal naming, DTO mapping helpers, test case design, file placement within established folders, error-message wording.
**Agent recommends, human approves:** any deviation from the committed routes/DTOs above; any second migration; any new NuGet dependency.
**Human decides:** scope changes (adding/removing a sub-spec), the retention-window default if it should differ from 30 days, whether prune should hard-delete vs. soft-delete artifacts.

## War-Game Results

**Most Likely Failure:** parallel workers regenerating the shared `JourneyBookDbContextModelSnapshot.cs` → merge conflict / drift. **Mitigation:** baked into the design — only SS0 migrates; SS1–SS3 add no migrations and run after SS0 (Wave 2).
**Scale Stress:** N/A (single-user home-server MVP). L-series `max+1` race is closed by the unique index (gap fix); a concurrent collision fails the insert rather than duplicating a label.
**Dependency Risk:** backend integration tests need a Docker daemon (Testcontainers). If absent, those tests are env-blocked — `forge-project.json.idempotency_env_fail_patterns` already lists the Docker connection error so the factory falls back to artifact presence; the build check still gates.
**Maintenance Assessment:** high — each feature is a near-verbatim copy of the documented Stage 2B trio, so a new developer recognizes the shape immediately.

## Evaluation Metadata
- Evaluated: 2026-06-24
- Cynefin Domain: Complicated (depth matches — known pattern, analysis-light)
- Critical Gaps Found: 0
- Important Gaps Found: 1 (resolved — L-series unique index)
- Suggestions: 2 (resolved — prune config, seed Guid)

## Next Steps
- [ ] Turn this design into a Forge spec (`/forge docs/plans/2026-06-24-stage-2c-2e-persistence-api-design.md`) with four sub-specs (SS0 serial; SS1-SS3 parallel).
- [ ] Red-team the spec (worker wiring, migration ordering, 409/404 paths).
- [ ] Run via dark factory (Wave 1: SS0; Wave 2: SS1/SS2/SS3 parallel), then `dotnet test` (needs Docker) to confirm Testcontainers acceptance.
