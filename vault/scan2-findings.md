---
title: "Second five-pass scan — 2026-09-09"
category: "audit"
status: complete
priority: high
related:
  - "Maintainability Scan — 2026-09-09"
  - "Development Roadmap"
---

# Second five-pass scan — findings

Working tree at `ce5d4e3`, clean before and after. **No source was modified and left
modified**: every mutation below was applied, built, tested, and reverted, and the tree
was verified clean at the end.

## What was actually run

| Check | Result |
|---|---|
| `npx pnpm -r build` + `npx pnpm -r test` (baseline) | **239 pass** (atlas-core 75 · map-sources 53 · pdf-client 38 · render-cli 51 · web 16 · render-worker 6) |
| `dotnet build JourneyBook.slnx` | **succeeded**, 0 errors, 8 warnings (2× NU1903 high-severity CVE — `Microsoft.OpenApi` 2.0.0, `SSH.NET` 2025.1.0 — plus the EF 10.0.4↔10.0.9 conflict; all three carried over from the first scan) |
| `dotnet test --filter "FullyQualifiedName!~Api"` | **95 pass** |
| **17 source mutations**, each built and run against the full suite | see the mutation table |
| `node scripts/regenerate-sample-atlas.mjs --check` | clean on `master`; correctly fails under a grid mutation nothing else catches |
| Docker | unavailable — the Api/Testcontainers suite was not run, as expected |

Nothing here re-reports an item `vault/audit-2026-09-08/` or `vault/maintainability-2026-09-09.md`
records as done. The known-and-deliberate items — missing ADR text for 0001/0003/0004/0005,
no worker-owned progress, no cancel, the in-process queue — are not reported as discoveries.
Where this scan says one of them is *worse in practice than the ADR admits*, it says so and
proves it.

---

## THE HEADLINE

**`overlap` is the parameter the roadmap is about to put to the owner as "a far bigger
lever than any of this", and it is the one parameter in the scale chain with no guard
anywhere in either language.** Proven three ways:

- Halve its effect in the engine (`grid.ts:126`, `(1 - overlap)` → `(1 - overlap * 0.5)`)
  and **239 of 239 TypeScript tests stay green**.
- Hardcode it to `0` on the worker wire (`HttpRenderWorkerClient.cs:152,179`) and
  **95 of 95 .NET tests stay green** — the *exact* shape of the margins bug that was
  just fixed, on the very next field of the very same payload.
- Its only test, `grid.test.ts:111`, compares overlap 0 against overlap 0.5 and asserts
  "more pages". Any monotone function passes.

And separately: the number being put to the owner for it (`+17% pages`) is a single
extent's quantisation artefact. See §Q4.

---

# The five passes

## 1. Architecture and seams

### A-1. `pdf-client` ↔ `atlas-core` — the seam that was extracted is genuinely closed. **Cleared.**

`packages/pdf-client/src/AtlasDocument.tsx:19` imports `PAGE_FURNITURE_PT as FURNITURE`
and reads every neatline / edge-label / panel-border / header / notes / footer dimension
off it (`:53,55,61,68,76,84,97,127,213-215,685-692,721,801-802`). Nothing is re-declared.
The dependency direction is acyclic and `atlas-core/src/validation.ts:44-50` documents why
it takes printed measurements as *data* rather than importing the renderer. Verified by
mutation: `PAGE_FURNITURE_PT.panelBorder 1 → 2` (M11) fails 9 tests; `edgeLabelColumn
54 → 38` (M1) fails 9 tests. Both sides move together and the suite notices.

### A-2. Two literals still reach through that seam

- `packages/pdf-client/src/pdf-measure.ts:347` — `mapBoxOf(page, borderPt = 1)`. That `1`
  is `PAGE_FURNITURE_PT.panelBorder`, typed in as a literal in the one package that
  imports `PAGE_FURNITURE_PT` everywhere else, and `render-cli/src/cli.ts:173` calls it on
  the default, so the `validate` command's fidelity measurement is anchored on a copy.
  **Guarded, though**: M10 (`borderPt 1 → 3`) fails `pdf-measure.test.ts`. It is a
  documentation problem, not an unguarded invariant.
- `packages/pdf-client/src/AtlasDocument.tsx:177` and
  `packages/atlas-core/src/validation.ts:103-108` hardcode `widthIn: 8.5, heightIn: 11`
  while `LETTER_PORTRAIT` is exported from `page.ts:20` and `AtlasDocument.tsx:16` already
  imports `LETTER_PORTRAIT_PT`. Harmless today (Letter is the only sheet); it is the thing
  that has to change first when a second page size lands.

### A-3. The lng/lat → panel-fraction mapping exists three times, two of them divergent

`packages/map-sources/src/tilemath.ts:58-73` declares itself **THE** shared panel↔grid
mapping and is Web Mercator. `packages/atlas-core/src/landmarks.ts:91-102` and
`packages/render-cli/src/render.ts:584-610` each roll their own, **linear in degrees**.

**I measured the divergence rather than asserting it, and it downgrades the claim.**
Maximum displacement, as a fraction of the 549 pt printed map box:

| case | max error |
|---|---|
| one 1:24,000 page at 41°N | 0.008% = **0.044 pt** |
| one 1:100,000 page at 41°N | 0.033% = 0.182 pt |
| one 1:24,000 page at 61°N | 0.017% = 0.091 pt |
| overview of a 1° extent at 41°N | 0.190% = 1.04 pt |
| overview of a 3° extent at 41°N | 0.579% = 3.18 pt |
| overview of a 3° extent at 61°N | 1.207% = **6.62 pt** |

A landmark diamond is 5.4 pt across (`AtlasDocument.tsx:569`). On an atlas page the error
is a hundredth of a glyph — **not** a live misregistration, and I withdraw that reading.
On the overview page at continental extents it is a few points, and the overview is
explicitly schematic. The finding that survives is the duplication plus §2-a below.

### A-4. `overview.ts` re-implements extent padding

`packages/map-sources/src/overview.ts:29-32` is structurally `enclosingBBox`
(`packages/atlas-core/src/extent.ts`) with different constants (0.08 / 0.01 vs 0.05 / 0.02)
and, unlike atlas-core's, **no clamp to ±180 / ±90**. Unguarded: M13 (0.08 → 0.20) leaves
239/239 green.

### A-5. ADR 0004 — the geometry monopoly, re-checked more broadly than last time

The 2026-09-09 check looked for trigonometry, earth radii and degree/radian conversion in
`dotnet/` and `apps/api/`. That is still clean — no degrees-per-metre approximation, no
aspect-ratio math, no buffer distance, no page counting, no MGRS/USNG in C#. NetTopologySuite
use is storage (`RenderService.cs:77-78`, `ProjectService.cs:180-192,201-202`,
`LocationService.cs:165-167`) — an axis-aligned ring built from four doubles and read back
through `EnvelopeInternal`. `LandmarkService.cs:112-141` scoring is a category table with no
spatial term. `apps/web/src` calls `buildPageGrid`, `enclosingBBox` and `SCALE_PRESETS`
rather than duplicating them. **The monopoly on formulas holds.**

What does not hold is the monopoly on *constants and placement*:

- `dotnet/.../Persistence/Configurations/ScalePresetConfiguration.cs:15-21` seeds the scale
  denominators — the top of the scale chain — as a C# copy of `model.ts:54-60`. The
  duplication itself is already recorded at `vault/maintainability-2026-09-09.md:362` (four
  copies, all currently agreeing) and is still open. **What is new is how much now depends on
  it.** The C# copy is the gatekeeper on *four* user-facing write paths, through three
  separate validators plus a fourth inline query:
  - `ProjectService.EnsureScalePresetAsync` (`:159-165`) — project create (`:16`) and update (`:58`);
  - `LocationService.ValidateScalePresetAsync` (`:183-188`) — the per-location scale override,
    on create (`:22`) and update (`:137`);
  - `LocationService.ValidateZoomLevelsAsync` (`:195-213`) — every entry of a location's zoom
    ladder, on create (`:23`) and update (`:138`);
  - `LocationService.ImportCsvAsync` (`:65-79`) — a **fourth, inline** copy of the same
    `db.ScalePresets` lookup, not a call to either helper, covering both the override and the
    ladder in one query.

  So adding a preset to `packages/atlas-core/src/model.ts` without also adding it to
  `ScalePresetConfiguration.cs:16-21` returns 400 on project creation, project update,
  location save and CSV import — and the only thing asserting the two lists match is the
  comment at `ScalePresetConfiguration.cs:15`. A single test reading `SCALE_PRESETS` and
  comparing it with `HasData` covers all four at once, and is the highest-value mechanical
  guard available for ADR 0004.
- `dotnet/JourneyBook.Domain/ValueObjects/PageMargins.cs:9-12` and
  `dotnet/.../Rendering/RenderService.cs:59,62-64` re-state `DEFAULT_MARGINS` and
  `DEFAULT_SCALE_PRESET_ID`. Since the print fix, margins move the printed footprint.
- `apps/api/Endpoints/TileEndpoints.cs:37-44` computes `1 << z` tiles per axis;
  `map-sources/src/tilemath.ts:20-22` computes the same. Range guard, not a render, but it
  is the quantity ADR 0005 is aimed at.
- `packages/map-sources/src/tilemath.ts` is a **second projection implementation**, holding
  `EARTH_CIRCUMFERENCE_M` (`:6`), degree→radian conversions (`:28,36`),
  `groundResolutionMetersPerPixel` (`:35-37`) and `zoomForBBox` (`:40-49`) — a scale
  computation and a zoom selection, both squarely ADR 0004's subject matter, sitting outside
  `atlas-core`. Defensible (tiles *are* Web Mercator by definition), but it is why the
  earlier search found nothing: it looked in the wrong language.

**Nothing enforces ADR 0004 mechanically.** Every script in `harness/checks/` was read;
`lint.sh` is `pnpm -r typecheck`, there is no eslint config anywhere, and
`project-references.sh` enforces build order, not policy. `docs/decisions/README.md:38-42`
already says this. The highest-value guard would be a test that reads `SCALE_PRESETS` and
asserts it matches `ScalePresetConfiguration.HasData`.

---

## 2. The four recurring shapes

### (a) A test that cannot fail

The full mutation run. **17 mutations, each built and run against all 239 TS tests (or all
95 .NET tests), then reverted.**

| # | mutation | file | caught? |
|---|---|---|---|
| M1 | `edgeLabelColumn: 54 → 38` | `atlas-core/src/page.ts:74` | **9 tests** |
| M2 | renderer paints the map box 5% narrower | `pdf-client/src/AtlasDocument.tsx:178` | **5 tests** (4 fidelity + overlays) |
| M3 | crop origin `left + 8 px` | `map-sources/src/panel.ts:415` | **2 tests** |
| M4 | crop width × 1.3 | `map-sources/src/panel.ts:419` | **2 tests** |
| M5 | page grid gains one column | `atlas-core/src/grid.ts:128` | **3 tests** |
| **M6** | **grid step × 1.02 (a 2% ground gap between every adjacent page)** | `atlas-core/src/grid.ts:125` | **1, incidentally** — only the page-cap *count* test |
| M7 | scale bar printed 10% longer than the ground it claims | `atlas-core/src/scale.ts:49` | **1 test** |
| M8 | `metersPerInch` +1% | `atlas-core/src/scale.ts:11` | **10 tests** |
| **M9** | **`overlap` honoured at half its stated value** | `atlas-core/src/grid.ts:126` | **NO — 239/239 green** |
| M10 | `mapBoxOf` default border 1 → 3 | `pdf-client/src/pdf-measure.ts:347` | **1 test** |
| M11 | `panelBorder: 1 → 2` | `atlas-core/src/page.ts:72` | **9 tests** |
| **M12** | **every landmark shifted 3% down the panel** | `atlas-core/src/landmarks.ts:102` | **NO — 239/239 green** |
| **M13** | **overview extent padding 0.08 → 0.20** | `map-sources/src/overview.ts:29` | **NO — 239/239 green** |
| **M15** | **`zoomForBBox` returns one zoom coarser (half the print resolution)** | `map-sources/src/tilemath.ts:45` | **NO — 239/239 green** |
| M16 | `pageBBoxAround` half-width/half-height swapped | `atlas-core/src/grid.ts:161` | **6 tests** |
| M17 | crop origin `top + 3 px` | `map-sources/src/panel.ts:416` | **1 test** |
| **C#-1** | **`Overlap: request.Overlap` → `Overlap: 0` on the worker wire** | `HttpRenderWorkerClient.cs:152,179` | **NO — 95/95 green** |

Five unguarded, and each one names a specific test that reads like the guard and is not:

