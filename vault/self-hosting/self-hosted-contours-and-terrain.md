---
title: "Self-Hosted Contours and Terrain"
category: "self-hosting"
status: researched
priority: high
related:
  - "PMTiles and Protomaps"
  - "Self-Hosting Decision"
  - "3DEP Elevation"
  - "USGS National Map"
  - "Data Source Comparison"
source_urls:
  - "https://github.com/nst-guide/terrain"
  - "https://www.usgs.gov/3d-elevation-program/about-3dep-products-services"
  - "https://blog.mastermaps.com/2012/07/creating-contour-lines-with-gdal-and.html"
  - "https://github.com/joe-akeem/contour-tiles"
---

# Self-Hosted Contours and Terrain

## The Problem
OSM-derived vector basemaps ([[Planetiler]], [[Tilemaker]], the Protomaps basemap) are **road/street** maps — they carry essentially **no contour lines or terrain shading**. That is exactly the land-nav-grade information JourneyBook's higher tiers need. So a purely self-hosted OSM basemap cannot, by itself, replace USGS topo for land navigation. Contours/terrain must be generated separately from elevation data.

## Inputs (elevation / DEM)
- **USGS 3DEP** — seamless DEMs at 1 arc-second (~30 m) and 1/3 arc-second (~10 m), public domain, best US coverage.
- **SRTM** — ~30 m near-global, for non-US / international.
Both are public-domain raster elevation grids, independent of OSM's ODbL.

## Outputs you can generate
- **Contour lines** — `gdal_contour` over the DEM produces contour vectors at a chosen interval; tile them into MBTiles/PMTiles as a vector overlay. `gdal_contour` is single-threaded, so loop per-DEM-tile and parallelize.
- **Hillshade** — raster relief shading, overlaid under other layers.
- **Terrain-RGB / Terrarium** — encodes elevation per-pixel so MapLibre can do client-side hillshade/3D (also storable as raster-dem in [[PMTiles and Protomaps]]).
- **Slope-angle shading** — useful for terrain awareness.
The `nst-guide/terrain` project packages this exact gdalwarp -> gdal_contour -> tile pipeline.

## How It Fits JourneyBook
This is what lets a self-hosted / vector basemap reach **land-nav grade**: a self-generated contour + hillshade overlay sits on top of an OSM road basemap, mirroring what USGS topo gives for free in the US. Each becomes a [[TileSource Registry]] overlay row. For the US, however, USGS topo already bundles contours — so self-generating contours mainly matters **internationally** or when fully self-hosting/offline beyond US coverage.

## Licensing
DEM-derived contours/hillshade from 3DEP/SRTM are public domain — **no ODbL attribution** needed for the terrain layer itself (the road basemap underneath may still be OSM/ODbL). Cleaner license story than the vector basemap.

## Recommendation (brief)
Keep **USGS topo for US land-nav tiers** (contours come free, public domain). Reserve self-generated contours/hillshade for **international coverage** or a fully-offline self-hosted stack. This is the "mixed model" in [[Self-Hosting Decision]].

See also: [[PMTiles and Protomaps]], [[Self-Hosting Decision]], [[3DEP Elevation]], [[USGS National Map]], [[Data Source Comparison]]
