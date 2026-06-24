---
title: "Proj4"
category: "map-rendering"
status: researched
priority: high
related:
  - "WGS84 EPSG 4326"
  - "Web Mercator EPSG 3857"
  - "UTM Grid"
source_urls:
  - "https://github.com/proj4js/proj4js"
  - "https://proj.org/"
---

# Proj4

## What It Does
Coordinate transformation library family for converting between CRS definitions.

## License
Proj4js is MIT; PROJ is X/MIT.

## Best Fit
Essential for coordinate transformations in JS; PROJ/GDAL for heavier backend work.

## Problems
CRS definitions and datum transforms must be correct.

## Install Complexity
Low for Proj4js, medium for PROJ.

## Windows Compatibility
Good.

## Tauri Compatibility
Good in webview for Proj4js.

## Offline Capability
Fully offline after definitions are bundled.

See also: [[WGS84 EPSG 4326]], [[Web Mercator EPSG 3857]], [[UTM Grid]]
