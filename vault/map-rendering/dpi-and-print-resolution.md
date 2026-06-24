---
title: "DPI and Print Resolution"
category: "map-rendering"
status: researched
priority: high
related:
  - "Printable Atlas Generation"
  - "Page Labeling A1 B2"
source_urls:
  - "https://pptr.dev/api/puppeteer.pdfoptions"
---

# DPI and Print Resolution

A 300 DPI Letter page is 2550 x 3300 pixels before margins. If the map is rasterized below that, roads and labels may look soft. Vector PDFs are better, but raster basemaps must be rendered or sampled at print resolution.

See also: [[Printable Atlas Generation]], [[Page Labeling A1 B2]]
