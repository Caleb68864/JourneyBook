---
title: "Sheet-to-Sheet Navigation Labels"
category: "requirements"
status: researched
priority: high
related:
  - "Neighbor References"
  - "Continuation Labels"
  - "Route Crossing Many Pages"
source_urls:
  - "https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames"
---

# Sheet-to-Sheet Navigation Labels

Continuation labels make the atlas behave like a book. At each edge with a neighbor, show labels such as "Continue north on A2" or "Continue east on B1".

For routes that cross the page boundary, place a route-specific continuation label near the crossing point. For general map browsing, place a quieter edge label centered on the side.

Labels should never sit outside the safe print rectangle. If an edge has no neighbor, use no label rather than "end".

See also: [[Neighbor References]], [[Continuation Labels]], [[Route Crossing Many Pages]]
