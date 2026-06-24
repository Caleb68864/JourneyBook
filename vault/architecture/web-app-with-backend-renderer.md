---
title: "Web App With Backend Renderer"
category: "architecture"
status: researched
priority: high
related:
  - "Recommended Stack"
  - "MapLibre Screenshot PDF Renderer"
  - "API Key Dependence"
  - "Commercial vs Personal Use"
source_urls:
  - "https://pptr.dev/api/puppeteer.pdfoptions"
  - "https://playwright.dev/docs/docker"
  - "https://cloud.google.com/maps-platform/terms"
---

# Web App With Backend Renderer

A hosted web app handles project setup, map preview, rendering, and PDF generation. For Journey Book MVP, "hosted" can simply mean Docker Compose on the home server, not public SaaS.

## Pros
This path is the fastest MVP route: no desktop installer, no app-store packaging, easy access from any browser on the home network, centralized caches, and reproducible PDF generation through a Playwright/Chromium render container.

## Cons
Offline use is weaker than a desktop app, printing depends on the user opening/downloading the generated PDF, and remote access later will require authentication and careful handling of API keys/cache data.

## Best Use Case
Use this for MVP through early v1. It proves the hardest parts: atlas geometry, print-safe layout, PDF quality, attribution, and source selection.

## Pitfalls
Do not let the backend accidentally depend on restricted commercial map tiles. Keep rendering contracts clean so a future Tauri app can reuse the same API or run the same renderer locally.

See also: [[Recommended Stack]], [[MapLibre Screenshot PDF Renderer]], [[API Key Dependence]], [[Commercial vs Personal Use]]
