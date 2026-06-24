---
title: "Android Atlas App"
category: "architecture"
status: researched
priority: medium
related:
  - "Staged Build Roadmap"
  - "MapLibre GL JS"
  - "PMTiles"
  - "Offline Map Storage"
  - "Route-Shaped Maps"
source_urls:
  - "https://developer.android.com/guide"
  - "https://maplibre.org/maplibre-native/android/"
  - "https://docs.protomaps.com/pmtiles/"
  - "https://v2.tauri.app/distribute/mobile/"
---

# Android Atlas App

The Android app is a post-MVP direction after the printable atlas workflow is excellent. It should not replace the print-first product; it should reuse the atlas model, page grid, routes, landmarks, and source metadata created for print.

## Atlas-Page Interface

The distinctive mobile mode should mimic the rendered PDF atlas. Each page is a screen-sized or zoomable atlas sheet with the same page ID, compass rose, scale bar, route overlays, landmarks, and continuation labels as the printed version.

Navigation can follow the paper atlas metaphor:
- Scroll or swipe up to move to the grid page north.
- Scroll or swipe down to move south.
- Swipe left/right to move west/east.
- Tap a continuation label to jump to the referenced page.
- Use a small overview grid to jump to A1, B2, and other pages.

This mode teaches the same spatial model as the binder. A child using the phone should understand the printed atlas better, not switch into an unrelated app experience.

## Google-Maps-Style Interface

The app should also offer a conventional map mode for normal digital navigation:
- Pan/zoom continuous map.
- User location marker.
- Route overview.
- Landmark search/filter.
- Page-grid overlay toggle.
- Button to jump from current map position to the matching atlas page.

This mode is useful for adults and for orientation, but it should not be the first mobile experience to build. The differentiator is the atlas-page interface.

## Data Model Reuse

The mobile app should consume the same core project model:
- Atlas extent.
- Page grid cells.
- Page IDs and neighbor relationships.
- Route geometry.
- Landmark records.
- Tile source metadata.
- Attribution text.
- Generated PDF/page preview artifacts when available.

Avoid creating a separate Android-only map model. If the printed PDF and Android atlas page disagree, the product becomes harder to teach and maintain.

## Offline Direction

PMTiles remains a strong fit for Android because map packages can be stored as single files and read by range. The app can download a project package for offline use after the server creates or approves a bounded region package.

For MVP-plus mobile, prefer project-scoped downloads over global map downloads. The app should ask for a Journey Book project, then download only the needed atlas data, tiles, and page metadata.

## Technology Options

Likely options:
- Native Android with Kotlin and MapLibre Native for the conventional map mode.
- React Native if code sharing with the web UI becomes important.
- Tauri mobile only if its Android story fits the team and app-store goals at that time.

This decision should be postponed until the print/PDF system is stable.

## Pitfalls

Do not let Android requirements distort the print MVP. The print renderer should remain the source of truth for page geometry, scale, and attribution.

Do not use Google Maps tiles or SDK as the atlas source unless the licensing model is re-reviewed. A Google-like UI does not need Google map data.

See also: [[Staged Build Roadmap]], [[MapLibre GL JS]], [[PMTiles]], [[Offline Map Storage]], [[Route-Shaped Maps]]
