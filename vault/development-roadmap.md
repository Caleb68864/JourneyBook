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
>   warned. ~~Not fixed, and a real product limit: 1000 px over 5.76 in is ~173
>   DPI, and the 300 DPI target at this scale needs z17, which this source does
>   not have. Reaching it needs a deeper basemap, not a bigger number — worth
>   scheduling against Stage 7.~~ **This was wrong in its number, wrong in its
>   diagnosis and backwards in its remedy. Corrected 2026-09-10 — see
>   "Print resolution" below.**
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

> **Async render — decided and half-landed (2026-09-09).** The owner chose **B
> with A's 202 as the first step**. The 202 has landed; worker-owned progress has
> not. Written up as **`docs/decisions/0006-asynchronous-rendering.md`** — an ADR
> in a directory that is now tracked, because `docs/*` was ignored and ADRs 0001
> and 0003–0005 are cited in nine places with **no text in the repo** (see
> `docs/decisions/README.md`; reconstructing them is a separate item, still open).
>
> **Landed.** `POST /api/projects/{id}/render` answers **202** with
> `{ generatedPdfId, status: "Pending", downloadUrl, statusUrl }` and a `Location`
> header naming the status resource, not the PDF. `RenderService` does all the
> reading inside the request scope and enqueues the *already-built* worker request
> (so a project edited mid-render cannot change the atlas); a `BackgroundService`
> drains one job at a time in its own DI scope; `RenderJobRunner` sets
> **`Rendering`** — the status the enum has always declared and nothing had ever
> written — then `Completed`/`Failed`. `GeneratedPdf` gains a nullable
> `ErrorMessage` (migration `20260909203948_AddGeneratedPdfErrorMessage`): without
> it the 202 would be a regression, since the old 502 carried the worker's
> diagnostic in its body and the user's whole answer would have become the word
> "Failed". The web app polls through a new `waitForRender`
> (`apps/web/src/api/render-polling.ts`) and opens the download only on
> `Completed`; the button now says `Queued…` / `Rendering…`.
>
> **Accepted limits, all recorded in the ADR:** the queue is in-process (a restart
> strands outstanding rows; it does not survive scale-out), one render at a time,
> and a cancelled or shut-down render is marked `Failed` rather than `Cancelled`.
>
> **Still to do — worker-owned progress and cancel.** Only the worker knows it is
> on page 12 of 60, which is the whole argument for the knowledge living there.
> Needs a job protocol on the worker (`POST /render` → job id, `GET /jobs/{id}`,
> `DELETE /jobs/{id}`), `renderAtlas` reporting per-page progress and honouring an
> `AbortSignal` between pages, the API proxying both, a `Cancelled` member on
> `PdfStatus` with its migration, and a boundary ADR of its own. `waitForRender`
> already takes an `AbortSignal` and an `onStatus` callback, so the web side is a
> percentage and a Cancel button rather than a rewrite.

> **Page setup finally reaches the renderer (2026-09-09).** Margins, binder gutter
> and orientation survived EF, request validation, the duplicate endpoint and the
> web adapter — each with its own tests using non-default values — and then died
> at `assembleContract`, which passed `LETTER_PORTRAIT` to every page-producing
> call. `WorkerRenderPayload` had no member for them at all, and all seven
> `HttpRenderWorkerClientTests` passed the 0.5in portrait defaults, so the drop
> was literally unobservable: the values the engine fell back to were the values
> it was being sent. Two of those tests actively pinned it, asserting
> `margins`/`orientation` were **absent** from the wire.
>
> This was not cosmetic. Since the print fix a page's ground footprint is measured
> against the printed map box, so **a margin change moves the printed footprint** —
> the one page-setup value that changes scale and page count was the one that
> could not reach the geometry. Latent second half: C# emits `"Portrait"` and the
> engine's union is `"portrait"|"landscape"`, tested as
> `orientation === "landscape"`, so a raw `ToString()` would have made every
> landscape project print portrait, silently. Verified by rendering real PDFs and
> measuring them: default **415 × 549 pt** (unchanged), 1.25in margins **307 ×
> 441**, landscape **595 × 369**, a 0.75in gutter taking exactly 54 pt off the
> width and nothing off the height.

