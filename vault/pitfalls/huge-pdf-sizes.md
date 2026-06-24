---
title: "Huge PDF Sizes"
category: "pitfalls"
status: researched
priority: high
related:
  - "Route Polyline Rendering"
  - "300 DPI Export"
source_urls:
  - "https://pptr.dev/api/puppeteer.pdfoptions"
---

# Huge PDF Sizes

## Risk
High-resolution rasters and dense vectors can create enormous PDFs.

## Why It Matters
Large files are slow to generate, share, and print.

## Mitigation
Simplify geometry, compress rasters, and reuse assets.

## Prototype Check
Set file-size budgets for 4, 20, and 50 page atlases.

See also: [[Route Polyline Rendering]], [[300 DPI Export]]
