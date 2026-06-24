---
title: "MapLibre GL JS"
category: "map-rendering"
status: researched
priority: high
related:
  - "Vector Tiles"
  - "MapLibre Screenshot PDF Renderer"
source_urls:
  - "https://maplibre.org/maplibre-gl-js/docs/"
  - "https://github.com/maplibre/maplibre-gl-js"
---

# MapLibre GL JS

## What It Does
WebGL map renderer for vector tiles, styles, markers, and interactive preview.

## License
BSD-3-Clause.

## Best Fit
Best interactive map preview and potentially print render source.

## Problems
Headless rendering can be trickier than browser display; labels need print QA.

## Install Complexity
Medium.

## Windows Compatibility
Works in Chromium/WebView2 with WebGL support.

## Tauri Compatibility
Good in Tauri webview.

## Offline Capability
Works with local tiles/styles/glyphs/sprites.

See also: [[Vector Tiles]], [[MapLibre Screenshot PDF Renderer]]
