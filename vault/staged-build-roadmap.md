---
title: "Staged Build Roadmap"
category: "summary"
status: researched
priority: high
related:
  - "Recommended Stack"
  - "Recommended Architecture"
  - "MVP Plan"
  - "Branding Theme"
  - "PDF Rendering Strategy"
  - "Web App With Backend Renderer"
  - "PMTiles"
  - "Self-Hosted Tile Servers"
  - "Planetiler"
  - "Offline Map Storage"
  - "Important Location Pages"
  - "Android Atlas App"
  - "TC 3-25.26 Part 1 Map Reading and Land Navigation"
source_urls:
  - "https://react.dev/learn"
  - "https://vite.dev/guide/"
  - "https://ui.shadcn.com/docs/installation/vite"
  - "https://tailwindcss.com/docs/installation/using-vite"
  - "https://ui.shadcn.com/docs/theming"
  - "https://maplibre.org/maplibre-gl-js/docs/"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://docs.protomaps.com/pmtiles/"
  - "https://docs.protomaps.com/guide/getting-started"
  - "https://postgis.net/documentation/"
  - "https://developer.android.com/guide"
  - "https://www.armywriter.com/board/references/TC3-25x26-Part1.pdf"
  - "https://www.usgs.gov/faqs/how-much-area-does-a-usgs-topographic-map-cover"
---

# Staged Build Roadmap

This roadmap turns Journey Book into a buildable sequence. The MVP target is a Docker-hosted web app on the home server with a React/Vite/shadcn/Tailwind frontend, an ASP.NET Core C# backend, Postgres/PostGIS for project metadata, preferred client-side React PDF rendering, and device-side browser tile caching.

The build order is deliberately **risk-first and headless-first**: the riskiest unknowns (true print scale, projection, PDF fidelity, attribution survival) are proven by a no-UI engine before any visual theming exists. This lets an autonomous builder (Dark Factory) produce and validate the core engine before the brand/hero work begins.

## Current Status (2026-06-25)

**Phase A (headless engine), Phase B (persistence), Stage 3 (tile proxy), and Phase C (first usable web UI) are all complete.** The product now runs end-to-end in a browser. Built and verified:

