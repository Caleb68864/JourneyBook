# Journey Book

A printable land-navigation atlas generator: turn a bounding box or saved
locations + a chosen map scale (e.g. 7.5-minute / 1:24,000) into a printable,
kid-and-parent-friendly adventure atlas with page grids, compass roses, scale
bars, and landmark labels.

> Rugged field-guide clarity with junior-explorer warmth.

Planning lives in [`vault/`](vault/); the build sequence is
[`vault/staged-build-roadmap.md`](vault/staged-build-roadmap.md). Architecture
decisions are in [`docs/decisions/`](docs/decisions/).

## Status

**Through Stage 6C — the product runs end to end.** Draw or enter an extent (or
import locations), pick a scale and a map tier, and generate a printable
true-scale atlas: page grid, per-location pages, route corridor pages, USGS topo
basemap panels, USNG grid overlays, landmarks, an overview index page and a
locations table of contents. It works in the browser (React/Vite → ASP.NET Core
API → Node render worker) and headlessly (`journeybook render …`).

The printed map box is a constant **415 × 549 pt**, and that is measured off the
produced PDF rather than asserted about it — see
`packages/pdf-client/src/scale-fidelity.test.ts` and `journeybook validate`,
which renders the atlas and measures it before reporting.

Rendering is **asynchronous**: `POST /api/projects/{id}/render` answers 202 with
the record id, a background loop performs the render, and the web app polls
`GET /api/generated-pdfs/{id}` until it reads `Completed`. See
[`docs/decisions/0006-asynchronous-rendering.md`](docs/decisions/0006-asynchronous-rendering.md)
for the accepted limits — the queue is in-process, one render runs at a time,
and there is no cancel yet.

Not done: Stage 7 (PMTiles offline packages), Stage 9 (MVP polish), map Tier 4
(full MGRS + declination), and **worker-owned per-page progress and cancel** —
only the render worker knows it is on page 12 of 60, and today it does not
report it. Also: ADRs 0001 and 0003–0005 are cited across this repo and their
text does not exist; `docs/decisions/` is now tracked but those four have not
been reconstructed — see [`docs/decisions/README.md`](docs/decisions/README.md).
See [`vault/staged-build-roadmap.md`](vault/staged-build-roadmap.md) for the
current status and [`vault/development-roadmap.md`](vault/development-roadmap.md)
for the audit trail.

## Layout

```
apps/
  web/            React + Vite + Tailwind v4 app
  api/            ASP.NET Core (.NET 10) host (controllers/endpoints, health)
dotnet/           Clean Architecture backend libraries
  JourneyBook.Domain/          entities, value objects (EntityBase)
  JourneyBook.Application/     use-cases/services seam, AddApplication()
  JourneyBook.Infrastructure/  EF Core/Npgsql/PostGIS, AddInfrastructure()
  JourneyBook.Tests/           xUnit
packages/
  atlas-core/     Page grid, scale presets, projection, page-furniture contract
  map-sources/    Tile source + PMTiles + attribution helpers
  pdf-client/     React atlas page components (headless Node + browser)
  render-cli/     Headless CLI driving the render pipeline (no UI)
  ui/             Shared UI/theme components (Stage 4)
infra/
  docker/         Dockerfiles (api, web)
  compose/        docker-compose.yml (db, api, render-worker, web)
  db/             Migrations + seeds
data/             Generated PDFs, cache, map packages (gitignored, Docker volumes)
docs/             Architecture decisions + specs
vault/            Research and planning notes
```

## Prerequisites

- Node 22+ and pnpm 10+
- .NET 10 SDK
- Docker (for the full stack / Postgres+PostGIS)

## Develop

```bash
# Install workspace dependencies
pnpm install

# Build the shared TS packages
pnpm build

# Run the headless render CLI (no UI)
node packages/render-cli/dist/cli.js --help

# Web app (Vite dev server on :5173, proxies /api + /health to :5180)
pnpm dev:web

# Backend: build + test the whole solution
dotnet build JourneyBook.slnx
dotnet test dotnet/JourneyBook.Tests

# API (http://localhost:5180) — needs a PostGIS on :5433
dotnet run --project apps/api

# Add a migration (Infrastructure = migrations project, Api = startup)
dotnet ef migrations add <Name> -p dotnet/JourneyBook.Infrastructure -s apps/api
```

## Run the full stack (Docker)

```bash
cp .env.example .env
# POSTGRES_PASSWORD has no default — compose refuses to start without one.
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)" >> .env
docker compose -f infra/compose/docker-compose.yml up --build
# web → http://localhost:8080   api → http://localhost:5180
```

The stack runs `ASPNETCORE_ENVIRONMENT=Production` by default; set it to
`Development` in `.env` only while debugging the API, since that turns on
developer exception pages. The Postgres port is published on `127.0.0.1` only.

## Verify health

```bash
curl http://localhost:5180/health
curl http://localhost:5180/health/db
```
