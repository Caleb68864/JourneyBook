# Scan 2 — Correctness (geospatial + print maths)

Audit date: 2026-09-08. Read against working tree at `c36f69f`.
Everything below was verified by reading code and, where marked **[verified numerically]**,
by executing the built `atlas-core` dist against the real layout constants.

---

## P2-1 — Printed scale bar overstates ground distance by ~30% (the flagship bug)

**Title:** The map panel is not printed at the size its scale implies, so every tier-2+ scale bar lies.

**What & where:**
- `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/page.ts:41-61` — `printableAreaInches()` /
  `groundFootprintMeters()` compute a page's ground footprint from the **full printable area**:
  Letter portrait minus 0.5in margins = **7.5in × 10in**.
- `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:98,123` and `grid.ts:42-45` —
  every page bbox is built to cover exactly that 7.5in × 10in of ground (4572 m × 6096 m at 1:24,000).
- `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:520-552` — the panel is
  **not** the printable area. It sits inside `styles.neatline` (`AtlasDocument.tsx:37`, border 1.5pt +
  padding 6pt per side), between two fixed **54pt** edge-label columns
  (`AtlasDocument.tsx:522-524` and `:546-548`), under a header (`:507-519`), above a notes area
  (`:556`) and a footer (`:558-572`), with its own 1pt border (`AtlasDocument.tsx:49-56`).
- `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:121-139` — `ScaleBar`
  draws `niceScaleBar(scale, maxInches).inches * 72` points, i.e. a length derived purely from the
  *nominal* scale, never from the panel's real printed size.

**[verified numerically]** Letter portrait, `DEFAULT_MARGINS`:
```
page content box        612 - 2*36            = 540 pt (7.5 in)   <- what the engine assumes
neatline inner          540 - 2*(1.5+6)       = 525 pt
minus E/W label columns 525 - 2*54            = 417 pt
minus panel border      417 - 2*1             = 415 pt = 5.764 in <- what actually prints
nominal 1:24,000  ->  ACTUAL printed scale 1:31,229
scale bar labelled "2 km" prints 3.281 in; true length is 2.521 in  -> 30.1% too long
```
The vertical factor differs (header + two edge labels + notes + footer are subtracted from height),
so the error is also **anisotropic** — the map is not merely mis-scaled, it is non-uniformly mis-scaled.

**Why it matters:** True-to-scale printing is the product's entire premise. A child pacing "1 km"
off this bar walks 1.30 km. The 1-inch `CalibrationTick` (`AtlasDocument.tsx:158-171`) will read
correct on a printed page, which makes the error *more* convincing, not less. Every tier-2+ page in
every atlas ever generated is affected.

**Blast radius:** 4 (engine footprint contract + renderer layout + validator + fixtures/tests)
**Effort:** M · **Impact:** 5 · **Regression risk:** med (every page bbox and page count changes)

**First step:** Make the *renderer* the source of truth for the printed map box. Export the layout
constants (neatline border+padding, 54pt edge columns, header/footer/notes heights) from
`pdf-client`, derive `PageSpec`-equivalent `printableAreaInches` from them, and feed that into
`groundFootprintMeters`. Then add the assertion that is currently missing anywhere in the repo:
`barInches / panelPrintedInches === bar.groundMeters / pageFootprintMeters`.

---

## P2-2 — The print-validation harness structurally cannot catch P2-1

**Title:** `validateAtlas` validates bbox-vs-scale, never printed-size-vs-scale.

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:54-77`
measures each page's bbox on the ground and compares it to `groundFootprintMeters(...)` — both sides
of the comparison come from the *same* assumption (7.5in × 10in). It is a tautology with respect to
the actual sheet. `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/scale-fidelity.test.ts:41-108`
tests the same axis, as does the CLI `validate` command.

**Why it matters:** `journeybook validate` prints PASS (worst error 0.21%) on an atlas whose printed
scale is 30% wrong. This is worse than having no validator, because it is documented in
`vault/staged-build-roadmap.md:337` as "catches a false scale bar".

**Blast radius:** 3 · **Effort:** S · **Impact:** 5 · **Regression risk:** low

**First step:** Add a `print-fidelity` check that takes the renderer's panel geometry and asserts
printed-inches-per-ground-metre matches `1/ratio`. Fail it deliberately first to confirm it bites.

---

## P2-3 — `effectiveDpi` is dead; no minimum print-resolution guard exists

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:105-108`
defines `effectiveDpi`. Grep across the repo: the only callers are
`packages/atlas-core/src/validation.test.ts:52-55` and a mention in the roadmap. No renderer,
validator, CLI command or API path ever calls it.

