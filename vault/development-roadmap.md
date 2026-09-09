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
> **Third pass, 2026-09-09 — three closed, one escalated for a decision.**
>
> - **CLOSED — SSRF in the tile-source registry.** Two controls, because either
>   alone is insufficient. *Authorisation:* `AdminApiKeyGate` on the registry's
>   POST/PUT/DELETE (reads stay anonymous), failing **closed** — no key
>   configured means read-only. It is a shared key, not invented identity: this
>   API has no authentication at all and adding some is a product decision.
>   *Egress:* `TileEgressPolicy` enforced in a `SocketsHttpHandler`
>   `ConnectCallback`, so the check runs against the address actually being
>   connected to, on every connection including redirect hops — a URL-string
>   check cannot work, because an attacker's own DNS can answer public at
>   registration and `127.0.0.1` at fetch time. Redirects refused; IPv4-mapped
>   IPv6 unwrapped. **What it does not stop:** a sensitive host in *public*
>   address space (set `Tiles:AllowedHosts` for that — the deny-ranges are only
>   the floor), exfiltration to an attacker-controlled public host, anything at
>   all under the `Tiles:AllowPrivateNetworks` dev escape hatch, and the other
>   HTTP clients (Overpass, Nominatim, render worker), which take their base URLs
>   from configuration rather than user input.
> - **CLOSED — no exception handler.** `UseExceptionHandler` over a pure
>   `ExceptionMapping.Map`. Validation exceptions → 400 (409 for a duplicate tile
>   source key, matching the endpoint beneath it); everything else → 500 with the
>   message **discarded** and logged instead, since an arbitrary exception message
>   is an internal detail. The existing per-endpoint catches stay, so no response
>   body and no integration assertion moves.
> - **CLOSED — test files were never typechecked.** The build keeps excluding
>   them (dist must not ship tests); a `tsconfig.test.json` per workspace includes
>   them with `noEmit` and `typecheck` runs both. Nine real errors surfaced and
>   were fixed, not suppressed.
> - **ESCALATED, not started — async render with progress and cancel.** This one
>   needs a decision rather than an implementation, so nothing was guessed. See
>   the note below.
>
> **Async render — the decision this needs.** Useful finding: the persistence is
> already there. `PdfStatus` is `Pending → Rendering → Completed → Failed`, the
> `GeneratedPdf` row is created *before* the worker is invoked, and
> `GET /api/generated-pdfs/{id}` already reads it. Nothing ever sets `Rendering`,
> the POST blocks on the worker, and there is no cancel. So the remaining work is
> a transport and an ownership choice, not a schema one:
>
> - **A. In-process background task in the API.** POST returns 202 immediately,
>   a `BackgroundService`/channel drives the worker call, the web app polls
>   `GET /generated-pdfs/{id}`. Cheapest by far and needs no new infrastructure.
>   Cost: a render dies with the API process, and it does not survive scale-out.
> - **B. The worker owns jobs.** `POST /render` returns a job id, the worker keeps
>   a job registry with per-page progress, the API proxies status and cancel.
>   Correct place for the knowledge (only the worker knows it is on page 12 of
>   60) and gives real cancel. Cost: new state and a new contract in a service
>   that is currently stateless, and ADR 0005 governs that boundary.
> - **C. A durable queue.** Survives restarts and scales out; genuinely new
>   infrastructure for a product that today runs one API and one worker.
>
> Progress transport is a second axis (poll vs SSE vs WebSocket); polling pairs
> with A and B and needs nothing new. **Recommendation if forced: B for progress
> and cancel, with A's 202 as the first step** — but this is a product/ADR call,
> not an audit fix, so it is left open deliberately.
>
> Suites after this pass: **178 TS** (unchanged — the TS work was typechecking,
> which found no runtime defects) and **79 .NET** non-Docker (was 29): +7
> `ExceptionMappingTests`, +39 `TileEgressPolicyTests`, +4
> `AdminApiKeyGateTests`. Three new `Api` integration tests were written but
> **have not been run** — Testcontainers needs a Docker daemon this machine
> lacks.
>
> Still open from the audit and worth scheduling: the async render above, the
> unvalidated render-worker wire input, the absent linter/formatter, and neither
> tile cache ever evicting. See `vault/audit-2026-09-08/scan-summary.md`.

