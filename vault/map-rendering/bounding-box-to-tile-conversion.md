---
title: "Bounding Box To Tile Conversion"
category: "map-rendering"
status: researched
priority: high
related:
  - "Printable Atlas Generation"
  - "Page Labeling A1 B2"
source_urls:
  - "https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames"
  - "https://epsg.io/3857"
---

# Bounding Box To Tile Conversion

Convert the requested WGS84 bbox to tile ranges at the selected zoom, then expand to cover partial tiles. Keep bbox math separate from page tiling math: tiles are web-rendering units, pages are print-layout units.

See also: [[Printable Atlas Generation]], [[Page Labeling A1 B2]]