Related: `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:113-117` documents
`panelWidthPx` default 1000 as "~176 DPI across a 7.5in printable width" — 1000/7.5 is 133, and the
7.5in is the wrong width anyway (see P2-1). Because `zoomForBBox`
(`packages/map-sources/src/tilemath.ts:40-49`) returns the *first* zoom at or above the target, the
real panel is 1000–2000 px, so real print DPI floats between ~174 and ~347 with nothing enforcing a
floor. `vault/print-and-pdf/300-dpi-export.md` states 300 DPI as a requirement.

**Blast radius:** 2 · **Effort:** S · **Impact:** 3 · **Regression risk:** low

**First step:** Call `effectiveDpi` in `renderAtlas` per page, warn below 200 and fail below 150;
fix the docstring arithmetic at the same time.

---

## P2-4 — Hardcoded, inaccurate map attribution in the PDF

**What & where:** `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:562-564`
prints the literal string `"© OpenStreetMap contributors · USGS — Journey Book"` on **every** page
regardless of which basemap was used. Meanwhile:
- `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:206` returns the real
  `basemap.attribution` on every `MapPanel` — discarded.
- `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:565-567` computes a correct
  `attribution` ("Map data: USGS National Map (public domain)") into `RenderAtlasResult` — never
  reaches the document.

**Why it matters:** Both directions are wrong. Default renders credit OSM when only USGS public-domain
tiles were fetched; and a user pointing `--tile-source` at an OSM-derived or ODbL source gets that
source's required attribution silently dropped. `vault/licensing-and-attribution/required-attribution-text.md`
and `vault/pitfalls/missing-attribution.md` are explicit that printed attribution is a licence condition.

**Blast radius:** 2 · **Effort:** S · **Impact:** 4 · **Regression risk:** low

**First step:** Thread `MapPanel.attribution` (dedup across pages) into `AtlasDocumentProps` and
render it; keep the literal only as the no-basemap fallback.

---

## P2-5 — Tier 4 renders identically to Tier 3 (advertised, not built)

**What & where:** `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:487-488`
defines only `showTier2 = page.tier >= 2` and `showTier3 = page.tier >= 3`. There is no tier-4 branch
anywhere in the renderer. A repo-wide grep for `declination` / `magnetic` / `azimuth` returns **zero**
hits in any `src/` file — only vault notes (`vault/map-rendering/declination-handling.md`,
`vault/requirements/declination.md`). `CompassRose` (`AtlasDocument.tsx:142-155`) is a fixed north-up
rose with no declination arm and no angle input.

Meanwhile `/home/caleb/Projects/JourneyBook/apps/web/src/components/TierPicker.tsx:7` sells Tier 4 as
"Tier 3 + full MGRS & azimuth", and `packages/atlas-core/src/model.ts:79-80` documents it as
"+ full MGRS & azimuth/declination".

**Category:** NOT BUILT, but shipped in the UI as a selectable option. Selecting Tier 4 today silently
produces a Tier 3 page. Note `vault/staged-build-roadmap.md:494-498` *does* record Level 4 as
deliberately deferred — so this is not a surprise regression, it is a UI-honesty gap: the roadmap
knows it is deferred and the picker does not.

**Blast radius:** 2 · **Effort:** M · **Impact:** 4 · **Regression risk:** low

**First step:** Either gate/label Tier 4 as coming soon (XS), or implement the declination arm — a
WMM/IGRF lookup is the only genuinely new dependency; the rose already has the SVG scaffolding.

---

