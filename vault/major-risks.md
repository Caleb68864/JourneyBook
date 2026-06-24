---
title: "Major Risks"
category: "summary"
status: researched
priority: high
related:
  - "Wrong Projection Causing Scale Errors"
  - "OSM Tile Policy Violations"
  - "Low Resolution Printed Maps"
  - "Missing Attribution"
  - "Offline Map Storage Bloat"
source_urls:
  - "https://epsg.io/3857"
  - "https://operations.osmfoundation.org/policies/tiles/"
  - "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"
  - "https://developers.google.com/maps/faq"
---

# Major Risks

The riskiest part of Journey Book is not drawing a map. It is generating a printed atlas that is legally sourced, scale-aware, legible, and repeatable across home printers.

## Top Risks
- Projection and scale errors can make a printed scale bar false.
- Hosted tile policies can be violated by automated atlas export or offline downloads.
- Browser screenshots can look fine on screen but print soft at 300 DPI.
- Attribution can be clipped, hidden, or omitted when map pages are tiled.
- Offline regions can become huge if multiple zoom levels are downloaded naively.

## Practical Response
Build a print validation harness early. Every prototype PDF should include a measured scale bar, page boundary marks, attribution footer, and a pixel-density check.

See also: [[Wrong Projection Causing Scale Errors]], [[OSM Tile Policy Violations]], [[Low Resolution Printed Maps]], [[Missing Attribution]], [[Offline Map Storage Bloat]]
