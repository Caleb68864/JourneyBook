---
title: "Printable Atlas Generation"
category: "requirements"
status: researched
priority: high
related:
  - "Page Tiling 8.5x11"
  - "Exact Letter Page Sizing"
  - "Overview Map Plus Detailed Page Grid"
source_urls:
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page"
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
  - "https://www.w3.org/TR/css-page-3/"
---

# Printable Atlas Generation

Printable atlas generation means composing complete pages, not just map images. Each page needs map content plus page furniture: title, page ID, grid locator, compass rose, scale bar, legend, attribution, and neighbor labels.

The generator should treat the printable map rectangle as a measured physical area. It should know the page size, margins, DPI target, and map scale before rendering labels or tiles.

Output should be a multi-page PDF with consistent page order and repeatable geometry. The user should not need to adjust browser print settings to make the atlas fit.

See also: [[Page Tiling 8.5x11]], [[Exact Letter Page Sizing]], [[Overview Map Plus Detailed Page Grid]]
