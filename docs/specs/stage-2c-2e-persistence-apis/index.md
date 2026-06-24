---
type: phase-spec-index
master_spec: "docs/specs/2026-06-24-stage-2c-2e-persistence-apis.md"
date: 2026-06-24
sub_specs: 4
---

# Stage 2C-2E: Persistence APIs -- Phase Specs

Refined from [2026-06-24-stage-2c-2e-persistence-apis.md](../2026-06-24-stage-2c-2e-persistence-apis.md).

| Sub-Spec | Title | Dependencies | Phase Spec |
|----------|-------|--------------|------------|
| SS-01 | Schema deltas + tile-source seed | none | [sub-spec-1-schema-deltas.md](sub-spec-1-schema-deltas.md) |
| SS-02 | Important-locations API + L-series | SS-01 | [sub-spec-2-locations-api.md](sub-spec-2-locations-api.md) |
| SS-03 | Tile-source registry API | SS-01 | [sub-spec-3-tile-source-registry.md](sub-spec-3-tile-source-registry.md) |
| SS-04 | Generated-PDF records + retention | SS-01 | [sub-spec-4-generated-pdf-records.md](sub-spec-4-generated-pdf-records.md) |

## Waves

- **Wave 1 (serial):** SS-01 (one migration; gates the rest).
- **Wave 2 (sequential dispatch):** SS-02, SS-03, SS-04 — all depend only on SS-01. Each modifies `Program.cs` + `Infrastructure/DependencyInjection.cs`; the factory dispatches sub-specs sequentially to one canonical branch, so these shared-file edits append cleanly without conflict.

## Integration

No separate integration sub-spec is generated: each of SS-02/03/04 already carries a `dotnet test JourneyBook.slnx` acceptance criterion that runs the **full** suite (its own `PostgisApiFactory` tests + the existing 14), so cross-feature wiring (all endpoint groups mapped in `Program.cs`, all services registered, one shared migration) is verified end-to-end by the last sub-spec's green test run.

## Requirement Traceability Matrix

| Requirement | Covered By |
|-------------|-----------|
| R1: one migration (LocationNumber, ExpiresAt, seed) | SS-01 |
| R2: locations CRUD + stable L-series | SS-02 |
| R3: tile-source registry (unique key, by-key) | SS-03 |
| R4: generated-PDF records + prune | SS-04 |
| R5: SRID 4326 geometry; existing 14 tests green | SS-01 (regression), SS-02 (geometry) |

## Execution

Run `/forge-run docs/specs/2026-06-24-stage-2c-2e-persistence-apis.md` to execute all phase specs (point at the master spec; forge-run auto-detects linked phase specs).
Run with `--sub N` to execute a single sub-spec.
