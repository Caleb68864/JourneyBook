---
title: "pg_tileserv"
category: "self-hosting"
status: researched
priority: low
related:
  - "Martin"
  - "Self-Hosting Decision"
  - "Recommended Stack"
  - "Vector Tiles"
source_urls:
  - "https://github.com/CrunchyData/pg_tileserv"
  - "https://www.crunchydata.com/blog/crunchy-spatial-tile-serving-with-postgresql-functions"
  - "https://wheregroup.com/blog/details/pg-tileserv-der-postgis-only-tileserver/"
---

# pg_tileserv

## What It Does
pg_tileserv (CrunchyData) is a very thin, PostGIS-only tile server in Go. It takes an HTTP tile request, runs SQL against PostGIS, and returns an **MVT** vector tile generated **on the fly** — no caching or tiling middleware. It auto-publishes spatial **table layers** and parameterized **function layers**.

## Data Source
PostGIS only. Any table with a spatial column and an SRID becomes a layer; function layers let the client pass parameters into custom SQL for dynamic tiles.

## How It Fits JourneyBook
JourneyBook's stack already includes Postgres. pg_tileserv is the most minimal way to serve **the project's own spatial data** (custom landmarks, routes, school-route corridors, parks) as vector tiles straight from the DB, without a generation step. It is complementary to a basemap PMTiles file rather than a replacement: basemap from PMTiles, project overlays from pg_tileserv. Would appear as a [[TileSource Registry]] overlay row.

## License
Open source (Apache-2.0).

## vs Martin
[[Martin]] does everything pg_tileserv does **plus** MBTiles/PMTiles and source-combining. If JourneyBook self-hosts at all, Martin is usually the better single choice; pg_tileserv only wins on minimalism when the need is strictly "serve a few PostGIS tables." Security model: connect with a least-privilege DB user per service.

## Problems / Cautions
- PostGIS-only — cannot serve basemap MBTiles/PMTiles.
- On-the-fly with no built-in cache; heavy panning hits the DB unless fronted by the planned tile proxy/disk cache.
- No contours/topo of its own — overlay data only.

See also: [[Martin]], [[Recommended Stack]], [[Self-Hosting Decision]], [[Vector Tiles]]
