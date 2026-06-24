# CLAUDE.md — JourneyBook

## What This Project Is

JourneyBook generates printable, true-to-scale land-navigation atlases (PDF) from a bounding box or saved locations and a chosen map scale — a kid-and-parent-friendly "road atlas that grows into Army land nav." Headless TypeScript geometry engine + .NET 10 API + React web app.

## Commands

- Build: `pnpm -r build && dotnet build JourneyBook.slnx --nologo`
- Test (TS): `pnpm -r test` · Test (backend, needs Docker): `dotnet test JourneyBook.slnx`
- Headless render: `node packages/render-cli/dist/cli.js render --location LNG,LAT --scale usgs-7-5-min --tier 2 --basemap --out atlas.pdf` (also `grid`, `validate`)
- Web dev: `pnpm dev:web` · API: `dotnet run --project apps/api` (needs PostGIS on :5433)
- Migration: `dotnet ef migrations add <Name> -p dotnet/JourneyBook.Infrastructure -s apps/api`

## Structure

- `packages/` — TS monorepo: `atlas-core` (geometry: scale/projection/grid/validation), `map-sources` (Web Mercator tile math + USGS panels), `pdf-client` (@react-pdf), `render-cli` (headless CLI), `ui`.
- `apps/web` — React 19 + Vite + Tailwind v4. `apps/api` — ASP.NET Core .NET 10 host.
- `dotnet/` — Clean Architecture libs: `JourneyBook.{Domain,Application,Infrastructure,Tests}`.
- `infra/` — Docker (db/api/web) + Compose. `vault/` — research + staged-build-roadmap. `docs/` — ADRs, specs, notes.

## Key Conventions

- TS `atlas-core` is the one source of truth for geometry (ADR 0004); never reimplement projection/grid/scale math in C#.
- Shared `AtlasContract` (scale, margins, pages[id/bbox/orientation/tier/neighbors]) flows engine → renderer/validator. Extend it, don't fork it.
- Backend feature pattern (Stage 2B): DTOs + `I<X>Service` (Application) → `<X>Service` over `JourneyBookDbContext` (Infrastructure, registered in `AddInfrastructure`) → minimal-API endpoints in `apps/api/Endpoints/<X>Endpoints.cs` → integration test via `PostgisApiFactory` (Testcontainers PostGIS). Geometry via `NtsGeometryServices.Instance.CreateGeometryFactory(4326)`.
- TS tests: vitest; `*.test.ts` excluded from the `tsc` build; engine modules import from the leaf `./model.js`, not the barrel `./index.js`.
- Map tiers: `MapTier` (1–4) on every page; furniture is additive per level; default Level 1 (road-atlas).

## Constraints

### Musts
- Backend integration tests run against real PostGIS via Testcontainers — Docker must be running.
- New headless capabilities must be reachable via `render-cli` before any UI exists.
- PostGIS geometry is SRID 4326 (NetTopologySuite `Point`/`Polygon`).

### Must-Nots
- Do not duplicate the TS projection/scale engine in C#.
- Do not import engine modules from the barrel `./index.js` inside `atlas-core` (use `./model.js`).

## Decision Log

Fixes, workarounds, and intentional trade-offs live in `docs/decisions.md`. A pre-commit hook scaffolds a `<FILL-IN>` entry on any code commit that lacks one, and blocks commits whose decisions.md still contains the sentinel.

**Never include secrets, tokens, connection strings, or PII in entries — this file is committed.**

When debugging, grep `docs/decisions.md` for the surface area (file path or module) before proposing a fix. Bypass (sparingly): `git commit --no-verify`.

## Harness

Project harness lives in `harness/`. Run before any work session:

```bash
bash harness/init.sh
for f in harness/checks/*.sh; do bash "$f"; done
```

<!-- logic-dev-graph:start -->
## Code graph — query first

This project has a whole-project code graph at the **project root**
(`<repo root>/graphify-out/graph.db` — SQLite, the default backend;
`graph.json` for the legacy json backend), built by logic-dev-kit. The graph
tools auto-anchor to the project root, so you can call them from any
subdirectory without passing a target path. Before searching the codebase,
query the graph instead of grepping:

- Call `query_graph` (the MCP tool) before `Grep`, `Glob`, or a broad `Read`
  when you are looking for a symbol, definition, caller, or where something is
  used. The graph answers from a compact, structured index instead of scanning
  the whole repo.
- **If the `query_graph` MCP tool is not available this session** (e.g. the MCP
  server didn't surface it — check your tool list), use the CLI front door via
  `Bash` instead — it is always available and behaves identically:
  `python -m logic_dev_kit.graph_cli query "<symbol>" --text-fallback`
  (also `neighbors`, `path`, `impact`, `stats` subcommands). With
  `--text-fallback` the query returns graph hits first, then automatically falls
  back to ripgrep — or a pure-Python text walk when `rg` isn't installed — for
  content the graph doesn't index. So the CLI alone is graph-first *with* grep
  fallback in one call; reach for raw `Grep` only when it returns nothing.
- Use `get_neighbors` and `shortest_path` to follow call/import relationships.
- Only fall back to `Grep`/`Glob` when the graph returns no hits (a graph miss
  means the symbol genuinely isn't indexed — grep is the correct fallback then).
- `build_project_graph` refreshes the graph. The graph also lazily refreshes on
  query when `project_graph.auto_refresh` is `lazy`, so it reflects uncommitted
  edits without a manual rebuild.

Prefer the graph: it is faster and far more token-efficient than a repo-wide
grep.
<!-- logic-dev-graph:end -->
