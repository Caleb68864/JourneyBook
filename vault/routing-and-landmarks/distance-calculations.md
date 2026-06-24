---
title: "Distance Calculations"
category: "routing-and-landmarks"
status: researched
priority: high
related:
  - "Landmark Selection"
  - "Route Highlighting"
source_urls:
  - "https://epsg.io/3857"
  - "https://epsg.io/4326"
  - "https://turfjs.org/"
---

# Distance Calculations

Use projected/geodesic calculations deliberately. Page scale bars need projected ground distance; route totals should come from route geometry or routing engine output; straight-line Haversine distance is a different concept.

See also: [[Landmark Selection]], [[Route Highlighting]]
