---
title: "USGS Topo Services"
category: "data-sources"
status: researched
priority: high
related:
  - "USGS National Map"
  - "Contours"
  - "USGS Public Domain Data"
source_urls:
  - "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer"
  - "https://apps.nationalmap.gov/services/"
  - "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"
---

# USGS Topo Services

## What It Provides
A tiled topographic reference basemap combining National Map themes such as boundaries, names, transportation, contours, hydrography, land cover, shaded relief, and bathymetry.

## API Type
ArcGIS REST MapServer and related cached tile/service endpoints.

## Limits and Access
Use as a public service with care. For repeated atlas generation, prefer downloaded source layers or provider-approved caching.

## Licensing
USGS/public-domain posture for National Map data; some US Topo products can include third-party data exceptions, so verify per layer/product.

## Attribution
Credit USGS/National Geospatial Program and any visible source attributions carried by the service.

## Commercial Use
Generally compatible with commercial use when public-domain data is used and attribution is preserved.

## Offline or Cache Use
Good for prototyping; for robust offline atlases, build from downloaded layers instead of scraping service tiles.

## Best Use In Journey Book
Fast way to get a familiar topo look for U.S. pages.

## Pitfalls
Raster labels can clip at page edges and may not render at print-optimal sizes.

See also: [[USGS National Map]], [[Contours]], [[USGS Public Domain Data]]
