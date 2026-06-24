---
title: "OSM Tile Policy Violations"
category: "pitfalls"
status: researched
priority: high
related:
  - "OSM Tile Usage Policy"
  - "OSM Data vs Hosted Tiles"
source_urls:
  - "https://operations.osmfoundation.org/policies/tiles/"
---

# OSM Tile Policy Violations

## Risk
Using `tile.openstreetmap.org` for export, prefetch, or offline packages violates policy.

## Why It Matters
This is the easiest hidden licensing mistake in the project.

## Mitigation
Do not use OSM hosted tiles for atlas export. Use OSM data, extracts, or a provider that allows the intended use.

## Prototype Check
Search code/config for tile.openstreetmap.org before release.

See also: [[OSM Tile Usage Policy]], [[OSM Data vs Hosted Tiles]]
