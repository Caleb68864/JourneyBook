---
title: "Martin"
category: "self-hosting"
status: researched
priority: medium
related:
  - "PMTiles and Protomaps"
  - "TileServer-GL"
  - "pg_tileserv"
  - "Self-Hosting Decision"
  - "Recommended Stack"
source_urls:
  - "https://github.com/maplibre/martin"
  - "https://maplibre.org/martin/"
  - "https://maplibre.org/martin/architecture/"
  - "https://wiki.openstreetmap.org/wiki/Martin_(tile_server)"
---

# Martin

## What It Does
Martin is a fast, lightweight tile server written in Rust, maintained under the MapLibre org. It serves vector tiles on the fly from **PostGIS**, and serves **MBTiles** and **PMTiles** (local files or over HTTP), and can combine multiple sources into one endpoint. It also serves styles, generates sprites/glyphs, and bulk-generates tiles (`martin-cp`).

## Supported Sources
- **PostGIS** tables and functions — auto-discovered.
- **MBTiles** files.
- **PMTiles** — local or remote.
Point it at a file or a directory of `*.mbtiles` / `*.pmtiles` and it serves them; `--save-config` writes a YAML config you can edit.

## How It Fits JourneyBook
JourneyBook already runs **Postgres in Docker** (per the stack). Martin is the natural tile server when self-hosting graduates beyond a static PMTiles file — it reuses the existing Postgres/PostGIS and Docker stack, and can simultaneously serve a generated [[PMTiles and Protomaps]] basemap. It would sit behind the planned tile proxy / `/api/tiles/{source}/{z}/{x}/{y}` path, surfaced as a [[TileSource Registry]] row. See [[Recommended Stack]].

## License
MIT / Apache-2.0 (dual). Permissive.

## vs Alternatives
- **vs static PMTiles** — adds a running process; only worth it when you need PostGIS-driven dynamic layers or to combine many sources.
- **vs [[pg_tileserv]]** — Martin also reads MBTiles/PMTiles and is broader; pg_tileserv is PostGIS-only and thinner.
- **vs [[TileServer-GL]]** — Martin does not server-side rasterize to PNG/WMTS; TileServer-GL does. For JourneyBook's PDF pipeline that rasterization can matter.

## Problems / Cautions
- A running service to operate and monitor (vs zero-process PMTiles).
- Vector PostGIS/OSM data still lacks contours for land nav — see [[Self-Hosted Contours and Terrain]].

See also: [[PMTiles and Protomaps]], [[pg_tileserv]], [[TileServer-GL]], [[Self-Hosting Decision]], [[Recommended Stack]]
