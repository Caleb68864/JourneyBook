---
title: "Canvas"
category: "map-rendering"
status: researched
priority: medium
related:
  - "Tile Stitching"
  - "Cairo"
source_urls:
  - "https://github.com/Automattic/node-canvas"
---

# Canvas

## What It Does
Cairo-backed Canvas implementation for Node.js.

## License
MIT.

## Best Fit
Useful when browser-like 2D drawing is needed server-side.

## Problems
Native Cairo/Pango dependencies can be annoying.

## Install Complexity
Medium to high.

## Windows Compatibility
Windows install can require GTK/Cairo setup when binaries fail.

## Tauri Compatibility
Works as Node sidecar, not in webview.

## Offline Capability
Offline.

See also: [[Tile Stitching]], [[Cairo]]
