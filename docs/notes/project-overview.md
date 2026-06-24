---
date: 2026-06-24
project: "JourneyBook"
repo: "C:/Users/CalebBennett/Documents/GitHub/JourneyBook"
type: project-overview
tags:
  - project-docs
  - journeybook
---

# JourneyBook - Project Overview

## Tech Stack

- **TypeScript monorepo** — pnpm workspaces + TS project references (`tsc -b`), ESM, strict. vitest for tests. proj4, sharp, @react-pdf/renderer.
- **Backend** — ASP.NET Core **.NET 10**, Clean Architecture. EF Core 10 + Npgsql + NetTopologySuite. xUnit + Testcontainers + WebApplicationFactory.
- **Frontend** — React 19 + Vite + Tailwind v4 (CSS-first `@theme`).
- **Data** — Postgres + PostGIS (`postgis/postgis:16-3.4`).
- **Infra** — Docker Compose (db/api/web), nginx reverse proxy.

## Architecture

Risk-first, **headless-first**: a no-UI TypeScript engine produces true-to-scale, tier-aware printable PDF atlases (with real USGS map panels), validated, before any UI. The .NET API owns persistence/metadata over Postgres/PostGIS; per **ADR 0004** it does **not** duplicate the TS geometry engine. The web app (later) wires the proven engine + API to an interactive UI.

Pipeline (zero UI): `location/bbox + scale → page-centred TM projection → page grid → USGS tiles → composited panel → true-scale tier-aware PDF → validation harness`.

## Directory Structure

- `packages/atlas-core` — geometry: scale presets, true-scale projection, page-grid/location builders, `validateAtlas`, `MapTier`, the `AtlasContract`.
- `packages/map-sources` — Web Mercator tile math + `renderMapPanel` (USGS public-domain topo, via sharp).
- `packages/pdf-client` — `@react-pdf/renderer` headless PDF, tier-aware page furniture.
- `packages/render-cli` — the headless CLI (`grid` / `render` / `validate`).
- `packages/ui` — shared UI (Stage 4).
- `apps/web` — React/Vite/Tailwind app (branded hero shipped).
- `apps/api` — ASP.NET Core host (health + `/api/projects`).
- `dotnet/JourneyBook.{Domain,Application,Infrastructure,Tests}` — layered backend.
- `infra/` — Docker + Compose + db migrations dir. `vault/` — research + roadmap. `docs/` — ADRs (0001-0004), notes, specs.

## Key Patterns

- One shared cross-language contract: `AtlasContract`.
- Backend feature pattern (Stage 2B): DTOs + `I<X>Service` (Application) → `<X>Service`/DbContext (Infrastructure) → minimal-API endpoints → `PostgisApiFactory` integration test.
- TDD throughout the TS engine (vitest); EF Core code-first migrations.

## Entry Points

- `apps/api/Program.cs` (minimal API host).
- `packages/render-cli/src/cli.ts` (headless CLI).
- `apps/web/src/main.tsx` (web app).

## Configuration

- `forge-project.json` (build/test/factory config), `apps/api/appsettings.json` (`ConnectionStrings:Postgres`, `Database:MigrateOnStartup`, CORS), `.env.example` (Compose: DB_PORT 5433, ports).

## Undocumented Areas

- Web app beyond the hero shell (Stages 4-5, not built).
- Landmark/route subsystem (Stage 6 — entities not yet in schema).