> **Page count vs. legibility — measured, and left to the owner (2026-09-09).**
> True scale made atlases longer (20 → 30 pages for a 20 km box at 1:24,000) and
> the question was whether there is a happy medium. Measured with the real
> `buildPageGrid` and real Helvetica metrics rather than estimated. **Answer: for
> the headline case, almost nothing is recoverable without costing the reader.**
> Page counts are `ceil()`'d, so most furniture trims buy paper and no pages:
> a 20 km box needs **+57.4 pt** of map width to drop 6 columns to 5 and **+41.6
> pt** of height to drop 5 rows to 4.
>
> | Change | map box | 20 km pages | what it costs |
> |---|---|---|---|
> | baseline | 415 × 549 | **30** | — |
> | `edgeLabelColumn` 54 → 38 | 447 × 549 | **30** (no-op) | nothing — `CONTINUE` (36.6 pt) still fits whole |
> | `edgeLabelColumn` 54 → 36 | 451 × 549 | **30** (no-op) | `CONTIN-UE` hyphenates to three lines |
> | `edgeLabelColumn` 54 → 27 | 469 × 549 | **30** (no-op, misses by 3.4 pt) | four-line labels |
> | `edgeLabelColumn` 54 → 18 | 487 × 549 | **25** | **overflows** — `AA200` is 21 pt; needs the label reworded |
> | `notesBlock` 66 → 0 | 415 × 615 | **24** | the write-on notes area, the kid-facing feature |
> | header 30 → 25 + footer 40 → 35 (honest floors) | 415 × 559 | **30** (no-op) | nothing, and buys nothing |
> | `neatlinePadding` 6 → 3 | 421 × 555 | **30** (no-op) | tighter neatline |
> | margins 0.5 → 0.375in | 433 × 567 | **30** (no-op) | home-printer clipping risk |
> | notes 0 + edge 18 + header/footer/padding | 493 × 637 | **20** | all of the above at once |
> | landscape | 595 × 369 | **28** | **−3.6% map area** — furniture is 171 pt tall vs 125 wide |
>
> Only two levers move the number at all: **`notesBlock → 0`** (30 → 24) and
> **`edgeLabelColumn ≤ 18`** (30 → 25). The first deletes the notes area and can
> only be done as a document-level setting baked into the contract *before*
> `buildPageGrid` runs — as a render toggle it would make the scale bar lie again,
> which is exactly what `AtlasDocument.tsx:728-733` reserves the block to prevent.
> The second is unrenderable without rewording `CONTINUE WEST · A1`.
> `MAX_ATLAS_PAGES` coverage barely moves under any of it: 3111 km² → 4268 km²
> even with everything trimmed. **Nothing was changed**; the map box is still
> 415 × 549 pt. Two follow-ups if wanted: `edgeLabelColumn 54 → 38` buys **+7.71%**
> map area (and does drop a 40 km box 108 → 99), and `overlap` is a far bigger
> lever than any of this.
>
> Suites after this pass: **239 TS** (was 223) and **95 .NET** non-Docker (was 79).

