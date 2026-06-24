---
title: "MBTiles"
category: "map-rendering"
status: researched
priority: high
related:
  - "Offline Map Storage"
  - "SQLite Tile Cache"
source_urls:
  - "https://github.com/mapbox/mbtiles-spec"
---

# MBTiles

## What It Does
SQLite-based tileset container for raster or vector tiles.

## License
Open specification; implementation licenses vary.

## Best Fit
Good local storage format for selected regions.

## Problems
SQLite access is simple, but large files and scheme metadata need care.

## Install Complexity
Low to medium.

## Windows Compatibility
Excellent.

## Tauri Compatibility
Good as app data file.

## Offline Capability
Excellent if source terms allow offline packaging.

See also: [[Offline Map Storage]], [[SQLite Tile Cache]]
