---
title: "Scan 5 — Product Gaps, UX, Print Polish"
category: "audit"
status: complete
date: 2026-09-08
pass: 5 of 5
scope: "What is actually built vs stubbed vs absent, judged from code, not roadmap"
---

# Pass 5 — Product Gaps, UX, and Print Polish

Method: read `vault/staged-build-roadmap.md`, `vault/development-roadmap.md`, `README.md`,
and `git log --oneline -60` first, then verified every claim against source. Anything the
roadmap calls done but the code does not do is filed as **STUBBED**, not **BUILT**.

**What the roadmap gets right:** the page-grid engine, per-page tmerc projection, USNG grid
geometry, route corridor tiling, landmark selection/declutter, overview page, TOC, page
numbers, reference-grid border, notes strip, custom pins, zoom ladders, CSV import, geocode,
project duplicate/delete/backup, and the render-worker round trip are all genuinely
implemented and reachable.

**What it gets wrong:** the "true print scale" promise — the single load-bearing claim of the
product — is not delivered by the renderer, and the Stage 1E "print-validation harness" cannot
detect that because it validates contract geometry, never the rendered sheet. That is finding
A1 and it dominates this list.

---

## (A) BUILT BUT WEAK — exists in code, needs polish or fix

### A1. The printed map is ~29 % smaller than the scale bar claims

**What & where** — `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/page.ts:41-51`
(`printableAreaInches` = 7.5 × 10.0 in on Letter at 0.5 in margins) sets the ground footprint
of every page bbox via `groundFootprintMeters`
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/page.ts:54-61`). But the sheet that
bbox is actually drawn onto is far smaller:
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:492-576` puts the
map panel inside a neatline (`:37`, 1.5 pt border + 6 pt padding), under a header (`:507-519`),
between two 54 pt-wide continuation-label columns (`:524`, `:550`), above the north/south edge
labels (`:521`, `:555`), the notes strip (`:557`, ~56 pt), and the footer (`:559-572`, ~38 pt).
Measured from the style sheet the drawn panel is roughly **417 × 569 pt = 5.79 × 7.90 in**, not
7.5 × 10.0 in. Meanwhile the scale bar at `:122-140` / `:561` draws a *physically true* length
(`bar.inches * PT`) for the nominal ratio. So a page labelled 1:24,000 prints at roughly
1:31,000, and the bar under it is ~29 % too long. The 1-inch calibration tick (`:158-170`) only
catches printer scaling, not this.

