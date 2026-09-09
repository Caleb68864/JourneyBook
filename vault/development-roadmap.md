---
title: "Development Roadmap"
category: "summary"
status: researched
priority: high
related:
  - "MVP Plan"
  - "Staged Build Roadmap"
  - "Branding Theme"
  - "Recommended Architecture"
  - "Offline Map Storage"
  - "Kid-Friendly Exercises"
  - "Android Atlas App"
source_urls:
  - "https://pptr.dev/api/puppeteer.pdfoptions"
  - "https://react-pdf.org/"
  - "https://www.questpdf.com/license/community.html"
  - "https://apps.nationalmap.gov/services/"
  - "https://docs.protomaps.com/pmtiles/"
  - "https://developer.android.com/guide"
---

# Development Roadmap

> **Audit 2026-09-08.** A five-pass re-scan of the tree (notes in
> `vault/audit-2026-09-08/`, cross-project view in `../../ROADMAP.md`) found a
> defect that sits underneath Phase 1 and should be fixed before any further
> print work is scheduled: **the printed map is roughly 30% off its stated
> scale.** `atlas-core/src/page.ts:53` sizes each page's ground bbox from the
> full printable area (7.5in = 540pt), while `pdf-client/src/AtlasDocument.tsx`
> paints that bbox into a `flexGrow:1` panel sitting between two 54pt edge
> labels — about 430pt. A 1:24,000 atlas therefore prints near 1:31,200, under
> a scale bar that states 1:24,000. True scale on paper is this project's
> entire premise, so this is the roadmap's real Phase 1 blocker.
>
> The reason it went unnoticed is worth recording: `atlas-core`'s
> `validateAtlas` compares the bbox against the scale using the *same*
> assumption on both sides, so it agrees with itself, and `packages/pdf-client`
> (~800 lines) has no tests at all. Nothing in the project measures a rendered
> PDF. The fix and the measurement should land together.
>
> Also confirmed: **Tier 4 is selectable in `TierPicker.tsx:7` and renders
> exactly as Tier 3** (`AtlasDocument.tsx:487-488`). This roadmap correctly
> records Level 4 as deferred — it is the picker that oversells it, so the
> honest short-term fix is in the UI, not here.

