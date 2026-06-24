---
title: "PMTiles and Protomaps"
category: "self-hosting"
status: researched
priority: high
related:
  - "PMTiles"
  - "PMTiles Offline"
  - "Offline Map Storage"
  - "TileSource Registry"
  - "Planetiler"
  - "Self-Hosting Decision"
  - "Data Source Comparison"
source_urls:
  - "https://docs.protomaps.com/pmtiles/"
  - "https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md"
  - "https://docs.protomaps.com/pmtiles/maplibre"
  - "https://docs.protomaps.com/basemaps/downloads"
  - "https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md"
  - "https://docs.protomaps.com/pmtiles/create"
---

# PMTiles and Protomaps

## What It Does
PMTiles is a single-file archive holding a Z/X/Y tile pyramid. A reader fetches only the bytes it needs via HTTP range requests, so the file can sit on plain static storage (S3, Cloudflare R2, a NAS, a local disk) with **no tile-server process** running. Protomaps is the project behind PMTiles and also publishes a ready-made OpenStreetMap basemap distributed as one PMTiles file.

This is the lowest-ops way to add a self-hosted basemap to JourneyBook: drop a `.pmtiles` file behind the existing static/web layer and point MapLibre at it.

## Raster vs Vector
A PMTiles archive can hold **vector** tiles (MVT layers: water, roads, POIs), **raster** tiles (PNG/JPEG image tiles), or **raster-dem** (Terrarium/Terrain-RGB elevation). So the same format covers both a self-generated vector basemap and a packaged raster topo set. For JourneyBook's USGS topo (raster, public domain) a raster PMTiles works; for an OSM road/street basemap, vector PMTiles is the norm.

## How You Build / Obtain One
- **Hosted Protomaps basemap** — download a prebuilt planet (~120 GB, zoom 0-15) or a regional cutout. Daily builds at `maps.protomaps.com/builds`; an AWS us-west-2 mirror exists on Source Cooperative.
- **Cut out a region** — `pmtiles extract` pulls a spatial subset; `--maxzoom` drops unneeded zoom levels to shrink the file dramatically. Ideal for "package this trip area."
- **Self-generate** — build your own PMTiles from raw OSM with [[Planetiler]] (or [[Tilemaker]]); convert raster tiles into PMTiles with the `pmtiles` CLL/`go-pmtiles`.

## MapLibre Integration
MapLibre GL JS reads PMTiles natively via the `pmtiles://` protocol (one small JS plugin registers it). Source min/max zoom are derived automatically from the archive header. No proxy, no MBTiles server. See [[MapLibre GL JS]] and [[PMTiles]].

## How It Fits the Registry
In the planned [[TileSource Registry]] a PMTiles archive is "just another row": `sourceUrl` points at the file (local path or URL), `maxZoom` comes from the header, and the cache policy can be "already local, no proxy needed." It slots beside USGS topo rows without changing the rendering path — this is the seam the roadmap (ADR 0003, Stage 2D/3) was designed for.

## Offline Story
Excellent. A single file is trivial to copy to a laptop, a [[Tauri]] bundle, or (later) the Android app. Range-request reads work off a local file too, so the same archive serves both the home server and the offline hiker. Pairs with [[PMTiles Offline]] and [[Offline Map Storage]].

## Licensing
The Protomaps OSM basemap is an ODbL **Produced Work**: any map using it must visibly show **"© OpenStreetMap contributors"**. This is the OSM-derived attribution case in [[License Summary]] — distinct from USGS topo, which is public domain. See [[Self-Hosting Decision]].

## Problems / Cautions
- Tooling is newer than MBTiles, though now broadly stable.
- A full-planet vector file is large (~120 GB); always cut to region + capped maxzoom.
- Vector OSM basemaps are road/street-oriented and **lack contours** — for land-nav tiers you still want USGS topo or a generated contour overlay. See [[Self-Hosted Contours and Terrain]].

See also: [[PMTiles]], [[PMTiles Offline]], [[TileSource Registry]], [[Planetiler]], [[Self-Hosting Decision]], [[Offline Map Storage]]