> **Maintainability pass 4 — 2026-09-09** (findings in
> `vault/maintainability-2026-09-09.md`). Nine items; **all nine closed**. The
> theme was the one the 30% scale bug already taught and the tree had not yet
> finished learning: *a check whose two sides come from the same function
> agrees with itself.* Two live defects fell out of fixing the tests that could
> not fail.
>
> - **The map panel was never cropped to the bbox.** `renderMapPanel` chained
>   `.extract()` onto `.composite()`; sharp applies operations in pipeline order,
>   not call order, so the blank canvas was cropped first and the tiles were then
>   composited onto the crop at their full-mosaic offsets. Every panel was the
>   top-left of the tile grid, anchored on a tile boundary instead of the bbox —
>   misregistered by up to a full 256 px tile, about **460 m of ground at
>   1:24,000**, on a printed map whose whole purpose is navigating by it. Every
>   tile fixture in the tests served the same flat colour, so the composite was
>   uniform and any crop window was byte-identical to the right one; the only
>   assertions were `widthPx > 0` / `heightPx > 0`. `panel.test.ts` now serves
>   self-locating tiles whose every pixel encodes its own global Web-Mercator
>   address, so a painted pixel decodes back to the ground it shows. This is the
>   30% bug's failure mode one layer upstream, and it was found by writing the
>   test the audit asked for.
> - **The overview page never got the fixes the atlas pages got.** `OverlaySvg`
>   exists, and its comment says why — a square viewBox over a non-square panel
>   letterboxes every overlay — and it was used at four of five call sites.
>   `OverviewPage` kept `viewBox="0 0 1000 1000"` over a 487 × 625 pt panel plus
>   an `objectFit: "cover"` the atlas pages had already dropped, so its page
>   rectangles, route and stops sat 69 pt off-register over a basemap cropped the
>   other way. An index map whose squares do not sit on the ground they name is
>   worse than none. Untested; now four tests, all four failing on the old code.
> - **`validateAtlas` can now detect a false scale bar**, which the roadmap, the
>   README and its own doc comment all wrongly said it already could. It gained
>   `printed-scale-fidelity`, taking the map box measured off the rendered PDF —
>   the only input that does not come out of the contract — and `journeybook
>   validate` (this project's declared e2e validation command) renders and
>   measures before reporting. When nothing was measured the check is reported
>   `unmeasured` / `[SKIP]`, never as a pass. The corrections are recorded in
>   `staged-build-roadmap.md` beside the claims they replace.
> - **The printed-scale test now measures both axes.** It computed the page's
>   ground height and never asserted it; height was only ever compared against
>   `mapBoxInches()`, the function the renderer laid out from. A 1.3× error in
>   `groundFootprintMeters().heightMeters` now fails that one assertion and
>   nothing else.
> - **The golden fixture asserts something**, and
>   `scripts/regenerate-sample-atlas.mjs` reproduces it byte for byte from
>   recorded parameters (`--check` proves it). Its only real assertion had been
>   `validateAtlas(...).pass`, so it inherited that tautology and would have
>   accepted a wrong atlas.
> - **`pdf-measure` has tests** — 22 of them, over hand-written content streams.
>   It is the instrument every scale claim rests on and it had none.
> - **The default zoom has headroom.** At 1:24,000 a 1000 px panel selects z16
>   and USGS Topo's ceiling is z16; `--panel-px 2000` asked for z17 and every
>   tile 404'd, so asking for a sharper print produced no print. Now clamped and
>   warned. **Not fixed, and a real product limit: 1000 px over 5.76 in is ~173
>   DPI, and the 300 DPI target at this scale needs z17, which this source does
>   not have.** Reaching it needs a deeper basemap, not a bigger number — worth
>   scheduling against Stage 7.
> - **Project references** added where two workspaces imported packages they did
>   not reference (a clean `tsc -b apps/web` failed with 15 errors), with
>   `harness/checks/project-references.sh` in CI so it cannot silently return.
> - **Four status documents that described four different repos** — this
>   roadmap's sibling, the README, `harness/progress.json` and
>   `forge-project.json` — reconciled, with a note in each saying they move
>   together.
>
> Suites after this pass: **223 TS** (was 178; +45, every one of them a test that
> could previously not fail) and **79 .NET** non-Docker, unchanged — this pass
> touched no C# beyond reading the seeded `TileSource.MaxZoom`. The Docker-gated
> `Api` integration suites **were not run**: this machine has no daemon, and CI's
> `dotnet-integration` job is the only place they execute.
>
> Still open, and now the largest items on this roadmap: the async render
> decision above, the ~173 DPI ceiling, the unvalidated render-worker wire input,
> the absent linter/formatter, and neither tile cache ever evicting.

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
