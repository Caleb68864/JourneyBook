---
title: "Overpass API"
category: "data-sources"
status: researched
priority: high
related:
  - "OpenStreetMap"
  - "Overpass Landmark Queries"
  - "Landmarks Near Route"
source_urls:
  - "https://wiki.openstreetmap.org/wiki/Overpass_API"
---

# Overpass API

## What It Provides
Query access to OSM data by tags, bounding boxes, polygons, and proximity filters.

## API Type
HTTP API using Overpass QL or XML query syntax. Public instances and self-hosted deployments are available.

## Limits and Access
Public instance limits vary by server load and instance policy. Heavy or repeated atlas generation should use cached results, regional extracts, or a private instance.

## Licensing
Returned OSM data remains ODbL.

## Attribution
Attribution should follow OSM attribution requirements.

## Commercial Use
Commercial use of the data is allowed under ODbL. Commercial reliance on a public Overpass instance is operationally risky.

## Offline or Cache Use
Cache query results where license-compliant. For offline, prefer extracts instead of calling public Overpass repeatedly.

## Best Use In Journey Book
Finding landmarks near a route or inside each page cell.

## Pitfalls
Timeouts, incomplete responses, and tag inconsistency. Query design can overload public services.

See also: [[OpenStreetMap]], [[Overpass Landmark Queries]], [[Landmarks Near Route]]
