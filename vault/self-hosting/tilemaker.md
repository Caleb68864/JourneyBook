---
title: "Tilemaker"
category: "self-hosting"
status: researched
priority: low
related:
  - "Planetiler"
  - "PMTiles and Protomaps"
  - "Self-Hosting Decision"
  - "Vector Tiles"
source_urls:
  - "https://github.com/systemed/tilemaker"
  - "https://github.com/systemed/tilemaker/blob/master/docs/RUNNING.md"
  - "https://shortbread-tiles.org/make-vectortiles/tilemaker/"
---

# Tilemaker

## What It Does
Tilemaker is a C++ command-line tool that builds vector tiles directly from an `.osm.pbf` file "without the stack" (no PostGIS, no Node). It outputs **MBTiles** or **PMTiles**. It is the main alternative to [[Planetiler]] for the OSM -> vector-tiles step.

## Inputs / Output
- Input: an OSM extract (`.osm.pbf`) plus a Lua/JSON config and layer profile (e.g. Shortbread).
- Output: `.mbtiles` or `.pmtiles`.

## Resources
Keeps data in RAM by default, but a `--store` option spills to SSD so it can process large areas on **modest hardware** — its key advantage over Planetiler, which wants ~32 GB RAM for a planet. Tilemaker is generally slower than Planetiler but lighter on memory.

## How It Fits JourneyBook
Same role as Planetiler: self-generate a road/street basemap for chosen regions, own it, no third-party limits. Choose Tilemaker when the home server is **RAM-constrained** or you prefer a no-JVM C++ tool; choose Planetiler when you have the RAM and want raw speed. Output feeds [[PMTiles and Protomaps]] / [[Martin]] / [[TileServer-GL]] and a [[TileSource Registry]] row.

## License
Open source (FTWPL / BSD-style — verify current repo license).

## Problems / Cautions
- Slower than Planetiler for large areas.
- ODbL output (OSM-derived) — "© OpenStreetMap contributors".
- No contours — road/street vector only; see [[Self-Hosted Contours and Terrain]].

See also: [[Planetiler]], [[PMTiles and Protomaps]], [[Self-Hosting Decision]], [[Vector Tiles]]