> **Audit 2026-09-08 — closed on `fix/audit-2026-09-08`.** Eight of the audit's
> findings are fixed, each with a test that fails without the fix. Evidence
> below; the full reasoning is in `docs/decisions.md` under the same date.
>
> - **CLOSED — printed scale ~30% wrong.** `atlas-core/page.ts` gained
>   `PAGE_FURNITURE_PT` + `mapBoxInches`; the printed map box (Letter portrait,
>   0.5in margins: **415 × 549 pt = 5.7639 × 7.625 in**) is the printable area
>   less the neatline, the two 54pt continuation-label columns, the header, the
>   continuation rows, the notes block and the footer. `groundFootprintMeters`
>   measures that box, and `AtlasDocument` lays every page out from the same
>   constants, sizing the map panel *explicitly* instead of letting it grow into
>   whatever the furniture leaves. Measured off the rendered PDF, the panel was
>   also **not constant** before: 608.25pt untitled, 599.23pt with a subtitle,
>   582.85pt when the book title wrapped, 640.30pt with notes off — four scales
>   in one atlas. It is now one box on every page.
> - **CLOSED — nothing measured a rendered PDF.** New
>   `pdf-client/src/pdf-measure.ts` reads a produced PDF back (content-stream
>   rectangles, image placements, lines, standard-14 text, in points).
>   `scale-fidelity.test.ts` asserts `barLength/panelWidth ==
>   barGroundMetres/pageFootprintMetres` on the real output; it read 0.569 vs
>   0.219 before the fix. `packages/pdf-client` went from **0 to 9 tests**.
> - **Page-count consequence, accepted:** true scale covers less ground per
>   page, so atlases are longer — measured **15 → 18** pages (Lincoln→Omaha at
>   1:100,000), **20 → 30** (a 20×20 km box at 1:24,000), **2 → 4** (a 5×5 km
>   park). `MAX_ATLAS_PAGES` (200) now spans ~59% of the area it used to. The
>   only way to buy the page count back is to give the map more paper by
>   shrinking the furniture (narrower edge-label columns, a shorter notes block)
>   — a layout decision, deliberately left open rather than guessed at here.
> - **CLOSED — USNG grid labels computed then discarded.** `buildUsngGrid`'s
>   `labels` are drawn along all four edges, so a Tier 3 grid is one you can take
>   a reference off.
> - **CLOSED — square viewBox on a non-square panel.** Every overlay (USNG,
>   route, landmarks, reference grid) now shares `OverlaySvg`, whose viewBox *is*
>   the map box. They were letterboxed 67pt out of register.
> - **CLOSED — two panel geometries in one atlas.** `objectFit: "cover"` below
>   tier 3 was measured painting a 549×549 image into the 415×549 box, cropping
>   the map away. The panel image is already cropped to the page bbox, so it
>   fills the box exactly at every tier.
> - **CLOSED — `buildPageGrid` materialised every page before the 200-page cap.**
>   The continental US at 1:24,000 took **134.7 s** to produce an error; the cap
>   now runs on the row/column counts, before any page exists.
> - **CLOSED — Tier 4 was selectable and printed as Tier 3.** The picker offers
>   1–3 and `MapTier`'s doc comment records that Level 4 is on this roadmap but
>   implemented by no renderer. **Level 4 remains deferred here — unchanged.**
> - **CLOSED — both tile caches served half-written `.tmp` files as hits.** Node
>   and C# now match `{y}` or `{y}.{ext}` with a single extension segment.
> - **CLOSED — `.dockerignore` omitted `.env`.** Added, with
>   `harness/checks/secrets.sh` evaluating the ignore rules the way Docker does.
>
> Suites after the pass: **atlas-core 64, web 3 (new), map-sources 34,
> pdf-client 9 (new), render-cli 41, render-worker 6 = 157 TS** (was 138), and
> **29 .NET** non-Docker (was 27). The `Api` integration suites still need a
> Docker daemon; this machine denies the socket.
>
> **Second pass, 2026-09-09 — seven more closed on the same branch.**
>
> - **CLOSED — failed tiles became parchment and the render reported success.**
>   `renderMapPanel` now rejects a panel missing **more than 10%** of its tiles.
>   The threshold is deliberate: not zero, because raster pyramids have genuine
>   holes (a page clipping the USGS coverage edge legitimately 404s a few tiles
>   and must still render); not lenient, because at ~35 tiles a page that
>   tolerates three absent tiles still rejects a missing row, a throttled source
>   or an outage. Tolerated holes are reported on `MapPanel` and warned per page
>   instead of passing silently.
> - **CLOSED — the Node tile fetch was unbounded.** Descriptive `User-Agent`
>   (the same `JourneyBook/1.0 (…)` shape as the Overpass/Nominatim clients — the
>   Overpass 406 was this same bug), 10 s per-attempt timeout, 3 attempts with
>   backoff, and a 6-way concurrency cap. Retries are keyed on transience:
>   408/425/429/5xx retry, 404/403 do not.
> - **CLOSED — the scale picker was a no-op after project creation.** It now
>   persists through `PUT /api/projects/{id}`, which has accepted the field since
>   Stage 2B. Fixing it required carrying `margins` through the web adapter,
>   since that PUT replaces every grid field — `rename` was already resetting the
>   user's page setup, and a naive `setScale` would have added a second way to.
> - **CLOSED — grid page ids collided with the `L#`/`R#` namespaces.** `L` and
>   `R` are reserved out of the grid row alphabet, so a label can no longer
>   contain either letter in any position and the three namespaces are provably
>   disjoint at every grid size. The golden fixture is a 2x2 grid, so it did not
>   move.
> - **CLOSED — the PDF printed a hardcoded attribution.** The credit now comes
>   from the tile source actually used: the proxy's `X-Tile-Attribution` header,
>   else an explicit override, else the basemap's own. With no basemap the footer
>   claims no map source at all.
> - **CLOSED — no CI pipeline.** `.github/workflows/ci.yml`, four jobs. On
>   Docker: **both, split** — GitHub-hosted ubuntu runners ship a daemon, so the
>   Testcontainers PostGIS suite does run, as its own job, while `dotnet-unit`
>   runs the same `--filter "FullyQualifiedName!~Api"` a contributor without
>   Docker uses locally. **Unverified from here: the workflow has never run.**
> - **CLOSED — compose shipped `Development` and a default DB password.** The
>   password is now a required variable at both use sites, `Production` is the
>   default, and the DB port binds to loopback. `.env.example` (which the README
>   says to copy) shipped both weak values too and was fixed with it.
>
> Suites after this pass: **atlas-core 66, map-sources 46, pdf-client 12,
> render-cli 41, render-worker 6, web 7 = 178 TS** (was 157), **29 .NET**
> non-Docker (unchanged — no backend code changed). End-to-end on a real bbox:
> a 6-page 1:24,000 atlas measures a constant **415.00 x 549.00 pt** map box on
> every page and prints **1:24,008** against a claimed 1:24,000 (0.03%, the
> geodesic-vs-planar residual). A live USGS basemap render fetched 98 of 99
> tiles, warned about the one it missed, and printed "USGS The National Map" in
> the footer.
>
> Still open from the audit and worth scheduling: the SSRF on anonymous
> tile-source registration, the synchronous single-request render (no progress,
> no cancel), the unvalidated render-worker wire input, and the absent
> linter/formatter. See `vault/audit-2026-09-08/scan-summary.md`.

## Phase 1: Print Geometry
Build the Docker-hosted React/Vite/shadcn/Tailwind web app skeleton, define the outdoor field-guide visual system, accept bounding boxes, create page grid, generate overview and detail pages, and validate Letter-size PDF output from the preferred client-side React PDF path.

## Phase 2: Map Sources
Add OSM-derived vectors, USGS public-domain layers, Natural Earth overview data, and source-specific attribution.

## Phase 3: Routes and Landmarks
Import or calculate routes, simplify polylines, find nearby landmarks, and render callouts without label collisions.

## Phase 4: Offline Regions
Add provider-permitted PMTiles or MBTiles downloads for selected regions, cache invalidation, and disk-size estimates.

## Phase 5: Education Layer
Add compass lessons, map-scale exercises, landmark challenges, and printable navigator worksheets.

## Phase 6: Product Polish
Add templates, branding, preview editing, print calibration, shareable saved projects, and then evaluate Tauri packaging for offline/app-store distribution.

## Phase 7: Mobile Atlas
After the printing version is excellent, explore an Android app that reuses the generated atlas model. Prioritize an atlas-page interface that mimics the rendered PDFs, then add a conventional mobile map mode with current location, route context, and page-grid overlay.

See also: [[MVP Plan]], [[Staged Build Roadmap]], [[Branding Theme]], [[Recommended Architecture]], [[Offline Map Storage]], [[Kid-Friendly Exercises]], [[Android Atlas App]]
