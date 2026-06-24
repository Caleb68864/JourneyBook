---
title: "Low Resolution Printed Maps"
category: "pitfalls"
status: researched
priority: high
related:
  - "300 DPI Export"
  - "DPI and Print Resolution"
source_urls:
  - "https://pptr.dev/api/puppeteer.pdfoptions"
---

# Low Resolution Printed Maps

## Risk
Screen-resolution maps can print blurry.

## Why It Matters
A map that looks fine at 1000 px wide may fail on Letter paper.

## Mitigation
Target 300 DPI raster output or vector PDF content for labels/lines.

## Prototype Check
Render a page, inspect pixel dimensions, and print a detail sample.

See also: [[300 DPI Export]], [[DPI and Print Resolution]]
