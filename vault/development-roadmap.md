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
