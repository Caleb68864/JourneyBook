---
title: "MGRS USNG Map Acquisition"
category: "research"
status: researched
priority: high
related:
  - "Captain Input — Road Atlas vs Land Nav"
  - "Progressive Map Skills Curriculum"
  - "Land Nav Learning Curve Recommendation"
  - "TC 3-25.26 Part 1 Map Reading and Land Navigation"
  - "Staged Build Roadmap"
source_urls:
  - "https://www.usgs.gov/faqs/do-all-usgs-75-minute-topographic-maps-show-utm-grid"
  - "https://ngmdb.usgs.gov/topoview/viewer/"
  - "https://www.usgs.gov/programs/national-geospatial-program/us-topo-maps-america"
  - "https://usngcenter.org/usgs-us-topo-maps/"
  - "https://www.fgdc.gov/usng/how-to-read-usng"
  - "https://en.wikipedia.org/wiki/United_States_National_Grid"
  - "https://www.npmjs.com/package/mgrs"
  - "https://github.com/ngageoint/mgrs-js"
  - "https://www.npmjs.com/package/usng2"
---

# MGRS USNG Map Acquisition

This note directly answers the captain-conversation blocker from [[Captain Input — Road Atlas vs Land Nav]]: *"you also have to get MGRS maps, which tbh I'm not sure how to get."*

**Short answer: you have two paths, and the second is the better fit.** (1) Download free USGS US Topo maps that already carry a national grid, or (2) **generate the grid yourself** in Journey Book and overlay it on any basemap. Journey Book should do (2).

## USNG Is The Civilian Name For MGRS

The **U.S. National Grid (USNG)** is functionally identical to **MGRS** within the U.S.: same underlying UTM zones, same 100,000 m square IDs, same coordinate format. A USNG and an MGRS coordinate for the same point are the same string. USNG is the FGDC-standard civilian/emergency-management labeling; MGRS is the global military name. **For kids, label it USNG** (civilian, friendly, identical math) and note "the Army calls this MGRS." See [[Progressive Map Skills Curriculum]].

## Path 1 — Get Pre-Made Maps (free)

You do not have to buy or specially request "MGRS maps." Modern USGS topo maps already have the grid:

- **All US Topo 7.5-minute (1:24,000) maps published after 2009 carry a full UTM grid implemented in conformance with the U.S. National Grid standard.** The grid lines are spaced every 1000 m; the same lines serve UTM, USNG, and MGRS.
- US Topo GeoPDFs are **layered** — the grid is a layer you can toggle on/off.
- **Where to download free:**
  - **topoView** (`ngmdb.usgs.gov/topoview/viewer/`) — 3M+ downloadable historical + current US Topo files (2009→present).
  - **The National Map / US Topo** download pages.
  - **topoBuilder → OnDemand Topos** — request a custom quad on demand.
- Note: USGS topo maps for decades have printed 1000 m UTM **tick marks** in the collar; only the post-2009 US Topo editions draw the **full grid** and include the USNG info box (Grid Zone Designator + 100 km square IDs) in the collar.

This matches Journey Book's existing **Standard Scale Presets** note in [[Staged Build Roadmap]] — the 7.5-minute / 1:24,000 preset is the same quad standard.

## Path 2 — Generate The Grid Ourselves (recommended)

Journey Book does not need to source military maps at all. Because USNG/MGRS is pure math on WGS84 lat/lng, **the app can render its own grid lines and labels over any basemap** (Protomaps/PMTiles, USGS, etc.) at the chosen scale. This is the right answer because:

- It sidesteps the acquisition problem entirely (no hunting for the right quad).
- It works for **hiking trips and road trips alike**, anywhere, at any of our scale presets.
- The grid becomes a **toggleable tier** in the learning curve (Level 3 UTM, Level 4 full MGRS) rather than a property of a downloaded file. See [[Progressive Map Skills Curriculum]].

### Programmatic tooling (all JS, fits the TS monorepo)

- **`mgrs` / `proj4js/mgrs`** (npm) — convert WGS84 lat/lng ↔ MGRS/USNG string. Spun off from proj4js.
- **`usng2`** (npm) — USNG/MGRS converter with documented Cesium/OpenLayers examples.
- **`@ngageoint/mgrs-js`** — NGA's official MGRS library (grid zones, 100 km squares, lines/labels) — authoritative and built for drawing grids, not just point conversion.

Implementation sketch: for a page's extent, walk the 1000 m (or 10 km / 100 m, scale-dependent) UTM eastings/northings, project each gridline to the page's local projection (Journey Book already does per-page local projection — Stage 1B), draw lines + edge labels, and add the USNG collar box. This lives naturally in `packages/map-sources/` and feeds the page-furniture contract in `packages/pdf-client/`.

## Recommendation

Default to **Path 2 (self-generated USNG grid as an opt-in tier)**, and let advanced users also pull a real USGS US Topo quad (Path 1) for ground-truth comparison. This is captured as the **UTM/MGRS overlay spike** already listed in **Stage 6B** of [[Staged Build Roadmap]] — this research promotes it from "spike" to "the answer is generate-our-own, label it USNG."

See also: [[Captain Input — Road Atlas vs Land Nav]], [[Progressive Map Skills Curriculum]], [[Land Nav Learning Curve Recommendation]], [[TC 3-25.26 Part 1 Map Reading and Land Navigation]], [[Staged Build Roadmap]]