> ### Corrections to the two follow-up figures above (2026-09-10)
>
> Both numbers reported for the follow-ups were wrong. Re-measured against the real
> engine; the corrections are in the table and the paragraph above, and the workings
> are here so the owner can see what changed and why.
>
> **1. `edgeLabelColumn` 54 → 38 is 447 × 549 pt and +7.71%, not 451 × 549 and +8.7%.**
> The width is `415 + 2 × (54 − X)`, which the table's own 27 and 18 rows obey (469,
> 487). For X = 38 that is 447; for X = 36 it is 451. The table listed **451 for both
> rows, which cannot both be true** — and 451 / 415 = 1.0867, so the "+8.7%" was the
> 54 → **36** figure, the option the same table says hyphenates `CONTIN-UE` onto three
> lines. The safe option was being sold with the unsafe option's number. Measured:
> baseline 415.00 × 549.00 (area 227,835 pt²), at 38 → 447.00 × 549.00 (245,403 pt²),
> **+7.71%**. The rest of that row stands: 40 km 108 → 99 and the 20 km headline case
> a no-op are both confirmed against `buildPageGrid`.
>
> **"Renders identically" was true only of the label, and has been dropped.** The
> atlas does not render identically: the map box grows 32 pt, every page bbox moves,
> and the change fails **11 atlas-core tests plus one render-cli PDF-measurement test
> plus `regenerate-sample-atlas.mjs --check`**. It requires re-approving the golden
> fixture. It is cheap, not free — "free follow-up" understated it.
>
> **2. "5% overlap costs +17% pages" is one extent's `ceil()` artefact, not a rate.**
> It is right for the 20 km headline box (30 → 35 = +16.7%) and wrong as a general
> figure. Square extents around 41°N / 98°W at 1:24,000, every size from 5 to 60 km:
>
> | size | 0% | 5% | delta |
> |---|---|---|---|
> | 7 km | 4 | 6 | **+50.0%** |
> | 15 km | 20 | 20 | 0.0% |
> | **20 km (the headline case)** | **30** | **35** | **+16.7%** |
> | 26 km | 48 | 48 | 0.0% |
> | 40 km | 108 | 130 | +20.4% |
> | 50 km | 165 | 192 | +16.4% |
> | **aggregate, 5–60 km** | 5006 | 5523 | **+10.3%** |
> | theory, `(1/0.95)² − 1` | | | +10.8% |
>
> **19 of the 56 sizes cost exactly 0%**, because both counts are `ceil()`'d.
>
> > #### The aggregate is not "the number" either (re-measured 2026-09-10)
> >
> > `+10.3%` was quoted above; a later pass measured `+10.5%`; a third measured
> > `+11.1%`. **All three are correct, and none of them is the figure**, because
> > the aggregate is an artefact of the sample set. Re-run against `pageGridSize`
> > with square extents about 41°N / 98°W at 1:24,000:
> >
> > | sample set | sizes | aggregate | cost nothing | worst |
> > |---|---|---|---|---|
> > | 5–50 km, step 1 km | 46 | +11.1% | 18 (39%) | +50% |
> > | 5–60 km, step 1 km | 56 | +11.2% | 18 (32%) | +50% |
> > | 5–50 km, step 5 km | 10 | +13.4% | 5 (50%) | +20% |
> > | 10–40 km, step 1 km | 31 | +10.8% | 14 (45%) | +31% |
> > | 5–60 km, step 0.5 km | 111 | +10.9% | 37 (33%) | **+67%** |
> >
> > **Quote this as a range with its drivers, never as a rate:**
> >
> > - **Theory: `(1/0.95)² − 1` = +10.8%.** The only construction-independent
> >   number here, and the value a dense sweep converges on (+10.8% to +11.2%).
> > - **Typical: about +11%, and 0% to +50% for any individual extent.**
> > - **Roughly a third of extents cost nothing at all** (32–45% across sample
> >   sets) — both counts are `ceil()`'d, so an extent with slack in the last
> >   column and row absorbs the overlap for free.
> > - **The worst case gets worse the finer you sample**: +50% at 1 km steps,
> >   **+67%** at 0.5 km. A coarse sweep does not find the knife edges, so a
> >   reassuring "worst case" is a statement about the sampling, not the product.
> > - **A coarse or small sample overstates the aggregate** (+13.4% from 10 sizes).
> >
> > **And no single extent's figure is stable, including the 20 km headline in the
> > table above.** A 20 km box costs `30 → 35 = +16.7%` only if it is at least
> > **20,030 m** of ground; an exactly-20,000 m box is `30 → 30 = +0.0%`. The
> > divisor is `20000 / (3513.67 × 0.95) = 5.9916`, which is **0.14% below the 6
> > that `ceil()` is deciding**. Two reasonable ways of writing down "a 20 km box"
> > — a square in the page-centred projection versus one from a naive
> > metres-per-degree conversion — land on opposite sides of it. If a decision
> > rests on one extent's page count, measure *that* extent; do not carry a
> > headline figure across.
>
> **The two levers interact and cannot be decided independently.** At
> `edgeLabelColumn` 38 the 20 km box's 5% overlap becomes **free** (30 → 30, instead
> of 30 → 35), while the 40 km box goes 99 → 120.
>
> **Framing for the decision:** `overlap` defaults to 0 and there is no UI control for
> it, so every project reachable through the web app has overlap 0 today. This is not
> "overlap costs pages" — it is "turning on a safety feature that is currently off
> costs pages". Until 2026-09-10 nothing in either suite verified that overlap was
> honoured at all (halving its effect in the engine, or zeroing it on the worker wire,
> left both suites entirely green); it is now measured as shared ground per adjacent
> page pair, in `grid.test.ts` and `HttpRenderWorkerClientTests`.