## P2-6 — Panel image fitting differs by tier, and misregisters every vector overlay

**What & where:** `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:529-533`:
```tsx
showTier3 ? <Image src={panel} style={{ width: "100%", height: "100%" }} />
          : <Image src={panel} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
```
Tier 3+ stretches the panel to the box; tier 1–2 uses `cover`, which scales up until the box is
covered and **crops** the overflow. The overview page (`AtlasDocument.tsx:606`) also uses `cover`.

Every vector overlay — `UsngGridLayer`, `RouteLayer`, `LandmarkLayer`, `ReferenceGrid`, `LocationPin`,
and the overview's page rectangles — is drawn in a stretched normalized 0..1 / 1000×1000 space
(`packages/map-sources/src/tilemath.ts:65-73`). Under `cover` the image underneath is *not* in that
space, so pins and landmarks sit slightly off their features on exactly the tiers most kid-facing.

**[verified numerically]** worst page-bbox aspect deviation from the printable aspect across a
70-page 1:100,000 grid is 0.177%, so the crop is small — but it is unnecessary, undocumented, and
inconsistent between tiers of the same atlas.

**Blast radius:** 2 · **Effort:** XS · **Impact:** 3 · **Regression risk:** low

**First step:** Drop `objectFit: "cover"` everywhere so all tiers and the overview share the
stretch geometry the overlays already assume.

---

## P2-7 — Tile fetching: sequential across pages, unbounded within a page, no retry/timeout/UA

**What & where:**
- `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:440-453` — panels are rendered
  in a plain `for … await` loop, strictly one page at a time.
- `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:153-165` — within a page every
  covering tile is launched at once via `Promise.all` with no concurrency cap.
- `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:101-109` — `fetchTile` is a bare
  `fetch(url)` with **no timeout, no retry, no backoff, and no `User-Agent`**, and swallows every
  failure into `null`.

**Why it matters:** The worst of both shapes — slow overall (200 pages serialised) yet bursty enough
per page to trip tile-server rate limits. A missing User-Agent is precisely what caused the Overpass
406 already fixed in `923402b`; the same class of failure here degrades *silently* into blank
parchment tiles (`panel.ts:12`, `:193-197`) that look like a rendered map. See
`vault/pitfalls/tile-rate-limits.md`, `vault/licensing-and-attribution/osm-tile-usage-policy.md`.

**Blast radius:** 3 · **Effort:** S · **Impact:** 4 · **Regression risk:** low

**First step:** Add `AbortSignal.timeout`, a `User-Agent`, and 2 retries with jittered backoff in
`fetchTile`; put a shared semaphore (~6) around tile loads and run 2–3 pages concurrently. Then count
failed tiles per panel and surface a warning when a panel is more than ~5% blank.

---

## P2-8 — Every panel is held in memory simultaneously as a base64 data URI

**What & where:** `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:444`
`panels[page.id] = "data:...;base64," + panel.bytes.toString("base64")`, accumulated for all pages
before the document is built (`render.ts:438-453`).

**Why it matters:** At the `MAX_ATLAS_PAGES` = 200 cap (`packages/atlas-core/src/model.ts:92`) with
the documented ~480 KB JPEG per panel (`packages/map-sources/src/panel.ts:63-70`), that is ~96 MB of
bytes → ~128 MB of base64 strings, before `@react-pdf` copies them again while laying out. With
`--panel-format png` (~6× larger, per the same docstring) it is ~750 MB. The render-worker has no
per-job memory ceiling.

**Blast radius:** 3 · **Effort:** M · **Impact:** 3 · **Regression risk:** med

**First step:** Measure peak RSS for a 200-page `--basemap --panel-format png` render before changing
anything; if it confirms, stream panels to temp files and pass file paths to `@react-pdf`.

---