- ✅ **Stage 0** — monorepo skeleton, layered .NET 10 backend, Docker Compose, branded web shell.
- ✅ **Stage 1B** — scale + per-page true-scale projection + page-grid/location engine (`atlas-core`, TDD).
- ✅ **Stage 1C** — headless USGS topo map-panel renderer (`map-sources`; ADR 0003).
- ✅ **Stage 1D** — headless tier-aware PDF composition (`pdf-client`, `@react-pdf/renderer`).
- ✅ **Stage 1E** — print-validation harness (`validateAtlas`, golden fixture, 1-inch calibration tick).
- ✅ **Stage 2A** — Postgres/PostGIS schema + EF Core `InitialSchema` migration + seeded scale presets.
- ✅ **Stage 2B** — Project + extent CRUD API (Testcontainers PostGIS integration tests).
- ✅ **Stage 2C** — important-locations API + stable L-series labels (Point 4326).
- ✅ **Stage 2D** — tile-source registry (unique key → 409, by-key lookup, seeded `usgs-topo`).
- ✅ **Stage 2E** — generated-PDF records + retention + path-confined prune.
- ✅ **Stage 3** — tile proxy + per-device cache + **PMTiles reader** (`/api/tiles/{source}/{z}/{x}/{y}`, raster/PMTiles dispatch on the Stage 2D `Kind`, ETag/Cache-Control/attribution, `--tile-base-url` CLI). Hand-built after a factory `partial_success` (see `docs/decisions.md`).
- ✅ **Stage 4** — brand/visual system hardened: shadcn/ui primitives, shared `@journeybook/ui` tokens (forest/parchment/campfire + Saira Stencil / Source Sans 3 / Spline Mono), `pdf-client` furniture aligned to the same tokens.
- ✅ **Stage 5** — React web app: project list, MapLibre preview (wired to the tile proxy), scale + tier pickers (bound to `SCALE_PRESETS`/`MapTier`), bbox draw/enter, important-location drop/edit, **Generate + download**. Rendering goes through a dedicated **Node `render-worker`** (Fastify wrapping `renderAtlas`) that the C# API proxies to — geometry/render stays in TS (ADR 0004/0005).
- ✅ **Stage 6B — Level 3 (USNG grid)** — self-generated 1000 m USNG/MGRS grid overlay on tier-3 pages: `createUtmProjector` (atlas-core) + the shared `lngLatToPanelFraction` (map-sources), `buildUsngGrid` → `UsngGridOverlay`, an SVG overlay + USNG collar in `pdf-client`, wired through `renderAtlas`. Built by the **dark factory**, then driven to **CONVERGED** by `/forge-converge` (6 passes — caught a *linear* panel-mapping false positive that would mis-register the grid, and made `buildUsngGrid` self-degrade on bad coords), and verified live (tier-3 CLI + Docker). Georeferenced-correct against `mgrs`. **Level 4 (full MGRS + declination) is still deferred.**
- ✅ **Combined render (page per location)** — `renderAtlas` now composes the bbox grid **plus** a fixed-scale `L#` page per saved location (was single-mode: an extent dropped all locations). Verified live under Docker (extent-only → 2 pages; extent + 2 locations → 4). See [Planned Enhancements](#planned-enhancements--locations-extent--route-atlases-user-requested-post-phase-c).

**Phase C** was built by the **dark factory** (SS-01–06), then driven to **CONVERGED** by `/forge-converge` (3 passes — caught missing tests, a C#→worker wire-contract mismatch, and web↔API contract drift), **hardened** (10 adversarial passes — input validation, error mapping, cancellation safety, SSRF/page-count caps, map-crash guards, observability), had its **Docker images repaired** (all three were broken — the factory only ran `compose config`, never `docker build`), and was **verified end-to-end**: full `create → extent → render → download` round-trip under `docker compose up` (4 healthy containers) + a passing Playwright UI smoke test. See `docs/decisions.md` (Phase C entries + ADR 0004/0005).

The headless pipeline still runs with **zero UI** (`journeybook render … --out atlas.pdf`); the same `renderAtlas` now also backs the web app via the render-worker.

**Test tally:** atlas-core 28 · map-sources 26 · render-cli 13 · render-worker 6 · backend **71** — all green. Merged to `master` (Stage 6B Level 3 + combined-render on top of the Phase C merge).

**Next (decided): all six map-generation options are now built and live** (tier work stays parked; Level 4 deferred): per-location zoom, the page-per-location combined render, CSV import, box→location, locations→bbox, and the **route atlas** (the last one, built via the full forge chain). After this: Stage 6 (landmarks + simple routes) → Stage 7 (PMTiles offline packages + optional self-hosted tile server) → Stage 9 (MVP polish: geocode search, project rename/duplicate, error UX). Stage 8 (QuestPDF) stays conditional; Stages 10–11 are post-MVP.

## Planned Enhancements — Locations, Extent & Route Atlases (user-requested, post-Phase-C)

Concrete features requested after the first usable UI shipped. They build on the existing seams (Stage 2C locations API, the extent-driven page grid, the location-page render mode) and mostly slot into Stages 5/6/9 — captured here so they aren't lost.

- ✅ **Box → location.** *(DONE 2026-06-25.)* The pending-box confirm bar has a **"Save Centre as Location"** button that creates an important location at the drawn/previewed box's centre (auto-named `Area N`) instead of setting the project extent — reusing the existing preview/confirm flow + Stage 2C locations API. Verified live (Playwright): a previewed box → L3 "Area 3" at the exact centre.
- ✅ **Locations → bounding box (trip-covering atlas).** *(DONE 2026-06-25.)* An **"Enclose N Locations"** button computes the bbox enclosing *all* saved locations (padded 5% / min 0.02° so points aren't on the edge and a single point still yields a usable box) and stages it as a **pending box for review** (so the page-count guard + confirm flow apply) before it becomes the project extent via `PUT /extent`. Verified live: enclosing 2 locations → a padded box → confirm → persisted extent.
- ✅ **Locations → route atlas (page per stop along the route).** *(DONE 2026-06-25, via the full forge chain — brainstorm → spec → red-team → dark-factory build.)* With locations in L-series order, a **route** render mode produces one atlas = a fixed-scale **location page per stop** (`L#`) **plus corridor pages** (`R#`) tiled along the straight-line polyline between consecutive stops, near-coincident pages de-duplicated, the route polyline + stop markers drawn on corridor pages — all under `MAX_ATLAS_PAGES` (a long route fails fast with a clear over-limit error). Geometry is a new pure `buildRouteAtlas` in `atlas-core` (ADR 0004); the path source is behind a seam so real road routing can drop in later (OSRM/Valhalla deferred). Reachable headlessly via `render-cli` (`--route`, repeatable `--location`) and a **"Generate Route Atlas"** toggle in the web app. Verified: atlas-core route tests (corridor tiling + dedup), render-cli route test (L#+R# + page cap), .NET route-flag forwarding, headless CLI (2 stops → L1,L2,R1–R7), and a live Docker round-trip (3 stops: route off → 3 pages, route on → 9). The dark-factory run finished `partial_success` (rate-limit-throttled gap-sweep + an uncommitted SS-02 residue); recovered + the corridor-page cap perf-fixed by hand. See `docs/decisions.md`.
- ✅ **CSV import for locations (+ a sample CSV).** *(DONE 2026-06-25, full vertical slice.)* `POST /api/projects/{id}/locations/import` takes CSV text, parses it server-side (`LocationCsv` — header-by-name; columns `name,lng,lat[,notes][,scale]`, case-insensitive, quoted-comma-safe), validates every row + per-location scale **all-or-nothing**, bulk-creates continuing the L-series, and returns the created locations. The web location panel has an **Import CSV** upload; a committed sample at `data/fixtures/sample-locations.csv` (5 stops, mixed per-location zoom). Verified live: importing the sample → 5 locations → a **5-page tier-2 atlas** with mixed per-location scale. Pairs with per-location zoom (the `scale` column sets each location's zoom). See `docs/decisions.md`.
- ✅ **Render a location page per saved location (combined atlas).** *(Bug → feature — DONE 2026-06-25.)* `renderAtlas` now composes the bbox grid **plus** a fixed-scale `L#` page for *each* saved location into one `AtlasContract` (grid `A1/B2…` + location `L1/L2…` ids, never colliding); `HttpRenderWorkerClient.ToWirePayload` forwards *all* locations (was bbox-or-first-only); `MAX_ATLAS_PAGES` enforced over the combined count; basemap panels + tier-3 USNG grids cover the location pages too. Verified live under Docker (extent-only → 2 pages; extent + 2 locations → 4). See `docs/decisions.md`.
- ✅ **Per-location zoom/scale level (zoom in for small areas).** *(User-prioritized — DONE 2026-06-25, full vertical slice.)* Each saved location can carry its **own** scale preset overriding the project scale, so a small town / country house renders much more zoomed-in (1:24,000 or finer) while a regional stop stays coarse. `AtlasPage` gained an optional per-page `scale` (falls back to `contract.scale`; `AtlasContract` stays single-scale); `buildLocationPage` stamps it; the `pdf-client` scale bar and `validateAtlas` read `page.scale ?? contract.scale` (truthful scale bar in a mixed atlas). Wired end-to-end: `RenderLocation.scalePresetId` → `ImportantLocation.ScalePresetId` (nullable, migration `AddLocationScalePreset`, validated vs seeded presets → 400) → render wire → a per-location scale picker in the web location editor. Verified live under Docker: a 1:100,000 project with one inheriting location + one at 1:24,000 → a 2-page atlas whose footprints differ ~17×. See `docs/decisions.md`.

## Locked Decisions

These were resolved during roadmap refinement and are now treated as fixed constraints. Revisit only with explicit cause.

- **Build order: risk-first, headless-first.** Stage 1 is a no-UI engine that renders a real, measured Letter PDF. Visual theming/hero page comes *after* the engine is proven (Stage 4).
- **Users: single-user, no auth for MVP.** One shared workspace on the home server; projects are global. Lightweight profiles and remote-access auth are deferred to post-MVP (Stage 9).
- **Projection: per-page local projection.** Each page reprojects to a local CRS (UTM zone or a page-centered transverse-Mercator) so the printed scale bar is *true*, avoiding Web Mercator latitude distortion. Web Mercator is preview-only.
- **Input: bounding box + saved important locations first.** Address/geocode search (Nominatim or equivalent) is *planned for* — its data model and API surface are stubbed in early — but not wired to a UI until later.
- **Standard scale presets (first-class feature).** The user picks a named map scale (e.g. 7.5-minute / 1:24,000). Every saved-location page renders at that fixed scale, so all location pages cover the *same ground area*. See [Standard Scale Presets](#standard-scale-presets-feature).
- **Map tiers: road-atlas-first learning curve.** Pages carry a tier (Level 1 road-atlas → Level 4 full MGRS); the MVP default is Level 1 (Level 2 a fast-follow), higher tiers are opt-in templates. See [Map Tiers (Learning Curve)](#map-tiers-learning-curve-feature) and [[Land Nav Learning Curve Recommendation]].
- **PDF engine: React PDF, headless-capable.** `@react-pdf/renderer` runs in Node, so the same atlas page components render headlessly in Stage 1 and client-side in the browser later — no layout drift. QuestPDF remains the documented fallback if headless map-panel rendering proves unreliable.

## Standard Scale Presets (feature)

A core navigation-credibility feature. Instead of "fit this bbox onto N pages," the user can choose a **fixed map scale**, and the engine derives a consistent ground footprint for every page.

- Named presets map a scale ratio to a fixed ground footprint on a Letter page:
  - **7.5-minute / 1:24,000** (USGS quad standard) — ~3.0 mi × ~4.0 mi per Letter page at 0.5" margins.
  - **1:25,000**, **15-minute / 1:62,500**, **1:50,000**, **1:100,000**, plus a **custom ratio**.
- Because a Letter printable area is fixed, choosing the scale *determines* the ground area covered. Two different saved locations at 1:24,000 therefore pull in the same amount of surrounding terrain — directly comparable, teachable, and bindable in one book.
- Two extent modes share the same scale engine:
  - **Scale-driven (location pages):** center on a saved location → fixed-scale page → fixed ground footprint.
  - **Extent-driven (atlas grid):** a bbox is split into a grid of pages, all at one chosen scale (no per-page zoom variance).
- The scale also drives the scale bar, the grid-locator inset ratio, and disk/size estimates for tile fetches.

## Map Tiers (Learning Curve) (feature)

A core product-shaping concept that sits alongside Standard Scale Presets. A page (or whole book) has a **tier/level** that selects which navigation page furniture is drawn, so the same engine produces a friendly road-atlas page or a full military-grade land-nav page from one contract. The design rule is **one new concept per level** so a child is never handed "a different language" all at once. See [[Progressive Map Skills Curriculum]] and [[Orienteering Course Levels As Scaffold]].

- **Level 1 — Road-Atlas Grid (ages ~5–8).** Friendly page-relative alphanumeric grid (A1/B2), place-name index, landmarks, route line, continuation arrows. Answers "find our spot" and "how much longer." See [[Road Atlas Conventions]].
- **Level 2 — Scale Bar + Compass (ages ~7–10).** Adds the measured scale bar and a compass rose / cardinal directions ("which way, how far"). Nearly free — the engine already produces a true measured scale bar (Stage 1D/1E).
- **Level 3 — UTM/USNG Grid (ages ~9–12).** Adds a real georeferenced 1000 m metric grid (labeled **USNG** — the civilian, kid-friendly name for MGRS) plus contours for hiking pages.
- **Level 4 — Full MGRS + Azimuth/Declination (teen).** Full MGRS labeling, grid/magnetic azimuths, declination diagram and conversion, distance-azimuth worksheets — per [[TC 3-25.26 Part 1 Map Reading and Land Navigation]].

The decision is **road-atlas-first**: it is not road-atlas *vs* land-nav — the road atlas *is* the first rung of the land-nav ladder. **The MVP default is Level 1 (with the nearly-free Level 2 as a fast-follow); Levels 3–4 ship as opt-in advanced templates** gated behind a toggle, targeted at older kids and the hiking use case. Each level is **additive page furniture on the same engine** (a Level 4 page is a Level 1 page with more furniture turned on), so the tier rides the existing page-furniture contract (Stage 1D) and round-trips in project metadata (Stage 2A) exactly like the scale preset. One family book can hold mixed-level pages so siblings of different ages share the same atlas. Full rationale in [[Land Nav Learning Curve Recommendation]].

## Tile Sources & Self-Hosting (feature)

A capability that sits alongside Standard Scale Presets and Map Tiers: **where a page's basemap comes from is itself a first-class, swappable choice.** The architecture is already set up for this — the **Stage 2D `TileSource` registry is the seam**. Each registry row already carries provider, source URL, max zoom, attribution, and cache policy, so pointing the renderer at a tile server *you own* — or a **[[PMTiles]]** archive — instead of USGS is *just another registry row*. No architecture change is required, which makes self-hosting cheap to add and a natural fit for the Stage 3 tile-proxy + disk-cache (which is effectively a mini self-host already).

Why it matters for JourneyBook specifically:

- **Removes the tile-policy / rate-limit risk (a documented top risk).** Stage 1C currently fetches USGS public-domain tiles directly, per page — a 36-page atlas is hundreds of requests, and *any* third-party basemap carries rate limits and ToS constraints on bulk PDF generation. A tile server (or a PMTiles archive) you own has **no rate limit and no ToS worry for bulk rendering**, directly mitigating the vault's OSM-tile-policy / rate-limit risk. See [[Self-Hosted Tile Servers]].
- **Offline / hiking (Stage 7 + Android, Stage 11).** There is no signal on the trail. A bundled **PMTiles** archive (or a self-hosted server on a home network) is how a region's tiles go offline. **PMTiles ≈ "self-hosting in a single file"** — one archive served by HTTP range requests, with *no running server* — and it is MapLibre-native. See [[PMTiles]].
- **International coverage.** USGS is US-only; a self-hosted OSM-derived server or a Protomaps PMTiles archive covers the whole planet.

**The mixed model is the design.** This is not USGS *vs* self-host — it is both, chosen per tier:

- **USGS topo for the land-nav tiers (Level 3–4).** USGS is genuinely *topographic* (contours, terrain, relief) — that is the thing that makes a page useful for land navigation, and most self-hosted/OSM basemaps are road/street style, not topo.
- **PMTiles / self-host for the road-atlas tiers (Level 1–2), offline, and international.** A planet-wide road/street basemap with no rate limit is exactly what the friendly low tiers, offline packages, and non-US trips want.

Kinds of self-hosting, in rough order of ops cost:

- **PMTiles / Protomaps** — best fit, lowest ops, no running server. The natural home is `packages/map-sources`. **The cheapest high-value first step** (offline + planet-wide + no service to run). Either a prebuilt **Protomaps** basemap or a **self-generated [[Planetiler]] PMTiles** archive.
- **Full tile servers** — TileServer-GL / Martin / pg_tileserv, run in the existing Docker Compose. More power (live styling, vector tiles, custom data), more ops (one more service to run and maintain).
- **[[Planetiler]]** to *generate your own* PMTiles from OSM data — feeds the offline/international packages without depending on a hosted provider.

Trade-offs to keep honest: licensing still applies — OSM-derived tiles require "© OpenStreetMap contributors" (ODbL), which the registry's attribution field already models. A *running* server is one more service to operate; **PMTiles avoids that**, which is why it is the recommended first step. A running server is the better fit for power users.

**Recommendation:** make **PMTiles support part of the MVP roadmap** (the cheapest path to offline + planet-wide + no running server), and keep **full self-hosted tile-server hosting as a later "Power User / Home Server" advanced feature** built on the *same* `TileSource` registry. (Audience note: many eventual users are homelabbers — Proxmox/Docker/NAS/Starlink — who would value a bring-your-own-server option.) See [[Self-Hosted Tile Servers]], [[PMTiles]], [[Planetiler]].

## Guiding Architecture

Use Postgres/PostGIS for projects, atlas geometry, routes, landmarks, generated PDF records, tile source metadata, and cache manifests. Do not store tile bytes in Postgres.

Use the server filesystem for short-lived render artifacts, generated PDFs, and optional temporary PMTiles extracts. Use the browser/device cache for preview tiles so users can move between devices without the server permanently storing large tile archives.

For MVP, the browser preview and PDF renderer should request tiles through the same server endpoint. That keeps rendering consistent while still allowing each device to cache its own tile responses. If client-side PDF output is not good enough, use QuestPDF as a server-side fallback behind the same atlas metadata model.

## Proposed Folder Structure

Use a monorepo-style layout so the web app, API, shared atlas logic, render experiments, and future mobile app can evolve without splitting the product model.

```text
JourneyBook/
  apps/
    web/                         React + Vite + shadcn/ui + Tailwind app
    api/                         ASP.NET Core C# API service
    mobile-android/              Future Android app
  packages/
    atlas-core/                  Shared TypeScript atlas/page-grid/scale/projection logic
    map-sources/                 TypeScript PMTiles, tile source, attribution helpers
    pdf-client/                  React PDF/page components (Node-headless + browser)
    render-cli/                  Headless CLI that drives atlas-core + pdf-client (no UI)
    ui/                          Shared UI/theme components if needed
  dotnet/
    JourneyBook.Domain/          Optional C# domain project if API grows
    JourneyBook.Infrastructure/  Optional C# persistence/integration project
    JourneyBook.Tests/           Optional C# backend test project
  services/
    questpdf-renderer/           Optional server-side PDF fallback
    geo-worker/                  Optional GDAL/Rasterio/Shapely worker
  infra/
    docker/                      Dockerfiles and service images
    compose/                     Docker Compose files
    db/
      migrations/                Postgres/PostGIS migrations
      seeds/                     Seed data and local fixtures
  data/
    generated/                   Generated PDFs and render artifacts
    cache/                       Short-lived server cache
    map-packages/                Optional bounded PMTiles/MBTiles packages
    fixtures/                    Tiny committed test fixtures (sample bbox, golden PDFs)
  docs/
    decisions/                   Architecture and product decisions
    specs/                       Build specs and implementation plans
  vault/                         Research and planning notes
```

Do not commit heavy generated data, tile packages, or PDFs unless they are tiny fixtures. Keep `data/` mounted as Docker volumes in deployed environments. For MVP, keep the backend in `apps/api/` as one ASP.NET Core project unless real boundaries emerge; split into `dotnet/` projects only when useful.

## Build Ordering Principles

1. **Prove the riskiest thing first.** Print scale truth, projection, PDF fidelity, and attribution survival are the documented top risks. Stage 1 renders a measured PDF before anything else.
2. **Headless before UI.** The engine (library + CLI + API) is buildable and testable with no front-end. Theming and the hero page come only after the engine is validated. This is the boundary an autonomous builder can complete unattended.
3. **One contract, many renderers.** A single page-grid + page-furniture JSON contract feeds the headless renderer now, the browser preview later, QuestPDF if needed, and Android eventually.
4. **Each sub-stage has a measurable "Done when."** No sub-stage is complete without an automated check or a physical print measurement.
5. **Plan for the deferred.** Address search, routes, offline packages, and accounts are stubbed at the data/contract layer early even when their UI is deferred, so adding them later is wiring, not redesign.

## As-Built Stack (Stage 0)

Concrete technology choices locked while scaffolding the skeleton. Recorded in `docs/decisions/0001-foundation-stack.md`.

| Concern            | Choice                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| Monorepo           | pnpm workspaces + TypeScript project references (`tsc -b`)             |
| Backend            | ASP.NET Core **.NET 10**, **Clean Architecture** (Domain ← Application ← Infrastructure ← Api) |
| Data access        | **EF Core 10 + Npgsql + NetTopologySuite** (PostGIS) in Infrastructure |
| Database           | Postgres + PostGIS (`postgis/postgis:16-3.4`)                          |
| Frontend           | React 19 + Vite + **Tailwind v4** (CSS-first `@theme`), shadcn at St.4 |
| Headless PDF       | `@react-pdf/renderer` in Node (planned 1D); QuestPDF fallback (St.8)   |
| Orchestration      | Docker Compose (`db`, `api`, `web`); nginx proxies `/api` + `/health`  |
| Ports (dev)        | web 5173 / api 5180 / db 5433 (host); web container 8080→80            |

## Stage 0: Foundation Skeleton (built)

Goal: a runnable, buildable monorepo skeleton that every later stage extends — no product features yet. Completed during roadmap refinement; this is the floor Stage 1 builds on.

Delivered:
- Monorepo workspace: `packages/atlas-core`, `map-sources`, `pdf-client`, `render-cli`, `ui` — all building via `tsc -b` with project references; shared `tsconfig.base.json` (strict).
- `atlas-core` seeded with the real foundation types: Letter page constants, **standard scale presets** (1:24,000 … 1:100,000), `BBox`/`LngLat`/`AtlasPage`/`AtlasContract` (the one render contract).
- `render-cli`: a working **no-UI** executable (`journeybook --help`/`--version`) that lists scale presets and stubs `render`/`validate` for Stages 1B–1E. Proves the headless toolchain wires together.
- **Layered backend (Clean Architecture)** under `dotnet/` + `apps/api`:
  - `JourneyBook.Domain` — entities/value objects; `Common/EntityBase` (Guid id). No dependencies.
  - `JourneyBook.Application` — use-case/service seam; `AddApplication()` composition root. → Domain.
  - `JourneyBook.Infrastructure` — `Persistence/JourneyBookDbContext` (PostGIS extension enabled, `ApplyConfigurationsFromAssembly`, no entities yet) + `AddInfrastructure(config)` registering EF Core/Npgsql/NetTopologySuite. → Application, Domain.
  - `JourneyBook.Api` — host; `GET /health` + `GET /health/db`, CORS; wires `AddApplication().AddInfrastructure(...)`. Keeps `EntityFrameworkCore.Design` for `dotnet ef` tooling. → Application, Infrastructure.
  - `JourneyBook.Tests` — xUnit; DI composition smoke test (green).
  - Whole solution (`JourneyBook.slnx`) builds clean; test passes.
- `apps/web`: React/Vite/Tailwind v4 shell that probes the API health endpoints; the branded hero/landing arrives in Stage 4.
- `infra/`: Dockerfiles for api + web, `docker-compose.yml` (db/api/web), nginx reverse proxy, `.env.example`. Compose config validates.
- `.gitignore`, `.dockerignore`, root README, ADR 0001.

Satisfies several Stage 1A items early (skeleton, Compose, health checks). Stage 1A now reduces to confirming a first EF Core migration applies and the api↔db readiness path is green end-to-end.

## Implementation Patterns (established)

Conventions later stages should follow so new code stays consistent with what's built:

- **TS engine is the one source of truth for geometry** (ADR 0004) — projection, page-grid/location derivation, scale, and validation live in `packages/atlas-core`. Never reimplement this math in C#.
- **Shared contract**: `AtlasContract` (`scale`, `margins`, `pages[]` with `id`/`bbox`/`orientation`/`tier`/`neighbors`) flows engine → renderer/validator. Extend this type; don't fork it.
- **Backend feature pattern** (from Stage 2B): DTOs + `I<X>Service` in Application → `<X>Service` (uses `JourneyBookDbContext`) in Infrastructure, registered in `AddInfrastructure` → minimal-API endpoints in `apps/api/Endpoints/<X>Endpoints.cs` → integration test via `PostgisApiFactory` (Testcontainers + `WebApplicationFactory`, real PostGIS). Build geometry with `NtsGeometryServices.Instance.CreateGeometryFactory(4326)`.
- **TS package TDD**: vitest; `*.test.ts` excluded from `tsc` build; engine modules import from the leaf `./model.js`, not the barrel `./index.js` (avoids the init cycle).
- **Tiers**: `MapTier` (1–4) on every page; furniture is additive per level; default Level 1.
- **Headless entry is `render-cli`** (`grid`/`render`/`validate`) — keep new no-UI capabilities reachable there before any UI exists.

---

# Phase A — Headless Engine (no UI, Dark-Factory buildable)

## Stage 1: Atlas Engine and Print-Fidelity Spike

Goal: from a hardcoded/config bbox **or** a saved location + chosen scale, produce a validated multi-page Letter PDF with a *true* scale bar — entirely headless, driven by a CLI and/or API, with no front-end UI. This is both the core domain engine and the print-validation harness the vault calls for.

This stage de-risks projection, scale truth, PDF fidelity, DPI, and attribution survival before any visual design exists.

### Stage 1A: Skeleton and infrastructure (no front-end)
Folders touched: `infra/docker/`, `infra/compose/`, `infra/db/migrations/`, `apps/api/`, `packages/atlas-core/`, `packages/render-cli/`, `data/generated/`, `data/cache/`, `data/fixtures/`.

Build:
- Monorepo workspace + TypeScript build for `atlas-core`, `map-sources`, `pdf-client`, `render-cli`.
- Docker Compose with **api** and **postgres+postgis** services only (no web service yet). Health checks for api and db.
- ASP.NET Core API skeleton with a health endpoint and a single `POST /api/render` stub.
- First migration applies cleanly; PostGIS extension enabled.

Done when:
- `docker compose up` brings api + db healthy with one command.
- The API can connect to Postgres/PostGIS and apply a migration.
- `render-cli --help` runs.

### Stage 1B: Page geometry, scale, and projection (pure functions) — ✅ built (2026-06-24)

Delivered in `packages/atlas-core` (TDD, 17 vitest tests): `scale.ts` (metersPerInch, scaleBarGroundMeters), `page.ts` (printableAreaInches with orientation + gutter, groundFootprintMeters, `LETTER_PORTRAIT`), `projection.ts` (page-centred transverse Mercator via proj4 — **true scale at the page**; verified latitude-independent: 1000 plane m ≈ 1000 ground m at 25° and 60°; ECEF geodesic distance; `utmZoneForLongitude` kept for future MGRS/USNG), `grid.ts` (`buildPageGrid` extent-driven + `buildLocationPage` scale-driven, page IDs A1/B2…, N/S/E/W neighbors, overlap). Barrel via leaf `model.ts` (no init cycle). Demonstrated headless: `journeybook grid --bbox W,S,E,N --scale <preset> [--overlap]` and `grid --location LNG,LAT --scale <preset>` emit the AtlasContract JSON with zero UI.

Spec:

Folders touched: `packages/atlas-core/`.

Build:
- Letter page model: 8.5 × 11, portrait default, configurable safe margins and optional binder gutter; printable viewport in inches and PDF points (612 × 792).
- **Standard scale presets**: 1:24,000 (7.5-min), 1:25,000, 1:62,500 (15-min), 1:50,000, 1:100,000, custom ratio; scale → ground-footprint math.
- **Per-page local projection**: choose UTM zone or page-centered transverse Mercator per page; reproject extent; compute true ground-distance-per-inch at page center and edges.
- Extent → page-grid splitting at a fixed scale (extent-driven mode) and center+scale → single page (scale-driven/location mode).
- Page IDs (A1, B2…), neighbor references (N/S/E/W), optional 5–10% overlap with a defined overlap marker convention.
- Shared page-grid + page-furniture JSON contract (the one contract all renderers consume).
- Unit tests for scale truth: a known ground segment maps to the expected inches at each preset, across multiple latitudes.

Done when:
- Given a bbox + scale, the grid is stable and adjacent pages align.
- Scale-bar length in inches is correct to a defined tolerance at low and high latitude (unit-verified).
- A location + scale yields a deterministic, repeatable ground footprint.

### Stage 1C: Headless map-panel rendering — ✅ built (2026-06-24)

Decision (ADR 0003): render panels from **public-domain USGS National Map raster tiles** (Web Mercator), composited + cropped to the page bbox with `sharp`, embedded in the PDF as a PNG — chosen over fragile maplibre-gl-native and a heavyweight headless-browser MapLibre. Within one small page Web Mercator is locally true-to-scale, so the (locally-projected) scale bar stays valid. Delivered in `packages/map-sources`: `tilemath.ts` (Web Mercator pixel/tile math, TDD, 6 tests) + `panel.ts` (`renderMapPanel(bbox, targetWidthPx, basemap=USGS_TOPO)`). Wired through the CLI (`render … --basemap`) and `pdf-client` (`<Image>` panel). **Verified end-to-end and visually**: a Lincoln, NE location page renders a real USGS topo panel inside a true-scale Letter PDF with page ID, scale bar, compass, and attribution — zero UI. Failure modes (network at render time, US-only coverage, raster vs. vector, caching for big atlases) documented in ADR 0003. The self-generated USNG/MGRS grid (Stage 6B) layers on top of this panel.

Spec:

Folders touched: `packages/map-sources/`, `packages/render-cli/`.

Build:
- Server/Node-side reader for a remote or local PMTiles/vector-tile source.
- Render one page's map panel, in the page's local projection, to a 300 DPI-target raster and/or vector layer.
- **Spike the highest-risk unknown:** headless map-panel rendering path. Evaluate maplibre-gl-native / headless raster vs. a static vector-to-raster path. Record findings in `docs/decisions/`.
- Attribution string resolved from the tile source metadata and carried into the render contract.

Done when:
- A single page's map panel renders headlessly at the target DPI in the correct projection.
- The chosen headless render path is documented with its failure modes; QuestPDF fallback trigger is defined.

### Stage 1D: Headless PDF composition with page furniture — 🟡 mostly built (2026-06-24)

Delivered: `packages/pdf-client` renders an `AtlasContract` to a multi-page Letter PDF via `@react-pdf/renderer` in Node (`renderAtlasPdfToFile` / `renderAtlasPdfToBuffer`; reusable client-side later). Page furniture: title, page ID, neatline, **tier-aware** content — Level 1 shows the road-atlas locator + N/S/E/W continuation labels ("CONTINUE NORTH · A1"); Level 2+ adds a **true measured scale bar** (round-number `niceScaleBar`, unit-tested length) and a north-up compass rose; attribution footer inside the safe margin. The `tier` field (1–4) is now on the contract (`atlas-core` model, default Level 1). Wired into the CLI: `journeybook render --bbox … --scale … --out a.pdf [--tier N] [--basemap]` and `render --location …` — verified producing valid multi-page PDFs headlessly (36-page grid + 1-page location). With `--basemap` the panel now shows a **real USGS topo map** (Stage 1C). **Remaining for 1D-complete:** fiducial/ruler crop marks + a grid-locator inset are not yet drawn (Stage 1E adds the measurement harness).

Spec:

Folders touched: `packages/pdf-client/`, `packages/render-cli/`, `data/generated/`.

Build:
- React atlas page components rendered headlessly via `@react-pdf/renderer` in Node (reused client-side later).
- Page furniture: title, page ID, **measured scale bar**, compass rose (true north), grid-locator inset, continuation/neighbor labels, legend stub, attribution footer inside the safe margin.
- Overview page + detail pages composited into one multi-page Letter PDF.
- Fiducial/ruler marks and page-boundary ticks for physical measurement.

Done when:
- `render-cli --bbox … --scale 1:24000` and `render-cli --location … --scale 1:24000` each emit a multi-page Letter PDF.
- Every map page shows visible attribution inside the printable area.

### Stage 1E: Print-validation harness — ✅ built (2026-06-24)

Delivered: `validateAtlas(contract)` in `atlas-core` (TDD) emits a structured report — **scale-consistency** (each page's measured ground footprint vs. the scale-implied footprint, via ECEF geodesic, 0.5% tolerance — catches a false scale bar), **neighbor-reciprocity** (every N/S/E/W reference resolves and points back), and has-pages; plus `effectiveDpi(panelPx, printableInches)`. CLI `journeybook validate --bbox|--location --scale` prints PASS/FAIL per check and exits 0/1 — verified flagging a tampered footprint and a dangling neighbor, and passing a real 36-page grid (worst error 0.21%). Committed golden fixture `data/fixtures/sample-atlas.json` (2×2) with a regression test. The PDF now draws a **1-inch calibration tick** ("print check") so a printed page reveals printer scaling. **This completes Phase A — the headless engine — entirely with zero UI.** (Remaining nicety: page-boundary crop fiducials beyond the 1-inch tick.)

Spec:

Folders touched: `packages/render-cli/`, `data/fixtures/`.

Build:
- Automated checks emitted as a report: scale-bar measured length vs. known ground distance, effective DPI / pixel-density check, attribution-present check, page-boundary fiducial check, neighbor-reference correctness.
- A small committed golden fixture (sample bbox + expected report) under `data/fixtures/`.
- A one-page physical calibration target for ruler verification.

Done when:
- The harness flags a deliberately wrong scale bar and passes a correct one.
- A printed page measured by ruler matches the stated scale within tolerance.
- The engine produces a validated atlas from CLI/API with **zero UI**.

---

# Phase B — Persistence and Services (still mostly headless)

## Stage 2: Project, Location, and Tile-Source Metadata

Goal: save and reload atlas projects, locations, and scale choices from any device — exercised through the API and integration tests, no UI required.

Folders touched: `apps/api/`, `packages/atlas-core/`, `infra/db/migrations/`, `infra/db/seeds/`, `docs/decisions/`.

### Stage 2A: Schema and migrations — ✅ built (2026-06-24)

Delivered: Domain entities (`Project`, `AtlasExtent`, `AtlasPageGrid`, `AtlasPage`, `ImportantLocation`, `TileSource`, `GeneratedPdf`, `ScalePreset`) with enums (`PageOrientation`, `LocationCategory`, `SourceConfidence`, `PdfStatus`) and owned value objects (`PageMargins`, `TileCachePolicy`); `IEntityTypeConfiguration<T>` maps in Infrastructure; `InitialSchema` migration. Verified against PostGIS: 8 app tables created, geometry columns `geometry(Polygon|Point, 4326)`, owned-type columns (`Margins_*`, `Cache_*`), `jsonb` snapshot column, 5 scale presets seeded. `Database:MigrateOnStartup` flag (on in Compose, off for local `dotnet run`) auto-applies on boot — verified creating the schema on a fresh DB. 10 backend tests green (entity mapping, geometry SRID, DI composition).

Schema spec:
- Use **EF Core code-first migrations** with Infrastructure as the migrations project and Api as the startup project: `dotnet ef migrations add <Name> -p dotnet/JourneyBook.Infrastructure -s apps/api`. The Stage 0 `JourneyBookDbContext` (in `Infrastructure/Persistence`) already enables the `postgis` extension and calls `ApplyConfigurationsFromAssembly`, so the first migration can introduce geometry columns immediately. Define entities in Domain, map them with `IEntityTypeConfiguration<T>` in Infrastructure. Geometry maps via NetTopologySuite (`Point`, `Polygon`) in SRID 4326.
- Project table (single-user, no owner column yet — but leave room).
- Atlas extent table using PostGIS geometry.
- Page-grid metadata: rows, columns, page IDs, orientation, margins, **scale preset**, overlap.
- Scale-preset reference data (seeded).
- Important-locations table: name, geometry, category, notes, source confidence.
- Tile-source metadata table: provider, source URL, version/date, attribution, max zoom, cache policy.
- Generated-PDF table: status, file path, created date, source-metadata snapshot.
- **Geocode-search planning:** add a nullable `geocoded_from`/provider field and reserve an address-search adapter interface, even though no geocoder is wired yet.

### Stage 2B: Project + extent API — ✅ built (2026-06-24)

Delivered: `IProjectService` (Application) + `ProjectService` (Infrastructure) + minimal-API endpoints `/api/projects` — create, list, get, update, delete, and `PUT /{id}/extent` (WGS84 bbox → PostGIS `Polygon`, SRID 4326, via NetTopologySuite). Creating a project also creates its `AtlasPageGrid` config (scale preset, orientation, margins, overlap); unknown scale preset → 400. Integration-tested with **Testcontainers PostGIS + WebApplicationFactory** (4 tests, full CRUD + extent geometry round-trip through real PostGIS, no mocks). Backend now 14 tests.

**Architectural seam (ADR 0004): the C# API owns persistence/metadata; it does NOT duplicate the TS `atlas-core` projection/grid engine.** So "derive and persist a page grid" is split — the API persists grid *config*; the actual page derivation (projection, page IDs, neighbors) stays in `atlas-core` and runs in the render pipeline. A later integration can persist derived pages back via the API.

### Stage 2C: Important-locations API + fixed-scale location pages — ✅ built (2026-06-24)

Delivered: `ILocationService`/`LocationService` + `/api/projects/{id}/locations` (nested) + `/api/locations/{id}`, with stable per-project **L-series** labels (`L1`, `L2`… via a `LocationNumber` column + unique `(ProjectId, LocationNumber)` index, never renumbered on delete) and `referenceLabel` ("see page L1"), `Point(4326)` geometry, enum validation → 400, unknown project → 404. 8 `PostgisApiFactory` integration tests. The `Label` feeds the engine's `buildLocationPage` id (cross-language contract). Spec below.

- CRUD for important locations — follow the **Stage 2B feature pattern** (`ILocationService` + `LocationService` + `/api/projects/{id}/locations` endpoints + `PostgisApiFactory` tests). The `ImportantLocation` entity already exists (Stage 2A) with `Point` geometry (4326), `LocationCategory`/`SourceConfidence` enums, notes, and the reserved `GeocodedFrom`/`GeocodeProvider` fields. Build the point via `NtsGeometryServices…CreateGeometryFactory(4326).CreatePoint(new Coordinate(lng, lat))`.
- Location-page generation **reuses the TS engine** `buildLocationPage(center, scale, page, id, tier)` (already built, `atlas-core`) — the API persists the location; the render pipeline derives the fixed-scale `L1` page. Add the `L1/L2…` reference-label scheme (the locator label "see page L1") to the page-furniture contract.

### Stage 2D: Tile-source registry — ✅ built (2026-06-24)

Delivered: `ITileSourceService`/`TileSourceService` + `/api/tile-sources` (global) + `/api/tile-sources/{id}` + `/api/tile-sources/by-key/{key}`; unique `key` (duplicate → **409**), owned `TileCachePolicy` round-trip, and a seeded `usgs-topo` row. 7 integration tests. **Wiring `renderMapPanel` to read this registry (instead of the hardcoded `USGS_TOPO`) is Stage 3** — see below. Spec:

- Register/select tile sources with attribution + cache policy. The `TileSource` entity already exists (Stage 2A) with the owned `TileCachePolicy`. Wire `renderMapPanel`'s `RasterBasemap` (currently the hardcoded `USGS_TOPO` in `map-sources/panel.ts`) to read provider/url/attribution from this registry; surface attribution via `composeAttribution`.
- **This registry is the self-hosting seam** (see [Tile Sources & Self-Hosting](#tile-sources--self-hosting-feature)). A self-hosted tile server or a [[PMTiles]] archive is **just another registry row** — provider/sourceUrl (e.g. `http://your-server:8080/{z}/{x}/{y}` or a `pmtiles://…` archive) / maxZoom / attribution / cache policy — so no schema or architecture change is needed to point the renderer at a server you own. Keep the row's `kind`/source-type open enough to distinguish `usgs-raster` / `xyz-server` / `pmtiles` so Stage 3 can dispatch the right reader. The ODbL "© OpenStreetMap contributors" string for OSM-derived sources rides the existing attribution field.

### Stage 2E: Generated-PDF records + retention — ✅ built (2026-06-24)

Delivered: `IGeneratedPdfService`/`GeneratedPdfService` + `/api/projects/{id}/generated-pdfs` + `/api/generated-pdfs/{id}` (+ `/status`) + `POST /api/generated-pdfs/prune`; lifecycle `Pending`→`Rendering`→`Completed`/`Failed`, `jsonb` `SourceMetadataSnapshot` (semantic round-trip), `ExpiresAt` from config (`GeneratedPdf:RetentionDays` default 30), and a **path-confined** best-effort prune (a `../`/escape `FilePath` is skipped, proven by a negative test added during convergence). 8 integration tests. Spec:

- Persist render outputs with a source-metadata snapshot and a retention/expiry policy field. The `GeneratedPdf` entity already exists (Stage 2A) with `PdfStatus`, `FilePath`, and a `jsonb` `SourceMetadataSnapshot`. A render endpoint (or the render worker) writes a `Pending`→`Completed`/`Failed` record around each `renderAtlasPdfToFile` call; artifacts land under `data/generated/`.

Done when:
- A project with a bbox and a chosen scale can be created, persisted, and reopened from another device via API.
- A saved location persists and generates a fixed-scale location page + reference label.
- The server derives and persists a page grid; all metadata round-trips through integration tests.

## Stage 3: Tile Proxy and Per-Device Cache (headless) — ✅ built (2026-06-25)

Goal: serve map tiles without permanently storing large archives, and let the headless renderer and (future) browser share one endpoint.

Folders touched: `apps/api/`, `packages/map-sources/`, `data/cache/`.

Context now that code exists: Stage 1C's `renderMapPanel` fetches USGS raster tiles **directly** per page (fine for the spike, but a 36-page atlas is hundreds of uncached fetches). Stage 3 centralizes fetching behind one endpoint + cache so the renderer and browser share it. Reuse `map-sources/tilemath.ts` (`tileRangeForBBox`, `zoomForBBox`) for the math; the registry from Stage 2D supplies source URLs/attribution.

This proxy + cache is **effectively a mini self-host** (see [Tile Sources & Self-Hosting](#tile-sources--self-hosting-feature)) and the natural place to add first-class self-hosted/PMTiles support: the `{source}` segment resolves through the Stage 2D registry, so a row pointing at a **bring-your-own tile server URL** or a **[[PMTiles]] archive** is served the same way as USGS.

Build:
- C# tile endpoint `/api/tiles/{source}/{z}/{x}/{y}` (raster today; `.mvt` when a vector/PMTiles source is added). `{source}` resolves to a Stage 2D registry row, dispatching by source kind: USGS raster XYZ, a **self-hosted XYZ/TMS server** (bring-your-own URL), or a PMTiles archive.
- **PMTiles reader** (range-request reader over a local or remote `.pmtiles` archive — "self-hosting in a single file," no running server). This is the cheapest path to offline + planet-wide tiles; back it by a Protomaps basemap or a self-generated [[Planetiler]] archive. See [[PMTiles]].
- Disk-backed tile cache under `data/cache/` keyed by source+z+x+y; `renderMapPanel` fetches through this endpoint instead of USGS directly. (A self-owned server/archive has no rate limit, so caching is purely a performance choice, not a ToS necessity.)
- Explicit HTTP cache headers for per-device browser caching; attribution surfaced through endpoint metadata (ODbL "© OpenStreetMap contributors" for OSM-derived sources).

Done when:
- The renderer fetches tiles through this endpoint instead of hitting USGS per page.
- Tile responses carry correct cache headers and attribution.
- A second request reuses cache where possible (verified via headers).

---

# Phase C — UI, Brand, and Product

## Stage 4: Brand and Visual System (hero/theming page) — ✅ built (2026-06-25)

Goal: define the visual language now that the engine is proven. This is the first UI work and the natural home for a themeable hero page.

Partly seeded already: the Stage 0 web shell shipped a **branded hero** (`apps/web/src/components/Hero.tsx`, `MapFurniture.tsx`) and a **Tailwind v4 `@theme`** brand token set (forest/moss/bark/parchment/cream/campfire + Saira Stencil / Source Sans 3 / Spline Mono fonts) in `apps/web/src/index.css`. Stage 4 hardens these into a reusable system and aligns the **PDF** furniture (`pdf-client`) to the same tokens. **shadcn/ui is not yet installed** — adding it is part of this stage.

Folders touched: `apps/web/`, `apps/web/src/styles/`, `packages/ui/`, `packages/pdf-client/`, `docs/decisions/`, `vault/`.

Build:
- shadcn/ui scaffold (the web service is already in Docker Compose; React/Vite/Tailwind v4 already set up).
- Color tokens: forest, moss, bark, parchment, cream, campfire/trail-marker accent, charcoal.
- Stencil display font (brand/page IDs/stamped moments); body/UI font; print/map label font.
- shadcn/ui + Tailwind theme tokens; first hero/landing screen.
- First printable atlas cover style and first map-page furniture style applied to the existing engine output.
- Design guardrails: outdoor/hiker, kid-friendly but not childish, land-nav credible but not military software.

Done when:
- A sample app screen and a sample atlas page share one visual system.
- The brand reads as rugged field-guide clarity with junior-explorer warmth.
- The printed page stays legible in grayscale and color.
- Brand direction documented in [[Branding Theme]].

## Stage 5: Web App — Preview, Projects, and Generate — ✅ built (2026-06-25)

Goal: wire the proven headless engine to an interactive UI.

Context now that code exists: the UI is largely **wiring existing pieces** — `/api/projects` CRUD + extent (Stage 2B) and locations (2C) already exist; the scale picker is driven by `SCALE_PRESETS` and the tier picker by `MapTier` (both from `atlas-core`); the PDF is produced by `pdf-client` (`renderAtlasPdf*`, reusable client-side in the browser). Mostly new is the MapLibre preview and binding forms to the API.

Folders touched: `apps/web/`, `apps/api/`, `packages/map-sources/`, `packages/atlas-core/`.

Build:
- MapLibre browser preview (Web Mercator preview, with the true-scale disclosure from the engine).
- Project list; create/open project; draw or enter a bbox — calling the existing `/api/projects` endpoints.
- **Scale-preset picker** bound to `SCALE_PRESETS`, plus a **tier picker** (`MapTier`), driving extent and location pages.
- Drop/save important locations on the map (Stage 2C endpoints).
- Generate + download/open the PDF via `pdf-client` (client-side) or a render endpoint; visual comparison of preview vs. exported PDF.
- Source attribution shown in the map UI.

Done when:
- A non-developer can create a project, pick a scale, preview, and export a validated atlas from the browser.
- Preview reuses per-device tile cache; a second device can open the same project.

## Stage 6: Landmarks and Simple Routes

Goal: make pages kid-friendly without drowning them in GIS detail.

Folders touched: `packages/atlas-core/`, `packages/map-sources/`, `apps/api/`, `apps/web/`, `infra/db/migrations/`.

Build:
- Landmark import/query pipeline from OSM/Overpass or Overture.
- Landmark ranking: durable, visible, useful, distributed across pages.
- Landmark table in PostGIS; important-location references in index and legend.
- Route geometry import or simple route entry; route overlay rendering with print-friendly casing.
- Basic callout collision avoidance.

Done when:
- Each page can show a few useful landmarks, clearly distinct from saved important locations.
- A route can be highlighted across multiple pages with continuation labels at boundaries.

## Stage 6B: Land-Nav Fidelity Pass (tiered templates)

Goal: implement the [Map Tiers (Learning Curve)](#map-tiers-learning-curve-feature) as concrete page-furniture templates, so the same engine yields a clean road-atlas page for a 5-year-old and a TC 3-25.26-credible land-nav page for a teen. See [[Progressive Map Skills Curriculum]] and [[Land Nav Learning Curve Recommendation]].

Folders touched: `packages/atlas-core/`, `packages/map-sources/`, `packages/pdf-client/`, `apps/web/`, `vault/source-docs/`, `docs/decisions/`.

Build:
- **Tier as a first-class field.** Add a `tier`/level (1–4) to the page-furniture contract (Stage 1D) and project metadata (Stage 2A) so it round-trips like the scale preset; default Level 1.
- **Level 1 (road-atlas) furniture:** friendly page-relative A1/B2 locator grid, place-name index, landmarks, route line, continuation arrows. See [[Road Atlas Conventions]].
- **Level 2 (scale + compass):** measured scale bar (already built, Stage 1D/1E) + compass rose / cardinal directions surfaced as their own teachable layer.
- **Level 3 (UTM/USNG grid):** **render our own grid overlay** — walk the page's local-projection eastings/northings and draw a 1000 m grid with edge labels; label it **USNG** (the kid-friendly civilian name; "the Army calls this MGRS"). This is the resolved outcome of the old "UTM/MGRS overlay spike": **generate the grid, don't source pre-made MGRS maps** (see USNG/MGRS grid rendering below and [[MGRS USNG Map Acquisition]]). Add contour/relief readability review for hiking pages.
- **Level 4 (full MGRS + azimuth/declination):** full MGRS labeling, three-norths explanation, declination diagram + G-M conversion, distance/azimuth worksheet concepts. The advanced template where TC 3-25.26 vocabulary (including the MGRS name) is the point.
- **Progressive marginal information:** the marginal-info review scales across tiers — key → legend → full TC 3-25.26 margins (page name, page ID, scale, source date, legend, attribution, adjoining pages) at Levels 1 → 4.

USNG/MGRS grid rendering: the grid lines are **self-generated**, not sourced. USNG/MGRS is pure math on WGS84, so for a page's extent we project the metric gridlines through the **per-page local projection already built in Stage 1B** (`utmZoneForLongitude` was retained there for exactly this) and draw lines + edge labels + the USNG collar box. This lives in `packages/map-sources/` and feeds the page-furniture contract in `packages/pdf-client/`; JS tooling (`mgrs`, `usng2`, `@ngageoint/mgrs-js`) fits the TS monorepo. See [[MGRS USNG Map Acquisition]].

Done when:
- A page renders correctly at each of Levels 1–4 from one contract, driven by the tier field.
- The Level 1 map stays clean for a young child; the Level 3/4 templates visibly respect TC 3-25.26 concepts.
- The self-generated USNG grid is georeferenced-correct against a known point (verified by converting a page coordinate with the `mgrs`/`usng2` library), with no pre-made MGRS map sourced.
- An experienced user can orient, measure, and teach from the advanced-tier pages.

## Stage 7: Tile Package Strategy and Render Reliability

Goal: avoid giant server storage while supporting reliable renders.

Folders touched: `packages/map-sources/`, `apps/api/`, `infra/db/migrations/`, `data/cache/`, `data/map-packages/`, `infra/compose/`.

Build:
- Cache-manifest model in Postgres; server-side short-lived tile cache for render jobs.
- Optional `pmtiles extract` workflow for a selected bbox when a reusable package is requested.
- **[[PMTiles]] packaging for offline / international (built on the Stage 2D registry + Stage 3 reader).** Either extract a bbox from a hosted Protomaps basemap or **generate a region archive with [[Planetiler]]** from OSM data — the resulting `.pmtiles` is "self-hosting in a single file," registered as just another `TileSource` row, and is how Stage 11 (Android) and the hiking use case go offline planet-wide. Licensing note: OSM-derived archives carry the ODbL "© OpenStreetMap contributors" attribution through the existing attribution field.
- Expiration/pruning job for temporary extracts and old render artifacts; size estimate before creating an extract (driven by the chosen scale).

**Power User / Home Server (advanced, later):** a **full self-hosted tile server** — TileServer-GL / Martin / pg_tileserv in the existing Docker Compose — for users who want live styling, vector tiles, or to serve their own data. It is built on the *same* `TileSource` registry (just a row with the server's URL), so it is purely additive over the PMTiles path. The trade-off is ops cost: a running server is one more service to operate, which is why **PMTiles is the recommended first step and the server is the opt-in upgrade** for homelabbers. See [[Self-Hosted Tile Servers]].

Default behavior:
- Preview uses per-device browser cache; PDF render uses the server tile proxy + per-device cache; permanent extracts only on explicit request or when a render needs reliability.

Done when:
- The server renders without permanent map bloat; temporary files prune safely.
- Cache metadata records source URL, source date, bbox, zoom range, attribution, and expiration.

## Stage 8: Server PDF Fallback Spike (conditional)

Goal: only if Stage 1's headless React-PDF path showed fidelity/reliability gaps, decide whether QuestPDF is justified.

Folders touched: `services/questpdf-renderer/`, `packages/atlas-core/`, `apps/api/`, `infra/docker/`, `infra/compose/`, `data/generated/`.

Build only if needed:
- QuestPDF service consuming the *same* page-grid contract; one overview + one detail page; output comparison against the React-PDF output; license eligibility checkpoint.

Done when:
- The team keeps client/headless React PDF, or QuestPDF is justified by visibly better fidelity/reliability, with license eligibility documented before any production/commercial use.

## Stage 9: MVP Polish

Goal: make the app pleasant enough for real family use.

Folders touched: `apps/web/`, `apps/api/`, `packages/ui/`, `packages/pdf-client/`, `docs/specs/`.

Build:
- Project list; rename/delete/duplicate project.
- Basic style settings: title, explorer name, date, orientation, margin, overlap, scale preset.
- PDF history; understandable error messages for tile/source/render failures.
- Print calibration page; simple backup/export of project JSON.
- **Address/geocode search** wired to the UI (the adapter reserved in Stage 2A).
- Optional lightweight profiles if family use demands separation.

Done when:
- A non-developer can create, preview, generate, and reprint an atlas; failed renders are understandable; project data can be backed up.

---

# Phase D — Post-MVP

## Stage 10: Post-MVP Paths

Consider after the PDF workflow is proven:
- Reusable offline region packages; route-shaped atlases; kid challenge pages; compass lessons; UTM/MGRS overlays.
- User accounts or remote access (the deferred auth path).
- Tauri desktop wrapper; app-store distribution.

## Stage 11: Android Atlas App

Goal: turn the printed atlas model into an optional mobile experience after the printing version is excellent.

Folders touched: `apps/mobile-android/`, `packages/atlas-core/`, `packages/map-sources/`, `apps/api/`, `data/map-packages/`.

Build:
- Mobile project sync/download from the home-server app.
- Atlas-page viewer reusing the rendered page grid; swipe/scroll where up/down/left/right jumps to the N/S/W/E page; tap-to-jump continuation labels; overview grid.
- Conventional continuous map mode with pan/zoom, current location, route overview, and page-grid overlay.
- Project-scoped offline download using bounded tile packages + atlas metadata.

Done when:
- A user can open the same Journey Book project on Android.
- Atlas-page mode matches the printed PDF closely enough to teach the same navigation model; the conventional map mode aids orientation without replacing the page grid; offline data is project-scoped.

---

## Resolved vs. Remaining Decisions

Resolved (now locked, see [Locked Decisions](#locked-decisions)):
- Build order is risk-first / headless-first; Stage 1 has no UI.
- MVP is single-user, no auth.
- Printed pages use per-page local projection for true scale.
- First input is bbox + saved locations; address search is planned and stubbed early.
- Standard scale presets are a first-class feature.
- PDF engine is headless-capable React PDF, QuestPDF as documented fallback.
- **Road-atlas-vs-land-nav is resolved: tiered, road-atlas-first.** The road atlas is Level 1 of a Level 1–4 land-nav learning curve, not an alternative to it; tiers are additive page furniture on one engine. See [Map Tiers (Learning Curve)](#map-tiers-learning-curve-feature) and [[Land Nav Learning Curve Recommendation]].
- **MGRS map acquisition is resolved: generate our own USNG grid** over any basemap rather than sourcing pre-made military maps. See [[MGRS USNG Map Acquisition]].
- **MVP default template = Level 1 + Level 2** (road-atlas grid plus the nearly-free true scale bar and compass). Levels 3–4 are opt-in advanced templates. See [[Progressive Map Skills Curriculum]].
- **Default grid label = USNG** (civilian, kid-friendly) everywhere; the "MGRS" name is surfaced only in the Level 4 advanced template.
- **Tiers are chosen per page** (a book may mix tiers so siblings of different ages share one atlas); an orienteering-style age-band picker for parents is a later convenience, not MVP.
- **Basemap is mixed, chosen per tier: USGS topo for the land-nav tiers (Level 3–4) + [[PMTiles]] for the road-atlas tiers (Level 1–2), offline, and international.** USGS is US-only and topographic; PMTiles/self-host is planet-wide, rate-limit-free, and offline-capable. **PMTiles support is in the MVP roadmap**; a **full self-hosted tile server** is a later "Power User / Home Server" advanced feature on the same `TileSource` registry. See [Tile Sources & Self-Hosting](#tile-sources--self-hosting-feature) and [[Self-Hosted Tile Servers]].

Remaining for review before/within the relevant stage:
- Which headless map-panel render path wins in Stage 1C (maplibre-gl-native vs. static vector-to-raster)?
- What exact scale-bar tolerance counts as "true" in the Stage 1E harness?
- What max zoom should MVP allow for print?
- How long should generated PDFs and temporary tile caches be retained?
- **Which PMTiles basemap for the MVP offline/road-atlas path: a prebuilt Protomaps archive or a self-generated [[Planetiler]] archive (or both)?** (The mixed USGS-topo-for-land-nav decision is resolved above; this is now specifically about the road/offline/international PMTiles source.)
- Should location pages use a separate numbering scheme (L1/L2) or join the normal page sequence?
- Exact page-overlap percentage and overlap-marker style.
- For Android later, native-rendered from metadata or image/PDF-page based?

See also: [[Recommended Stack]], [[Recommended Architecture]], [[MVP Plan]], [[Branding Theme]], [[PDF Rendering Strategy]], [[Web App With Backend Renderer]], [[PMTiles]], [[Self-Hosted Tile Servers]], [[Planetiler]], [[Offline Map Storage]], [[Important Location Pages]], [[Android Atlas App]], [[TC 3-25.26 Part 1 Map Reading and Land Navigation]], [[Land Nav Learning Curve Recommendation]], [[Progressive Map Skills Curriculum]], [[Orienteering Course Levels As Scaffold]], [[Road Atlas Conventions]], [[MGRS USNG Map Acquisition]], [[Captain Input — Road Atlas vs Land Nav]]
