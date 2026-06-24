---
title: "Planetiler"
category: "self-hosting"
status: researched
priority: medium
related:
  - "PMTiles and Protomaps"
  - "Tilemaker"
  - "Self-Hosting Decision"
  - "Vector Tiles"
  - "Offline Map Storage"
source_urls:
  - "https://github.com/onthegomap/planetiler"
  - "https://github.com/onthegomap/planetiler/blob/main/PLANET.md"
  - "https://docs.protomaps.com/pmtiles/create"
  - "https://wiki.openstreetmap.org/wiki/Planetiler"
---

# Planetiler

## What It Does
Planetiler is a Java tool that generates vector tilesets from OpenStreetMap (and other geo data) **fast**, on a single machine, with no external database. It writes directly to **MBTiles** or **PMTiles**. This is the "self-generate your own basemap" path: feed it an `.osm.pbf`, get back a basemap archive you own outright.

## Inputs
- An OSM extract (`.osm.pbf`) — a country/region extract (e.g. from Geofabrik) for a regional basemap, or the full `planet.osm.pbf` for the world.
- Optionally Natural Earth / water polygons for low-zoom context.
- A profile (e.g. the OpenMapTiles or Shortbread schema) defining which features land in which layers.

## Output Sizes (rough)
- **Netherlands** extract -> ~700 MB MBTiles (~683 MB once converted to PMTiles).
- **Full planet**, zoom 0-15 -> on the order of 100+ GB (Protomaps' published planet is ~120 GB).
Regional extracts are the realistic target for a home server; cap maxzoom to shrink further.

## Runtime / Resources
- Needs roughly **1.5x the input `.pbf` size in RAM** for node/relation lookups; ~32 GB RAM recommended for a full planet.
- Needs **5-10x the input size in scratch disk** during rendering.
- Full planet: ~40 CPU-hours, but parallel — ~3 hours on 16 cores, under an hour on 64. A single-country extract finishes in **minutes** on a normal machine.

## How It Fits JourneyBook
This is the Power-User / home-server upgrade for road/street/international basemaps: generate a [[PMTiles and Protomaps]] file for exactly the regions you care about, own it forever, no third-party rate limits or ToS. Output drops into the [[TileSource Registry]] as a new row and is served either directly (PMTiles) or via [[Martin]] / [[TileServer-GL]].

## Licensing
Output is derived from OSM -> **ODbL**, requires "© OpenStreetMap contributors". See [[License Summary]].

## Problems / Cautions
- Higher baseline RAM than [[Tilemaker]]; for very low-spec hardware Tilemaker (with `--store`) or sequential planet tooling is friendlier.
- Vector OSM output is road/street-oriented and has **no contour lines** — pair with [[Self-Hosted Contours and Terrain]] for land-nav use.
- Java toolchain to run, though it ships as a single jar / Docker image.

See also: [[PMTiles and Protomaps]], [[Tilemaker]], [[Martin]], [[Self-Hosting Decision]], [[Vector Tiles]]
