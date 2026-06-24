---
title: "Self-Hosting Decision"
category: "self-hosting"
status: researched
priority: high
related:
  - "PMTiles and Protomaps"
  - "Planetiler"
  - "Tilemaker"
  - "Martin"
  - "TileServer-GL"
  - "pg_tileserv"
  - "Self-Hosted Contours and Terrain"
  - "TileSource Registry"
  - "Recommended Stack"
  - "Data Source Comparison"
  - "Staged Build Roadmap"
  - "License Summary"
source_urls:
  - "https://docs.protomaps.com/pmtiles/"
  - "https://docs.protomaps.com/basemaps/downloads"
  - "https://github.com/maplibre/martin"
  - "https://github.com/onthegomap/planetiler"
  - "https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md"
  - "https://www.usgs.gov/3d-elevation-program/about-3dep-products-services"
---

# Self-Hosting Decision

Decision note: should JourneyBook self-host a basemap, and if so, how? Why it matters: avoid third-party tile rate-limits/ToS for bulk PDF generation, enable offline hiking ([[Staged Build Roadmap]] Stage 7 + Android Stage 11), and reach non-US coverage. Constraint: Docker-on-home-server, homelab owner.

## The Spectrum (lowest -> highest ops)
| Option | Process? | Best when | Notes |
|---|---|---|---|
| **[[PMTiles and Protomaps]]** | None (static file) | MVP, offline packaging | Drop-in registry row; range requests off disk/CDN |
| **[[Planetiler]] / [[Tilemaker]]** | Build-time only | Own your basemap, chosen regions | Generates the PMTiles/MBTiles above |
| **[[Martin]]** | Running server | PostGIS-driven or multi-source | Reuses existing Postgres/Docker; MIT/Apache |
| **[[TileServer-GL]]** | Running server | Need server-side raster/PNG/WMTS for print | Heavier Node + GL Native |
| **[[pg_tileserv]]** | Running server | Serve project's own PostGIS overlays | PostGIS-only, thin |

## Topo vs Vector (the core trade-off)
- **USGS topo (raster, public domain)** has **contours + terrain** — directly valuable for land nav, and free of attribution.
- **OSM / self-hosted basemaps (vector)** are **road/street** maps — great for road-atlas tiers, offline, and international, but they **lack contours** (see [[Self-Hosted Contours and Terrain]]).

**Recommended: a mixed model.**
- Use **USGS topo for land-nav tiers** (US): contours come free.
- Use **PMTiles / self-hosted OSM for road-atlas tiers, offline packaging, and international** coverage.
- For non-US land nav, add **self-generated contours/hillshade** from SRTM/3DEP on top of the OSM basemap.

The [[TileSource Registry]] makes this clean: each layer (USGS topo, OSM PMTiles, contour overlay) is just a row with its own provider/maxZoom/attribution/cache policy. No either/or.

## Licensing Summary
- **USGS topo / 3DEP / SRTM** -> public domain (credit requested, not required). 
- **OSM-derived** (Protomaps basemap, Planetiler/Tilemaker output, Martin/pg_tileserv over OSM data) -> **ODbL: must show "© OpenStreetMap contributors"**.
Mixed maps need both attributions in the footer. See [[License Summary]].

## Ops Cost
- PMTiles: ~zero — a file. Backups are a copy.
- Planetiler/Tilemaker: periodic build job (minutes per region; RAM/disk during build).
- Martin/TileServer-GL/pg_tileserv: a long-running container to monitor, update, and back up, plus DB load.

## Recommendation for the MVP
**PMTiles-first.** For the MVP, prefer a single PMTiles archive (Protomaps hosted basemap, or a [[Planetiler]]-built regional cutout) served statically — zero new infrastructure, native MapLibre support, and it doubles as the offline package. Keep **USGS topo as the land-nav layer** via the existing per-page raster path. Defer **Martin** (and friends) to a **Power-User / home-server upgrade** once there's a real need for PostGIS-driven layers, server-side raster rendering, or combined dynamic sources. The registry + tile-proxy seam means this upgrade is additive, not a rewrite.

See also: [[PMTiles and Protomaps]], [[Planetiler]], [[Martin]], [[TileServer-GL]], [[pg_tileserv]], [[Self-Hosted Contours and Terrain]], [[Recommended Stack]], [[Staged Build Roadmap]]