**Why it matters** — Every credibility claim in the vault ("true print scale", "a scale bar is
a promise about ground truth on the sheet in your hand" —
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/projection.ts:73-92`) is false in the
delivered artefact. A kid measuring 2 km on the bar walks 2.6 km. It also breaks the Level-3/4
USNG story, where a 1000 m grid must measure 1000 m.

**Blast radius** 5 · **Effort** M · **Impact** 5 · **Regression risk** high
(every fixture, golden atlas and page-count expectation shifts).

**First step** — Decide which side is authoritative and make the other follow. Cheapest correct
fix: compute the *drawn* panel size in points from the same constants the layout uses, export it
from `pdf-client` (or move the chrome sizes into `atlas-core`), and have `printableAreaInches`
return that. Then add the A-C4 rendered-PDF assertion so it can never drift again.

---

### A2. Overlays are letterboxed and the basemap is cropped or stretched — geo-registration is off

**What & where** — Every overlay draws into a square viewBox on a non-square panel:
`UsngGridLayer` `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:355-375`,
`RouteLayer` `:195-248`, `LandmarkLayer` `:406-435`, `ReferenceGrid` `:259-283`, and the
overview `:611`. All use `<Svg width="100%" height="100%" viewBox="0 0 1000 1000">` with no
`preserveAspectRatio`. react-pdf defaults to `xMidYMid meet`
(`node_modules/.pnpm/@react-pdf+render@4.5.1/…/lib/index.js:1108-1127`), so on a ~417 × 569 pt
panel the 1000-unit box is scaled to the *width* and vertically centred — normalized 0..1
coordinates no longer reach the panel's top and bottom edges. Separately the panel `Image`
itself uses `objectFit: "cover"` below tier 3 (`:532`, crops the map) and react-pdf's default
`fill` at tier 3+ (`:530`, anisotropic stretch — `resolveObjectFit` default at `index.js:1508`).

**Why it matters** — A USNG line, a landmark diamond, a route stop and a reference-grid cell all
land in the wrong place on the printed sheet, by a fraction that grows with the panel's aspect
departure from 1:1. At tier 3 the whole basemap is non-uniformly stretched, so the grid cannot
be square even in principle. The roadmap records the USNG grid as "georeferenced-correct against
`mgrs`" — that was verified on normalized coordinates, not on the rendered page.

**Blast radius** 4 · **Effort** S · **Impact** 5 · **Regression risk** med.

**First step** — Add `preserveAspectRatio="none"` to all five overlay `<Svg>` elements and set a
single, explicit `objectFit` on the panel `Image` for every tier. Then make the panel bbox aspect
match the drawn panel aspect (falls out of A1).

---

### A3. Attribution is a hardcoded string; the TileSource registry's attribution is never used

**What & where** —
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:562-564` prints the
literal `"© OpenStreetMap contributors · USGS — Journey Book"` on every page regardless of
source, and `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:564-566` returns
a second, different hardcoded string. `renderMapPanel` is always called with
`basemap = undefined` → `USGS_TOPO` (`render.ts:443`, `:536`;
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:141`), so `MapPanel.attribution`
(`panel.ts:206`) is computed and thrown away. The C# `TileSource` entity carries an attribution
field and the registry has full CRUD
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/TileSourceEndpoints.cs:11-36`).

**Why it matters** — The vault names attribution survival as a top risk. A PMTiles or
OSM-derived source will print a USGS credit it did not come from, which is a licensing problem,
and a US-only credit line on an international map is simply wrong. It also blocks A(B5).

**Blast radius** 3 · **Effort** S · **Impact** 4 · **Regression risk** low.

**First step** — Thread `MapPanel.attribution` (already returned) into `RenderPdfOptions` as a
per-atlas string and render it at `AtlasDocument.tsx:562`; default to the current literal when absent.

---

### A4. Default print resolution is ~1000 px per panel and cannot be raised from the web

**What & where** — `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:436`
(`panelWidthPx ?? 1000`), documented as "~176 DPI" at `render.ts:115-121`. Against the panel that
is actually drawn (A1) that is ~172 DPI; against a 300 DPI print target it is well under half.
`--panel-px` exists in the CLI
(`/home/caleb/Projects/JourneyBook/packages/render-cli/src/cli.ts:204-211`) but the C# wire
payload has no field for it — see the `WorkerRenderPayload` record at
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs:33-58`
— so every web render is locked to 1000 px JPEG q90.

**Why it matters** — USGS topo linework and contour labels are the whole point of the tier-3/4
pages; at ~170 DPI the 6-point label text on the source tiles is unreadable in print. The
web app, which is the product, cannot reach the quality the CLI can.

**Blast radius** 3 · **Effort** S · **Impact** 4 · **Regression risk** low
(watch PDF size — the JPEG measurement in `panel.ts:64-79` was taken at 1000 px).

**First step** — Add `panelWidthPx`/`panelFormat`/`panelQuality` to `WorkerRenderPayload` and a
"Print quality: Draft / Good / Best" select next to Generate; keep 1000 as Draft.

---

### A5. The landmark legend sits on top of the reference-grid border labels

**What & where** — `landmarkLegend` is absolutely positioned at `top: 4, left: 4` inside the
panel (`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:98-107`,
rendered at `:542`). `ReferenceGrid` puts its column letters at `top: 1` and its row numbers at
`left: 1` across the same corner (`:271-280`, rendered at `:544`). Both default to on
(`:725-726`). The legend also has no cap on entries — `selectPageLandmarks` can return enough
that the list runs the height of the panel.

**Why it matters** — On a dense page the A/B/C and 1/2/3 locators — the *only* wayfinding
affordance a Level-1 (age 5-8) page has — are covered by a legend box. This is the flagship
kid-facing tier.

**Blast radius** 2 · **Effort** XS · **Impact** 3 · **Regression risk** low.

**First step** — Move the legend to `bottom/right` (or inset it past the grid gutter when
`referenceGrid` is on) and cap it at ~6 rows with an "+N more" line.

---

### A6. Fixed page chrome eats ~30 % of the map area, including on pages that can never use it

**What & where** — The 54 pt continuation-label columns
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:524`, `:550`) are
reserved even when `page.neighbors.east/west` are undefined (the `continuation` helper at `:172-174`
returns `""` for a location or corridor page — every `L#` page has empty neighbors,
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:54`). The notes strip
(`:286-296`, rendered `:557`) prints its "NOTES" header and three ruled lines on *every* page
including grid pages, which never carry `page.notes` (only `buildLocationPage` sets it,
`grid.ts:49`).

**Why it matters** — This is the direct cause of most of the A1 shortfall and it is free to
recover. A grid page loses ~108 pt of width and ~56 pt of height to furniture that is blank.

**Blast radius** 2 · **Effort** S · **Impact** 4 · **Regression risk** med (changes every page's layout).

**First step** — Collapse the edge-label column to width 0 when the neighbor id is absent, and
skip `NotesArea` on pages with no `page.notes` unless the user explicitly asked for blank lines.

---

### A7. The binder gutter is always added to the left edge — wrong on every verso page

**What & where** — `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:501`
adds `gutter` to `paddingLeft` unconditionally; `printableAreaInches` likewise subtracts it from
width once (`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/page.ts:45-50`). There is
no odd/even page mirroring anywhere, and no hole-punch or trim guidance.

**Why it matters** — The product is a *book* you print and bind. Double-sided, the gutter falls
into the binding on odd pages and off the outer edge on even pages, so half the atlas has its
map crowded against the punch holes. `PageMargins.gutter` is modelled in the domain
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Domain/ValueObjects/PageMargins.cs`) and
persisted, which makes the omission look like an oversight rather than a decision.

