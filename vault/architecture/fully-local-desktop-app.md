---
title: "Fully Local Desktop App"
category: "architecture"
status: researched
priority: high
related:
  - "Tauri"
  - "Offline Map Storage"
source_urls:
  - "https://v2.tauri.app/concept/architecture/"
  - "https://docs.protomaps.com/pmtiles/"
---

# Fully Local Desktop App

All data, rendering, and PDF generation happen on the user's machine. Pros: privacy, offline use, no server costs, reliable printing. Cons: packaging large geospatial dependencies and data updates. Best for family/offline product. Pitfalls: disk use, native dependencies, provider licensing for packaged data.

See also: [[Tauri]], [[Offline Map Storage]]
