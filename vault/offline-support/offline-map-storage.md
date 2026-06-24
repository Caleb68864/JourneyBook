---
title: "Offline Map Storage"
category: "offline-support"
status: researched
priority: high
related:
  - "Offline Map Storage"
  - "License Summary"
source_urls:
  - "https://operations.osmfoundation.org/policies/tiles/"
  - "https://github.com/mapbox/mbtiles-spec"
  - "https://docs.protomaps.com/pmtiles/"
---

# Offline Map Storage

Offline maps should be built from data or providers that explicitly allow offline use. The cleanest storage options are PMTiles, MBTiles, or local vector/raster packages by selected region. Never implement offline download against `tile.openstreetmap.org`.

See also: [[Offline Map Storage]], [[License Summary]]
