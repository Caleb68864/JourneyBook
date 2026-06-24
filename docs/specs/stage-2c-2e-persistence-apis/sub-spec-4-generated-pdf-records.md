---
sub_spec_id: SS-04
phase: run
depends_on: ['SS-01']
dispatch: factory
---

# SS-04: Generated-PDF records API + retention/prune

## Scope
Project-nested generated-PDF record lifecycle (`Pending`→`Rendering`→`Completed`/`Failed`), `jsonb` snapshot, `ExpiresAt` from config, and a manual prune. No migration.

## Shared Context
Copy the Stage 2B pattern. Reuse `PostgisApiFactory`. The `GeneratedPdf` entity exists with `PdfStatus`, `FilePath`, jsonb `SourceMetadataSnapshot`; requires SS-01's `ExpiresAt` column. Config in `apps/api/appsettings.json` under `"GeneratedPdf"`.

## Implementation Steps (TDD)
1. **Failing test.** `dotnet/JourneyBook.Tests/Api/GeneratedPdfsApiTests.cs`: create → 201 `Status=="Pending"` + non-null `ExpiresAt`; status→`Completed` persists `FilePath`; jsonb snapshot round-trips; `prune` removes a seeded-expired record and returns count; project delete cascades. `dotnet test` fails to compile.
2. **DTOs.** `dotnet/JourneyBook.Application/GeneratedPdfs/GeneratedPdfDtos.cs` (`CreateGeneratedPdfRequest`, `UpdateGeneratedPdfStatusRequest`, `GeneratedPdfResponse`, `PruneResult`).
3. **Interface.** `dotnet/JourneyBook.Application/GeneratedPdfs/IGeneratedPdfService.cs` — CRUD + `UpdateStatusAsync` + `PruneExpiredAsync(...) -> Task<int>`.
4. **Service.** `dotnet/JourneyBook.Infrastructure/GeneratedPdfs/GeneratedPdfService.cs` — inject `IConfiguration`; read `GeneratedPdf:RetentionDays` (default 30) + `GeneratedPdf:GeneratedDir` (default `data/generated`). Create: `Status=Pending`, `CreatedAt=UtcNow`, `ExpiresAt=CreatedAt+RetentionDays`. `UpdateStatusAsync` parses `Status` enum ignoreCase. `PruneExpiredAsync`: load records `ExpiresAt < UtcNow`, for each best-effort `try { if(FilePath!=null) File.Delete(Path.Combine(generatedDir, FilePath)); } catch {}`, remove, save, return count.
   **Path-traversal guard (red-team C-1):** before deleting, resolve and confine the path — `var full = Path.GetFullPath(Path.Combine(generatedDir, FilePath)); var root = Path.GetFullPath(generatedDir); if (full.StartsWith(root, StringComparison.Ordinal)) { try { File.Delete(full); } catch {} }`. Never delete a path that resolves outside `generatedDir` (a crafted `FilePath` like `../../…` must be skipped).
5. **Register + config.** `services.AddScoped<IGeneratedPdfService, GeneratedPdfService>();` in `DependencyInjection.cs`; add `"GeneratedPdf": { "RetentionDays": 30, "GeneratedDir": "data/generated" }` to `apps/api/appsettings.json`.
6. **Endpoints.** `apps/api/Endpoints/GeneratedPdfEndpoints.cs` — routes per master spec; `app.MapGeneratedPdfEndpoints();` in `Program.cs`.
7. **Green.** `dotnet test JourneyBook.slnx --nologo`.
8. **Commit.** `git commit -m "factory(SS-04): generated-PDF records + prune [factory-managed]"`.

## Interface Contracts
### Implements contract from SS-01
- Requires `GeneratedPdf.ExpiresAt` (DateTimeOffset?) from SS-01.

## Verification Commands
- Build: `dotnet build JourneyBook.slnx --nologo`
- Test: `dotnet test JourneyBook.slnx --nologo`

## Checks

| Criterion | Type | Command |
|-----------|------|---------|
| IGeneratedPdfService exists | [STRUCTURAL] | `test -f dotnet/JourneyBook.Application/GeneratedPdfs/IGeneratedPdfService.cs \|\| (echo "FAIL: IGeneratedPdfService missing" && exit 1)` |
| PruneExpiredAsync declared | [STRUCTURAL] | `grep -q "PruneExpiredAsync" dotnet/JourneyBook.Application/GeneratedPdfs/IGeneratedPdfService.cs \|\| (echo "FAIL: PruneExpiredAsync missing" && exit 1)` |
| Service registered | [STRUCTURAL] | `grep -q "AddScoped<IGeneratedPdfService, GeneratedPdfService>" dotnet/JourneyBook.Infrastructure/DependencyInjection.cs \|\| (echo "FAIL: not registered" && exit 1)` |
| Retention config present | [STRUCTURAL] | `grep -q "RetentionDays" apps/api/appsettings.json \|\| (echo "FAIL: retention config missing" && exit 1)` |
| Endpoints mapped | [STRUCTURAL] | `grep -q "MapGeneratedPdfEndpoints" apps/api/Program.cs \|\| (echo "FAIL: endpoints not mapped" && exit 1)` |
| Suite green | [MECHANICAL] | `dotnet test JourneyBook.slnx --nologo 2>&1 \| tail -1 ; [ ${PIPESTATUS[0]} -eq 0 ] \|\| (echo "FAIL: tests" && exit 1)` |
