---
title: "Wrong Projection Causing Scale Errors"
category: "pitfalls"
status: researched
priority: high
related:
  - "Web Mercator EPSG 3857"
  - "Map Scale Calculations"
source_urls:
  - "https://epsg.io/3857"
---

# Wrong Projection Causing Scale Errors

## Risk
Printed scale bars and distance exercises can be wrong if distance is measured in degrees or unadjusted Web Mercator units.

## Why It Matters
Kids and parents will trust the scale bar. A false scale undermines the educational value.

## Mitigation
Use a suitable projected CRS for measurement or apply latitude-aware corrections. Test scale bars against known distances.

## Prototype Check
Generate a page with two known points and compare printed ruler distance to calculated ground distance.

See also: [[Web Mercator EPSG 3857]], [[Map Scale Calculations]]
