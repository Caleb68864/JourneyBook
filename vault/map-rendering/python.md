---
title: "Python"
category: "map-rendering"
status: researched
priority: high
related:
  - "GDAL"
  - "Rasterio"
  - "Shapely"
  - "GeoPandas"
  - "ReportLab"
source_urls:
  - "https://docs.python.org/3/"
---

# Python

## What It Does
Runtime for geospatial processing, clipping, reprojection, raster processing, and deterministic PDF composition.

## License
Python Software Foundation License.

## Best Fit
Best worker language for GIS-heavy tasks.

## Problems
Packaging Python inside a desktop app can be fiddly.

## Install Complexity
Medium to high with GDAL stack.

## Windows Compatibility
Good with wheels/conda, but GDAL dependencies need discipline.

## Tauri Compatibility
Works as a bundled sidecar, not directly inside webview.

## Offline Capability
Excellent with packaged data.

See also: [[GDAL]], [[Rasterio]], [[Shapely]], [[GeoPandas]], [[ReportLab]]
