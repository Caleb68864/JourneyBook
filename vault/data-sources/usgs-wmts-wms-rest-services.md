---
title: "USGS WMTS WMS REST Services"
category: "data-sources"
status: researched
priority: medium
related:
  - "USGS National Map"
  - "Raster Tiles"
  - "Tile Stitching"
source_urls:
  - "https://apps.nationalmap.gov/services/"
---

# USGS WMTS WMS REST Services

## What It Provides
Service endpoints for many USGS/National Map layers, including cached basemaps and dynamic GIS layers.

## API Type
REST, WMS, WMTS, WFS, WCS, and download APIs, varying by dataset.

## Limits and Access
No one-size limit. Implement polite request scheduling and prefer downloads for batch atlas work.

## Licensing
Usually public-domain USGS data, but check the specific service metadata.

## Attribution
Preserve USGS and layer-specific attribution.

## Commercial Use
Generally allowed for USGS-authored public-domain data.

## Offline or Cache Use
Prefer official downloads for offline. Use services for preview or small export workloads.

## Best Use In Journey Book
Layer access without building a full data pipeline on day one.

## Pitfalls
Different projections, image formats, scale dependencies, and service uptime assumptions.

See also: [[USGS National Map]], [[Raster Tiles]], [[Tile Stitching]]
