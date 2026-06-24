---
title: "Recommended Architecture"
category: "architecture"
status: researched
priority: high
related:
  - "Recommended Stack"
  - "MVP Plan"
  - "PDF Rendering Strategy"
  - "Web App With Backend Renderer"
  - "MapLibre Screenshot PDF Renderer"
source_urls:
  - "https://maplibre.org/maplibre-gl-js/docs/"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://v2.tauri.app/distribute/"
---

# Recommended Architecture

Recommended MVP path: Docker-hosted web app on the home server. Use React, Vite, shadcn/ui, and Tailwind CSS for the UI, MapLibre preview, client-side React PDF generation when quality is acceptable, and persistent volumes for projects, generated PDFs, cache metadata, and permitted map packages.

Recommended v1 evolution: add a Python/GDAL/Shapely worker for geospatial processing and keep QuestPDF available as the exact-composition fallback if client-side PDF output is not precise enough. Use USGS/public-domain data and provider-permitted OSM-derived vector archives.

Recommended future distribution path: once the atlas workflow and PDF engine are stable, wrap the React app with Tauri for offline desktop/app-store distribution. The Tauri version should reuse the same rendering contracts rather than becoming a separate product.

See also: [[Recommended Stack]], [[MVP Plan]], [[PDF Rendering Strategy]], [[Web App With Backend Renderer]], [[MapLibre Screenshot PDF Renderer]]