**Blast radius** 2 · **Effort** S · **Impact** 3 · **Regression risk** low
(blocked behind B3 — gutter never reaches the renderer today).

**First step** — Pass the physical page index into `AtlasPageView` and swap
`paddingLeft`/`paddingRight` on even pages; add a `--duplex` / "print double-sided" toggle.

---

### A8. Print typography: Helvetica only, brand fonts unused, body type at 6-9 pt

**What & where** — No `Font.register` call exists anywhere in the repo (verified by grep across
`packages`, `apps`, `services`). `styles.page` pins `fontFamily: "Helvetica"` at 9 pt
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:36`); the
attribution is 6 pt (`:65`), the landmark legend 6 pt (`:108-110`), edge labels and grid labels
7 pt (`:47`, `:80-86`), the notes header 7 pt (`:89`). The brand faces (Saira Stencil One,
Source Sans 3, Spline Sans Mono) are declared at
`/home/caleb/Projects/JourneyBook/packages/ui/src/tokens.ts:46-50` and used only by the web app.

**Why it matters** — The product's audience starts at age 5. 6-7 pt Helvetica is below what a
child reads comfortably, and the printed atlas shares no visual identity with the branded web
app that Stage 4 built — the two look like different products.

**Blast radius** 2 · **Effort** S · **Impact** 3 · **Regression risk** low
(font registration in a Node container needs the TTFs vendored, not CDN-fetched).

**First step** — Vendor the three TTFs into `packages/ui/fonts`, `Font.register` them in
`pdf-client/src/index.ts`, and lift the minimum furniture size to 8 pt.

---

### A9. Render is a single synchronous request with no progress, no ETA, and no cancel

**What & where** — `GenerateButton` awaits one POST and spins
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/GenerateButton.tsx:23-38`);
`RenderEndpoints` awaits the worker inline
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/RenderEndpoints.cs:9-30`); `RenderService`
awaits `workerClient.RenderAsync` inline
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:117-126`);
and the worker fetches panels **serially, one page at a time**, in a `for` loop
(`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:441-452`) with progress
written only to the worker's stderr (`:445`). `MAX_ATLAS_PAGES` is 200
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:92`).

**Why it matters** — A 60-page atlas is 60 sequential tile-mosaic fetches behind one HTTP
request. The user sees an indefinite spinner with no page count, no elapsed time and no way to
stop; a proxy or browser timeout leaves a `Pending`→`Failed` record and no explanation. The
`GeneratedPdf` lifecycle table already exists to support polling — it just isn't used that way.

**Blast radius** 4 · **Effort** M · **Impact** 5 · **Regression risk** med.

**First step** — Two independent wins: (a) bound-concurrency the panel loop (4-6 at a time) in
`render.ts:441`; (b) return `202 + generatedPdfId` immediately and poll
`GET /api/generated-pdfs/{id}` from `GenerateButton`, showing "page 12 of 34".

---

### A10. The scale picker in the editor is a no-op — it changes the view, not the atlas

**What & where** — `setScaleView`
(`/home/caleb/Projects/JourneyBook/apps/web/src/routes/ProjectEditorPage.tsx:111-117`) mutates
local state only; the comment there says so. `RenderService` reads the scale from the persisted
grid (`RenderService.cs:51`), and `PUT /api/projects/{id}` is the only way to change it
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/ProjectEndpoints.cs:29`) — the web client
calls it only from `rename` (`/home/caleb/Projects/JourneyBook/apps/web/src/api/client.ts:189-198`).
The disclaimer is a 10 px italic line at `ProjectEditorPage.tsx:427-430`.

