---
title: "TileServer-GL"
category: "self-hosting"
status: researched
priority: medium
related:
  - "Martin"
  - "PMTiles and Protomaps"
  - "MBTiles"
  - "Self-Hosting Decision"
  - "Print and PDF"
source_urls:
  - "https://github.com/maptiler/tileserver-gl"
  - "https://tileserver.readthedocs.io/en/latest/config.html"
  - "https://openmaptiles.org/docs/host/tileserver-gl/"
  - "https://hub.docker.com/r/maptiler/tileserver-gl"
---

# TileServer-GL

## What It Does
TileServer-GL is a Node.js tile server (by MapTiler) that serves vector **and** raster tiles from MBTiles plus GL style JSON. Its differentiator is **server-side rasterization** via MapLibre GL Native: it renders vector tiles into PNG raster tiles, WMTS, and a static-maps API — the same style served to web, mobile, and as flat images.

## Inputs
- **MBTiles** as the primary data source (`mbtiles://source.mbtiles`).
- GL **style JSON** referencing those sources, plus fonts/sprites.
Ships as an official Docker image; Node 20+ required if running from npm.

## How It Fits JourneyBook
The server-side raster rendering is the interesting bit for a **printable atlas**: JourneyBook ultimately needs flat raster images on the page (PDF pipeline, [[Print and PDF]]). TileServer-GL can turn a self-generated vector basemap ([[Planetiler]]/[[Tilemaker]] -> MBTiles) into print-ready PNG/WMTS tiles server-side, rather than rasterizing in the browser. Surfaced as a [[TileSource Registry]] row behind the tile proxy.

## License
Open source (BSD-2-Clause for the core).

## vs Martin
- **[[Martin]]** is leaner, Rust, PostGIS-native, MIT/Apache — best when the data lives in Postgres or you only need vector tiles out.
- **TileServer-GL** is heavier (Node + GL Native), MBTiles-centric, but **rasterizes server-side** — best when you need PNG/WMTS/static images, which a print product does.

## Problems / Cautions
- Heavier runtime (Node + native GL) than Martin or static PMTiles.
- MBTiles-oriented; less direct PMTiles/PostGIS flexibility than Martin.
- Still road/street vector data underneath — no contours without [[Self-Hosted Contours and Terrain]].

See also: [[Martin]], [[PMTiles and Protomaps]], [[MBTiles]], [[Self-Hosting Decision]], [[Print and PDF]]