> ### Print resolution — the earlier claim was backwards (2026-09-10)
>
> The bullet above used to read: *"1000 px over 5.76 in is ~173 DPI, and the 300 DPI
> target at this scale needs z17, which this source does not have. Reaching it needs
> a deeper basemap, not a bigger number — worth scheduling against Stage 7."*
>
> **It needs a bigger number and no deeper basemap.** That line was driving a Stage 7
> scheduling decision and was wrong three ways. Measured against the real engine
> (`buildLocationPage`, `mapBoxInches`, `zoomForBBox`, `lngLatToGlobalPixel`), one
> Letter-portrait page at 41°N:
>
> | preset | zoom | delivered px | DPI |
> |---|---|---|---|
> | `usgs-7-5-min` (1:24,000) | z16 | 1947 | **338** |
> | `1-25000` | z15 | 1014 | **176** |
> | `usgs-15-min` (1:62,500) | z14 | 1268 | **220** |
> | `1-50000` | z14 | 1014 | **176** |
> | `1-100000` | z13 | 1015 | **176** |
>
> 1. **~173 DPI was the *request*, not the delivery.** `renderMapPanel` crops at
>    native tile resolution and never resamples, so `--panel-px` is a **floor** and
>    the delivered panel is 1×–2× it.
> 2. **300 DPI is already met at 1:24,000 (338), and missed at every other preset.**
>    Not a uniform limit — a 2× swing across the scale menu.
> 3. **None of that is a property of this product.** It is an artefact of where each
>    preset's page falls relative to a Web-Mercator zoom boundary. 1:24,000 passes
>    only because its page lands 1.95× past one; **1:25,000 — a 4% change in scale —
>    falls off a 1.92× cliff to 176 DPI.** The default of 1000 px over a 5.7639 in
>    map box asks for **173 DPI**. Nothing anywhere asked for 300.
>
> **The remedy is one number.** `panelWidthPxForDpi(mapBox, 300)` = **1730 px**. At
> that target every preset clears 300 DPI, and **every one still lands inside USGS
> Topo's z16 ceiling** — nothing is clamped, so no deeper basemap is involved:
>
> | preset | zoom | px | DPI |
> |---|---|---|---|
> | `usgs-7-5-min` | z16 | 1947 | 338 ✓ |
> | `1-25000` | z16 | 2028 | 352 ✓ |
> | `usgs-15-min` | z15 | 2536 | 440 ✓ |
> | `1-50000` | z15 | 2029 | 352 ✓ |
> | `1-100000` | z14 | 2030 | 352 ✓ |
>
> #### Measured cost of raising the default — the owner's decision, not made here
>
> Measured through the real `renderMapPanel` against a local tile server (every
> fetch, composite, crop and JPEG encode on the production path; only USGS network
> latency is absent, and that term is proportional to tile count, which is exact):
>
> | preset | tiles | render ms | panel bytes |
> |---|---|---|---|
> | `usgs-7-5-min` | 99 → 99 (**1.00×**) | 4079 → 4003 (0.98×) | **unchanged** |
> | `1-25000` | 35 → 108 (3.09×) | 1158 → 4343 (3.75×) | 3.97× |
> | `usgs-15-min` | 48 → 154 (3.21×) | 1728 → 6668 (3.86×) | 3.97× |
> | `1-50000` | 30 → 99 (3.30×) | 1174 → 4917 (4.19×) | 3.98× |
> | `1-100000` | 35 → 108 (3.09×) | 1151 → 5350 (4.65×) | 3.98× |
>
> - **At 1:24,000 — the default scale, and the land-nav scale — it is free.** Same
>   z16, same 99 tiles, same bytes, same wall clock. It is already at the ceiling.
> - At the other four it is **~3.1–3.3× the tiles and ~4× the panel bytes**, which is
>   the term that matters: `panel.ts` records that a 34-page basemap atlas is ~18 MB
>   at JPEG q90, and 4× is ~72 MB — past "too big to mail", the constraint that chose
>   JPEG in the first place. (Absolute byte figures above are inflated: the fixture
>   tiles are incompressible noise. The **ratio** is pixel-area and is real.)
> - Tile count is also load against USGS through the proxy, and a coarse-scale atlas
>   of a given area has fewer pages — so the per-atlas total does not move by 3×.
>
> **Nothing was changed.** The default is still 1000. What changed is that the number
> is now derivable rather than magic (`panelWidthPxForDpi`, `PRINT_DPI_TARGET`), and
> the resolution is a **tested property per preset** rather than an accident:
> `tilemath.test.ts` pins today's delivered DPI for all five presets by value, asserts
> that 1730 clears 300 at every one of them unclamped, and asserts the floor/1×–2×
> mechanism that produces the swing. Before this, the DPI guard covered 1:24,000 only
> — the single preset that passes — so a change to any other preset's print
> resolution was invisible to the suite.

