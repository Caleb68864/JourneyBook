---
title: "Clipped Labels"
category: "pitfalls"
status: researched
priority: high
related:
  - "Tile Stitching"
  - "Landmark Callouts"
source_urls:
  - "https://mapbox.github.io/vector-tile-spec/"
---

# Clipped Labels

## Risk
Labels can be cut at tile or page boundaries.

## Why It Matters
A clipped road or landmark label is confusing on paper.

## Mitigation
Use vector rendering with collision management or add page overlap. Avoid stitching public raster labels where possible.

## Prototype Check
Inspect every page edge in generated PDFs.

See also: [[Tile Stitching]], [[Landmark Callouts]]
