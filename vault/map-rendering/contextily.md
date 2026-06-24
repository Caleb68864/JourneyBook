---
title: "Contextily"
category: "map-rendering"
status: researched
priority: low
related:
  - "GeoPandas"
  - "Raster Tiles"
source_urls:
  - "https://contextily.readthedocs.io/"
---

# Contextily

## What It Does
Python helper to fetch web tiles and add basemaps to matplotlib/geopandas plots.

## License
BSD-3-Clause project; verify current package metadata.

## Best Fit
Good for research notebooks, not production atlas tile fetching.

## Problems
Default providers may have tile policies; fetching can violate terms if used blindly.

## Install Complexity
Low.

## Windows Compatibility
Good.

## Tauri Compatibility
Python sidecar.

## Offline Capability
Only with local/provider-allowed tiles.

See also: [[GeoPandas]], [[Raster Tiles]]