## P2-9 — Corridor pages are stepped by page *width* along any bearing

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/route.ts:24-49`
(`tileSegment`, `stepMeters`) is called at `route.ts:103` with `fp.widthMeters` regardless of the
leg's direction.

**Why it matters:** A north–south leg advances 4572 m per page when the page is 6096 m tall at
1:24,000 — ~33% more corridor pages than needed, more tiles fetched, and the 200-page cap
(`route.ts:114-118`) reached a third sooner. Not a coverage bug: even the worst axis-aligned case
(E–W, chord = width = step) is exactly covered.

**Blast radius:** 1 · **Effort:** S · **Impact:** 2 · **Regression risk:** low

**First step:** Step by the chord of the page rectangle along the leg's unit bearing
(`min(W/|ux|, H/|uy|)`), keeping a small safety factor.

---

## P2-10 — Corridor tiling uses one projector anchored at the first stop

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/route.ts:89` —
`createProjector(stops[0]!)` for the whole route; all segment tiling, spacing and the dedup radius
(`route.ts:92`) live in that one plane.

**Why it matters:** `grid.ts` deliberately re-centres each page for exactly this reason
(`packages/atlas-core/src/projection.ts:73-92`, and commit `da541ad`), and page bboxes here are also
re-centred via `pageBBoxAround`, so *scale* stays true. But on a several-hundred-kilometre route the
far end sits far off `stops[0]`'s central meridian, where the tmerc scale factor grows quadratically —
so page *spacing* and the dedup radius drift, producing uneven overlap at the far end of a long trip.
Silent: `scale-fidelity.test.ts:88-105` only checks footprints, which are immune.

**Blast radius:** 2 · **Effort:** S · **Impact:** 2 · **Regression risk:** med

