---
title: "Data Source Comparison"
category: "summary"
status: researched
priority: high
related:
  - "OpenStreetMap"
  - "USGS National Map"
  - "Natural Earth"
  - "TIGER Line Roads"
  - "3DEP Elevation"
  - "NHD Hydrography"
source_urls:
  - "https://www.openstreetmap.org/copyright"
  - "https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map"
  - "https://www.naturalearthdata.com/"
  - "https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html"
  - "https://www.usgs.gov/3d-elevation-program/about-3dep-products-services"
  - "https://www.usgs.gov/national-hydrography/national-hydrography-dataset"
---

# Data Source Comparison

| Source | Best For | License Posture | Offline Fit | Main Caution |
|---|---|---|---|---|
| OpenStreetMap data | Roads, paths, POIs, landmarks | ODbL with attribution and share-alike database rules | Good if using data/extracts legally | Do not confuse data with hosted tiles |
| USGS National Map | U.S. topo, contours, hydrography, elevation | Public domain with requested source credit | Excellent | U.S.-only and service styling may not fit kids |
| Natural Earth | Overview maps | Public domain | Excellent | Too coarse for detail pages |
| TIGER/Line | U.S. roads, boundaries, address ranges | U.S. government public data | Excellent | Roads may lag local reality |
| 3DEP | Elevation, hillshade, contours | Public domain | Good but large | DEM processing complexity |
| State/county GIS | Local parks, schools, structures | Varies by agency | Varies | Schema and license inconsistency |

Recommendation: combine OSM-derived features with USGS public-domain topographic layers. Use Natural Earth only for overview/context pages.

See also: [[OpenStreetMap]], [[USGS National Map]], [[Natural Earth]], [[TIGER Line Roads]], [[3DEP Elevation]], [[NHD Hydrography]]
