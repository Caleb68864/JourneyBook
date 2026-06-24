---
title: "MVP Plan"
category: "summary"
status: researched
priority: high
related:
  - "Recommended Stack"
  - "PDF Rendering Strategy"
  - "Page Tiling 8.5x11"
  - "Splitting Extent Into Pages"
  - "Neighbor References"
  - "Exact Letter Page Sizing"
  - "Required Attribution Text"
source_urls:
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
  - "https://pptr.dev/api/puppeteer.pdfoptions"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"
  - "https://operations.osmfoundation.org/policies/tiles/"
---

# MVP Plan

## MVP Goal
Generate a printable 8.5 x 11 PDF atlas from one user-provided bounding box using a Docker-hosted React web app, preferably with client-side React PDF generation.

## Scope
The MVP should include one overview page, a detailed page grid, page IDs such as A1 and B2, north-up rendering, scale bar, compass rose, visible attribution, simple legend, route overlay if provided, and continuation labels on map edges.

## Implementation Steps
1. Host the React/Vite/shadcn/Tailwind app and API in Docker Compose on the home server.
2. Accept a bounding box in WGS84.
3. Reproject the extent into a local projected CRS or Web Mercator for preview, then compute print scale.
4. Split the printable map area into page-sized cells with optional overlap.
5. Render each cell at a fixed scale and 300 DPI target using the preferred client-side React PDF path.
6. Add page furniture: title, page ID, scale bar, compass rose, grid locator, neighbor labels, legend, attribution.
7. Export PDF, download/open it from the browser, and visually inspect print size.
8. If client-side output is not good enough, spike QuestPDF as a server-side fallback.

## Defer
Defer Tauri packaging, app-store distribution, route-shaped atlases, offline region download UI, MGRS, full landmark ranking, kid worksheets, and a production QuestPDF service unless client-side PDF quality fails.

See also: [[Recommended Stack]], [[PDF Rendering Strategy]], [[Page Tiling 8.5x11]], [[Splitting Extent Into Pages]], [[Neighbor References]], [[Exact Letter Page Sizing]], [[Required Attribution Text]]