> ### Brought current — 2026-09-11 (worker-owned progress and cancel; every number re-measured)
>
> The last update to this file was 2026-09-10. Ten commits have landed since. This
> block records what closed, **re-measures every figure the file leans on rather than
> carrying it forward**, and corrects the two that are still wrong. Each number below
> was produced by running the real engine on this commit; where a figure came from an
> earlier pass rather than from this one, it says so.
>
> #### Closed since 2026-09-10
>
> - **Worker-owned progress, and cancel — the largest user-facing gap on this
>   roadmap.** `docs/decisions/0007-worker-owned-render-jobs.md`. The worker now owns
>   the job (`POST /render` → 202 + job id, `GET`/`DELETE /jobs/{id}`), `renderAtlas`
>   reports per-page progress and honours an `AbortSignal` between pages, the API
>   proxies both onto the `GeneratedPdf` record (`progress`/`pageCount`, and
>   `POST /api/generated-pdfs/{id}/cancel`), and the web app shows a real progress bar
>   and a Cancel button that stops the *render*, not the polling. `PdfStatus` gains
>   `Cancelled`, distinct from `Failed`. This closes the "What this does not deliver"
>   section of ADR 0006.
> - **The basemap knobs reach the API** (audit F08). `Basemap` was a hardcoded `true`
>   in the wire payload and the three panel knobs had no member at all, so the web app
>   could reach strictly less than `render-cli`.
> - **The render worker is no longer an open outbound fetch.** `tileBaseUrl` is judged
>   by a real URL parse with an operator allowlist, `cacheDir` is refused from the wire
>   entirely, and `POST /render` has a JSON schema with an explicit accepted-field list.
> - **CI gates the EF model against the migration history** (`harness/checks/migrations-current.sh`).
> - **Every setting that changes printed scale now has a UI control** — orientation,
>   the four margins, the gutter and overlap, plus basemap/format/quality. The item
>   below that reads "there is no UI control for overlap" is now historical.
> - **`validateAtlas` no longer reports a malformed contract as a scale error.** A
>   `NaN` in a bbox used to throw out of `proj4` three frames down; `west > east` used
>   to report "worst footprint error 260%".
> - **The contract seams are pinned.** The render request existed three times with no
>   shared schema; two parity tests now compare the engine's interface, the worker's
>   JSON schema and the payload the API actually serializes. The disk tile cache's key
>   layout and hit rule are pinned across both languages by one fixture.
>
> **The "Still open, and now the largest items" list above is stale.** Of its five,
> the async render decision, the DPI ceiling and the unvalidated worker wire input are
> closed. **Still open: the absent linter/formatter, and neither tile cache ever
> evicting.** Add: ADRs 0001/0003/0004/0005 still have no text.
>
> #### Re-measured: the two follow-up figures hold
>
> Run on this commit against the real engine, not carried forward:
>
> - **`edgeLabelColumn` 54 → 38 is 447.00 × 549.00 pt, +7.71%.** Confirmed. And
>   54 → 36 is 451.00 pt / **+8.67%** — which is where the retired "+8.7%" came from,
>   as the correction above says. The table is right.
> - **Overlap has no single rate.** Re-swept, square extents about 41°N / 98°W at
>   1:24,000, `pageGridSize` so the 200-page cap does not truncate the sample:
>
> | sample set | sizes | aggregate | cost nothing | worst |
> |---|---|---|---|---|
> | 5–50 km, step 1 km | 46 | **+10.5%** | 17 (37%) | +50% |
> | 5–60 km, step 1 km | 56 | +10.3% | 19 (34%) | +50% |
> | 5–50 km, step 5 km | 10 | **+14.6%** | 3 (30%) | +33% |
> | 10–40 km, step 1 km | 31 | +11.3% | 12 (39%) | +33% |
> | 5–60 km, step 0.5 km | 111 | +10.1% | 39 (35%) | **+67%** |
> | 5–60 km, step 0.25 km | 221 | +10.3% | 81 (37%) | **+67%** |
>
> Theory `(1/0.95)² − 1` = **+10.8%**. The 20 km headline is **30 → 35 = +16.7%**;
> 40 km is 108 → 130. Every conclusion in the block above survives: quote it as a
> **range with its drivers**, never as a rate — theory +10.8%, roughly a third of
> extents free, worst +50% at 1 km sampling and +67% at 0.5 km, and the aggregate
> inflated by a coarse sample (+14.6% from ten sizes).
>
> **One honest discrepancy, recorded rather than overwritten.** The table above this
> one reports `+11.1%` and `18 (39%)` for the 5–50 km / 1 km set; this run gives
> `+10.5%` and `17 (37%)` for the same nominal set. Both are right about what they
> measured — the difference is the extent construction, which is exactly the
> sensitivity the note above identifies when it shows a 20 km box landing 0.14% below
> a `ceil()` boundary. It strengthens that conclusion rather than replacing it: if a
> decision rests on one extent's page count, measure *that* extent.
>
> #### Corrected: "300 DPI is met at 1:24,000" is a 41°N fact, and the preset that is not raised cannot be
>
> The block below reports per-preset DPI **at 41°N** and correctly says so. What it
> does not say is how much of the swing is latitude, and that matters because the
> answer changes the remedy for one preset. Four presets now ship at
> `PRINT_TARGET_PANEL_WIDTH_PX` (1730); **`usgs-7-5-min` still ships at 1000**, on the
> reasoning that it already clears 300 DPI. Measured on this commit, every whole
> degree 20°N–70°N, at each preset's own shipping target:
>
> | preset | shipping target | delivered DPI, 20–70°N | clamped |
> |---|---|---|---|
> | `usgs-7-5-min` | 1000 | **174.3 – 343.0** | never |
> | `1-25000` | 1730 | 282.8 – 584.4 | 8 of 51 |
> | `usgs-15-min` | 1730 | 304.8 – 593.7 | never |
> | `1-50000` | 1730 | 301.0 – 596.5 | never |
> | `1-100000` | 1730 | 301.1 – 596.8 | never |
>
> - **`usgs-7-5-min` — the default, and the land-nav scale — is below 300 DPI at 36 of
>   those 51 latitudes.** Its 338 is the 41°N value and close to its best (343 at
>   42°N); at **43°N it is 174.3**, a **1.97× cliff one degree north of the peak**.
>   43°N is Nebraska's northern border.
> - **Raising it to 1730 does not fix it.** At that target its worst case is
>   **271.5 DPI at 20°N, and it is CLAMPED at z16** — the panel is already asking for
>   more resolution than USGS Topo has. So the retired claim "reaching 300 DPI needs a
>   deeper basemap, not a bigger number" — correctly called backwards for the other
>   four — **is right for this one preset at low latitude.** Both statements are true
>   of different presets, and the file previously carried only one of them.
> - `1-25000` also clamps at 8 of the 51 latitudes and dips to 282.8 DPI.
>
> **What to put to the owner:** print resolution is not a property of this product. It
> is where each preset's page happens to fall relative to a Web-Mercator zoom boundary,
> and it moves with **latitude as well as scale**. The band across the whole menu and
> the continental US is **174 – 597 DPI**. Nothing in the product asks for 300 except
> the four raised presets, and the one that cannot be raised is the default.
>
> #### Recorded: what the size levers actually cost
>
> This settles a question the file has carried as an extrapolation. Measured through
> `render-cli` on a **real 36-page 1:50,000 atlas** (a raised preset, 1730 px, z15,
> live USGS tiles), each row refusing to report a number unless the page count parsed
> off the render's own stdout and the DCTDecode stream count read out of the PDF both
> agreed:
>
> | JPEG quality | atlas size |
> |---|---|
> | q5 | 1.06 MB |
> | q30 | 7.74 MB |
> | q50 | 12.50 MB |
> | q60 | 15.03 MB |
> | q70 | 18.99 MB |
> | q80 | 26.33 MB |
> | **q90 (default)** | **42.03 MB** |
> | q95 | 61.75 MB |
>
> - **Quality is the lever.** It is continuous and it moves size by 58× across the
>   range. Panel *width* does not: cost is quantised by the zoom the engine picks, so
>   a wider request buys nothing until it crosses a boundary and then costs ~4×.
> - **Format is a cost, not a lever.** Measured at Stage 9B on one dense page
>   (1322×1766 @ z13): PNG 2883 KB against JPEG q90 478 KB — **6.0×** — and the whole
>   34-page atlas went **110 MB → 18 MB (6.1×)** when JPEG became the default. PNG is
>   available for a lossless panel and costs about six times the file.
> - **The "~72 MB" figure in the block below is an extrapolation, and it is high.** It
>   was 4× applied to a *different* atlas's 18 MB — a 34-page 1:24,000 book at the old
>   panel width. The measured q90 size of a real raised-preset atlas is **42.03 MB**.
>   It also belongs to an atlas built **entirely** from the four raised presets; one at
>   the default 1:24,000 is unchanged, because that preset was not raised.
> - So if a raised-preset atlas is too big to mail, the lever is `panelQuality` —
>   **q70 is 18.99 MB, 0.45× the default, on the same pages** — and the API can now
>   reach it (F08 closed above). It was not reachable when the 72 MB figure was written.
>
> #### Withdrawn, and why that matters as much as what was found
>
> - **The page-id collision (`vault/audit-2026-09-08/scan-1-architecture.md` F01) was
>   already fixed when the audit re-verified it.** The finding says a 12-row grid emits
>   a page literally named `L1`, colliding with the location namespace the renderer
>   dispatches on. Checked on this commit: `ROW_LETTERS` in `grid.ts` is
>   `"ABCDEFGHIJKMNOPQSTUVWXYZ"` — **base-24 with L and R removed**, so a generated row
>   label cannot contain either letter in any position at any grid size. Measured: a
>   tall narrow extent yielding **44 rows × 3 columns** produces ids `A1 … AV3`, of
>   which **zero** match `/^[LR]\d/` and zero are duplicates. The finding describes
>   code that no longer exists, and it was re-pinned to line numbers rather than
>   re-run.
> - **The lng/lat → panel-fraction misregistration was withdrawn by the pass that
>   found it**, and correctly. Three implementations exist, two linear-in-degrees, but
>   the maximum displacement on a 1:24,000 page at 41°N is **0.044 pt against a 5.4 pt
>   landmark glyph** — a hundredth of a symbol. It reaches 3.2 pt only on a
>   continental-extent overview page, which is explicitly schematic. The duplication is
>   the finding; the misplacement is not. Recorded here so a later pass does not
>   rediscover it as a bug.
>
> Suites after this pass: **444 TS** (atlas-core 100 · web 99 · pdf-client 38 ·
> map-sources 79 · render-cli 102 · render-worker 35) and **199 .NET** non-Docker (287
> with the Docker-gated `Api` suites). The
> Docker-gated `Api` suites were **not run** — this machine has no daemon; CI's
> `dotnet-integration` job is the only place they execute.

