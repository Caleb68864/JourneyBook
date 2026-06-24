---
sub_spec_id: SS-01
phase: run
depends_on: []
dispatch: factory
---

# SS-01: Schema deltas + tile-source seed (one migration)

## Scope
Add `ImportantLocation.LocationNumber` (int) with a unique index `(ProjectId, LocationNumber)`, add `GeneratedPdf.ExpiresAt` (nullable `timestamptz`), seed one `usgs-topo` `TileSource`, then generate and verify exactly one EF migration. No services/endpoints. Wave 1 — gates SS-02/03/04.

## Shared Context
JourneyBook .NET 10 Clean Architecture; EF Core 10 + Npgsql + NetTopologySuite (PostGIS). Migrations project `dotnet/JourneyBook.Infrastructure`, startup `apps/api`. Entity configs use `IEntityTypeConfiguration<T>`. See `CLAUDE.md` and `docs/decisions/0002-backend-layering.md`.

## Implementation Steps (TDD)

1. **Domain edits.** Add `public int LocationNumber { get; set; }` to `dotnet/JourneyBook.Domain/Entities/ImportantLocation.cs`; add `public DateTimeOffset? ExpiresAt { get; set; }` to `dotnet/JourneyBook.Domain/Entities/GeneratedPdf.cs`.
2. **Config edits.** In `ImportantLocationConfiguration.cs` add `builder.Property(l => l.LocationNumber).HasDefaultValue(0);` (red-team A-1: keeps the NOT NULL add safe even against pre-existing rows) and `builder.HasIndex(l => new { l.ProjectId, l.LocationNumber }).IsUnique();`. In `GeneratedPdfConfiguration.cs` ensure `ExpiresAt` is mapped (default mapping is fine). In `TileSourceConfiguration.cs` **modify the existing** `builder.OwnsOne(t => t.Cache)` call to chain `.HasData(new { TileSourceId = …, MaxAgeSeconds = 86400, OfflineAllowed = false })` (red-team A-2: do NOT add a second `OwnsOne` — that won't compile); add `builder.HasData(new TileSource { … })` for the entity using fixed Guid `11111111-1111-1111-1111-111111111111`.
3. **Build.** `dotnet build JourneyBook.slnx --nologo` → 0 errors. Fix any nullability/mapping issues.
4. **Generate migration.** `dotnet ef migrations add Stage2Persistence -p dotnet/JourneyBook.Infrastructure -s apps/api`. Confirm a new migration appears under `dotnet/JourneyBook.Infrastructure/Migrations/` containing `LocationNumber`, `ExpiresAt`, the unique index, and an `InsertData` for the seeded tile source.
5. **Verify apply + regression.** `dotnet test JourneyBook.slnx --nologo` (Docker running) → green; `PostgisApiFactory` applies the migration on a fresh PostGIS container and the existing 14 tests pass.
6. **Commit.** `git commit -m "factory(SS-01): Stage2Persistence schema deltas + usgs-topo seed [factory-managed]"`.

## Interface Contracts

### JourneyBookDbContext schema (Stage2Persistence)
- Direction: SS-01 -> SS-02, SS-03, SS-04
- Owner: SS-01
- Shape: `ImportantLocation.LocationNumber: int` (+ unique `(ProjectId, LocationNumber)`), `GeneratedPdf.ExpiresAt: DateTimeOffset?`, seeded `TileSource` row `key="usgs-topo"`. SS-02 reads/writes `LocationNumber`; SS-03 lists the seeded source; SS-04 reads/writes `ExpiresAt`.

## Verification Commands
- Build: `dotnet build JourneyBook.slnx --nologo`
- Migration: `dotnet ef migrations add Stage2Persistence -p dotnet/JourneyBook.Infrastructure -s apps/api`
- Test: `dotnet test JourneyBook.slnx --nologo`

## Checks

| Criterion | Type | Command |
|-----------|------|---------|
| ImportantLocation declares LocationNumber | [STRUCTURAL] | `grep -q "int LocationNumber" dotnet/JourneyBook.Domain/Entities/ImportantLocation.cs \|\| (echo "FAIL: LocationNumber missing" && exit 1)` |
| GeneratedPdf declares ExpiresAt | [STRUCTURAL] | `grep -q "DateTimeOffset? ExpiresAt" dotnet/JourneyBook.Domain/Entities/GeneratedPdf.cs \|\| (echo "FAIL: ExpiresAt missing" && exit 1)` |
| Unique index on (ProjectId, LocationNumber) | [STRUCTURAL] | `grep -Eq "HasIndex.*LocationNumber.*IsUnique\|LocationNumber.*\.IsUnique" dotnet/JourneyBook.Infrastructure/Persistence/Configurations/ImportantLocationConfiguration.cs \|\| (echo "FAIL: unique index missing" && exit 1)` |
| usgs-topo seeded | [STRUCTURAL] | `grep -q "usgs-topo" dotnet/JourneyBook.Infrastructure/Persistence/Configurations/TileSourceConfiguration.cs \|\| (echo "FAIL: seed missing" && exit 1)` |
| Solution builds | [MECHANICAL] | `dotnet build JourneyBook.slnx --nologo 2>&1 \| tail -1 ; [ ${PIPESTATUS[0]} -eq 0 ] \|\| (echo "FAIL: build" && exit 1)` |
