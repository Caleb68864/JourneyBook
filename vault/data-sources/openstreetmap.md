---
title: "OpenStreetMap"
category: "data-sources"
status: researched
priority: high
related:
  - "OSM ODbL"
  - "OSM Data vs Hosted Tiles"
  - "Overpass API"
  - "Overpass Landmark Queries"
source_urls:
  - "https://www.openstreetmap.org/copyright"
---

# OpenStreetMap

## What It Provides
Crowdsourced global roads, paths, POIs, landuse, natural features, buildings, and route-relevant landmarks.

## API Type
Raw data extracts, planet files, regional extracts, Overpass queries, Nominatim geocoding, and many third-party tile/vector services.

## Limits and Access
The data license does not impose API rate limits, but public OSM-hosted services each have their own policies. For production, use extracts, a provider, or self-hosted infrastructure.

## Licensing
Open Database License (ODbL). Attribution is required, and publicly used adapted databases may trigger share-alike obligations.

## Attribution
Use visible text such as '(c) OpenStreetMap contributors' with the correct license context.

## Commercial Use
Allowed under ODbL if obligations are met.

## Offline or Cache Use
OSM data can be stored and processed offline. OSM-hosted tiles are a separate service and cannot be bulk downloaded for offline atlases.

## Best Use In Journey Book
Primary source for roads, paths, landmarks, and many kid-recognizable POIs.

## Pitfalls
Data quality varies by area. ODbL obligations must be understood before distributing derived datasets.

See also: [[OSM ODbL]], [[OSM Data vs Hosted Tiles]], [[Overpass API]], [[Overpass Landmark Queries]]
