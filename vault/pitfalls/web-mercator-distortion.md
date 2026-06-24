---
title: "Web Mercator Distortion"
category: "pitfalls"
status: researched
priority: high
related:
  - "Web Mercator EPSG 3857"
  - "Scale Bars"
source_urls:
  - "https://epsg.io/3857"
---

# Web Mercator Distortion

## Risk
Web Mercator distorts scale away from the equator.

## Why It Matters
A page in Minnesota and a page in Texas at the same zoom do not have the same ground scale in raw Web Mercator pixels.

## Mitigation
Use local projected measurement for print scale or clearly compute scale at page center.

## Prototype Check
Export the same nominal page at different latitudes and confirm scale bar math.

See also: [[Web Mercator EPSG 3857]], [[Scale Bars]]