---

## The half-wired sweep — 2026-09-11 (W3)

Five passes looking specifically for **things declared and only half-wired**: a field
written and never read, a value that survives several hops and then has no member on
the next payload, a computed result rendered nowhere, a rule tested but never applied,
a number nothing acts on. The one shape type checking, schema validation and a green
suite are all blind to. Full write-ups in `docs/decisions.md`; this is what it changes
about the plan.

**The richest seam was where it was predicted to be — the boundary walk — and the most
productive thing in the whole sweep was reading the *previous* fix's own Watch note and
taking it at face value.** `WorkerWirePayloadParityTests` was written to pin what the
API sends against what the worker accepts, and its author recorded the gap honestly:
the check was a hand-written list of five names, so *"a NEW field the API ought to send
but does not is still invisible"*, and the comment naming `title`, `zoomLevels`,
`coverPadFraction` and `tileMaxZoom` as "legitimately absent" was checked by nothing.
Deriving the set difference instead took two of those three claims down:

- **Every atlas the API has ever produced was titled "Journey Book."** The engine is
  `title: options.title ?? "Journey Book"`; the payload had no member for a title. The
  project's name is loaded on every render and the user typed it themselves, and it
  appeared on the project list and on no page of the book — page headers, the overview
  page, the contents page, the PDF's own document metadata.
