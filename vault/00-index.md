---
title: "Journey Book Research Index"
category: "index"
status: researched
priority: high
related:
  - "Project Overview"
  - "Recommended Stack"
  - "MVP Plan"
  - "Staged Build Roadmap"
  - "Branding Theme"
  - "Data Source Comparison"
  - "License Summary"
  - "Major Risks"
  - "Development Roadmap"
  - "Open Questions"
source_urls:
  - "https://www.openstreetmap.org/copyright"
  - "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"
  - "https://operations.osmfoundation.org/policies/tiles/"
  - "https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40page/size"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
---

# Journey Book Research Index

Journey Book is a printable atlas generator for families and kids. The core product takes selected locations, routes, or bounding boxes and emits binder-ready 8.5 x 11 pages with a consistent north-up map, page grid labels, scale bar, compass rose, landmark callouts, route highlights, and continuation labels.

## Best Recommended Stack
Build the MVP as a Docker-hosted web app on the home server. Use React, Vite, shadcn/ui, and Tailwind CSS for the UI, MapLibre GL JS for interactive preview, and client-side React PDF generation if it can produce excellent 8.5 x 11 output. Add QuestPDF as a server-side fallback only if client-side PDF quality is not good enough. Keep Tauri as a later wrapper/offline/app-store path after the PDF engine is proven.

## Best Data Sources
Use OpenStreetMap data for roads, paths, and landmarks; USGS National Map services for U.S. topographic context, elevation, hydrography, and public-domain layers; Natural Earth for overview pages; Census TIGER/Line as a U.S. roads/boundaries fallback; and state/county GIS only where local landmark quality matters enough to handle inconsistent schemas.

## Biggest Risks
The major risks are projection scale errors, tile policy violations, low-resolution printed output, missing attribution, printer margin drift, contour label readability, offline tile storage bloat, and route-shaped atlases that cross many page boundaries.

## MVP Path
Prototype one selected bounding box into a 4-page atlas. Use USGS/OSM-derived sources, a fixed scale, 0.25 inch safe margins, A1/B1 page labels, neighbor references, a small overview index, and a visible attribution footer. Add routes and kid challenges only after page geometry is reliable.

## Build Roadmap
Use [[Staged Build Roadmap]] as the implementation path. It starts with Docker Compose, Postgres/PostGIS, a React/Vite/shadcn/Tailwind frontend, a backend tile proxy, and a client-side React PDF proof-of-concept, then adds page geometry, cache manifests, landmarks, routes, polish, and a QuestPDF fallback only if needed.

## Brand Direction
Use [[Branding Theme]] as the visual guide: rugged field-guide clarity with junior-explorer warmth. The app should use stencil display type, dark greens and browns, parchment/cream print surfaces, and practical outdoor/hiker cues while staying kid-friendly but not childish.

## Prototype First
First prove page tiling and print fidelity: one north-up extent, four detailed pages, one overview page, route line, landmarks, continuation labels, and a 300 DPI export check. The map can be simple at first; the atlas math must be solid.

See also: [[Project Overview]], [[Recommended Stack]], [[MVP Plan]], [[Staged Build Roadmap]], [[Branding Theme]], [[Data Source Comparison]], [[License Summary]], [[Major Risks]], [[Development Roadmap]], [[Open Questions]]
