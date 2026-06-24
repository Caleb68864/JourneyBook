# ADR 0004 — C# persistence vs. TS geometry seam

- Status: accepted
- Date: 2026-06-24

## Context

The atlas geometry engine (scale, page-centred projection, page-grid + location
derivation, true-scale validation) is implemented and thoroughly TDD'd in
TypeScript (`packages/atlas-core`). Stage 2 adds a C# API over Postgres/PostGIS.
The roadmap's "derive and persist a page grid" could imply re-deriving the grid
in C#.

## Decision

Do **not** duplicate the geometry engine in C#. Responsibilities split by layer:

- **C# API (`apps/api` + `dotnet/*`)** — owns persistence and metadata: projects,
  atlas extents (PostGIS geometry), grid *configuration* (scale preset,
  orientation, margins, overlap), important locations, tile sources, generated-
  PDF records.
- **TS `atlas-core`** — owns all geometry: projection, page-grid/location
  derivation, page IDs/neighbors, scale truth. Runs in the render pipeline
  (`render-cli` / future render worker).

Derived pages are produced by the TS engine. If they need to be persisted, the
engine writes them back through the API (a thin write endpoint), rather than C#
recomputing projection math.

## Rationale

- The projection/scale math is correctness-critical and was hardened with 26
  unit tests. A second C# implementation would inevitably drift and reintroduce
  the exact scale-truth bugs the engine was built to prevent.
- One source of truth for geometry; the API stays a thin, well-tested CRUD +
  persistence layer.

## Consequences

- Rendering and grid derivation require the Node engine, not just the API.
- A future "persist derived grid" feature is a write endpoint fed by the engine.
- Cross-language contract is the `AtlasContract` shape (TS) mirrored by the EF
  entities (C#); keep them aligned as the schema evolves.