- **`tileMaxZoom`'s docstring names this API as the caller it exists for** ("needed
  when tiles come through the proxy from a registered `TileSource` whose `MaxZoom`
  this process cannot see") and this API was the one caller not sending it. Latent only
  because the seeded row also says 16; a shallower registered source would have had
  every tile above its own ceiling refused by *this API's own proxy*.

Both are wired, and the parity check is now a set difference against an exemption
dictionary whose entries are themselves checked for rot in both directions.

### What this changes about the schedule

1. **Print resolution is now reported, not just computed.** `effectiveDpi` — the exact
   inverse of the `panelWidthPxForDpi` every scale preset's width comes from — was
   exported, tested, and called by nothing but its own tests. Every render now prints
   the DPI each panel delivered and warns below the 300 DPI target. `--scale 1-100000`
   reports **351 dpi**, which independently confirms the 352 measured in
   `vault/scan2-findings.md` §3.2 and the correction it made to the figures at
   `:268-270`. **This does not answer the default-preset DPI question, which is still
   the owner's** — it makes the answer observable from the front door instead of
   derivable only by a scan.
2. **ADR 0004 is now enforced by a test rather than by memory.**
   `docs/decisions/README.md` said in as many words *"Nothing enforces it
   mechanically"*, with a dated manual search standing in for a guard.
   `GeometryMonopolyTests` scans the four governed C# projects for the vocabulary
   geometry cannot be written without. It ships with the mutation it catches **and the
   enumeration of those it does not** — including geometry in TypeScript outside
   `atlas-core`, which is precisely where the previous manual search's conclusion was
   wrong. Reconstructing the ADR *text* for 0001/0003/0004/0005 remains open and is
   still worth scheduling.
