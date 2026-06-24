# ADR 0003 — Headless map-panel rendering (Stage 1C)

- Status: accepted
- Date: 2026-06-24

## Context

Stage 1C is the flagged spike: render a page's map panel **headless** (no browser
UI) at print resolution, in the page's projection, so the Stage 1D PDF shows a
real map instead of a placeholder. The roadmap framed the choice as
"maplibre-gl-native vs. static vector-to-raster."

## Decision

Render each page's panel from **public-domain USGS National Map raster tiles**
(Web Mercator XYZ), composited and cropped to the page bbox with `sharp`, then
embedded in the PDF as a PNG image (`@react-pdf/renderer` `<Image>`).

- `@journeybook/map-sources`: `tilemath.ts` (Web Mercator pixel/tile math,
  TDD, 6 tests) + `panel.ts` (`renderMapPanel(bbox, targetWidthPx, basemap)`).
- Default basemap `USGS_TOPO` (`basemap.nationalmap.gov`, ArcGIS `{z}/{y}/{x}`),
  attribution "USGS The National Map".
- CLI: `journeybook render … --basemap` fetches a panel per page.

### Why this over the alternatives
- **maplibre-gl-native** — no reliable Windows prebuilt; fragile native toolchain.
- **headless-browser MapLibre (Playwright/Chromium)** — works but adds a heavyweight
  browser dependency to the render path; deferred as a future vector option.
- **static vector→raster (decode MVT + draw)** — large styling burden to reach
  topo-map quality; not worth it for the MVP.
- USGS raster is **permissively licensed** (public domain — no OSM tile-policy
  issue), needs no map engine, and is on-brand for a land-nav app.

### Projection note (why true scale survives)
Pages use a page-centred transverse Mercator for a true scale bar (ADR/Stage 1B).
Tiles are Web Mercator. Within a single small page (a 1:24,000 Letter page is
~3 × 4 mi) the difference between Web Mercator and the local projection is
negligible, so cropping WebMercator tiles to the page bbox keeps the map aligned
and the **scale bar — computed in the true local projection — stays valid**.
The distortion WebMercator introduces is an inter-page / large-extent effect,
not a within-page one.

## Consequences / failure modes

- **Network at render time**: panels require reaching USGS; cache tiles for big
  atlases (a 36-page book is ~hundreds of tile fetches). Caching is future work.
- **US-only coverage**: USGS is domestic; international atlases need another
  permissive source (or the deferred vector path).
- **Raster, not vector**: text crispness is bounded by tile resolution at high
  print DPI; a vector basemap path remains open if needed.
- **Self-generated USNG/MGRS grid (research decision) layers on top** of this
  raster panel in Stage 6B — independent of the basemap source.

## Verified

A location page rendered headless over Lincoln, NE: USGS topo panel
(1165 × 924 px, z14/z15) composited, embedded in a true-scale Letter PDF with
page ID, scale bar, compass, and attribution — confirmed visually by rasterising
the PDF. No UI involved.
