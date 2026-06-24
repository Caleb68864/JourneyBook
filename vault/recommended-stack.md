---
title: "Recommended Stack"
category: "summary"
status: researched
priority: high
related:
  - "React"
  - "Vite"
  - "Shadcn UI"
  - "Tailwind CSS"
  - "MapLibre GL JS"
  - "PDF Rendering Strategy"
  - "QuestPDF"
  - "Web App With Backend Renderer"
  - "PMTiles"
  - "Tauri"
  - "USGS National Map"
  - "OpenStreetMap"
source_urls:
  - "https://react.dev/learn"
  - "https://vite.dev/guide/"
  - "https://ui.shadcn.com/docs/installation/vite"
  - "https://tailwindcss.com/docs/installation/using-vite"
  - "https://maplibre.org/maplibre-gl-js/docs/"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://docs.protomaps.com/pmtiles/"
  - "https://v2.tauri.app/distribute/"
---

# Recommended Stack

## Recommendation
For the MVP, build Journey Book as a Docker-hosted web app on the home server. Use React, Vite, shadcn/ui, and Tailwind CSS for the browser UI. Use MapLibre GL JS for interactive preview and PMTiles for vector map packages.

Prefer client-side PDF generation from React if it can produce excellent print output. Keep QuestPDF as the server-side fallback if the client-side path cannot deliver crisp, reliable 8.5 x 11 atlas pages.

## Rendering Path
For MVP, build the atlas pages as React page components that can be previewed in the browser and exported to PDF. Test `@react-pdf/renderer` or a browser print/export path early, with real map panels, labels, scale bars, continuation labels, and attribution.

If client-side output is not good enough, keep the React UI and atlas metadata model, but move final PDF composition to QuestPDF on the server. QuestPDF should consume the same page-grid and page-furniture metadata rather than becoming a separate layout model.

## Data Path
Use downloaded or provider-permitted OSM-derived vector tiles, USGS public-domain layers, and local caches. Avoid relying on `tile.openstreetmap.org` for atlas export or offline downloads because the official policy forbids bulk/offline tile building.

## Deployment Path
Use Docker Compose on the home server:

1. Web frontend/API service.
2. Postgres/PostGIS service for projects and atlas geometry.
3. Optional PDF render service if QuestPDF is needed.
4. Optional geospatial worker for GDAL/Rasterio/Shapely.
5. Persistent volumes for projects, cache metadata, generated PDFs, and permitted offline map packages.

## Why This Stack
Docker gets the MVP to a usable family/network app faster than desktop packaging. React/Vite/shadcn/Tailwind keeps the UI fast to build and easy to polish. Keeping the preferred PDF renderer in React reduces layout drift between preview and export. MapLibre supports vector tile styling and offline-capable sources, and Python/GDAL remains the escape hatch for projections, clipping, rasterization, and future QGIS-style automation.

Tauri becomes valuable after the PDF engine and atlas workflow are proven: app-store distribution, offline desktop mode, direct local file access, local map archives, and a more polished installed-app experience.

Keep Tauri as a later packaging path, not the first implementation target. A future Tauri app can wrap the same React frontend and either call the home-server renderer or bundle the renderer locally for offline/app-store distribution.

See also: [[React]], [[Vite]], [[Shadcn UI]], [[Tailwind CSS]], [[MapLibre GL JS]], [[PDF Rendering Strategy]], [[QuestPDF]], [[Web App With Backend Renderer]], [[PMTiles]], [[Tauri]], [[USGS National Map]], [[OpenStreetMap]]