**Why it matters** — Scale is the product's headline first-class feature. A user changes it,
watches the page-count estimate and footprint label update
(`ProjectEditorPage.tsx:313-317`, `:340-353`), clicks Generate, and gets an atlas at the *old*
scale. The only escape is to create a new project.

**Blast radius** 3 · **Effort** S · **Impact** 4 · **Regression risk** low.

**First step** — Wire `setScaleView` to `api.projects.update` with the project's current
orientation/overlap/margins (fix A12 at the same time), then delete the disclaimer.

---

### A11. No URL routing — no deep links, no back button, no refresh survival

**What & where** — `/home/caleb/Projects/JourneyBook/apps/web/src/App.tsx:9-24` holds the route
in `useState`; there is no router dependency, no `history.pushState`, and no `:projectId` in the
address bar.

**Why it matters** — Refreshing while editing an atlas throws the user back to the project list.
The browser Back button leaves the app entirely instead of returning to the list (the in-app
"← Projects" button at `ProjectEditorPage.tsx:368-373` is the only way back). A project cannot be
bookmarked or shared with the other parent — on a single-user home-server app, links are the
sharing mechanism.

**Blast radius** 2 · **Effort** S · **Impact** 3 · **Regression risk** low.

**First step** — Add `react-router` (or 20 lines of `popstate` + `pushState`) with `/` and
`/projects/:id`; keep `onOpen`/`onBack` as the call sites.

---

### A12. Destructive edits with no guard: location delete, and rename silently resets margins

