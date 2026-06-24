---
title: "Tile Rate Limits"
category: "pitfalls"
status: researched
priority: high
related:
  - "OSM Tile Usage Policy"
  - "OpenTopoMap"
source_urls:
  - "https://operations.osmfoundation.org/policies/tiles/"
  - "https://github.com/der-stefan/OpenTopoMap"
---

# Tile Rate Limits

## Risk
Automated atlas generation can request many tiles quickly.

## Why It Matters
Public tile services may block the app or violate usage policies.

## Mitigation
Use downloaded datasets, PMTiles/MBTiles, or paid/provider-approved tile services. Rate-limit preview requests.

## Prototype Check
Log tile requests for a 20-page atlas and estimate provider load.

See also: [[OSM Tile Usage Policy]], [[OpenTopoMap]]