- **M9 / C#-1 — `overlap`.** `grid.test.ts:111-116` compares overlap 0 with overlap 0.5 and
  asserts the second produces more pages. Any monotone function satisfies that; the actual
  fraction is never checked. On the C# side, `HttpRenderWorkerClientTests.cs:53,125` *supply*
  `Overlap: 0.05` and never assert it appears on the wire. That is the margins bug's shape
  with one difference: the margins tests at least asserted absence, which was visibly wrong;
  overlap is simply never looked at.
- **M15 — `zoomForBBox`.** `tilemath.test.ts:32-35` is
  `expect(zoomForBBox(bbox, 2048)).toBeGreaterThan(zoomForBBox(bbox, 256))`. A relative
  assertion on the function that decides the printed map's resolution and, with the source
  ceiling, the effective print DPI the roadmap tracks against 300. No absolute value is
  asserted anywhere. `panel.test.ts:294-297` ("leaves a request within the ceiling exactly
  where it was") asserts `zoom < maxZoom` and `zoomClamped === false`, both still true one
  level down.
- **M12 — landmark placement.** `landmarks.test.ts:19` uses `bbox: [0, 0, 1, 1]` and its
  header (`:13`) documents the mapping as "x = lng, y = 1 - lat" — the test is written *to*
  the linear mapping, on a degenerate box where every mapping agrees.
- **M13 — overview padding.** `overview.test.ts` (3 tests) never asserts the padded box.

### (a-bis) The most dangerous one: the golden fixture's only engine binding runs nowhere

`fixture.test.ts:24-33` states: *"`scripts/regenerate-sample-atlas.mjs` rebuilds the file
from its recorded parameters and reproduces it byte for byte; `--check` fails if it would
not. If the engine changes, both this test and that check fail together."*

**The second half is false, and I proved it.** Under M6 — grid step 2% larger, so every pair
of adjacent pages leaves a 2%-of-a-page strip of ground on no page at all:

```
$ node scripts/regenerate-sample-atlas.mjs --check
sample-atlas.json does NOT match what the engine produces for its recorded parameters.
rc=1
$ npx vitest run --root packages/atlas-core src/fixture.test.ts
Tests  5 passed (5)
```

All five fixture tests passed. The full TS suite lost one test — the page-**cap** count
assertion, which fired incidentally because the grid got bigger, not because a seam opened.

The reason is structural. `fixture.test.ts:38-43` (`EXPECTED_BBOXES`) compares a static
constant to a static file: **two frozen artefacts, neither of which is the engine.** Of the
five fixture tests, only *"covers, on the ground, exactly what 1:24,000 on a Letter map box
covers"* (`:117-137`) touches live code (`mapBoxInches`), which is why M1 and M11 caught it
and M6 did not. `--check` is the only thing in the repo that regenerates from the engine and
diffs — and **grep confirms it is referenced by no `package.json`, no `.github/workflows/ci.yml`
step, and no `harness/checks/` script.** It runs when a human remembers.

There is also no seam test on *generated* grids at all: `grid.test.ts` asserts ids and
neighbour links (`:85-99`) but never that adjacent pages abut. The only abutment assertions
in the repo are on the frozen fixture (`fixture.test.ts:80-113`).

### (b) A rule maintained in more than one place

Already covered: A-3 (the panel-fraction mapping, ×3), A-4 (extent padding, ×2), A-5 (scale
presets ×4, margins ×3, tile-pyramid math ×2, `TileSource.MaxZoom` ×2 —
`TileSourceConfiguration.cs:36` and `panel.ts:89`, whose own comment at `:79-82` says "the
two numbers have to agree"). None of the pairs has a check.

### (c) A capability declared and only half-wired

- **`overlap`.** Persisted (`AtlasPageGrid.Overlap`), validated on write, copied on
  duplicate, returned in `ProjectDto`, exported to JSON, read by `RenderService.cs:61`, on
  the wire at `HttpRenderWorkerClient.cs:152,179`, consumed at `render.ts:396,411`. The
  plumbing is complete and correct. It has **no UI control anywhere in `apps/web`** (grep:
  the word appears only in `api/client.ts`, `client.test.ts`, and `ProjectListPage.tsx:74`'s
  export). Every project reachable through the UI has overlap 0 for ever — i.e. pinhole
  holes where four pages meet, the first scan's item #34, still shipping.
- **Margins / gutter / orientation.** Commit 5f061f4's claim is **true end-to-end** — I
  traced every hop (`AtlasPageGrid.cs:20,26,29` → `RenderService.cs:60-64` →
  `HttpRenderWorkerClient.cs:101-107,165-166,191-192` → `render.ts:333-339` → `:365`) and
  M2/M1 confirm the renderer honours the resulting box. **But there is no UI control for any
  of them either.** The one setting the product exposes that moves the printed scale is now
  correctly plumbed and unreachable. Two knock-ons:
  `ProjectEditorPage.tsx:363` hardcodes `page: LETTER_PORTRAIT` in the page-count estimate,
  ignoring `project.margins`/`project.orientation`, which are on the type; and `:440` prints
  "Ground footprint fixed by the {label} preset **(Letter portrait)**" unconditionally.
- **Import Landmarks.** See P-2.
- **Location notes.** `Location.notes` reaches the PDF (`render.ts:461`) and the UI
  advertises the notes strip (`ProjectEditorPage.tsx:663-671`), but the web app has no notes
  input and no notes display — `handleAddLocation` (`:251-259`) passes `undefined`. Notes can
  only arrive by CSV or JSON import and can then never be seen or edited.
- **`PruneExpiredAsync`.** See P-4.

### (d) Configuration that lies

- **`RenderWorker:TimeoutSeconds`** — see C-1. The number the ADR blames is still 120 and
  is set in no config file.
- **`harness/progress.json`** — `last_known_good_commit: 37ef0af` is **8 commits behind**
  `ce5d4e3` and predates the entire async-render branch, the margins fix and the e2e change.
  The file's own `_note` says *"A stale pointer here is worse than an absent one … Update it,
  or drop it."* It was updated on 2026-09-09 and was stale again within the day, because the
  fix was to correct the value rather than to remove the second place. `features` and
  `session_history` are still `[]`.
- **`dotnet/JourneyBook.Application/Rendering/IRenderService.cs:5,14-15`** documents
  `RenderOutcome.WorkerFailed` ("→ 502") and `RenderOutcome.Success` ("→ 200"). The enum is
  `{ Accepted, ProjectNotFound, InvalidParameters }` (`RenderDtos.cs:32`), and `RenderDtos.cs:26-31`
  explicitly says there is no worker-failure outcome any more. The interface's own docs
  contradict the ADR. This is *checkable by the compiler* — `<see cref="…"/>` to a missing
  member is CS1574 — but `GenerateDocumentationFile` is off, so the build's 8 warnings contain
  no CS1574. Turning it on for the Application project would have caught it for free.
- **`forge-project.json:12`** `"frontend_test": null` — false; `apps/web` has a `test`
  script and three vitest files. `"e2e_command"` is a render-CLI invocation, so the Playwright
  spec appears in none of the project's declared commands.
- **`harness/checks/typecheck-covers-tests.sh:68`** prints *"PASS: every workspace's test
  files are inside the typecheck program"* while its own workspace list (`:24-30`) omits
  `apps/web`.

---

## 3. Correctness in the load-bearing path — true scale

### C-0. The chain, mutation by mutation

This is the answer to *"which mutations does the suite catch and which does it not."*

**Caught, and caught well.** The scale chain proper is genuinely measured now. A renderer
that paints into a box 5% narrower than the one the bbox was sized from (M2 — the exact
shape of the ~30% bug) fails four `scale-fidelity` tests plus `overlays`. A 1% error in
`metersPerInch` fails ten. A scale bar printed 10% long fails one. A crop shifted 8 px or
scaled 1.3× fails the two `crop registration` tests, which now serve self-locating tiles and
decode painted pixels back to ground — the last unmeasured link named in
`vault/maintainability-2026-09-09.md` §1 is measured. `panelBorder` and `edgeLabelColumn`
each fail nine. Swapping the page's half-width and half-height fails six. **The 2026-09-08
headline bug cannot come back through any of those doors.**

**Not caught.** Everything that decides *where the page sits* or *how sharp it is*, as
opposed to how big its ground footprint is: `overlap` (M9), page-to-page seams on generated
grids (M6), print resolution (M15), overlay placement (M12), overview framing (M13). The
suite proves each page covers the right amount of ground. It does not prove the pages
together cover the ground **without gaps**, nor that the map inside them is at the
resolution asked for.

### C-1. `RenderWorker:TimeoutSeconds` is 120 s, is set nowhere, and now misreports itself

`dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:79-85`:

```csharp
var workerTimeout = int.TryParse(configuration["RenderWorker:TimeoutSeconds"], out var wt) ? wt : 120;
services.AddHttpClient<IRenderWorkerClient, HttpRenderWorkerClient>(http => { …
    http.Timeout = TimeSpan.FromSeconds(workerTimeout); });
```

Repo-wide grep: `RenderWorker:TimeoutSeconds` / `RenderWorker__TimeoutSeconds` appears in
`apps/api/appsettings.json` — no; `infra/compose/docker-compose.yml` — no (it sets only
`RenderWorker__BaseUrl`, `:52`); `.env.example` — no. The only other hits are the ADR and the
decision log.

Meanwhile `apps/web/src/api/render-polling.ts:44-49` sets a **15-minute** client deadline,
justified as *"A 200-page atlas at the MAX_ATLAS_PAGES cap is 200 sequential basemap
fetches."* The async change raised the client's patience 7.5× and left the server-side cap at
two minutes. Any atlas needing more than 120 s of worker time is killed by the API's own
`HttpClient`, and because that throws `TaskCanceledException` — an `OperationCanceledException` —
`RenderJobRunner.cs:53-55` writes:

> `"Render was cancelled before it finished (the service shut down or the job was aborted)."`

Nothing shut down and nobody aborted. **This is the specific way the async path is worse than
ADR 0006 admits**: `0006:19` names *"the `RenderWorker:TimeoutSeconds` of 120"* as one of the
timeouts that turned a healthy render into a failed request, and `:61-63` dismisses "raise
the timeouts" as moving the number rather than the problem — but the number that still caps
every render was never moved, and the 202 does not protect it.

### C-2. Q4 §1 — `edgeLabelColumn 54 → 38`: the roadmap's numbers are wrong

`vault/development-roadmap.md:358` and `:377-378` say the change gives a **451 × 549** map
box and **+8.7%** map area. Measured, by mutating `page.ts:74` and running the real engine
and the real PDF measurement:

```
### BASELINE (54)   map box pt: 415.00 x 549.00
### MUTATED (38)    map box pt: 447.00 x 549.00
```

- **447 × 549, not 451 × 549. +7.71%, not +8.7%.**
- The arithmetic is `415 + 2 × (54 − X)`, which the table's own 27 and 18 rows obey
  (469, 487). For X = 38 it gives 447; for X = 36 it gives 451. **The table lists 451 for
  both the 38 row and the 36 row, which cannot both be true.** 451 / 415 = 1.0867, so the
  "+8.7%" is the 54 → **36** figure — the option the same table says hyphenates `CONTIN-UE`
  onto three lines. The safe option is being sold with the unsafe option's number.
- The rest checks out. `CONTINUE` in Helvetica at 7 pt is 36.55 pt, so it fits a 38 pt column
  with 1.45 pt to spare and not a 36 pt one; `AA200` is 21.0 pt. Both match the table.
- **"does drop a 40 km box 108 → 99" — correct**, confirmed against the real `buildPageGrid`
  (108 at 54, 99 at 38). The 20 km headline case is a no-op at both, as claimed.
- **"renders identically" is true only of the label.** The atlas does not: the map box grows
  32 pt, every page bbox moves, and the change breaks **9 tests** plus
  `regenerate-sample-atlas.mjs --check`. It requires re-approving the golden fixture. Calling
  it a "free follow-up" understates it — it is cheap, not free.

### C-3. Q4 §2 — `overlap` at 5%: "+17% pages" is one extent's quantisation, not a rate

Square extents around 41°N / 98°W, real `buildPageGrid`, 1:24,000, overlap 0 vs 0.05, every
size from 5 km to 60 km:

| size | 0% | 5% | delta |
|---|---|---|---|
| 7 km | 4 | 6 | **+50.0%** |
| 15 km | 20 | 20 | 0.0% |
| **20 km (the roadmap's headline case)** | **30** | **35** | **+16.7%** |
| 26 km | 48 | 48 | 0.0% |
| 40 km | 108 | 130 | +20.4% |
| 50 km | 165 | 192 | +16.4% |
| **aggregate, 5–60 km** | | | **+10.5%** |
| theory, `(1/0.95)² − 1` | | | +10.8% |

- **The +17% is right for the 20 km box and is not a general figure.** Half the sizes in the
  sweep cost exactly 0%, because both counts are `ceil()`'d; the honest headline is
  *"about +11% on average, anywhere from 0% to +50% depending on where the extent lands
  relative to a page boundary."*
- **The two levers interact and cannot be decided independently**, which the roadmap presents
  them as. With `edgeLabelColumn` at 38, the 20 km box's 5% overlap becomes **free**
  (30 → 30 instead of 30 → 35), while the 40 km box goes 99 → 120.
- Framing note for the owner: today `overlap` defaults to 0 and no UI can change it, so this
  is not "overlap costs pages" — it is "turning on a safety feature that is currently off,
  and that nothing in the suite verifies works (M9), costs pages."

---

## 4. The newest code — the async render path

### P-1. What the client actually does with a stranded row *(Q3)*

A row written, the API restarted, the row left at `Pending`:

1. `waitForRender` (`render-polling.ts:78-108`) has **no backoff**. It polls
   `GET /api/generated-pdfs/{id}` every 1000 ms for **15 minutes — 900 requests**, per
   stranded render, per open tab. The Generate button reads `Queued…` throughout
   (`GenerateButton.tsx:82`). There is no cancel; the only exit is navigating away, which
   aborts the polling and leaves the row.
2. At 15 minutes it throws
   `"Still pending after 900s. The render is still running — check this project's PDF history
   for it."` (`render-polling.ts:100-105`). **Both halves are false in this case.** The render
   is not still running — the in-process queue died with the process — and the history has
   nothing to find.
3. The history (`ProjectEditorPage.tsx:694-702`) renders `{createdAt} · {status}` and an
   **Open** link only for `Completed`. So the row shows `… · Pending` for ever, with no
   explanation and no action. `GeneratedPdf.errorMessage` is on the wire
   (`client.ts:118-124`) and is **never rendered anywhere in the app** — the field added by
   this very commit so a post-response failure would have somewhere to ride home is not
   displayed.
4. Clicking Generate again creates a *new* `GeneratedPdf` row. Nothing retries or reaps the
   old one.

### P-2. Nothing ever prunes, so "stranded for its retention window" means "stranded"

ADR 0006 accepts the strand on the grounds that *"a row left at `Rendering` is stranded for
its whole retention window"* — which reads as *eventually cleaned up*.
`GeneratedPdfService.PruneExpiredAsync` (`GeneratedPdfService.cs:98-113`) has exactly **one**
caller: the manual `POST /api/generated-pdfs/prune` (`GeneratedPdfEndpoints.cs:31-32`). Grep
across `apps/`, `dotnet/`, `infra/`, `harness/`, `scripts/` finds no hosted service, no
scheduled job, no compose entry and no UI call. Retention is a number in
`appsettings.json:19` that nothing acts on. **This is worse than the ADR admits.**

### P-3. Two holes in the shutdown story the code says it has closed

- `RenderJobProcessor.cs:40-42` comments: *"RunAsync marks the record Failed on any throw, so
  a job that blows up must not also take the loop down."* But `RenderJobRunner.cs:35-36`
  writes `Rendering` **before** the `try` at `:38`. A throw from that first
  `UpdateStatusAsync` — row deleted between accept and dequeue, a DB blip — escapes `RunAsync`
  uncaught, is swallowed by the processor's belt, and leaves the row at **`Pending` for ever**.
  The comment is wrong about the exact case it was written for.
- On shutdown, `RenderJobRunner` marks `Failed` only for the **one job in flight**. Every job
  still sitting in the channel is discarded silently: `DequeueAllAsync(stoppingToken)`
  (`RenderJobProcessor.cs:35`) throws `OperationCanceledException`, caught and ignored at
  `:55-58`. ADR 0006 says "a cancelled or shut-down render is marked `Failed`"; that is true
  of at most one row per shutdown.

### P-4. The over-page-limit guard in the editor is dead code — killed by the first scan's own fix

`apps/web/src/routes/ProjectEditorPage.tsx:359-372`:

```ts
const countPages = (bbox) => { … try { return buildPageGrid({…}).pages.length; } catch { return null; } };
const pendingOverLimit = pendingPageCount !== null && pendingPageCount > MAX_ATLAS_PAGES;
```

`packages/atlas-core/src/grid.ts:136-141` throws when `rows * columns > MAX_ATLAS_PAGES`, and
`pages.length === rows * columns`. So `pages.length > MAX_ATLAS_PAGES` **implies the call
threw**, `countPages` returns `null`, and both `pendingOverLimit` and `savedOverLimit` are
provably always `false`. Unreachable as a consequence:

- `:507-514` — an over-limit box shows **no page estimate at all**, not even a wrong one.
- `:519-524` — Confirm is never disabled and never says `"Too Large"`.
- `:672` — Generate is never disabled.
- `:678-682` — the `⚠ … over the 200-page limit` banner can never render.

The user draws a 3° box, gets no warning, confirms, clicks Generate, waits through
`Queued…` / `Rendering…`, and receives the raw string
`Render worker returned 400: {"error":"Invalid request: this extent produces 5256 pages …"}`.

The early cap was commit `520fb24` — the first scan's fix for its own finding #3, which is
correct and worth keeping. Nothing recorded that it made this guard unreachable, and
`docs/decisions.md:110` still records the guard as *"Verified live (Playwright: an 825-page
box drew the dashed box, disabled Confirm + Generate)."* The Playwright spec no longer
contains any page-limit assertion (grep for `825` / `Too Large` / `MAX_ATLAS` in
`apps/web/tests/e2e/create-render.spec.ts`: nothing), and the spec runs nowhere automatically
anyway — already recorded at `docs/decisions.md:531-533`, still true after the change made to
prove polling.

### P-5. The e2e spec proves less than it looks like it proves

Not a re-report of "it runs nowhere" (recorded). On its content:

- The polling assertion is real but narrow-windowed: `MOCK_STATUS_SEQUENCE` advances one step
  per poll and `waitForRender`'s interval is 1000 ms, so `"Rendering…"` is on screen for about
  one second against Playwright's ~100 ms retry cadence. Asserting `page.waitForRequest` count
  on `/api/generated-pdfs/job-001` (≥ 2) would prove the same thing without the race.
- `MOCK_PROJECT` has **no `margins` field**, so the spec never exercises the field commit
  5f061f4 was about — `toMargins` (`client.ts:153-161`) quietly supplies defaults.
- `MOCK_LOCATION` omits `scalePresetId`, `pinShape`, `pinColor`, `zoomLevels`, all four always
  present on the real `LocationResponse`.
- It selects controls by ordinal (`page.locator("select").nth(0)`/`.nth(1)`), a direct
  consequence of P-8 — there is no accessible name to select by.
- It is outside the static gate too: `apps/web/tsconfig.app.json:18` is `include: ["src"]`, so
  `pnpm -r typecheck` never sees the spec and API-shape drift will not even produce a type
  error.

---

## 5. Product and polish

### P-6. "Import Landmarks" cannot succeed from the web app

`apps/web/src/api/client.ts:334-335` posts with `body === undefined`, and `request()`
(`:190-194`) then sends **no body and no `Content-Type`**. `apps/api/Endpoints/LandmarkEndpoints.cs:11`
binds a **non-nullable** complex parameter, `ImportLandmarksRequest` — a required JSON body.
A minimal-API body parameter with no JSON content type answers 415; with an empty body, 400.
Either way `LandmarkImportControl.tsx:37-39` renders the raw wire string. (I could not execute
this — no Docker/PostGIS locally — but the contrast is deliberate elsewhere:
`RenderEndpoints.cs:11` declares `RenderProjectRequest? request` and defaults it with
`request ?? new RenderProjectRequest()`.)

The client's comment is also wrong about the contract: it says the server fetches "for the
project extent", but `LandmarkService.ImportAsync` reads `request.Bbox`
(`LandmarkService.cs:27`) and never looks at the project's extent, and nothing in the web app
sends one. The Api integration tests pass because they post
`new ImportLandmarksRequest(Extent)` (`LandmarksApiTests.cs:124,148,167,185`) — a body the web
app never sends. Knock-on: **"Include Landmarks"** (`ProjectEditorPage.tsx:613-628`, default
on) is a no-op for every project reachable through the UI, because no such project can have
landmarks; `RenderService.cs:117` even overrides the flag with `landmarks.Count > 0`.

### P-7. Six brand colour tokens used 48 times do not exist

`apps/web/src/index.css:14-50` defines bark 700/600/400, parchment 300/200, cream 100/50,
campfire 600/500, trail 500, moss 600/500/300, forest 900–500.

| token | uses in `apps/web/src/**.tsx` | defined |
|---|---|---|
| `bark-500` | 22 | no |
| `bark-300` | 16 | no |
| `bark-200` | 3 | no |
| `campfire-700` | 4 | no |
| `parchment-100` | 2 | no |
| `campfire-50` | 1 | no |

Proven against the compiled stylesheet (`apps/web/dist/assets/index-CyyLnhP8.css`, current —
it contains "Queued", "Rendering…", "Zoom ladder"): `.text-bark-400` present,
`.text-bark-500` **absent**; `.text-campfire-600` present, `.text-campfire-700` **absent**;
`.bg-parchment-200` present, `.bg-parchment-100` **absent**; `.border-bark-300` and
`.divide-bark-200` **absent**. Tailwind v4 generates a utility only for a defined `@theme`
token, so 48 class names produce no rule at all. `packages/ui/src/tokens.ts:20-36` agrees with
`index.css`, so this is not a drift between two sources — both lack the shades the UI asks
for. Visible effects: every `border border-bark-300` panel (location list, render history,
sidebar boxes) falls back to the preflight border colour instead of a light hairline; and
`text-campfire-700`, the over-limit alarm colour at `ProjectEditorPage.tsx:508,679`, renders
as ordinary body text — on a warning that is unreachable anyway (P-4).

### P-8. Accessibility

- **No `aria-live` anywhere** (grep: zero). Every async status change is silent to assistive
  tech: `Queued… / Rendering…` (`GenerateButton.tsx:82`), the failure message (`:107-109`),
  `Saving…` and the header error (`ProjectEditorPage.tsx:402-403`), the draw-mode banner
  (`:409-413`), "Imported N locations" (`LocationList.tsx:140`). The only `role="status"` is in
  `HealthChip.tsx:43`, which is never rendered.
- **Both file imports are unreachable by keyboard.** `ProjectListPage.tsx:135-138` and
  `LocationList.tsx:119-128` put `<input type="file" className="hidden">` inside a `<label>`.
  `hidden` is `display:none`, so the input is not focusable, and a `<label>` is never in the
  tab order. No button, no `tabIndex`, no key handler. Project import and CSV import cannot be
  reached at all without a mouse.
- **One `htmlFor` in the whole app** (`ProjectEditorPage.tsx:460`, correctly done).
  `ScalePicker.tsx:12-20`, `TierPicker.tsx:27-35` and `ProjectListPage.tsx:158-168` put the
  `<label>` as a *sibling* with no `htmlFor`/`id`/`aria-label`; `LocationList.tsx:225-246` and
  `GeocodeSearch.tsx:52-58` carry only `placeholder`. (`LocationList.tsx:155-171,248-262` and
  the Generate checkboxes wrap their control correctly — the pattern exists in the file.)
- **`focus:outline-none focus:ring-*`** at `ScalePicker.tsx:19`, `TierPicker.tsx:34`,
  `ProjectListPage.tsx:167`, `ProjectEditorPage.tsx:469`, `GeocodeSearch.tsx:57`,
  `LocationList.tsx:161,230,238,245,253`. Rings are `box-shadow`, which forced-colors mode does
  not paint, so the focus indicator vanishes entirely there. Also `focus:` rather than
  `focus-visible:`.
- **No headings in the live app.** `<h1>/<h2>/<h3>` appear nowhere outside the dead
  `Hero.tsx`; `ProjectListPage.tsx:133` and `ProjectEditorPage.tsx:394` are styled `<span>`s.
  `ProjectEditorPage` has no `<main>`.
- **No `onKeyDown` handler anywhere**, so draw mode has no Escape: `ProjectEditorPage.tsx:374-381`
  puts the app in a state where every map click is consumed and the only exits are completing
  the gesture or re-clicking the toggle.
- `PinEditor.tsx:19-44` signals selection by border/ring only, with no `aria-pressed` — while
  `LocationList.tsx:182-196` gets exactly that right for the zoom-ladder toggles.

### P-9. Error paths

- **Every error the user sees is a raw wire string.** `client.ts:202-205` throws
  ``` `${method} ${BASE}${path} → ${res.status}: ${text}` ```, so a validation failure renders
  as `POST /api/projects → 400: {"error":"Name is required."}`. The API goes to real trouble
  to produce a clean `{ error }` envelope (`ExceptionMapping.cs:44-67`) and the client discards
  it.
- `ProjectEditorPage.tsx:61-67` — `refreshPdfHistory` has a bare `catch {}`; the **Refresh**
  button does nothing visible on failure and has no spinner either way.
- The render history never auto-refreshes: `GenerateButton` has no completion callback, so a
  PDF you just generated does not appear until you click Refresh.
- `handleRename`, the map-click branch, `updateLocation` and `handleDeleteLocation`
  (`:69-78,219-249,267-288,322-330`) set errors but never clear the previous one, and there is
  no dismiss; a stale error sticks in the header indefinitely.
- **JSON import is a silent serial storm.** `ProjectListPage.tsx:96-126` creates the project
  then loops `await api.locations.create(...)` (plus a second PUT per pinned location) with no
  importing state, no progress and no disabled control. On a mid-loop failure `setProjects`
  (`:122`) is never reached, so the user sees "Failed to import" and no new atlas — while a
  partially-populated project exists on the server and appears on reload.
- **`MapPreview` tile error latches.** `MapPreview.tsx:47,96-98` sets `tileError` on any
  maplibre `error` event and never resets it; one transient failure leaves *"Some map tiles
  failed to load (the area may be outside USGS coverage)"* on screen for the component's life,
  attributing to USGS coverage what may have been a sprite or glyph error.
- **"PDF opened in a new tab" is often false.** `GenerateButton.tsx:57-60` calls `window.open`
  *after* an await, so it is not a user-gesture popup and will normally be blocked; the code
  comment acknowledges this and the copy at `:98-99` asserts it happened.
- No router: `App.tsx:9-23` keeps the route in `useState`, so an open project has no URL, a
  refresh returns you to the list, and Back leaves the app. `window.confirm`/`window.prompt`
  are the delete and rename UI.

### P-10. Export/import is lossy for three fields that now change the printed output

`ProjectListPage.tsx:69-83` exports `name, scalePresetId, orientation, overlap, extent` —
**margins are not exported at all**. `:106-108` imports only `name`, `scalePresetId`,
`extent`, so `orientation` and `overlap` are written to the file and dropped on the way back
in. Since 5f061f4, all three change the printed atlas.

### P-11. `Category` / `SourceConfidence` are round-trip-lossy through the web PUT — latent

`client.ts:295,301` sends `category: body.category ?? "Other"` and
`sourceConfidence: body.sourceConfidence ?? "Unknown"`; `updateLocation`
(`ProjectEditorPage.tsx:267-288`) never passes either, and the web `Location` interface
(`client.ts:43-67`) has no field for them, so it *cannot*. `LocationService.UpdateAsync`
(`LocationService.cs:142,145`) writes them unconditionally.
`ProjectEditorPage.tsx:261-266` even carries a comment warning that PUT replaces the whole
record and *"omitting a field here silently clears it"*.

**Downgraded to latent**: nothing reachable in the UI or in the CSV import (header
`name,lng,lat,notes,scale`) sets a non-default category today, so the loss is currently
invisible. It becomes a live data-loss bug the moment anything does.

### P-12. Documentation a new contributor would follow into a wall

- `README.md:89-97` and `CLAUDE.md` describe a two-process local stack (`pnpm dev:web` +
  `dotnet run --project apps/api`), but `DependencyInjection.cs:78` defaults
  `RenderWorker:BaseUrl` to `http://render-worker:8090`, a Compose-network hostname. Outside
  Docker, DNS fails, the record goes `Failed`, and the user gets a raw `HttpRequestException`.
  Neither `appsettings.json` nor `.env.example` mentions `RenderWorker__BaseUrl`.
- `README.md:47-69` (Layout) omits `services/` entirely — the render worker, without which the
  headline feature does not run, is absent from the map of the repo.
- `components/Hero.tsx` (238 lines) is still never imported by anything. It is the only file
  with an `<h1>`, the only one with real `focus-visible:` styles, and the only consumer of
  `HealthChip.tsx` and `MapFurniture.tsx`. `components/ui/{button,dialog,select}.tsx` and
  `lib/utils.ts` are shadcn scaffolding imported by nothing, while `components.json` and the
  `@radix-ui/*` dependencies advertise a setup the app does not use.
- `DuplicateAsync` (`ProjectService.cs:83-124`) does not `.Include(p => p.Landmarks)` and does
  not copy them; Duplicate silently drops imported landmarks with no notice.

---

## Withdrawn and cleared

Worth as much as the findings, per the brief.

- **The linear-vs-Mercator overlay mapping is not a live misregistration.** I measured it:
  0.044 pt on a 1:24,000 page, 0.18 pt at 1:100,000, against a 5.4 pt glyph. It matters only
  on a continental overview (3.2 pt at 41°N, 6.6 pt at 61°N). The duplication is the finding;
  the misplacement is not.
- **`mapBoxOf`'s hardcoded `borderPt = 1` is guarded.** M10 fails `pdf-measure.test.ts`. It
  reads like an unguarded copy and is a redundant one — a documentation problem, not a bug.
- **`atlas-core` does not import `pdf-client`**, in source or in tests
  (`grep 'from "@journeybook' packages/atlas-core/src/` → nothing), and
  `validation.ts:44-50` documents why. The extraction is real.
- **The panel crop is now genuinely measured.** `panel.test.ts:379-457` serves self-locating
  tiles and decodes painted pixels back to ground. M3, M4 and M17 all fail it. The last
  unmeasured link in the true-scale chain named by the previous scan is closed.
- **Margins / gutter / orientation really do reach the renderer.** Traced every hop and
  confirmed by mutation. Commit 5f061f4's claim holds. (What is missing is a UI for them.)
- **`overlap` is not dropped on the wire** — it is carried correctly. What is missing is any
  test that would notice if it stopped being.
- **`apps/web/src` does not duplicate atlas-core geometry.** `ProjectEditorPage.tsx:359-368`
  calls `buildPageGrid`, `:201` calls `enclosingBBox`, `ScalePicker.tsx:21` renders
  `SCALE_PRESETS`. `MapPreview.tsx:113-155` computes midpoints for `fitBounds` only, never fed
  into the contract, and `:191` disclaims true scale.
- **No trigonometry, earth radii, degrees-per-metre, page counting, aspect-ratio math or
  MGRS/USNG in C#.** The previous scan's narrower claim still holds; NTS use is storage.
- **`MapPreview.tsx:165`'s `innerHTML` is not an injection.** `packages/ui/src/pins.ts:84-91`
  whitelists the shape id and regex-validates the colour as `^#[0-9a-fA-F]{6}$`; the label is
  server-generated `L{n}`.
- **`cli.test.ts:75-77`, `assemble.test.ts:108`, `attribution.test.ts:62-69`,
  `HttpRenderWorkerClientTests.cs:74-76,114,191`** all assert absence for a good reason (a flag
  not passed, a legacy field that would 400 the worker, a credit that must not be claimed).
  None of them defends a bug. I looked at every `toBeUndefined` / `toBeNull` / `not.toContain`
  / `Assert.False(...TryGetProperty)` in the repo; the two that pinned the margins drop were
  the only ones of their kind, and they are fixed.
- **`pnpm build`, `typecheck`, `dev:web`, `build:web`, `clean`** all exist and work as named;
  `pnpm -r test` reaches all six test-bearing workspaces;
  `dotnet test --filter "FullyQualifiedName!~Api"` matches the `dotnet-unit` CI job exactly, as
  `CLAUDE.md` says.

---

## Ranked — `(Impact × 4) − (Blast × 3) − Effort`

| id | score | finding | file:line |
|---|---|---|---|
| F1 | **14** | `RenderWorker:TimeoutSeconds` is 120 s, set nowhere, and reports its own timeout as a cancellation | `DependencyInjection.cs:79` · `render-polling.ts:49` · `RenderJobRunner.cs:53-55` |
| F2 | **10** | The golden fixture's only engine binding is `--check`, and nothing runs it; a 2% page-seam gap is invisible to all 239 tests | `fixture.test.ts:24-33` · `scripts/regenerate-sample-atlas.mjs` · `.github/workflows/ci.yml:60-79` |
| F3 | **9** | `overlap` is unguarded in both languages — and it is the parameter about to be decided | `grid.ts:126` · `grid.test.ts:111` · `HttpRenderWorkerClient.cs:152,179` |
| F4 | **9** | The over-page-limit guard is provably unreachable — the early cap killed it | `ProjectEditorPage.tsx:359-372` vs `grid.ts:136-141` |
| F5 | **9** | "Import Landmarks" sends no body to an endpoint that requires one | `client.ts:334` vs `LandmarkEndpoints.cs:11` |
| F6 | **9** | `zoomForBBox` — print resolution — has only a monotonicity test | `tilemath.ts:40-49` · `tilemath.test.ts:32-35` |
| F7 | **9** | Roadmap: `edgeLabelColumn 54 → 38` is 447 × 549 / +7.71%, not 451 × 549 / +8.7% | `development-roadmap.md:358,377-378` |
| F8 | **9** | Roadmap: "5% overlap costs +17% pages" is one extent's `ceil()`; the rate is ~+11%, range 0–50% | `development-roadmap.md:379` |
| F9 | **8** | Export/import drops margins, orientation and overlap — all three now change the print | `ProjectListPage.tsx:69-83,106-108` |
| F10 | **6** | A stranded `Pending` row is permanent: prune has no automatic caller | `GeneratedPdfService.cs:98` · `GeneratedPdfEndpoints.cs:31` |
| F11 | **6** | Six brand colour tokens, used 48 times, generate no CSS | `index.css:14-50` vs `apps/web/src/**` |
| F12 | **6** | Two shutdown holes: `Rendering` is written outside the try; queued jobs are dropped silently | `RenderJobRunner.cs:35-36` · `RenderJobProcessor.cs:35,40-42,55` |
| F13 | **6** | File imports unreachable by keyboard; no `aria-live`; one `htmlFor` in the app | `ProjectListPage.tsx:135-138` · `LocationList.tsx:119-128` |
| F14 | **5** | `IRenderService` documents two enum members that no longer exist; `GenerateDocumentationFile` is off so CS1574 never fires | `IRenderService.cs:5,14-15` vs `RenderDtos.cs:32` |
| F15 | **5** | `harness/progress.json` stale again, 8 commits behind, one day after being fixed | `harness/progress.json:3` |
| F16 | **5** | `Category`/`SourceConfidence` cleared by every web location edit — latent, nothing sets them today | `client.ts:295,301` · `ProjectEditorPage.tsx:267-288` |
| F17 | **4** | `overview.ts` re-implements extent padding with different constants and no ±180/±90 clamp | `overview.ts:29-32` vs `extent.ts:23-40` |
| F18 | **4** | Margins/gutter/orientation/overlap are correctly plumbed and have no UI control | `apps/web/src` (grep) |
| F19 | **3** | Every API error reaches the user as `METHOD /path → 404: {json}` | `client.ts:202-205` |
| F20 | **−2** | The lng/lat→panel-fraction mapping exists three times, two linear-in-degrees (immaterial on a page; 3–7 pt on an overview) | `tilemath.ts:58-73` · `landmarks.ts:91-102` · `render.ts:584-610` |

## Recommended first move

**One CI line and one config line buy most of the value.** Add
`node scripts/regenerate-sample-atlas.mjs --check` to the `ts` job (F2) — it already works,
it already catches the class of change nothing else does, and it is the only thing binding
the golden fixture to the engine. Set `RenderWorker:TimeoutSeconds` to something that
matches the client's 15 minutes (F1), because today the async render cannot outlive two.

Then the two that cost a test each: assert the actual overlap fraction in `grid.test.ts` and
assert `overlap` on the wire in `HttpRenderWorkerClientTests` (F3), and give `countPages` a
non-throwing path so the page-limit guard comes back to life (F4).

And before the page-count furniture decisions go to the owner, fix the two numbers: the safe
`edgeLabelColumn` is **447 × 549 / +7.71%**, and overlap costs **~+11% on average, 0–50%
depending on the extent** — with the two levers interacting, not independent.

---
---

# Sixth pass — do the fixes hold? (2026-09-10, `662b402`)

Everything above describes `ce5d4e3`. This section re-runs the same probes against the
merged fix branch. **Tree clean at `662b402` before and after; nothing committed.**

Baseline at HEAD: **272 TS** (atlas-core 80 · web 42 · pdf-client 38 · map-sources 55 ·
render-cli 51 · render-worker 6) and **111 .NET** non-Docker, all green;
`node scripts/regenerate-sample-atlas.mjs --check` clean.

## Method correction to the pass above, before anything else

The original run used `pnpm -r test`, which **bails after the first failing workspace**.
Where a mutation broke `atlas-core`, the downstream packages never ran, so several
"failing tests" counts in the table above are **undercounts of the repo-wide total**, not
measurements of it. Proof, from the two logs for the same mutation:

```
ce5d4e3, pnpm -r test        : packages/atlas-core  Tests  9 failed | 66 passed (75)   <- and nothing else ran
662b402, pnpm -r --no-bail   : packages/atlas-core  Tests 11 failed | 69 passed (80)
                               apps/web             Tests  1 failed | 41 passed (42)
                               packages/render-cli  Tests  1 failed | 50 passed (51)
```

Every number in this section is from `pnpm -r --no-bail test`. The red/green verdicts
above are unaffected — a bail only ever truncates a count, it cannot turn red into green.

Each probe also now (a) patches by anchor text and echoes the before/after line, (b)
proves the mutation reached its subject by requiring the built `dist` to change, and (c)
reports **COULD-NOT-RUN** rather than a result if either fails. All 20 anchors still
resolved at HEAD; none was reported COULD-NOT-RUN.

## 1. Every recorded mutation, re-run

| # | mutation | `ce5d4e3` | `662b402` | verdict |
|---|---|---|---|---|
| M1 | `edgeLabelColumn 54 → 38` | 9 (truncated) | **RED — 13** | holds |
| M2 | renderer map box 5% narrower | 5 (truncated) | **RED — 8** | holds |
| M3 | crop origin `left + 8 px` | 2 | **RED — 2** | holds |
| M4 | crop width × 1.3 | 2 | **RED — 2** | holds |
| M5 | page grid gains one column | 3 | **RED — 7** | holds |
| **M6** | **grid step × 1.02 (2% gap at every seam)** | **1, incidental** | **RED — 6** | **FIXED** |
| M6b | same, `buildPageGrid` only (count/layout drift) | n/a | **RED — 4** | new duplication is guarded |
| M7 | scale bar printed 10% long | 1 | **RED — 2** | holds |
| M8 | `metersPerInch` +1% | 10 (truncated) | **RED — 16** | holds |
| **M9** | **`overlap` honoured at half value** | **GREEN** | **RED — 2** | **FIXED** |
| M9b | same, `buildPageGrid` only | n/a | **RED — 1** | guarded |
| M10 | `mapBoxOf` border 1 → 3 | 1 | **RED — 2** | holds |
| M11 | `panelBorder 1 → 2` | 9 (truncated) | **RED — 22** | holds |
| M12 | landmark y shifted 3% | GREEN | **GREEN** | *not fixed — F20, scored −2, out of scope* |
| M13 | overview padding 0.08 → 0.20 | GREEN | **GREEN** | *not fixed — F17, scored 4, out of scope* |
| **M15** | **`zoomForBBox` one zoom coarser** | **GREEN** | **RED — 2** | **FIXED** |
| M16 | `pageBBoxAround` half-dims swapped | 6 | **RED — 11** | holds |
| M17 | crop origin `top + 3 px` | 1 | **RED — 1** | holds |
| **C#-1** | **`Overlap` hardcoded to 0 on the worker wire** | **GREEN (95/95)** | see §3 | **FIXED** |

**All twelve fixes hold. Sixteen of eighteen mutations now go red; the two that stay
green (M12, M13) correspond to findings that were deliberately not fixed** (F20 scored
−2, F17 scored 4 — neither was among the twelve). No fix failed to hold, and no
could-not-run.

The three that changed from green to red are the three that mattered:

- **M6** is now caught by `grid.test.ts > [BEHAVIORAL] leaves no ground uncovered between
  adjacent pages at overlap 0` — a real seam test on *generated* pages, with a vacuity
  guard (`expect(eastSeams).toBeGreaterThan(0)`) so an all-`undefined` neighbour map
  cannot satisfy it by checking nothing. F2 is additionally closed twice over: the fixture
  now has an in-process `[BEHAVIORAL] is exactly what the engine produces today` test, and
  `check:fixture` is a `package.json` script run by CI (`ci.yml:82`).
- **M9** is caught by `[BEHAVIORAL] carries the exact overlap fraction as shared ground,
  not just 'more pages'` — four overlap values, both axes, vacuity-guarded. (But see §2.)
- **M15** is caught by two new `tilemath.test.ts` tests, including the missing half of the
  definition: *one level coarser must NOT have met the target*.

## 2. What the new guards do not cover

### N-1. The new overlap guard cannot tell shared ground from missing ground — score 13

**The highest-value result of this pass.** `grid.test.ts`'s overlap guard measures

```ts
const shared = geodesicDistanceMeters({ lng: eastNeighbor.bbox[0], lat: midLat }, { lng: east, lat: midLat });
expect(Math.abs(shared - wantEast)).toBeLessThan(TOLERANCE_M);
```

`geodesicDistanceMeters` is a **chord length — always ≥ 0**. (The sibling seam test's
comment even claims "Signed: positive = this page's east edge sits west of its
neighbour's west edge"; it is not signed and cannot be.) So a 176 m *overlap* and a 176 m
*gap* are the same number, and `|176 − 176| = 0` either way.

Proven by mutation. Invert the sign of the overlap term — `(1 - overlap)` → `(1 + overlap)`
in both `stepX` sites, so every strip that was promised as shared ground becomes an
equal-sized strip belonging to **no page at all**, which is the exact defect `overlap`
exists to prevent:

```
G1x-overlap-sign-x   packages/atlas-core/src/grid.ts
  LINE 142 BEFORE: const stepX = fp.widthMeters * (1 - overlap);
  LINE 142 AFTER : const stepX = fp.widthMeters * (1 + overlap);
  LINE 182 BEFORE: const stepX = fp.widthMeters * (1 - overlap);
  LINE 182 AFTER : const stepX = fp.widthMeters * (1 + overlap);
  subject changed: packages/atlas-core/dist md5 522d5828 -> 529ba73f

  packages/atlas-core   Tests  80 passed (80)     <-- BOTH new guards ran and passed
  apps/web              Tests   1 failed | 41 passed (42)
```

`stepY` behaves identically. **`atlas-core` is 80/80 green with every page seam inverted.**
Both new guards miss it:

- *"carries the exact overlap fraction as shared ground"* — blind by construction, as above.
- *"leaves no ground uncovered between adjacent pages at overlap 0"* — runs only at
  overlap 0, where `1 − 0 == 1 + 0`, so the mutation is invisible to it.
- the golden fixture and `check:fixture` — the fixture is overlap 0.

The suite goes red only by accident, in a different package: one page-**count** assertion
(`apps/web/src/lib/page-estimate.test.ts > [BEHAVIORAL] a box can cross the limit purely
by gaining overlap`) notices that fewer columns now fit. Nothing observes the seam.

Fix: compare a **signed** separation and assert the sign as well as the magnitude — e.g.
`eastNeighbor.bbox[0] - east` must be negative (an overlap) by the expected amount, never
positive (a gap). One line in each of the two tests.

### N-2. The client-patience constant is now duplicated across languages — score 8

`DependencyInjectionTests.cs:18` is a genuinely good guard: it asserts a *relationship*
(`http.Timeout >= ClientPatience`) rather than a magic number, and proves it is looking at
the right client via `BaseAddress`. But `ClientPatience` is

```csharp
private static readonly TimeSpan ClientPatience = TimeSpan.FromMinutes(15);
```

a hand-copied mirror of `DEFAULT_TIMEOUT_MS = 15 * 60 * 1000` in
`apps/web/src/api/render-polling.ts:56`. The 15-minute figure now lives in **four** places
— that constant, this C# mirror, a comment at `DependencyInjection.cs:91`, and a comment at
`docker-compose.yml:53-55` — and **nothing compares them**. Raise the client's patience to
30 minutes and the assertion `900s >= 900s` still passes while the server cap is short
again. That is the original bug's exact shape, re-created inside its own fix.

### N-3. The retention sweep's docstring claims a capability it does not have — score 10

`GeneratedPdfRetentionService` closes F10 properly for the graceful case, and its comment
says: *"One sweep at startup (which is when a restart's wreckage is on the floor)."*

The sweep it runs at startup is `PruneExpiredAsync`, which is
`Where(g => g.ExpiresAt != null && g.ExpiresAt < now)` — rows past their 30-day retention.
A row stranded ten seconds ago by a crash is not expired and is not touched. Verified: a
repo-wide grep for startup reconciliation of `Pending`/`Rendering` rows returns **nothing**.

So the strand is fixed only on the path that runs `FailQueuedJobsAsync` — an orderly
`SIGTERM`. After a `SIGKILL`, an OOM kill, a container crash or power loss, every
`Pending`/`Rendering` row is stuck exactly as before, for **30 days**, and the client still
polls it 900 times and then says "The render is still running". The one-line capability
that is missing: on startup, any `Pending`/`Rendering` row cannot be in flight, because the
queue is in-process — mark it `Failed`.

### N-4. `FailQueuedJobsAsync` runs one DB round-trip per job inside an unbounded budget — score 5

It executes during `StopAsync`, after `ExecuteAsync` returns, opening a fresh scope and
awaiting `UpdateStatusAsync` **sequentially, once per stranded job**. `HostOptions.ShutdownTimeout`
is configured nowhere in the repo (grep: the only hit is the comment at
`RenderJobProcessor.cs:110` that names it), so the budget is the ASP.NET Core default of
**5 seconds** — shared with the in-flight render's own `Failed` write. Overrun and the host
kills the process with the remaining rows at `Pending`, which is the state this code exists
to prevent, reached silently. The code names the risk and does not bound it: no cap on the
number of rows, no batching, no `CancellationTokenSource` on the loop.

### N-5. The new DPI guard pins the one preset that passes — score 9

See §3.2. `tilemath.test.ts`'s new DPI assertion covers **1:24,000 only**, the single scale
preset that clears 300 DPI. Nothing pins the other four, and nothing asserts a minimum DPI
anywhere. It also hardcodes `const MAP_BOX_WIDTH_IN = 5.763888888888889; // mapBoxInches(LETTER_PORTRAIT)`
in a file that already imports from `@journeybook/atlas-core` on line 2 — a fresh copy of a
constant the imported package computes.

### N-6. Scope notes, not findings

- `panel.test.ts`'s *"moves the crop when the bbox moves"* shifts the bbox **east only**
  (`bbox[0] + width/3`, latitudes untouched) and samples along a fixed `y = 10`, so it
  cannot see a north–south registration error. That is why M17 (`top + 3`) fires one test
  and M3 (`left + 8`) fires two. The invariant is still guarded by the sibling, so this is
  redundancy missing on one axis, not an unguarded invariant.
- `harness/checks/golden-fixture.sh` is not itself in CI; CI runs `pnpm check:fixture`,
  which is the same command. No gap.

## 3. The four corrections, checked rather than taken

### 3.1 `ReadAllAsync` and queued jobs — **correction upheld; my original claim withdrawn**

Probed independently with a standalone console app against the real BCL (in scratchpad,
not the repo), asserting the items were genuinely buffered before cancellation:

```
[cancel BEFORE loop] delivered: 0/5 -> []          ended by OperationCanceledException, >=1 left buffered
[cancel MID-drain  ] delivered: 5/5 -> [1,2,3,4,5] delivered WHILE cancelled: 5
```

Both descriptions are right about *different* cases, and the fix agent's is the one that
matters. Cancel before the loop's first `WaitToReadAsync` and nothing is delivered — my
"discarded in silence". Cancel **mid-drain**, which is what a real `SIGTERM` does while job 1
is rendering, and `ReadAllAsync`'s inner `while (TryRead(out item))` yields **all five**
buffered jobs to a loop whose token is already cancelled. Under the old code each then hit
`UpdateStatusAsync(..., cancelledToken)` at `RenderJobRunner.cs:35` — outside the `try` — so
every one threw, was swallowed by the processor's belt, and left its row at `Pending`. Same
outcome for the user, worse mechanism, and my description of it was wrong. `RenderJobProcessor.cs:34-38`
now documents this exactly and guards it with `if (stoppingToken.IsCancellationRequested) break;`.

### 3.2 The DPI figures — **mechanism upheld, my number wrong, and the conclusion drawn from it wrong too**

Computed against the real engine and the real tilemath (`mapBoxInches`, `buildLocationPage`,
`zoomForBBox`, `lngLatToGlobalPixel`), not replicated:

| preset | zoom | delivered px | vs 1000 px target | DPI |
|---|---|---|---|---|
| `usgs-7-5-min` (1:24,000) | z16 | 1947 | **1.95×** | **338** |
| `1-25000` | z15 | 1014 | 1.01× | **176** |
| `usgs-15-min` (1:62,500) | z14 | 1268 | 1.27× | **220** |
| `1-50000` | z14 | 1014 | 1.01× | **176** |
| `1-100000` | z13 | 1015 | 1.01× | **176** |

- **Upheld:** nothing resamples, so `targetWidthPx` is a floor, not the delivered width;
  the delivered panel is 1×–2× the target. My "~173 DPI" treated the target as delivered.
  Wrong, and it came from the (also wrong) comment then in `panel.ts`.
- **Upheld:** 1:24,000 is ~338 DPI at z16. Exact figure 1947 px / 5.7639 in = 337.8.
- **NOT upheld: "the 300 DPI target is therefore already met."** It is met at 1:24,000 and
  at **no other preset**. Four of the five print at 176–220 DPI. 1:24,000 passes only
  because its page happens to land 1.95× past a zoom boundary; 1:25,000 — a 4% change in
  scale — drops to 176 DPI, a 1.92× cliff.

The real finding is worse and more useful than either version: **print resolution is not a
property of this product, it is an artefact of where each scale's page falls relative to a
Web-Mercator zoom boundary, and it swings by 2× across the scale menu.** The default
`panelWidthPx` of 1000 over a 5.7639 in map box is a request for **173 DPI**; nothing
anywhere asks for 300.

And the remedy is the opposite of what is scheduled. 300 DPI needs `ceil(300 × 5.7639)` =
**1730 px**. At that target:

| preset | zoom | px | DPI |
|---|---|---|---|
| `usgs-7-5-min` | z16 | 1947 | 338 ✓ |
| `1-25000` | z16 | 2028 | 352 ✓ |
| `usgs-15-min` | z15 | 2536 | 440 ✓ |
| `1-50000` | z15 | 2029 | 352 ✓ |
| `1-100000` | z14 | 2030 | 352 ✓ |

**Every preset clears 300 DPI, all within USGS Topo's z16 ceiling.** So
`vault/development-roadmap.md:268-270` — *"1000 px over 5.76 in is ~173 DPI, and the 300 DPI
target at this scale needs z17, which this source does not have… Reaching it needs a deeper
basemap, not a bigger number — worth scheduling against Stage 7"* — is wrong in its number,
wrong in its diagnosis, and backwards in its remedy. It needs a bigger number and no deeper
basemap. **`git diff ce5d4e3..662b402 -- vault/development-roadmap.md` shows no DPI line was
touched**: the fix corrected `panel.ts`'s comment and left the roadmap's copy of the same
wrong number in place, still driving a Stage 7 scheduling decision. `effectiveDpi`
(`validation.ts:189`) is the exported, tested, uncalled function that would express this.

### 3.3 Overlap aggregate +10.3% vs +10.5% — **neither is "the" number**

Both are defensible; the figure is an artefact of the sample set, which is the point my
finding was making:

```
5..50 km step 1   sizes=46  aggregate=+10.5%  zero-cost=17/46  worst=+50%
5..60 km step 1   sizes=49  aggregate=+10.0%  zero-cost=18/49  worst=+50%
5..50 km step 5   sizes=10  aggregate=+14.6%  zero-cost=3/10   worst=+33%
10..40 km step 1  sizes=31  aggregate=+11.3%  zero-cost=12/31  worst=+33%
theory (1/0.95)^2 - 1 = +10.8%      20 km headline: 30 -> 35 = +16.7%
```

The stable facts to put to the owner are the ones that do not move: theory **+10.8%**, the
20 km headline **+16.7%**, roughly **37% of extents cost nothing at all**, worst case
**+50%**. Quoting any single aggregate — mine or theirs — reintroduces exactly the
single-number error the finding was about.

### 3.4 "11 tests, not 9" — **right about HEAD, and my 9 was an undercount for a different reason**

At `662b402`, `edgeLabelColumn 54 → 38` fails **11 in atlas-core** — and **13 repo-wide**
(plus `apps/web` page-estimate and `render-cli` page-setup). At `ce5d4e3` it failed 9 in
atlas-core, and the log proves no other workspace ran, because `pnpm -r test` bailed. So: 9
was correct for that commit's atlas-core and was an undercount of the repo total; 11 is
correct for HEAD's atlas-core; 13 is the number that answers the question. Both figures
were measuring different things, and mine was measured with a harness that could not see
past the first failing package. Corrected for the whole table in the note at the top of
this section.

## 4. `dotnet test --filter "FullyQualifiedName!~Api"` — mechanism confirmed, and my impact verdict below is WRONG

> **Correction, 2026-09-11 — I got this one wrong, and the fix caught what I missed.**
> Everything below about the *mechanism* is right and was measured. The conclusion
> "impact currently zero" is not. I asked "what does case-**insensitivity** exclude that
> case-sensitivity would not?", measured the answer correctly (nothing — both sets are the
> same 82), and then reported that as *the filter excludes nothing it shouldn't*. Those
> are different questions. I had the number 82 in front of me and never inspected the list.
>
> `!~Api` is a **substring** match, and `JourneyBook.Tests.AdminApiKeyGateTests` contains
> `Api`. It is in namespace `JourneyBook.Tests`, not `JourneyBook.Tests.Api`, holds **4
> Docker-free `[Fact]`s**, and was therefore excluded from the `dotnet-unit` job and from
> the filter `CLAUDE.md` tells contributors to run locally — the authorisation half of the
> tile-source SSRF fix, silently outside the Docker-free gate. Not zero impact. The
> case-insensitivity I did measure is a *second*, still-latent hazard on top of it.
>
> Now fixed at `877b526`: the filter is `!~JourneyBook.Tests.Api.` (namespace, not word),
> and `harness/checks/test-filter-partitions.sh` asserts the two CI jobs between them run
> every test — which is the structural guard, not just the corrected string.

Measured by counting `--list-tests` under each filter:

```
unfiltered                        : 193
FullyQualifiedName!~Api  (CI job) : 111
FullyQualifiedName!~api  (lower)  : 111
FullyQualifiedName!~APi  (mixed)  : 111
FullyQualifiedName~Api            :  82
FullyQualifiedName~api   (lower)  :  82
```

**The matcher is case-insensitive — confirmed.** `~` in VSTest ignores case, so `!~Api`
excludes any fully-qualified name containing `api` in any casing.

**But at `662b402` it is dropping nothing extra.** The set of names containing `Api` and the
set containing `api` case-insensitively are both 82 and **identical** — the difference is
empty. 193 − 82 = 111, which is exactly the `dotnet-unit` count. No test is currently being
silently excluded, and `git log -S"apis_own" -- dotnet/JourneyBook.Tests` finds nothing, so
if such a test existed it was renamed before it was ever committed.

The hazard is real and unguarded, though, and it is worth closing while it costs nothing:
`api` is a substring of ordinary English words a test name would plausibly use — **rapid**,
**rapidly**, **capital**, **capitalisation**, **therapies**. A test named
`Rename_preserves_capitalisation` or `Prune_is_rapid_on_a_large_table` would vanish from the
`dotnet-unit` job, from the filter contributors are told to run in `CLAUDE.md`, and from CI,
in complete silence — the same shape as a guard that passes because it could not resolve
its subject.

Two cheap fixes, either sufficient:
- filter on the namespace instead of a bare word — `FullyQualifiedName!~JourneyBook.Tests.Api.`
  cannot collide with an English word; or
- assert the arithmetic in CI: `dotnet-unit` count + `~Api` count == unfiltered count, so a
  silently-dropped test fails the build instead of disappearing.

## Sixth-pass ranked

| id | score | finding | file:line |
|---|---|---|---|
| N-1 | **13** | The new overlap guard measures an unsigned distance: invert the overlap sign — every promised strip of shared ground becomes a strip on no page — and `atlas-core` is 80/80 green | `packages/atlas-core/src/grid.test.ts` (both `[BEHAVIORAL]` seam tests) |
| N-3 | **10** | The retention service's startup sweep prunes *expired* rows, not the restart's wreckage its comment names; no startup reconciliation exists, so a crash still strands a row for 30 days | `GeneratedPdfRetentionService.cs:33-36` · `GeneratedPdfService.cs:98-103` |
| N-5 | **9** | 300 DPI is met at one preset and missed at four; the new DPI guard pins only the one that passes, and the roadmap still carries the corrected-elsewhere wrong number driving a Stage 7 decision | `tilemath.test.ts` (new DPI test) · `vault/development-roadmap.md:268-270` |
| N-2 | **8** | The 15-minute client deadline is now hand-copied into C# with nothing comparing them — the original bug's shape, inside its own fix | `DependencyInjectionTests.cs:18` vs `render-polling.ts:56` |
| N-4 | **5** | Shutdown row-failing is one sequential DB write per queued job inside an unconfigured 5 s `ShutdownTimeout` | `RenderJobProcessor.cs:88-131` |
| N-7 | **4** | `!~Api` is a substring match: it silently excluded `AdminApiKeyGateTests` (4 Docker-free tests) from the unit job — my "zero impact" verdict was wrong, see the correction in §4. Fixed at `877b526`. | `.github/workflows/ci.yml` (`dotnet-unit`) · `CLAUDE.md` |

## 5. Gaps in the new web-side guards — checked by mutation, not taken on report

`apps/web` gained five new guards. Three of the original defects can be restored by
editing production code while all **42/42** web tests stay green. Each was proven, not
argued.

### N-8. A token moved out of `@theme` un-defines its utility and the token guard does not notice — score 12

`theme-tokens.test.ts` collects definitions with `readFileSync(INDEX_CSS)` and
`matchAll(/--color-([a-z]+-\d+)\s*:/g)` over the **whole file**. Tailwind v4 emits a
utility only for a custom property declared **inside `@theme`**. The guard never parses
that boundary.

Moved `--color-bark-300: #b5926c;` out of `@theme` into a `@layer base { :root { … } }`
— same file, same text, same hex:

```
  web tests            : 42 passed (42)          <-- guard green
  BASELINE  .border-bark-300 rules in the compiled CSS: 1   (.text-bark-600: 1)
  MUTATED   .border-bark-300 rules in the compiled CSS: 0   (.text-bark-600: 1)
```

Compiled with a real `vite build` both ways, with `.text-bark-600` as an untouched
control. **This is finding F11 exactly — a token used 16 times generating no CSS — put
back, with the guard written to prevent it reporting success.**

The guard's other half is genuinely strong and is cleared: `theme-tokens.test.ts:94-115`
locks `index.css` against `packages/ui/src/tokens.ts` by name *and* by hex in both
directions. Remaining scope gaps, unproven but structural: `FAMILIES` is a hardcoded list
so a new colour family is invisible; the utility-prefix list misses `border-t-`,
`ring-offset-` (already present at `components/ui/select.tsx:17`) and `caret-`; template
literals are unscanned; `index.css` is not scanned as a *usage* site; non-colour tokens
(`--font-display` and friends) are covered by neither test.

### N-9. The file-input a11y guard reads only string-literal `className` — score 11

`a11y.test.ts:94` is `/className=["']([^"']*)["']/`. Any JSX-expression form yields no
match, so no offender. Restored the pre-fix defect verbatim except for the brace:

```
apps/web/src/routes/ProjectListPage.tsx:132
  BEFORE: … onChange={(e) => void handleImport(e)} className="sr-only" />
  AFTER : … onChange={(e) => void handleImport(e)} className={`hidden`} />
  web tests: 42 passed (42)     <-- GREEN
```

`className="hidden"` is what the file said at `ce5d4e3`; `` className={`hidden`} `` is the
same defect and the same rendered DOM. Project import is keyboard-unreachable again and
the guard is green.

*Evidence corrected 2026-09-11.* I first cited `cn(...)` in `components/ui/*.tsx` as proof
the expression form is idiomatic here — as does the guard's own docblock at
`a11y.test.ts:85`. That is the weakest available evidence: **nothing imports
`components/ui/*` or `lib/utils.ts`** (grep over `apps/web/src` and `apps/web/tests`,
excluding those files themselves, returns no hits), so the guard justifies its regex by
pointing at dead code. The live evidence is far stronger and is the form the mutation
above actually used: `` className={`…`} `` appears in **ten** places in shipping components,
including `ProjectEditorPage.tsx:582,808`, `PinEditor.tsx:24,40`, `LocationList.tsx:195`,
`PageSetup.tsx:119,208`, `MapFurniture.tsx:116,138` and `Hero.tsx:229`. A contributor
writing a file input the way this codebase already writes conditional classes defeats the
guard on the first try.

Also outside the guard: `style={{display:"none"}}`, the bare
`hidden` attribute, `w-0 h-0 overflow-hidden`, and `<Select>` (the Radix component in
`components/ui/select.tsx`) since the tag regex only matches lowercase `<select`.

### N-10. The aria-live guard is a five-file allowlist, and a sixth file is silent today — score 10

`a11y.test.ts:152-158` hardcodes `mustAnnounce` as five paths, then tests each with a
**whole-file** substring match for `aria-live=|role="status"|role="alert"`.

No mutation needed. `apps/web/src/components/GeocodeSearch.tsx` holds `searching`,
`adding` and `error` state (`:15-17`) and renders "No matches found." (`:70`), "Adding…"
(`:85`) and an error paragraph (`:93`) — and a grep for
`aria-live|role="status"|role="alert"` in that file returns **0**. It is not in the
allowlist. The guard's own docblock says *"Zero `aria-live` regions existed anywhere in
the app, so every asynchronous status change was silent"* — still true of this component,
and green. Commit `de6cd2e` edited this very file (adding an `aria-label` at `:55`) and
left the async status unannounced.

The whole-file match is the second half of the hole: `ProjectEditorPage.tsx` satisfies it
with a single region at `:401` covering `saving`/`error`, while the over-limit alarm
(`:682-686`) and the entire render-history list — including `entry.detail`, the failure
diagnostic that fix F10 exists to surface — sit outside any live region.

### N-11. `project-transfer` does not assert that an exported location has coordinates — score 12

`project-transfer.test.ts:55-64` checks the round-tripped location with `toMatchObject`
naming `name`, `notes`, `pinShape`, `zoomLevels`. `toMatchObject` ignores keys it is not
told about, and **`lng`/`lat` are named nowhere in the file**.

```
apps/web/src/lib/project-transfer.ts:56
  BEFORE: lng: l.lng,
  AFTER : lngDROPPED: l.lng,
  web tests: 42 passed (42)     <-- GREEN
```

Every exported location then arrives with no longitude. `ProjectListPage.tsx:101` calls
`api.locations.create(proj.id, l.name, undefined, undefined, …)` and each imported
location lands at a junk coordinate. The coordinates are the only thing a location *is*,
and they are the one field the round-trip guard does not pin. `pinColor` and the
per-location `scalePresetId` are unasserted in the same way — and "changing a location's
scale used to wipe its custom pin" is a bug this codebase has already had once
(`ProjectEditorPage.tsx:265`).

The part that **is** cleared: margins, orientation and overlap genuinely round-trip, with
a non-default fixture (Landscape, 0.05, asymmetric margins, `gutter: 0.25`) through a real
`JSON.parse(JSON.stringify(...))`, and `pageSetup: null` for a legacy file is a thoughtful
assertion. F9 itself holds. Also unpinned: `locations` is imported through a bare
`as ExportedLocation[]` cast with no validation (the module rejects an orientation of
`"Sideways"` but accepts a latitude of `"north"`), `version` is written and never read,
and landmarks are dropped by export entirely although the test is titled *"round-trips
every field that changes the printed atlas"*.

### N-12. `page-estimate` is correctly wired, and still cannot see the project's page setup — score 7

Verified wired, against my own suspicion: `ProjectEditorPage.tsx:10` imports
`estimatePages` and `:364-369` uses it for all four consumers (estimate line, "Too Large"
confirm, disabled Generate, ⚠ banner). The dead-code bug is genuinely dead and
`project.overlap` is genuinely passed. **F4 holds.**

But `estimatePages` takes no `PageSpec` parameter at all (`page-estimate.ts:43-47`) and
hardcodes `page: LETTER_PORTRAIT` (`:50-60`). Its TODO justifies this as "there is still
no UI control for them" — and that premise is false: `ProjectListPage.tsx:98` applies
`parsed.pageSetup` through `api.projects.patch`, and `api.projects.duplicate` carries page
setup too, so a Landscape or gutter-bearing project is reachable **today** without any
editor control. `pageGridSize` derives its count from `groundFootprintMeters(scale, page)`,
and `printableAreaInches` swaps the axes on landscape and takes the gutter off the width —
so for such a project the editor's estimate and the renderer's real count disagree, either
side of a 200-page cap. The guard cannot express the defect because the function has no
parameter for it.

### N-13. What is cleared on the web side

- **`pdf-history`** is the tightest of the five: wired at `ProjectEditorPage.tsx:11,705`
  with all four fields consumed, and it pins `errorMessage` verbatim, the whitespace
  fallback, the stranded-row wording for both `Pending` and `Rendering`, unparseable
  dates, and `downloadable` across all four statuses. Only soft spot: `STUCK_AFTER_MS` is
  asserted against itself (`T0 + STUCK_AFTER_MS + 1`), so the 30-minute constant could
  become 30 seconds or 30 hours with the test green.
- **All five new modules that production is supposed to call, it does call.** I suspected
  parallel implementations and there are none — `page-estimate`, `pdf-history` and
  `project-transfer` are each imported and consumed at named line numbers.

### The pattern under N-8 through N-12

The fixes moved derivation into pure functions and pinned the pure functions well. **The
wiring into JSX is pinned nowhere**, because `apps/web` has no DOM test setup — three of
the original defects (hidden file input, unrendered `errorMessage`, missing over-limit
banner) can each be restored by editing JSX alone with the whole suite green. Deleting
`ProjectEditorPage.tsx:716-720` un-renders the failure diagnostic; deleting `:682-686`
un-renders the over-limit banner. `@testing-library/react` + `jsdom` in `apps/web` would
close more of this than any further regex hardening.

## Sixth-pass ranked, complete

| id | score | finding | file:line |
|---|---|---|---|
| N-1 | **13** | Overlap guard measures an unsigned distance: invert the sign — every strip of shared ground becomes a strip on no page — and atlas-core is 80/80 green | `packages/atlas-core/src/grid.test.ts` |
| N-8 | **12** | A colour token moved out of `@theme` stops emitting its utility; guard green. F11 restored, proven against the compiled CSS | `apps/web/src/lib/theme-tokens.test.ts:49-54` |
| N-11 | **12** | The export round-trip never asserts `lng`/`lat`; drop them and 42/42 stay green | `apps/web/src/lib/project-transfer.test.ts:55-64` |
| N-9 | **11** | File-input a11y guard reads only string-literal `className`; `` className={`hidden`} `` restores the defect, green | `apps/web/src/lib/a11y.test.ts:94` |
| N-3 | **10** | Retention sweep's "restart's wreckage" claim is false; no startup reconciliation, so a crash still strands a row 30 days | `GeneratedPdfRetentionService.cs:33-36` |
| N-10 | **10** | aria-live guard is a 5-file allowlist; `GeocodeSearch.tsx` is silent and green today, no mutation needed | `apps/web/src/lib/a11y.test.ts:152-158` |
| N-5 | **9** | 300 DPI met at one preset, missed at four; new DPI guard pins only the one that passes; roadmap still carries the wrong number | `tilemath.test.ts` · `vault/development-roadmap.md:268-270` |
| N-2 | **8** | The 15-minute client deadline hand-copied into C# with nothing comparing them | `DependencyInjectionTests.cs:18` vs `render-polling.ts:56` |
| N-12 | **7** | `estimatePages` cannot accept a `PageSpec`; a Landscape/gutter project (reachable via import) estimates against the wrong box | `apps/web/src/lib/page-estimate.ts:43-60` |
| N-4 | **5** | Shutdown row-failing is one sequential DB write per queued job inside an unconfigured 5 s `ShutdownTimeout` | `RenderJobProcessor.cs:88-131` |
| N-7 | **4** | `!~Api` is a substring match: 4 Docker-free tests were silently outside the unit job — my "zero impact" verdict was wrong (§4). Fixed at `877b526`. | `.github/workflows/ci.yml` |

---
---

# Seventh pass — do the sixth pass's fixes hold? (2026-09-11, `04a9073`)

Tree clean at `04a9073` before and after; the only working-tree changes are the two
vault files that were never mine. Baseline: **486 TS** (atlas-core 100 · web 129 ·
pdf-client 38 · map-sources 79 · render-cli 105 · render-worker 35 — four more than the
482 quoted) and **216 .NET** non-Docker, all green; `golden-fixture.sh` and
`test-filter-partitions.sh` both PASS.

Twenty-three probes. Every one patched by anchor text with the before/after line echoed
and re-read off disk, with the built artifact required to change before a verdict was
recorded. All twenty-three anchors resolved; none was COULD-NOT-RUN.

## 1. The four priority probes — all four fixes hold

| probe | sixth pass | `04a9073` | caught by |
|---|---|---|---|
| **N-1** overlap sign inverted (shared ground → ground on no page) | GREEN, 80/80 | **RED** | `grid.test.ts > [BEHAVIORAL] carries the exact overlap fraction as shared ground` + `page-estimate.test.ts` |
| **N-8** colour token moved out of `@theme` | GREEN, 42/42 | **RED** | both `theme-tokens.test.ts` tests |
| **N-9** file input hidden via `` className={`hidden`} `` | GREEN, 42/42 | **RED** | `a11y.test.ts > [BEHAVIORAL] no file input is hidden with display:none` |
| **N-11** exported location loses `lng` | GREEN, 42/42 | **RED** | `project-transfer.test.ts > [BEHAVIORAL] round-trips a location whole — coordinates included` |

Both axes of N-1 were probed separately (`stepX` and `stepY`); both go red.

## 2. The rest of the recorded set

Seventeen mutations, `--no-bail` throughout.

| # | mutation | verdict | failing tests |
|---|---|---|---|
| M1 | `edgeLabelColumn 54 → 38` | RED | 26 |
| M2 | renderer map box 5% narrower | RED | 8 |
| M3 | crop origin `left + 8` | RED | 2 |
| M4 | crop width × 1.3 | RED | 2 |
| M5 | page grid gains a column | RED | 7 |
| M6 / M6b | grid step × 1.02 (both sites / layout only) | RED | 6 / 4 |
| M7 | scale bar 10% long | RED | 2 |
| M8 | `metersPerInch` +1% | RED | 16+ |
| M9 | overlap honoured at half value | RED | 2 |
| M10 | `mapBoxOf` border 1 → 3 | RED | 2 |
| M11 | `panelBorder 1 → 2` | RED | 22 |
| **M12** | **landmark y shifted 3%** | **GREEN** | 486/486 pass |
| **M13** | **overview padding 0.08 → 0.20** | **GREEN** | 486/486 pass |
| M15 | `zoomForBBox` one zoom coarser | RED | 2 |
| M16 | `pageBBoxAround` half-dims swapped | RED | 11 |
| M17 | crop origin `top + 3` | RED | 1 |

**Twenty-one of twenty-three probes red. No fix failed to hold.** The two that stay green
are F20 (score −2) and F17 (score 4) — the two findings that were deliberately never
fixed. They have now been green across three passes, which is consistent, not a
regression.

## 3. What the new guards do not cover

### S-1. An eighth copy of a cross-language vocabulary, and it is unguarded — score 14

The sweep found a seventh hand-written terminal-status set and closed `PdfStatus` ↔
`RenderStatus` properly, with parsers that read the real source and refuse rather than
degrade. **It left the next one out.**

`services/render-worker/src/jobs.ts:23`:

```ts
export type JobState = "rendering" | "completed" | "failed" | "cancelled";
```

`HttpRenderWorkerClient.cs:298-316` is a `switch (job.State)` on four hand-written string
literals — and it has **no `default`**: an unrecognised state falls through to the
progress path, so the API reads it as *still rendering* and keeps polling until the
HttpClient deadline. That is precisely the failure `PdfStatusParityTests` documents for a
client that has not heard of a status, one layer further out. `grep` finds `JobState` in
exactly one file in the repo — its own declaration. `wire-contract.test.ts` pins the
request **body**; nothing pins the job-state **response** vocabulary.

Proven. Rename the state the way a contributor would, on the worker side only:

```
services/render-worker/src/jobs.ts
  LINE 23 BEFORE: export type JobState = "rendering" | "completed" | "failed" | "cancelled";
  LINE 23 AFTER : export type JobState = "rendering" | "completed" | "failed" | "canceled";

  dotnet: Passed!  216 / 216
  ts:     100 + 38 + 129 + 79 + 105 + 35  = 486 / 486
  RESULT: GREEN — survives BOTH suites
```

Every cancel would then be read as "still rendering" and polled to the timeout, reported
as the deadline error the sweep went to some trouble to distinguish from a cancellation.
The fix is the technique already in the file next door: parse `jobs.ts` for the union and
compare it with the switch's labels, as `PdfStatusParityTests` does for `render-polling.ts`.

### S-2. The geometry monopoly guard misses the idiomatic violation — score 13

`GeometryMonopolyTests` is well built — a scan-reached-the-code control, a
can-every-rule-fire self-test, and stale-exemption detection. Its `Vocabulary` is seven
regexes: trig, `Math.PI`, `Math.Log/Exp`, earth-radius literals
(`6378137|6371000|20037508|40075016|40075017`), degree↔radian conversion, `1 << z`, and
`Math.Pow(2,…)`.

It contains no `111320`, no `Math.Sqrt`, no `0.0254`. Those are how a C# developer
actually writes this. Added to `dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs`
— a governed root — a `PadExtentMetres` using `const double MetresPerDegreeLat = 111320.0`
plus a latitude-shrink factor, and a `PlanarMetres` using `Math.Sqrt`:

```
  on disk: 164:        const double MetresPerDegreeLat = 111320.0;
  on disk: 175:        var dx = (x2 - x1) * 111320.0;
  Passed!  - Failed: 0, Passed: 216
  RESULT: GREEN — the geometry monopoly guard does not see this
```

That is real projection and real ground-distance arithmetic in C#, which ADR 0004 forbids
in those words, sitting in the layer the guard governs, with the guard green. Cheapest
fix: add `\b111\d{3}\b`, `Math\.Sqrt`, and `0\.0254` to the vocabulary — each is a literal
that has no business in a layer that owns no geometry.

### S-3. The partition check cannot see the filter it is guarding — score 11

Two probes, opposite directions.

**It can fail, and it diagnoses well.** Restoring the old filter *in the script*:

```
UNIT_FILTER='FullyQualifiedName!~Api'
FAIL: excluded from the unit job but not an integration test:
  JourneyBook.Tests.AdminApiKeyGateTests.{4 tests}
  JourneyBook.Tests.Rendering.HttpRenderWorkerClientTests.{3 tests}
  JourneyBook.Tests.TileCacheLayoutParityTests.Treats_an_escaping_source_key_as_a_miss…
  JourneyBook.Tests.WorkerWirePayloadParityTests.{2 tests}
rc=1
```

Ten Docker-free tests, not the four its own header records — that number was measured at
197 tests and the suite is now 309. A measured claim in a comment that has since drifted.

**But it reads its own copy of the filter.** `UNIT_FILTER` is hardcoded at
`test-filter-partitions.sh:30` under the comment *"Keep in step with ci.yml's dotnet-unit
job."* Changing the filter in `.github/workflows/ci.yml` **only** — both the comment at
`:16` and the live `run:` at `:128` — leaves the check reporting:

```
PASS: 216 unit + 93 integration == 309 total …
rc=0
```

The guard against filter drift is itself a duplicated filter with nothing comparing it to
CI. It should read the filter out of `ci.yml` the way `PdfStatusParityTests` reads the
union out of `render-polling.ts`.

Worth noting alongside: with a namespace-prefix filter, the check's two substantive
branches are close to unreachable. `excluded` is computed as `comm -23 all unit`, so
`n_unit + n_excluded == n_all` is an identity; and "excluded ⇒ in the Api namespace" is
guaranteed by the filter's own form. The check earns its keep only when someone changes
the filter — which is the case it cannot see.

### S-4. `effectiveDpi` still has nowhere to land on the path the product uses — score 10

Of the fields the sweep reports wired end to end, four genuinely are: **`phase`** (worker
`jobs.ts:108,126,133` → `GeneratedPdf.Phase` → `progressOf` → `GenerateButton.tsx:47,54,58`),
**`tileMaxZoom`** (`RenderService.cs:132` reads the registry → wire → `render.ts:630`),
**`expiresAt`** (`pdf-history.ts:55-81` `expiryNote`), and **`category`/`sourceConfidence`**
— that last one fixed the right way, by making the parameters *required* in
`client.ts:352` so omitting them is a compile error rather than a silent default, with
`ProjectEditorPage.tsx:322-323` passing the record's own values through.

**`effectiveDpi` is not.** It is now called (`render.ts:692`) and the number is collected
into `deliveredDpi` — and `deliveredDpi` is used at `render.ts:694,740-750` for
`stderr.write` and nothing else. `stderr` is imported directly from `node:process`
(`render.ts:1`), so it is not injectable; the render-worker never captures it; and
`RenderAtlasResult` (`render.ts:247-259`) has **no DPI member** — it carries
`attribution`, `pageCount`, `contract`, `grids`, `landmarks`, `polyline`.

So on the only path the product actually uses — web → API → worker — the achieved print
resolution reaches a container's stderr and stops. The commit that paired them, *"the DPI
the renderer achieved, and the credit it printed, reach someone"*, delivered its other
half properly: `Attribution` is persisted into `SourceMetadataSnapshot`
(`RenderJobRunner.cs:196-206`) and returned by the API (`GeneratedPdfService.cs:224`),
and its docstring claims only that this "makes it answerable afterwards", which is exactly
what it does. **Cleared for attribution; open for DPI.** One field on `RenderAtlasResult`
would close it, and the provenance JSON already has a place to put it.

### S-5. `ProjectEditorPage` still has no DOM test, so two original defects are still JSX-deletable — score 9

The sixth pass's structural recommendation was taken and taken well: `jsdom` and
`@testing-library/react` are in `apps/web/package.json`, opted into per file with a
documented reason (`vite.config.ts:18-31` explains that a project-wide jsdom would break
the two source-walking scanners). Five DOM test files exist — `PageSetup`,
`BasemapOptions`, `GenerateButton` ×2, `LocationList.provenance`.

**None of them is `ProjectEditorPage`**, which is where the two findings live. Both
deletions the sixth pass named are still green:

```
J-A  ProjectEditorPage.tsx:788   the ⚠ over-limit banner text removed      → 129/129 pass
J-B  ProjectEditorPage.tsx:820   {entry.detail && (  →  {false && entry.detail && (   → 129/129 pass
```

`estimatePages` and `describePdfHistoryEntry` are both thoroughly pinned as functions;
what they are pinned *to* is still not rendered under test. The harness now exists — this
is two files, not a change of approach.

### S-6. The 15-minute client deadline is now hand-copied into C# three times — score 8

N-2 from the sixth pass is not fixed, and it has grown. `DEFAULT_TIMEOUT_MS = 15 * 60 * 1000`
(`render-polling.ts:168`) is the single source. Against it:

- `DependencyInjectionTests.cs:18` — `ClientPatience = TimeSpan.FromMinutes(15)`
- `HttpRenderWorkerClientTests.cs:104` — `Timeout = timeout ?? TimeSpan.FromMinutes(15)`
- `HttpRenderWorkerClientTests.cs:657` — `Timeout = TimeSpan.FromMinutes(15)`
- plus prose copies at `DependencyInjection.cs:91` and `docker-compose.yml:53-55`

Nothing compares any of them with the TypeScript. The assertion that matters —
`http.Timeout >= ClientPatience` — is a good *relationship* test and it silently stops
meaning anything the moment the client's patience changes. The technique to fix it is in
the same test project: `PdfStatusParityTests.cs:73` already opens `render-polling.ts` and
parses it.

### S-7. Narrowed, not unguarded: the schema parser cannot see a quoted key — score 3

`WorkerWirePayloadParityTests.ParseWorkerSchemaFields` matches
`^[A-Za-z_][A-Za-z0-9_]*\s*:`, so a field written as `"name": { … }` is invisible to it
and the "worker accepts it and the API never sends it" direction cannot fire. I probed it
by adding `"nobodySendsThis": { type: "string" }` to `renderBodySchema`:

```
    dotnet: Passed!  216 / 216          <-- the C# parity test does NOT see it
    ts:     services/render-worker  Tests  1 failed | 34 passed
    RED: wire-contract.test.ts > [BEHAVIORAL] the worker accepts no field the engine has never heard of
```

So the C# parser is blind as suspected, but a TypeScript sibling catches the same class
from the other side. **This is a redundancy gap, not an unguarded invariant**, and only the
narrow case bites: a field the *engine* does know about, added to the schema with a quoted
key, and not sent by the API. Worth a one-character regex change, not a finding of
substance.

### S-8. Structural, not currently live: the parity fixture is hand-maintained

`WorkerWirePayloadParityTests` derives the payload's field set by serializing `Maximal()`.
I checked: `RenderWorkerRequest` has 24 members and `Maximal()` sets all 24 today, so the
fixture is complete **now**. But every member past the eighth has a default, so adding one
compiles without touching `Maximal()`, and a member left null is omitted by
`WhenWritingNull` and vanishes from the compared set. `Assert.True(payload.Count >= 20)` is
a floor, not a completeness check. A reflection assertion over the primary constructor's
parameters would make it self-maintaining. Reported as a latent gap, not a live one.

### S-9. Cleared

- **`RenderPhase` duplicated** (`render.ts:215` and `render-polling.ts:63`) with no parity
  test — but `phaseLabel` (`render-polling.ts:88-101`) has a `default` returning `null` and
  says why: *"anything a newer worker invents. Saying nothing is better than guessing at a
  word we have never seen."* Degrades correctly by design. Not a finding.
- **`FailStrandedAsync`** exists (`GeneratedPdfService.cs:156`) and is called at startup
  (`RenderJobProcessor.cs:121` via `FailStrandedOnStartupAsync`). My N-3 is properly fixed:
  a crash-stranded row is now cleared at the next start, not left for the retention window.
- **N-4 remains open and was correctly deprioritised** (score 5): `HostOptions.ShutdownTimeout`
  is still configured nowhere, and `RenderJobProcessor.cs:163` still only names it in a
  comment while doing one sequential DB write per queued job inside that budget.
- **The branch-first process rule.** Verified: `ci.yml:25-29` is `on: push: branches:
  [master]`, `pull_request`, `workflow_dispatch`, so a bare branch push triggers nothing.
  The correction in `0f6cbab` is right, and `workflow_dispatch` is present so
  `gh workflow run CI --ref <branch>` is a real alternative. **This one is worth keeping in
  the shapes list**: it is config-that-lies in an instruction rather than in a file, and
  the thing that made it lie — a trigger list — was checkable all along.

## Seventh-pass ranked

| id | score | finding | file:line |
|---|---|---|---|
| S-1 | **14** | Eighth cross-language vocabulary: `JobState` vs a C# switch with no `default`; rename a state and both suites stay green (216 + 486) | `services/render-worker/src/jobs.ts:23` vs `HttpRenderWorkerClient.cs:298-316` |
| S-2 | **13** | The ADR 0004 guard's vocabulary has no `111320`, `Math.Sqrt` or `0.0254`; real geometry added to a governed file passes 216/216 | `GeometryMonopolyTests.cs:79-90` |
| S-3 | **11** | The partition check reads its own copy of the filter; changing `ci.yml` alone leaves it PASS | `harness/checks/test-filter-partitions.sh:30` vs `ci.yml:128` |
| S-4 | **10** | `effectiveDpi` is computed and written only to `node:process` stderr; absent from `RenderAtlasResult`, so it reaches nothing on the API path | `render.ts:669,694,740-750,247-259` |
| S-5 | **9** | `ProjectEditorPage` has no DOM test; the over-limit banner and the failure diagnostic are still deletable with 129/129 green | `ProjectEditorPage.tsx:788,820` |
| S-6 | **8** | The 15-minute client deadline hand-copied into C# three times, nothing comparing it with `render-polling.ts` | `DependencyInjectionTests.cs:18`, `HttpRenderWorkerClientTests.cs:104,657` |
| S-7 | **3** | Schema parser blind to a quoted key — covered by a TS sibling, so redundancy not exposure | `WorkerWirePayloadParityTests.cs:121` |
| S-8 | **3** | `Maximal()` is hand-maintained; complete today, silently incompletable | `WorkerWirePayloadParityTests.cs:166-190` |

## A process note on this pass's own method

Two self-inflicted stalls, both worth recording next to the heredoc rule:

- **`until ! pgrep -f "foo.sh"` matches the watcher's own command line.** Three waiters
  queued behind each other deadlocked permanently, each seeing the others' `pgrep` pattern
  in `/proc/*/cmdline`. Nothing was lost — the probes had not started — but two batches sat
  idle until the loops were killed. Wait on a sentinel file, or `pgrep -f` a pattern that
  cannot appear in the waiter itself.
- The `>= 20` / `>= 50` style floors used as "guard the guard" controls throughout this
  repo are good, and this pass is evidence for them: every probe that could not reach its
  subject said so instead of returning a verdict.