**What & where** — `onDelete` fires straight through with no confirm
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/LocationList.tsx:211-218` →
`ProjectEditorPage.tsx:303-311`), unlike project delete which does confirm
(`/home/caleb/Projects/JourneyBook/apps/web/src/routes/ProjectListPage.tsx:55`). Separately,
`api.projects.rename` sends a full `PUT` with **hardcoded** `margins: {0.5, 0.5, 0.5, 0.5,
gutter: 0}` (`/home/caleb/Projects/JourneyBook/apps/web/src/api/client.ts:189-198`) because the
API's PUT replaces all grid fields — so renaming an atlas silently discards any custom margins
or gutter it had. Errors surface as a transient, undismissable 11 px span in the header
(`ProjectEditorPage.tsx:384`).

**Why it matters** — Same class of bug the roadmap already recorded twice ("changing a
location's scale wiped its pin", "the backup importer wiped notes"). A misclicked Remove on a
geocoded stop with a custom pin, notes and a zoom ladder is unrecoverable.

**Blast radius** 2 · **Effort** XS · **Impact** 3 · **Regression risk** low.

**First step** — Add a confirm to location Remove; make `rename` read the project's current
margins instead of hardcoding, or add a `PATCH /projects/{id}` that merges.

---

## (B) STUBBED / PARTIAL — scaffolding present, not functional

### B1. Tier 4 is selectable and renders exactly like Tier 3

**What & where** — `TierPicker` offers *"Tier 4 — Land Nav · Tier 3 + full MGRS & azimuth"*
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/TierPicker.tsx:7`); the CLI accepts
`--tier 4` (`/home/caleb/Projects/JourneyBook/packages/render-cli/src/cli.ts:125-132`);
`validateInput` accepts 1-4 (`render.ts:156-158`); `RenderService` accepts 1-4
(`RenderService.cs:28-30`). But `AtlasDocument` branches only on `showTier2 = tier >= 2` and
`showTier3 = tier >= 3`
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:487-488`) — there is
no tier-4 code path anywhere. Grep confirms no `declination`, `azimuth`, or `magnetic` logic
exists outside comments and the unmounted Hero.

**Why it matters** — The UI promises a feature the engine does not have, silently. Level 4 is
the top of the "grows into Army land nav" ladder that names the product.

**Blast radius** 2 · **Effort** L · **Impact** 4 · **Regression risk** low
(purely additive furniture — the tier contract is already threaded end to end).

**First step** — Immediately: mark Tier 4 `disabled` in `TierPicker` with "coming soon". Then
build it as three separate additive pieces (full MGRS labels, declination diagram + G-M angle,
azimuth/distance worksheet page), each gated at `AtlasDocument.tsx:487`.

---

### B2. The USNG grid has no coordinate labels — you cannot read a grid reference off the page

**What & where** — `buildUsngGrid` computes a full label set with edge placement
(`/home/caleb/Projects/JourneyBook/packages/map-sources/src/usng-grid.ts:113-140`; the
`labels` array is part of the `UsngGridOverlay` contract at
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:145-160`). `UsngGridLayer`
renders `overlay.lines` and **never touches `overlay.labels`**
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:355-375`). The only
tier-3 text on the page is the collar badge (`:378-387`).

**Why it matters** — A USNG grid without two-digit easting/northing labels is decorative. The
entire point of Level 3 — "read me your grid square" — is unavailable, and the labels are
already computed and shipped across the wire.

**Blast radius** 2 · **Effort** XS · **Impact** 5 · **Regression risk** low.

**First step** — Render `overlay.labels` as `<Text>` in `UsngGridLayer` positioned by `edge`,
with a parchment backing box like `styles.gridLabel` (`:80-86`). Coordinate with A2 — the
positions are only correct once `preserveAspectRatio` is fixed.

---

### B3. Margins, gutter and orientation are persisted, DTO'd, then dropped at the worker wire

**What & where** — `RenderService` carefully builds `orientation` and `RenderMarginsDto`
from the persisted grid
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:52-56`)
and puts them in `RenderWorkerRequest` (`:96-114`). The wire record
`WorkerRenderPayload` has **no** `Margins` and **no** `Orientation` field
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs:33-58`,
constructed at `:112-133` and `:139-156`). On the other side `assembleContract` hardcodes
`LETTER_PORTRAIT` for every grid, location and route page
(`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:317`, `:331`, `:362`,
`:383`, `:398`) and stamps `margins: LETTER_PORTRAIT.margins` on the contract (`:408`). The CLI
has no `--margins`, `--gutter` or `--orientation` flag either
(`/home/caleb/Projects/JourneyBook/packages/render-cli/src/cli.ts:32-82`).

**Why it matters** — `PageOrientation`, `PageMargins.gutter`, the `Orientation` column and its
migration, the `landscape` branch in `sheetWidthInches`
(`AtlasDocument.tsx:113-115`) and `printableAreaInches` (`page.ts:42-43`) are all dead weight.
Landscape — the natural orientation for a road-trip corridor page — is unreachable, and A7's
binder gutter can never be exercised.

**Blast radius** 3 · **Effort** S · **Impact** 3 · **Regression risk** med
(page geometry changes; `validateAtlas` hardcodes 8.5 × 11 at `validation.ts:58-63`).

**First step** — Add `Margins` and `Orientation` to `WorkerRenderPayload`, accept them in
`RenderAtlasInput`, and build the `PageSpec` from them instead of the `LETTER_PORTRAIT`
constant. Add `--orientation` / `--margins` / `--gutter` to the CLI at the same time.

---

### B4. Location notes print and round-trip, but cannot be typed anywhere in the web app

**What & where** — Notes render at the foot of a location page
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:286-296`, `:557`),
flow through `buildLocationPage` (`grid.ts:49`), the wire (`HttpRenderWorkerClient.cs:95`), CSV
import (`/home/caleb/Projects/JourneyBook/packages/render-cli/src/cli.ts:68`, and the server-side
`LocationCsv`), and the JSON backup
(`/home/caleb/Projects/JourneyBook/apps/web/src/routes/ProjectListPage.tsx:79`). But
`LocationList` has no notes input — the add form is name/lng/lat/scale only
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/LocationList.tsx:224-262`) — and
`handleAddLocation` never passes one
(`/home/caleb/Projects/JourneyBook/apps/web/src/routes/ProjectEditorPage.tsx:232-240`).
`updateLocation` only preserves whatever is already there (`:248-269`).

**Why it matters** — "Grandma's house — the blue mailbox, turn after the barn" is the exact
content that makes this a *family* atlas rather than a map dump. Today it is reachable only by
hand-authoring a CSV. Also: locations cannot be renamed or repositioned after creation, and
cannot be reordered — which fixes the route-atlas stop order to creation order permanently.

**Blast radius** 2 · **Effort** S · **Impact** 4 · **Regression risk** low
(`PUT /locations/{id}` already accepts notes — `client.ts:237-252`).

**First step** — Add a notes `<textarea>` to each row's expanded editor in `LocationList`,
routed through the existing `updateLocation` helper; add name/lat/lng editing in the same pass.

---

### B5. The TileSource registry is fully built server-side and completely unreachable from the product

**What & where** — Full CRUD plus by-key lookup
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/TileSourceEndpoints.cs:11-36`), a
`Kind` discriminator with raster/PMTiles dispatch in the proxy
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/TileEndpoints.cs:15`), and a working
PMTiles reader. But `apps/web/src/api/client.ts` has **no** `tileSources` section at all, no
component references it, the web map hardcodes `"/api/tiles/usgs-topo/{z}/{x}/{y}"`
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/MapPreview.tsx:20`), and the render
source comes from config, not the project
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:93-94`).

**Why it matters** — The roadmap calls this "the seam" for offline PMTiles packages,
self-hosting, and international coverage — the answer to the documented tile-policy/rate-limit
risk. All of the hard work is done and none of it is exposed, so the product is USGS-only and
US-only in practice.

**Blast radius** 3 · **Effort** M · **Impact** 4 · **Regression risk** low (purely additive).

**First step** — Add a `Basemap` select to the editor sidebar fed by `GET /api/tile-sources`,
persist the choice on the project, and pass it as `TileSourceId` in `RenderService.cs:93-106`
instead of reading `Tiles:DefaultSource`.

---

### B6. The Stage 4 brand landing page exists and is never mounted

**What & where** — `/home/caleb/Projects/JourneyBook/apps/web/src/components/Hero.tsx:70`
exports `Hero`, backed by 143 lines of bespoke map furniture
(`/home/caleb/Projects/JourneyBook/apps/web/src/components/MapFurniture.tsx`). Grep for `Hero`
across `apps/web/src` returns only its own definition — `App.tsx:9-24` renders
`ProjectListPage` or `ProjectEditorPage` and nothing else.

**Why it matters** — A first-time visitor lands on a bare list with an empty state that says
"No atlases yet" (`ProjectListPage.tsx:194-199`) and no explanation of what a Journey Book is,
what a tier means, or what they will get. The onboarding asset is written and shelved.

**Blast radius** 1 · **Effort** XS · **Impact** 3 · **Regression risk** low.

**First step** — Render `<Hero />` above the list when `projects.length === 0`, or on a `/`
route once A11 lands.

---

## (C) NOT BUILT — genuinely absent, next feature candidates

### C1. No cover/title page — the book has no front

**Where it would hook in** — `AtlasDocument`'s front-matter block already establishes the
pattern and the page-offset arithmetic:
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:749-779`
(`frontMatter`, `physicalPage`) sequences the overview then the TOC. A `CoverPage` slots in
before both, and the fields ride `RenderPdfOptions`
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/index.ts:16-38`).

**Why it matters** — This is the emotional centre of a kid's atlas: *"THE SUMMER TREK — Explorer:
Nora — August 2026 — this atlas belongs to ___"*. It is also the single cheapest thing that
makes the PDF feel like a book rather than a map dump. The roadmap flags "explorer name/date"
as the top remaining Stage 9 nice-to-have and it is still absent.

**Blast radius** 1 · **Effort** S · **Impact** 4 · **Regression risk** low.

**First step** — Add `coverPage?: { explorer?: string; date?: string; subtitle?: string }` to
`RenderPdfOptions`, render it in the front-matter block, add two text fields to the editor
sidebar, and forward them on the wire.

---

### C2. Level-1 road-atlas furniture is incomplete: no place-name index, no continuation arrows

**Where it would hook in** — Continuation is text-only today:
`continuation()` returns `"CONTINUE NORTH · B2"`
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:172-174`, drawn at
`:521`, `:524`, `:550`, `:555`) with no arrow glyph. The TOC lists only *saved locations*
(`:760-770` filters on `page.title`), so grid and corridor pages appear nowhere in any index, and
imported landmarks — which have names and per-page placement
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/landmarks.ts`) — are never collated
into a back-of-book "Windmill Hill … page 14" list.

**Why it matters** — The roadmap defines Level 1 as *"friendly page-relative alphanumeric grid,
place-name index, landmarks, route line, continuation arrows"* and calls it the MVP default.
Two of the five are missing. A place-name index is what makes the artefact usable the way a
road atlas is usable — you look up the name, not the coordinates. All the data already exists
per page.

**Blast radius** 2 · **Effort** M · **Impact** 4 · **Regression risk** low (additive front/back matter).

**First step** — Ship the arrow glyph first (an SVG triangle beside the CONTINUE text, ~30 min),
then build a `PlaceIndex` back-matter page from the same `landmarks` record the pages consume,
sorted alphabetically with physical page numbers from the existing `pageNumbers` map (`:773-774`).

---

### C3. No page-size choice — Letter is hardcoded in four places

**Where it would hook in** — `LETTER_PORTRAIT_PT`
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:15`), `LETTER_PORTRAIT`
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/page.ts:20-25`),
`sheetWidthInches`'s literal 8.5/11
(`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:113-115`),
`<Page size="LETTER">` at `:494`, `:598`, `:686`, and `validateAtlas`'s hardcoded 8.5 × 11
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:58-63`). Grep for "A4"
returns nothing anywhere in the repo.

