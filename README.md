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

**Stage 0 — Foundation Skeleton.** Monorepo, headless atlas engine stubs, a
no-UI render CLI, the ASP.NET Core API with health + PostGIS-ready EF Core, and
a React/Vite/Tailwind shell. The riskiest work (true-scale printable PDFs) is
built headless first; see the roadmap.

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
  compose/        docker-compose.yml (db, api, web)
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
docker compose -f infra/compose/docker-compose.yml up --build
# web → http://localhost:8080   api → http://localhost:5180
```

## Verify health

```bash
curl http://localhost:5180/health
curl http://localhost:5180/health/db
```
