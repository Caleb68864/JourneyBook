---
title: "Offline Map Storage Bloat"
category: "pitfalls"
status: researched
priority: high
related:
  - "Disk Size Estimates"
  - "Downloading Selected Regions"
source_urls:
  - "https://docs.protomaps.com/pmtiles/"
  - "https://github.com/mapbox/mbtiles-spec"
---

# Offline Map Storage Bloat

## Risk
Offline maps can grow quickly across zoom levels.

## Why It Matters
A family app cannot silently consume many gigabytes.

## Mitigation
Estimate size, cap zoom, and download only selected regions.

## Prototype Check
Dry-run tile counts before download.

See also: [[Disk Size Estimates]], [[Downloading Selected Regions]]