3. **The progress protocol was half-wired by the commit that added it.** The engine's
   `phase` reached `RenderProgressUpdate` through four hops and then
   `UpdateGeneratedPdfProgressRequest` had no member for it. Not cosmetic: `progress`
   counts finished basemap *panels*, so at phase `pdf` it already equals `pageCount`
   and the bar read **100% for the whole of PDF assembly**, while a basemap-off render
   read **0% from start to finish**. Both look like a stall. Now on the record and in
   the button's label.
4. **Retention is visible.** The previous sweep found that nothing *acted on*
   `ExpiresAt` and wired a retention service. That fix was right, and it turned a
   number nobody acted on into a number that silently deletes the user's file — with
   the deadline still displayed nowhere. Shape 6 exactly. The history now says how long
   a PDF is kept.
5. **A latent data-loss bug was closed by a type, not a test.** `api.locations.update`
   invented `category: "Other"` / `sourceConfidence: "Unknown"` on every edit because
   the web's `Location` type had no member to read the real values from. Making them
   required turned a silent default into a compile error at each call site and found
   two — one of which was right by coincidence and wrong by construction.

### Deliberately not taken, and why

- **F02**, the empty Application layer with the use cases in Infrastructure. An
  L-effort relayering and the owner's call.
- **The default-preset DPI question and the atlas quality default.** Both measured and
  written up for the owner in the root `ROADMAP.md`. The DPI work above is disclosure —
  it changes no default, refuses no render and alters no pixel.
- **A UI for `LocationCategory`.** No renderer, filter or export column consumes the
  taxonomy, so a picker for it would be the half-wired control this sweep exists to
  remove, not a smaller version of one.
- **`AtlasPage`** (a table, a unique index and four neighbour columns nothing writes or
  reads) and the **dead `Hero`/shadcn component tree** (`Hero.tsx`, `HealthChip.tsx`,
  `MapFurniture.tsx`, `components/ui/*`, `lib/utils.ts`, `components.json` and the
  `@radix-ui` dependencies). Both are genuine instances of *a subsystem with no entry
  point*, both scored ≈0 on `Impact×4 − Blast×3 − Effort`, and both are removals whose
  blast radius is a migration and a lockfile respectively. They are the next-best
  candidates for this shape and are recorded rather than done. Note one consequence
  while they stand: `a11y.test.ts` and `theme-tokens.test.ts` walk every `.tsx` under
  `apps/web/src`, so part of what their PASS is about is code that never renders.

### Withdrawn

- *"The CLI cannot show progress — `cli.ts` never passes `onProgress`."* True about
  `cli.ts` and false about the CLI: `renderAtlas` writes per-page lines to `stderr`
  itself, and both `onProgress` and `signal` have real production consumers in the
  worker. "No caller found" was a claim about a search of one file.

Suites after this sweep: **482 TS** (atlas-core 100 · web 129 · pdf-client 38 ·
map-sources 79 · render-cli 105 · render-worker 35) and **216 .NET** non-Docker (309
with the Docker-gated `Api` suites). The Docker-gated suites were **not run** — no
daemon on this machine; six new `Api` tests were written for CI's
`dotnet-integration` job regardless.

### Working rule for this repository: push the branch, read CI, *then* merge

**Two consecutive merges to `master` went red on the same job — `.NET integration
(Testcontainers PostGIS)` — and it is the one job that needs Docker and therefore
cannot run on this machine at all.** Merging on the strength of "everything I can run
locally is green" is exactly how a job nobody can run locally ends up being discovered
by `master`.

So, for anyone working in this repo:

1. Push the working branch and **open a PR** — or `gh workflow run CI --ref <branch>`.
   A bare branch push runs nothing: `.github/workflows/ci.yml` is
   `on: push: branches: [master]`, plus `pull_request` and `workflow_dispatch`. This
   matters, and getting it wrong would make the rule below an instruction that
   silently does nothing.
2. Read all four jobs — `Repo hygiene`, `TypeScript`, `.NET (unit, no Docker)`,
   `.NET integration (Testcontainers PostGIS)`. A PR run tests the *merge result*,
   which is what you actually want to know.
3. Merge `--no-ff` only once that run is green, then read the run on `master` too.

That costs one CI round trip and removes the failure mode entirely. *"Merged and pushed
is not done until the CI run has been read"* was always the rule; the correction is
that for a job you cannot run locally, **reading it has to happen before the merge, not
after.**

And a companion rule the second failure earned: when a Docker-gated assertion fails,
the message has to name *which* of the possible causes it is. `Expected: 12, Actual: 1`
cost a round trip on its own, because the number alone cannot distinguish "no progress
report arrived" from "a later writer overwrote it" from "the test read too early". Any
assertion in the `Api` suites that a local run cannot reproduce should say what each
plausible wrong value would mean.

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
