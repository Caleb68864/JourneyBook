# ADR 0001 — Foundation stack and skeleton

- Status: accepted
- Date: 2026-06-24
- Context: Stage 0 (Foundation Skeleton) from `vault/staged-build-roadmap.md`

## Context

Journey Book needs a skeleton that future stages build on without rework. The
roadmap locks a risk-first, headless-first build order: the no-UI atlas engine
must be buildable and testable before any theming. This ADR records the
concrete technology and structure decisions made while scaffolding that
skeleton.

## Decisions

### Monorepo: pnpm workspaces + TypeScript project references
One repo holds the web app, API, shared TS packages, and (later) the Android
app and render services. pnpm workspaces + `tsc -b` project references give
fast, incremental, dependency-ordered builds. The shared atlas contract lives
in `packages/atlas-core` and is consumed by every renderer.

### Backend: ASP.NET Core (.NET 10), Clean Architecture
The backend is split into layered projects (decided in ADR 0002) rather than a
single project. `apps/api` is the host; the layers live under `dotnet/`. .NET 10
is the installed LTS. Minimal-API style.

### Data access: EF Core + Npgsql + NetTopologySuite
EF Core (10.x) with the Npgsql provider and its NetTopologySuite integration
gives first-class PostGIS geometry mapping and migration support — the roadmap
requires "a first migration applied from the backend workflow." The Stage 0
`JourneyBookDbContext` has no entities yet; its only job is to enable the
`postgis` extension so geometry columns are available when Stage 2A adds tables.
Dapper remains available later for hot read paths if needed.

### Frontend: React 19 + Vite + Tailwind v4
`apps/web` is a Vite/React/TypeScript shell. Tailwind v4 uses the CSS-first
`@theme` block (no `tailwind.config.js`); brand tokens live in `src/index.css`.
shadcn/ui is deferred to the Stage 4 brand work. The Stage 0 shell proves the
web→API wiring via `/health` + `/health/db`.

### Headless render path: render-cli + @react-pdf/renderer (planned)
`packages/render-cli` is the no-UI entry point that will drive `atlas-core` +
`pdf-client` to render a validated atlas (Stages 1B–1E). `@react-pdf/renderer`
runs in Node, so the same page components render headlessly now and client-side
later. QuestPDF stays the documented fallback (Stage 8) if headless map-panel
rendering proves unreliable.

### Local orchestration: Docker Compose (db, api, web)
`postgis/postgis:16-3.4` for the database; api and web build from
`infra/docker/*.Dockerfile`. The web container's nginx reverse-proxies `/api`
and `/health` to the api service so the browser uses same-origin URLs. In dev
(`pnpm dev`), Vite's proxy does the same to `http://localhost:5180`.

## Consequences

- The headless engine, persistence, and tile services can all be built and
  verified before any UI/theming exists — matching the roadmap's stage order.
- One atlas contract feeds headless React-PDF now, browser preview later,
  optional QuestPDF, and eventually Android — no per-renderer layout model.
- PostGIS is available from the first migration, so Stage 2A can add geometry
  columns immediately.

## Ports (convention)

| Service | Dev (host)            | Container |
| ------- | --------------------- | --------- |
| web     | 5173 (Vite) / 8080    | 80        |
| api     | 5180                  | 8080      |
| db      | 5433                  | 5432      |

> The host DB port is 5433 (not 5432) to avoid clashing with a locally
> installed Postgres. Inside the compose network the api always reaches
> `db:5432`.