**Why it matters** — Everywhere outside North America prints A4. The `PageSpec` abstraction
(`page.ts:10-17`) was clearly designed for this and is then bypassed by a constant. It pairs
naturally with B5 (international basemaps) — together they are "this product works outside the US".

**Blast radius** 3 · **Effort** M · **Impact** 3 · **Regression risk** med
(every footprint, page count and golden fixture is size-dependent).

**First step** — Introduce a `PAGE_SIZES` table beside `SCALE_PRESETS`, make `PageSpec` the only
source of sheet dimensions (delete the literals in `AtlasDocument` and `validation.ts`), and
persist a `pageSizeId` on the project.

---

### C4. Nothing tests the rendered PDF — the "print-validation harness" never opens the output

**Where it would hook in** — `validateAtlas`
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:41-103`) checks bbox
footprint against scale and neighbour reciprocity — both purely contract-level.
`scale-fidelity.test.ts`
(`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/scale-fidelity.test.ts:20-56`) and
the golden fixture (`fixture.test.ts`) do the same. `effectiveDpi` exists
(`validation.ts:105-107`) and is called by nothing. No test in the repo renders a PDF and
measures anything on the page.

**Why it matters** — This blind spot is precisely why A1 (a ~29 % scale error) and A2
(mis-registered overlays) can both be true while every check reports PASS and the roadmap
records the harness as built. Fixing A1 without adding this test only resets the clock.

**Blast radius** 4 · **Effort** M · **Impact** 5 · **Regression risk** low (test-only).

**First step** — Add a `pdf-client` test that renders a one-page atlas to a buffer, parses the
page's content stream for the panel image's placed width/height in points, and asserts
`panelWidthPt / 72 * scale.ratio * 0.0254 ≈ page bbox ground width` within 1 %. Wire it into
`harness/checks/test.sh`.

---

## Cross-cutting notes (not counted as findings)

- **`README.md:14-19` "Status" says Stage 0.** The product is at Stage 9. Anyone onboarding from
  the README will believe the engine is stubs.
- **Downloaded PDFs are named `atlas-<guid>.pdf`**
  (`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:63`,
  served with that name at
  `/home/caleb/Projects/JourneyBook/apps/api/Endpoints/GeneratedPdfEndpoints.cs:57-58`) — a
  downloads folder of guids, not "summer-trek-2026.pdf".
- **Accessibility is better than average for a project at this stage** — bbox inputs have `<label
  htmlFor>` (`ProjectEditorPage.tsx:441`), ladder chips use `aria-pressed`
  (`LocationList.tsx:186`), the scale select has an `aria-label` (`:162`), Remove has one
  (`:215`), spinners are `aria-hidden`. The gaps are contrast (10 px `text-bark-400` on
  parchment, e.g. `ProjectEditorPage.tsx:424`, `:427`) and the map's click-to-draw flow, which
  has no keyboard equivalent (`MapPreview.tsx:175-185`).
- **Mobile** — the layout stacks (`lg:flex-row`, `lg:w-80`, `ProjectEditorPage.tsx:387`, `:407`)
  but the map is pinned to `h-[calc(100vh-3.5rem)]` (`:395`), so on a phone the entire first
  screen is map and the sidebar is a full scroll away with no affordance suggesting it exists.
