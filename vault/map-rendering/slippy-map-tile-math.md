---
title: "Slippy Map Tile Math"
category: "map-rendering"
status: researched
priority: high
related:
  - "Printable Atlas Generation"
  - "Page Labeling A1 B2"
source_urls:
  - "https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames"
---

# Slippy Map Tile Math

Slippy map tilenames convert latitude/longitude and zoom into z/x/y tile indices. This is essential for fetching, stitching, and caching web tiles. The app should centralize this math and unit-test bounding boxes that cross tile boundaries.

See also: [[Printable Atlas Generation]], [[Page Labeling A1 B2]]