**First step:** Re-anchor the projector per leg (or at the route's centroid) and add a test asserting
uniform centre-to-centre spacing along a 300 km route.

---

## P2-11 — USNG grid lines are clamped, not clipped; panel size arguments are ignored

**What & where:**
- `/home/caleb/Projects/JourneyBook/packages/map-sources/src/usng-grid.ts:34-37` — `panelFraction`
  independently clamps `u` and `v` to [0,1].
- `usng-grid.ts:117-140` — line endpoints are built from the *bbox-corner* UTM extremes, so they
  routinely fall outside the panel and get clamped.

Clamping moves an endpoint along one axis while leaving the other, which **bends** any line that is
not exactly axis-aligned. UTM easting lines are not vertical in Web-Mercator panel space (grid
convergence, up to ~3° near zone edges in CONUS), so clamped ends skew visibly at tier 3–4 —
precisely the tier where a reader is meant to trust the grid.

- `usng-grid.ts:62-63` — `_panelWidthPx` and `_panelHeightPx` are accepted and never used. The 1 km
  vs 10 km interval choice (`usng-grid.ts:98-106`) is made on *line count* alone (`MAX_GRID_LINES`
  = 60), never on printed spacing, so grid density in inches-on-paper is unmanaged across scales.

**Blast radius:** 1 · **Effort:** S · **Impact:** 2 · **Regression risk:** low

**First step:** Replace the clamp with a proper segment/bbox clip (the Liang-Barsky routine already
exists at `packages/render-cli/src/render.ts:224-249` — lift it into a shared module) and drive the
interval choice off printed millimetres per line using the panel px arguments already in the signature.

---

## P2-12 — USNG collar is derived from the page centre only

**What & where:** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/usng-grid.ts:145` —
`mgrsForward([centreLng, centreLat], 1)` then `parseUsngCollar`.

**Why it matters:** The printed collar declares one zone designator + one 100 km square for the whole
page, while the grid labels themselves are only the ambiguous two-digit km values
(`usng-grid.ts:39-44`). A page straddling a 100 km square boundary — routine at 1:100,000, where a
page is ~19 × 25 km — mislabels one side, and a reader converting a two-digit read-off into a full
USNG string gets a wrong grid reference. Silent and costly, which is the whole point of tier 3+.

**Blast radius:** 1 · **Effort:** S · **Impact:** 2 · **Regression risk:** low

**First step:** Compute the square for each bbox corner; when they differ, label the 100 km square on
each grid line rather than once in the collar (standard USNG practice).

---

## P2-13 — `enclosingBBox` has no antimeridian handling and clamps silently

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/extent.ts:26-40` takes a
naive min/max over longitudes and clamps to ±180. `packages/map-sources/src/overview.ts:20-33` does
the same for the overview extent.

**Why it matters:** Stops at +179 and −179 (a few km apart) yield a near-global box, which then tiles
into far more than 200 pages and fails at `render.ts:412-415` with a "use a coarser scale" message
that has nothing to do with the actual problem. Also affects the web app's "Enclose N Locations".
Out of scope for CONUS, but it is a wrong answer rather than a refusal.

**Blast radius:** 1 · **Effort:** S · **Impact:** 2 · **Regression risk:** low

**First step:** Detect a longitude span > 180°, wrap into a [0,360) frame, and either handle it or
throw a message that names the antimeridian.

---

## P2-14 — `niceScaleBar` can return a bar longer than `maxInches`

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/scale.ts:38-44` seeds
`groundMeters = NICE_STEPS[0]` (= 1) and only ever replaces it with a candidate `<= maxMeters`. When
`maxMeters < 1` the seed survives, and the returned `inches` (`scale.ts:49`) exceeds `maxInches`.
The loop also caps at `10 ** 8` m, silently under-serving any scale coarser than ~1:4,000,000.

**Why it matters:** Small today (`maxBarInches` is 3.375in), but it is a contract violation in the one
function whose whole job is "fits within maxInches", and it will bite the moment the bar box shrinks
(e.g. a landscape or half-page layout).

**Blast radius:** 1 · **Effort:** XS · **Impact:** 1 · **Regression risk:** low

**First step:** Return `null` (or the smallest nice value with an explicit overflow flag) when no
candidate fits; add the `maxInches = 0.1` case to `scale.test.ts`.

---

## P2-15 — Pin-point coverage holes where four pages meet (default `overlap: 0`)

**What & where:** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:75` defaults
`overlap` to 0; `packages/render-cli/src/render.ts:~350,~375` pass `input.overlap ?? 0`.

**[verified numerically]** Dense sampling (301 × 121 points) of a 70-page 1:100,000 grid over
[-98, 40.5, -95, 41.6] found **4 uncovered points out of 36,421**, all at four-page corners — the
expected consequence of axis-aligned bboxes around individually re-centred pages
(`projection.ts:86-91` documents the trade). Interior and edge coverage is otherwise complete; my
hypothesis of a systematic south-edge gap was **disproved**.

**Why it matters:** Cosmetically trivial, but `vault/pitfalls/page-overlap-alignment.md` and
`vault/grid-system/page-overlap.md` both call for overlap by default, and a non-zero overlap also
makes page-to-page navigation usable in the field.

**Blast radius:** 1 · **Effort:** XS · **Impact:** 2 · **Regression risk:** low

**First step:** Default `overlap` to ~0.02–0.05 in `PageGridOptions` and the CLI.

---

## P2-16 — `zoomForBBox` can overshoot the requested panel width by 2×

**What & where:** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/tilemath.ts:40-49` returns
the first integer zoom whose bbox width is ≥ `targetWidthPx`, so the actual panel is anywhere in
[target, 2×target). Panel byte size therefore varies ~4× for the same request, driving both P2-8 and
P2-3.

**Blast radius:** 1 · **Effort:** S · **Impact:** 2 · **Regression risk:** low

**First step:** After choosing the zoom, `sharp.resize()` the extracted crop to exactly
`targetWidthPx` (downscale only), making panel size and print DPI deterministic.

---

## P2-17 — Every vector overlay is drawn in a SQUARE viewBox on a non-square panel

**Title:** All page furniture is letterboxed and vertically offset relative to the map underneath it.

**What & where:** every overlay uses `viewBox="0 0 1000 1000"` with `width="100%" height="100%"` and
**no `preserveAspectRatio="none"`**, so SVG's default `xMidYMid meet` applies — the content is scaled
uniformly to fit the *smaller* dimension and centred, rather than stretched to the panel rectangle
the normalized 0..1 coordinates assume:
- `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:207` — `RouteLayer`
- `.../AtlasDocument.tsx:263` — `ReferenceGrid`
- `.../AtlasDocument.tsx:359` — `UsngGridLayer`
- `.../AtlasDocument.tsx:410` — `LandmarkLayer`
- `.../AtlasDocument.tsx:611` — the whole-atlas overview's page rectangles / route / stops

The panel is roughly 415 × 570 pt (portrait, taller than wide), so a square viewBox renders into a
415 × 415 band vertically centred in the panel. Every grid line, route vertex, landmark diamond,
reference-grid cell and overview page rectangle is therefore compressed to ~73% of the panel height
and offset downward — while the sources that produce those coordinates
(`packages/map-sources/src/tilemath.ts:65-73`, `usng-grid.ts:34-37`, `overview.ts:36-46`) are all
explicitly documented as normalized-to-the-panel-rectangle.

**Why it matters:** This is the second-order half of P2-1 and arguably worse for tier 3–4: the USNG
grid, the landmark markers and the overview's "which page am I on" rectangles do not sit over the
features they name. It also compounds P2-6 — the *image* is fitted with `cover`/stretch while the
*overlay* is fitted with `meet`, so the two disagree by construction.

**Blast radius:** 3 · **Effort:** S · **Impact:** 5 · **Regression risk:** low

**First step:** Add `preserveAspectRatio="none"` to all five `<Svg>` elements (or give each a viewBox
matching the panel's real aspect), then eyeball a tier-3 page against a known intersection.

---

## P2-18 — USNG grid labels are computed and then thrown away

**What & where:** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/usng-grid.ts:123-139`
builds a `labels[]` array (two-digit km values with `edge: top|bottom|left|right`) for every grid
line, it is part of the `UsngGridOverlay` contract (`packages/atlas-core/src/model.ts:145-160`), it is
threaded all the way through `render.ts:461` into the document — and
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:354-373` (`UsngGridLayer`)
maps only `overlay.lines`. `overlay.labels` is never read by any renderer.

**Why it matters:** An unlabelled grid is decoration, not a grid. Tier 3 ("Navigator — Tier 2 +
UTM/USNG grid") exists to teach reading a grid reference, and a reader cannot state a single
coordinate from the page as rendered. The `UsngCollar` badge (`AtlasDocument.tsx:376-388`) gives the
zone and 100 km square but nothing to combine them with. This is the cheapest high-impact fix in the
whole audit — the data is already on the props.

**Blast radius:** 2 · **Effort:** XS · **Impact:** 5 · **Regression risk:** low

**First step:** Render `overlay.labels` as `<Text>` in `UsngGridLayer`, positioned by `edge`; fix
P2-17 first or they will land in the wrong band.

---

## Accepted / verified-correct (recorded so it is not re-litigated)

- **`pageBBoxAround` AABB inflation is real but bounded.** Each page bbox circumscribes a curved,
  slightly rotated quad, so it covers ~0.177% more ground than the scale claims
  (`projection.ts:93-109`, verified numerically). Within the 0.5% validator tolerance and dwarfed by
  P2-1; the per-page re-centring in `da541ad` was the right call.
- **`lngLatToPanelFraction` is consistent with `renderMapPanel`.** Web-Mercator pixel aspect equals
  ground aspect, so panels are ground-isotropic; the grid/route/landmark overlays share the transform
  (`tilemath.ts:56-73`). No hidden Mercator stretch bug here.
- **No systematic grid coverage gap.** See P2-15 — tested and disproved.
- **`columnLetters` / `pageLabel` bijective base-26 is correct** (`grid.ts:15-29`), including the
  Z→AA rollover.
- **`geodesicDistanceMeters` via ECEF chord** (`projection.ts:117-121`) is fit for purpose at atlas
  page spans; the documented ~0.2 m error is immaterial.
- **`clipSegmentToBbox` (Liang-Barsky)** at `render.ts:224-249` is correct, including the
  degenerate-`p` case.
- **`validateInput`** in `render.ts:145-219` is genuinely thorough for lng/lat/bbox/tier/overlap/
  panel params and includes an http(s)-only `tileBaseUrl` SSRF guard.
