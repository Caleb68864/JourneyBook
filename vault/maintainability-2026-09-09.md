---
title: "Maintainability Scan — 2026-09-09"
category: "audit"
status: complete
priority: high
related:
  - "Development Roadmap"
  - "Staged Build Roadmap"
---

# Maintainability Scan — 2026-09-09

Working tree at `37ef0af`. **No source was modified.** This is not a bug hunt; the
five-pass audit of 2026-09-08 is closed. The question here is: *what will make the
next change to this codebase expensive, risky, or easy to get wrong?*

## What was actually run

| Check | Result |
|---|---|
| `npx vitest run --dir <pkg>` × 6 | atlas-core 66 · map-sources 46 · pdf-client 12 · render-cli 41 · render-worker 6 · web 7 = **178 pass** |
| `dotnet test --filter "FullyQualifiedName!~Api"` | **79 pass**, 0 fail |
| `npx tsc -b` at repo root | **fails** — `TS5083: Cannot read file '.../tsconfig.json'`. There is no root `tsconfig.json`; `forge-project.json:53` says this command works. Per-package `tsc -p` does work. |
| Docker | unavailable — Api/Testcontainers suites not run (as expected) |

Every claim below was verified by reading the named file at the named line, or by
executing the named command. Where an earlier document is contradicted, that is
called out.

---

## 1. The seam that is still unmeasured: panel georegistration

**`packages/map-sources/src/panel.ts:367-373` · `packages/map-sources/src/panel.test.ts:81-90`**

The true-scale chain now has one measured link and one unmeasured one.

*Measured:* `pdf-client/src/scale-fidelity.test.ts` parses the produced PDF with
`pdf-measure.ts` (a genuine content-stream interpreter — it imports only
`node:zlib`, nothing from `atlas-core`) and asserts the painted map rectangle is
415 × 549 pt across five layout variants. That test is real and it is the best
thing in the repo.

*Unmeasured:* whether the **image inside that rectangle shows the ground the bbox
names**. The crop is computed at `panel.ts:368-373`:

```ts
const left  = Math.round(topLeft.x - range.minX * TILE_SIZE);
const top   = Math.round(topLeft.y - range.minY * TILE_SIZE);
const width = Math.max(1, Math.round(bottomRight.x - topLeft.x));
const height= Math.max(1, Math.round(bottomRight.y - topLeft.y));
```

`panel.test.ts:37-42` serves tiles that are a **flat solid colour**
(`background: { r: 120, g: 140, b: 110 }`), so `composite` + `extract` produce
byte-identical output for *any* crop window. The entire assertion set on the crop
is:

```ts
expect(panel.widthPx).toBeGreaterThan(0);
expect(panel.heightPx).toBeGreaterThan(0);
expect(panel.zoom).toBeGreaterThan(0);
```

Swap `left`/`top`, drop the `- range.minX * TILE_SIZE` term, or multiply
`width`/`height` by 1.3 — every test in the repo still passes, and the PDF tests
confirm the (now wrong) image is painted into a box of exactly the right size.
`render.test.ts:11` deliberately never renders with `--basemap`, so the orchestrator
never exercises this path either.

**This is the 30% bug's exact failure mode, one layer upstream of where the new
tests look.** Fix: serve per-tile-distinct or gradient tiles and assert pixel
content at known offsets. Risk of the fix itself: low. Risk of *refactoring* this
function: high — it is silent when wrong.

## 2. A scale input that is persisted, tested, and then discarded

**`dotnet/.../HttpRenderWorkerClient.cs:33-57` vs `RenderDtos.cs:39,41` ·
`packages/render-cli/src/render.ts:408`**

`PageMargins` (top/right/bottom/left/**gutter**) and `PageOrientation` are:
EF-owned columns (`ProjectAggregateConfigurations.cs:65`), validated on write
(`ProjectService.cs:175-178`), copied on project-duplicate (`:172-173`), returned in
`ProjectDto`, carefully preserved across the web `PUT` adapter
(`apps/web/src/api/client.ts:32-37`) with **two dedicated tests**
(`client.test.ts:85,97` using non-default `0.75/0.6/0.75/0.9`, gutter `0.25`), and
threaded into `RenderWorkerRequest` (`RenderService.cs:99,101`).

`WorkerRenderPayload` has **no `margins` and no `orientation` member**. They are
dropped at the last hop. `assembleContract` then hardcodes
`margins: LETTER_PORTRAIT.margins` (`render.ts:408`) and `LETTER_PORTRAIT` at
`:317, :330, :363, :383, :398`.

Two things make this worse than an ordinary dropped field:

- **Margins are a scale input.** `printableAreaInches` → `mapBoxInches` →
  `groundFootprintMeters`. Since the 2026-09-08 fix, changing a margin changes the
  printed ground footprint. The one setting the product exposes that moves the
  printed scale is the one that cannot reach the renderer.
- **The drop is untested by construction.** All seven `HttpRenderWorkerClientTests`
  pass `Margins: new RenderMarginsDto(0.5, 0.5, 0.5, 0.5)` and
  `Orientation: "Portrait"` — the defaults. No test can observe the loss.

Also dropped at the same hop: `title`, atlas-level `zoomLevels`, `coverPadFraction`,
`panelWidthPx`, `panelFormat`, `panelQuality`, `cacheDir`. CLI users get them; API
users never do.

Latent, unmasked by this: **`PageOrientation` disagrees on casing.** C# serialises
`"Portrait"`/`"Landscape"` (`ProjectService.cs:209`); TS is
`"portrait" | "landscape"` (`model.ts:17`) and `page.ts:42` tests
`=== "landscape"`. Wire orientation up without normalising and `"Landscape"`
silently renders portrait.

## 3. The render input is hand-mapped five to seven times, with no schema anywhere

There is **no OpenAPI client generation, no shared schema, no cross-language test**.
`Program.cs:13` `AddOpenApi()` publishes a spec nothing consumes.

| Hop | Site |
|---|---|
| 1 | `GenerateButton.tsx:28` → `client.ts:353` (object literal, names matched by string) |
| 2 | `RenderEndpoints.cs:11` (model binding) |
| 3 | `RenderService.cs:96-114` + four sub-maps at `:54, :70, :73, :82` |
| 4 | `HttpRenderWorkerClient.cs:114-133` **and again at `:139-157`** — a 20-argument positional record built twice in one method, differing in three arguments |
| 5 | `render-route.ts:43` `req.body as Partial<RenderAtlasInput>` — a bare cast, then `:75` spreads it whole into `renderAtlas` |
| 6 | `render.ts:288-424` → `AtlasContract` |
| 7 | `render.ts:567-581` → `pdf-client/src/index.ts:47-62` → `AtlasDocument` props (a second rename: `tableOfContents` → `toc`) |

Adding one render option is a seven-file edit. Because every field is optional on
both sides, TypeScript reports nothing when a hop forgets one — which is exactly how
the attribution string and the margins were lost. `render-route.ts:27-37` compounds
it by classifying errors via **string-prefix matching** on messages produced in
`render.ts` (`"Invalid "`, `"Unknown scalePresetId"`, `"requires "`): a stringly-typed
coupling across a package boundary and an HTTP status code.

`render-route.ts:43` also remains the audit's open 20b: the worker takes the whole
engine input off the wire unvalidated, so a direct POST can still set `cacheDir` to
any absolute path.

## 4. The height axis of printed scale has no independent witness

**`packages/pdf-client/src/scale-fidelity.test.ts:115-122, 145, 189`**

`pageGroundSize` computes both `width` and `height` geodesically. **`ground.height`
is never used in an assertion.** Only the width axis is checked against paper:

```ts
const printedRatio = ground.width / ((map.width / PT) * 0.0254);   // :145, :189
```

Height is only ever compared to `mapBoxInches(...).heightIn` (`:156, :177`) — the
same function the renderer laid the page out from. That is the original tautology,
surviving on the untested axis.

Worth stating precisely, because it tempers the finding: `:146` is *algebraically
identical* to `:155`. `ground.width` is derived from `mapBoxInches(spec).widthIn ×
metersPerInch(scale)`, so `printedRatio / ratio` reduces to
`mapBoxInches(spec).widthIn × PT / map.width`. The "ratio" framing adds no
constraint the box check does not already impose. What the suite genuinely catches —
and this is the real defect class — is **the renderer painting a smaller box than it
asked for** (a wrapped title, a re-introduced `flexShrink`, an outgrown notes block).
The five-variant loop at `:164-179` is the single most valuable test in the repo.

Adding `expect(ground.height / ((map.height / PT) * 0.0254))` against `scale.ratio`
is a one-line change that closes the untested axis.

## 5. `validateAtlas` cannot detect a false scale bar, and three documents say it can

**`packages/atlas-core/src/validation.ts:54-77`**

Unchanged in structure. It recomputes `groundFootprintMeters(scale, spec)` — the
same function `buildPageGrid`/`buildLocationPage` used to *build* the bbox — and
compares it to the bbox. It agrees with itself. It measures the geodesic-vs-planar
residual and nothing else.

Set `PAGE_FURNITURE_PT.edgeLabelColumn` to 154, or delete the
`2 * PAGE_FURNITURE_PT.panelBorder` term from `FURNITURE_WIDTH_PT` (`page.ts:89`):
`mapBoxInches` shrinks, bboxes shrink, and `validateAtlas` passes.

The problem is not the function — it is that three places advertise it as the print-
fidelity gate:

- its own doc comment (`validation.ts:38-39`): *"a false scale bar … fails here"*
- `vault/staged-build-roadmap.md:337`: *"catches a false scale bar"*
- `forge-project.json:110` `e2e_validate_command` — `journeybook validate` is the
  project's declared end-to-end validation command

`vault/development-roadmap.md:37-41` says the opposite, correctly. A maintainer
following the roadmap they happen to open will reach the wrong conclusion.

The same self-agreement runs through `atlas-core/src/scale-fidelity.test.ts:20-41`
(re-derives expected via `groundFootprintMeters`) and
`validation.test.ts:10-17` / `grid.test.ts:10-17` (a duplicated `bboxAround` helper
built from the same function). Its genuine, narrower value is catching **meridian
convergence** — an error not shared between the two sides. The two tampering tests
(`validation.test.ts:30, :41`) are good: they mutate output after the fact.

The numeric anchors that *do* hold the map box are `page.test.ts:45-48` (`415`,
`549`), `:68-69` (`3513.667`, `4648.2`) and `grid.test.ts:75-76, :107`. Caveat:
`page.test.ts:73-74` is pure algebra — `groundFootprintMeters` is literally
`box.widthIn × ratio × 0.0254`, so that assertion is `x/x == 1` and cannot fail.

## 6. Default zoom sits exactly on the source ceiling, and 300 DPI is unreachable

Computed with the repo's own `zoomForBBox` maths against the current 415 pt
(5.7639 in) map box at latitude 41, `panelWidthPx = 1000`:

| Preset | Ground width | Zoom chosen |
|---|---|---|
| 1:24,000 (**default**) | 3 514 m | **16** |
| 1:25,000 | 3 660 m | 15 |
| 1:50,000 | 7 320 m | 14 |
| 1:62,500 | 9 150 m | 14 |
| 1:100,000 | 14 640 m | 13 |

The seeded tile source is `MaxZoom = 16`
(`TileSourceConfiguration.cs:36`), enforced at `TileService.cs:27`
(`if (z > source.MaxZoom)` → 400). The default atlas therefore runs with **zero
headroom**, and `zoomForBBox` (`tilemath.ts:40-49`, capped at 20) has no knowledge of
any source's ceiling.

Reachable today via a documented flag: `--panel-px` accepts 256–8000
(`cli.ts:208`). `--panel-px 2000` at the default scale selects z17; through
`--tile-base-url` every tile 400s, trips the 10% threshold, and the render fails
outright. Two independent constants jointly determine this and neither references the
other.

Consequence for the product: 1000 px over 5.7639 in is **~173 DPI**. Reaching the
`vault/print-and-pdf/300-dpi-export.md` target needs ~1 730 px → z17 → blocked. The
print-resolution ceiling is an emergent property of two unrelated numbers.

## 7. The overview page still has both bugs that were fixed on the atlas pages

**`packages/pdf-client/src/AtlasDocument.tsx:744-757`**

The 2026-09-08 pass introduced `OverlaySvg` (`:189-192`), whose viewBox *is* the map
box, and removed `objectFit: "cover"`. It is used at `:283, :337, :460, :522` — every
atlas-page overlay. `OverviewPage` uses neither:

```tsx
<Image ... style={{ ..., objectFit: "cover" }} />        // :752
<Svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}>   // :757, SIZE = 1000
```

A square viewBox over `styles.panel` (`flexGrow: 1`, non-square) letterboxes and
offsets every page rectangle, route line and stop marker, while `cover` crops the
basemap underneath. The overview is the "which page is my house on" aid, so being
out of register defeats it. No test measures the overview page.

The maintainability point beyond the defect: the fix pattern exists and was applied
to four of five call sites. Anyone reading the (accurate, emphatic) comments at
`:181-188` will reasonably assume it is global.

Minor, same area: `OverviewPage` and `TableOfContents` hardcode `padding: 0.75 * PT`
and ignore `contract.margins`, which the content pages honour.

## 8. ADR 0004 is folklore — the text does not exist in the repo

`.gitignore:170-171` ignores `docs/*` except `decisions.md`. **`docs/decisions/` does
not exist.** Yet ADR 0003/0004/0005 are cited as binding by `CLAUDE.md:19,25`,
`forge-project.json:24,57`, `packages/map-sources/src/panel.ts:311`
(→ `docs/decisions/0003-map-panel-rendering.md`), `README.md:12` (a link to a missing
directory), `ProjectEditorPage.tsx:335,357`, `GeneratedPdfService.cs:12`,
`IGeneratedPdfService.cs:8`, and both roadmaps. The whole of the surviving text is
the one-line paraphrase in `CLAUDE.md:25`.

**Is the geometry monopoly enforced, or merely intended?** Intended — but, checked
exhaustively, currently *held*:

`grep -rnE "Math\.(Sin|Cos|Tan|Atan|Asin|Acos|Log|Exp|PI|Sinh)|6378137|6371|20037508|ToRadians|ToDegrees"`
over `dotnet/` and `apps/api/` (excluding `bin`/`obj`) returns **one hit**:
`HttpRangeStream.cs:48` `Math.Min(bytes.Length, buffer.Length)` — a buffer clamp.
There is no trigonometry, no earth radius, no degree/radian conversion and no
metres-per-pixel anywhere in C#. Geometry-adjacent C# is all benign: NTS envelope
reads (`RenderService.cs:69`, `ProjectService.cs:200`), bbox→polygon storage
(`ProjectService.cs:180-192`), SRID-4326 point construction, a `1 << z` index bound
check (`TileEndpoints.cs:39`), and PMTiles *archive-format* addressing
(`PmTilesReader.cs:192-224` — a Hilbert curve, but a file-format one, correctly in C#).

**What would catch a violation: nothing.** No lint rule, no architecture test, no
dependency check. The nearest thing is reviewer discipline plus code comments. There
is already a within-TS drift: `clipSegmentToBbox` (`render.ts:225-247`) is a
Liang-Barsky planar clip living in `render-cli`, not `atlas-core`.

Two cheap enforcements exist: a `dotnet test` assertion that the C# assemblies
contain no `System.Math` trig call, and committing the ADR text (a `.gitignore`
exception, one line).

## 9. The two roadmaps contradict each other, and three status files are stale

| Document | Says | Reality |
|---|---|---|
| `vault/staged-build-roadmap.md:43` | "Current Status (**2026-06-25**)" | 145 commits later |
| `vault/staged-build-roadmap.md:41` | "TS **101** · backend **86**" | 178 TS · 79 .NET non-Api |
| `vault/staged-build-roadmap.md:337` | `validateAtlas` "catches a false scale bar" | it structurally cannot (§5) |
| `vault/staged-build-roadmap.md:317` | Stage 1D "🟡 mostly built" | the print-geometry chain has since been rebuilt and measured |
| `README.md:17-20` | "**Stage 0** — Foundation Skeleton … headless atlas engine **stubs**" | full product, 178+79 tests, CI |
| `README.md:12` | links `docs/decisions/` | does not exist |
| `harness/progress.json:3` | `last_known_good_commit 7f19229` | that is `forge-init` — **145 commits** ago |
| `forge-project.json:53` | "`npx tsc -b` works without pnpm" | fails, no root `tsconfig.json` |
| `forge-project.json` `frontend_test` | `null` | `apps/web` has a `test` script and 7 tests |

`development-roadmap.md` is accurate and current. `staged-build-roadmap.md` is a
74 KB historical record being read as a status document. The cheapest fix is a header
on the staged roadmap saying so, and pointing at `development-roadmap.md`.

## 10. Page size is hardcoded in four places and is not on the contract

`AtlasContract` (`model.ts:139-144`) carries `scale`, `margins` and `pages` — **not
the sheet size.** The sheet is therefore re-asserted independently:

- `page.ts:20-25` `LETTER_PORTRAIT` (the intended source of truth; used correctly by
  `render.ts` and `ProjectEditorPage.tsx:363`)
- `AtlasDocument.tsx:176` re-inlines `{ widthIn: 8.5, heightIn: 11 }`
- `validation.ts:59-60` re-inlines `widthIn: 8.5, heightIn: 11`
- `AtlasDocument.tsx:611, 744, 832` — three literal `size="LETTER"` props

Adding A4 or Legal touches all four with nothing linking them, and the value cannot
even reach the renderer because it is not on the contract. The audit's *"a page-size
change touches every fixture, golden atlas and page-count expectation"* is right, and
this is the structural reason.

## 11. `PAGE_FURNITURE_PT` is a hand-maintained mirror of a JSX tree

**`packages/atlas-core/src/page.ts:86-98` vs `AtlasDocument.tsx:642-696`**

The 2026-09-08 fix was done well: `AtlasDocument.tsx:18` imports
`PAGE_FURNITURE_PT`, and every block height comes from it. I verified the sums by
walking the JSX — `FURNITURE_HEIGHT_PT` (neatline ×2, header, two edge-label rows,
notes, footer, panel border ×2) and `FURNITURE_WIDTH_PT` (neatline ×2, two 54 pt
label columns, panel border ×2) match what is laid out today, exactly.

But `FURNITURE_WIDTH_PT`/`FURNITURE_HEIGHT_PT` are a *hand-written summation of which
blocks exist and on which axis*, living in a different package from the tree they
describe. Add a legend row, split the header, or make a block tier-conditional, and
the constant must be updated by hand. `docs/decisions.md:310` names this contract
explicitly, which is good — but names it in a 114 KB append-only log.

The design does defend itself in the right direction: the panel is `flexGrow: 0,
flexShrink: 0`, so an over-budget tree overflows rather than silently shrinking the
map, and `scale-fidelity.test.ts:79` `expect(measured).toHaveLength(1)` catches the
overflow. That is a good guard. It is worth adding one more: a test asserting
`FURNITURE_HEIGHT_PT` equals the measured gap between the neatline and the panel in a
rendered PDF, so the mirror is checked rather than trusted.

### On `AtlasDocument.tsx` (951 lines) specifically

**Not a rewrite candidate.** It decomposes into 21 well-named components
(`OverlaySvg`, `ScaleBar`, `CompassRose`, `RouteLayer`, `UsngGridLayer`,
`LandmarkLayer`, `NotesArea`, `AtlasPageView`, `OverviewPage`, `TableOfContents`, …),
carries no dead code and no `TODO`/`FIXME` (there are none anywhere in the repo), and
its comments explain *why* rather than *what*. Splitting it would move the furniture
contract across yet another boundary — the opposite of what §11 wants. The cost here
is the implicit contract with `page.ts`, not the line count.

## 12. Duplication surface — verified state

**Currently in agreement, kept so by discipline alone:**

| Value | Copies | Where |
|---|---|---|
| Scale presets (id/label/ratio ×5) | **4** | `model.ts:54-60`, `ScalePresetConfiguration.cs:16-21`, `InitialSchema.cs:193-203`, model snapshot (+6 `.Designer.cs`). **All four agree exactly.** The web does *not* duplicate — `ScalePicker.tsx:1` imports `SCALE_PRESETS`. |
| Brand palette (22 hex + 3 font stacks) | **2** | `packages/ui/src/tokens.ts:7-50` ↔ `apps/web/src/index.css:14-50`. Byte-identical today; both files document the mirror; nothing tests it. |
| Tier bound 1..4 | **4** | `model.ts:87`, `render.ts:156`, `cli.ts:128`, `RenderService.cs:28` (+ a deliberately narrower 1–3 in `TierPicker.tsx:12`) |
| Default margins 0.5 | **4** | `model.ts:30`, `PageMargins.cs:9`, `RenderService.cs:56`, `client.ts:139` |
| `usgs-topo` id/URL/attribution | **5** | `panel.ts:73-79`, `TileSourceConfiguration.cs:28-39`, migration, snapshot, `MapPreview.tsx:20`, `RenderService.cs:94` |
| OSM tag → `LandmarkCategory` (35 entries) | **2, both C#** | `LandmarkService.cs:144-182` (dictionary) ↔ `OverpassClient.cs:31-46` (query filters). Diffed: agree. Drift is silent in both directions. |

**Already diverged — location CSV, parsed twice.** `LocationCsv.cs` vs
`render-cli/src/locations.ts`, six concrete differences:

1. `locations.ts:94` accepts `name`**|`label`**; `LocationCsv.cs:51` accepts only
   `name`. A `label,lng,lat` file works in the CLI and 400s at the API.
2. `indexOfAny` has **opposite precedence** — C# (`:115-121`) scans header columns,
   TS (`:48-54`) scans alias names. For header `shape,pin,…` they read *different
   columns*.
3. **`Number("") === 0`.** `locations.ts:122` accepts an empty coordinate cell as
   `0` — a location at Null Island. `double.TryParse("")` fails, so the API rejects
   it. Same file, two outcomes. (Likewise `Number("0x10") === 16`.)
4. Scale-id validation: TS validates in-parser against `SCALE_PRESETS` with a row
   number; C# validates afterwards against the DB with none.
5. Every error message string differs; TS throws `Error`, C# throws
   `LocationValidationException` → 400.
6. BOM stripped per-line (TS) vs once per document (C#).

Only the TS parser has tests. `LocationCsv.cs` has none.

**Two inconsistent bbox axis orderings, 40 lines apart in one assembly:**
`OverpassClient.cs:103` emits `(S,W,N,E)`; `NominatimClient.cs:85` emits `(W,N,E,S)`.
Both correct for their API, both hand-written, neither derived from a helper.

## 13. Package graph and build wiring

**The graph is a clean DAG, no cycles.** `atlas-core` and `ui` are leaves;
`render-cli` is the fan-in; `render-worker` and `web` are the roots. Every declared
workspace edge is backed by a real import. **`packages/ui` earns its place** — it is
consumed by `pdf-client/AtlasDocument.tsx:28` *and* by
`apps/web/{LocationPinSvg,PinEditor}.tsx:1`, and `PIN_SHAPES` exists exactly once.
That is the one thing genuinely shared between the printed and on-screen worlds.

Real problems:

- **Missing TS project references.** `pdf-client → ui` is declared in package.json
  and imported, but `pdf-client/tsconfig.json:10` references only `../atlas-core`.
  `apps/web/tsconfig.app.json` has **no `references` array at all**. Both can compile
  against a stale `dist`. `infra/docker/web.Dockerfile:16-18` already works around
  this with `pnpm --filter @journeybook/web... build`.
- **Phantom deps.** `map-sources/package.json:23,28` declare `proj4` and
  `@types/proj4`; the only occurrence of `proj4` in `map-sources/src` is the word
  "proj4" inside a comment at `usng-grid.ts:74`. `pdf-client/package.json:27`
  declares `@types/node` with zero `node:` imports in its src.
- **Undeclared dep.** `atlas-core/src/fixture.test.ts:2-3` imports `node:fs` and
  `node:url`; `@types/node` is not in `atlas-core/package.json`. It resolves only
  through vitest's peer link in the pnpm store — a vitest bump can break the
  typecheck with no code change.
- **`rimraf` is installed nowhere.** Root `package.json:20` `"clean": "pnpm -r exec
  rimraf dist"` cannot work on a fresh install.
- **TypeScript declared three times, two ranges** — root `^5.7.2`, render-worker
  `^5.7.2`, `apps/web` `~5.7.0`.

**No linter or formatter of any kind.** `find` for eslint/prettier/biome configs
returns nothing; no `lint` script in any `package.json`. `harness/checks/lint.sh:2`
says so, and it is **not wired into CI** (`ci.yml` runs `secrets.sh`,
`compose-hardening.sh`, `typecheck-covers-tests.sh` only). The load-bearing ESM
`./model.js` convention is 100% consistent in `packages/*` and `services/*` and
**uniformly violated in `apps/web`** (18 extensionless relative imports) — two
opposing conventions with no marker of which applies where. The only enforcement is
accidental: `services/render-worker/tsconfig.json:8-9` overrides to `NodeNext`, which
makes the compiler require extensions — in one of seven workspaces.

## 14. Test maintenance burden

**Typecheck coverage of tests is genuinely fixed.** Five `tsconfig.test.json` files
relax only *emit* settings (`noEmit`, `composite`, `declaration`) and inherit every
strictness flag from `tsconfig.base.json:12-21`. `typecheck-covers-tests.sh` proves
the file set with `--listFiles` rather than trusting the config, which is the right
design. Verified: `atlas-core` loads 10/10 test files.

Gaps: **`apps/web` is not in that check's workspace list** (`:24-30`) despite having
two test files; `apps/web/playwright.config.ts` and `tests/e2e/create-render.spec.ts`
are **in no tsconfig program at all**; `packages/ui` has no `test` script and its
`pins.ts` (consumed by both renderers) is untested. `harness/checks/test.sh:21` prints
a hardcoded PASS string naming six packages, which would keep saying PASS if one
stopped shipping tests.

**The Playwright spec is in no CI job and no `test` script** (`apps/web` has
`test:e2e`, which nothing calls). `docs/decisions.md:98` already notes it is fully
mocked.

**Golden fixture.** `data/fixtures/sample-atlas.json` is 1.4 KB / 4 pages.
`fixture.test.ts` asserts page count, page ids, and `validateAtlas(...).pass` — which
inherits §5's tautology, so the fixture would validate a freshly-generated *wrong*
atlas as readily as the right one. Its real protective value is close to zero.

**There is no regeneration script and no documented procedure.** No pnpm script, no
shell script, no comment. `docs/decisions.md:310` and `:330` record *that* it was
regenerated; none records *how*. The invocation is `journeybook grid --bbox … --scale
usgs-7-5-min` piped to the file (`cli.ts:274`), with the exact bbox and tier
recoverable only by reverse-engineering the committed coordinates. A furniture change
means: regenerate the JSON by archaeology, then update ~15 hardcoded numbers across
`page.test.ts` (`415`, `549`, `3513.667`, `4648.2`, `1.301`), `grid.test.ts:75-76,
:107, :127, :135` and `route.test.ts:198, :220`. Those anchors are the *only* defence
against §5 — so the answer is not fewer constants, it is a
`pnpm --filter @journeybook/atlas-core regen:fixture` script that records the
invocation.

**`pdf-measure.ts` — the measuring instrument the whole print-fidelity story rests
on — has no test of its own.** Its `cm` matrix composition (`:54-64`), `Do`
unit-square transform (`:282`), y-flip (`:182`) and hex-string decoder (`:134-147`)
are exercised only incidentally.

**Four API test factories: the image is single-sourced, the lifecycle is not.**
Verified — `TestContainerImages.Postgis` (`:16`) is the sole occurrence of
`postgis/postgis:16-3.4` in the test project, and `TilesApiFactory`/`PmTilesApiFactory`
correctly subclass `PostgisApiFactory`. But `RenderApiTests.cs:40`,
`LandmarksApiTests.cs:63` and `GeocodeApiTests.cs:51` each rebuild the container,
credential triple, `MigrateAsync` and disposal verbatim (~20 lines × 3), plus
duplicated constructor comments. All three do only what a `PostgisApiFactory`
subclass could do, and each costs a separate container start — six per
`dotnet test`. The image string still agrees with `docker-compose.yml:13` by
convention only.

**Shape-only tests worth knowing about** (they pass for wrong values):
`overview.test.ts:28-55` (all assertions are "in [0,1]" / "positive" / "length 3");
`render.test.ts` asserts `%PDF` at ten call sites — four blank pages pass;
`tilemath.test.ts:32-42` checks `zoomForBBox` only for monotonicity, never a specific
zoom; `usng-grid.test.ts:15-17` asserts `typeof … === "function"`;
`TierPicker.test.ts:23-28` asserts `label.length > 0`;
`render-route.test.ts:46` asserts `typeof body.attribution === "string"`.
`usng-grid.test.ts:60-99` re-derives expected values with the same
`createUtmProjector` + `lngLatToPanelFraction` the code calls — its `1e-6` tolerance
measures "did you call the same function", not "is the grid in the right place"
(the file says so at `:61`, honestly).

## 15. Config duplication

**Copy-pasted; a change costs N edits:**

| Value | N | Notable |
|---|---|---|
| `.NET version` | **9** | `ci.yml:85,100`, `api.Dockerfile:4,24`, 5× csproj TFM. **No `global.json` and no `Directory.Build.props`** — yet `.config/dotnet-tools.json:5-9` pins `dotnet-ef` to `10.0.9` with `rollForward: false`. The tool is pinned harder than the SDK hosting it. |
| `data/generated` | **6** | incl. **three independent C# fallbacks**: `appsettings.json:20`, `GeneratedPdfService.cs:27`, `GeneratedPdfEndpoints.cs:43` |
| API port 5180 | **6** | compose, `.env.example`, launchSettings ×2, `vite.config.ts:9`, README ×4 |
| render-worker port 8090 | **5** | `server.ts:5`, Dockerfile `:31,33,36`, compose `:52,77,84`, `DependencyInjection.cs:78`, a test |
| connection string literal | **3** | `appsettings.json:10`, `DependencyInjection.cs:38`, `DependencyInjectionTests.cs:18` |
| `data/cache` | **3** | two independent C# defaults (`DependencyInjection.cs:49`, `TileCache.cs:19`); **not in `appsettings.json` at all** |
| CORS origins | **3** | `appsettings.json:16` and `Program.cs:30` hold the identical two-element array |

Two config traps worth naming:

- **The documented hybrid dev path is broken.** `appsettings.json:10` still ships
  `Password=journeybook`, while `docker-compose.yml:20` now *requires* an operator
  `POSTGRES_PASSWORD`. `README.md:72-73` documents `docker compose up db` then
  `dotnet run --project apps/api` — which now fails authentication. A correct
  security fix left a stale default two files away.
- **`8080` means two different things.** Container-internal API port
  (`api.Dockerfile:28`, `web-nginx.conf:14`) and host web port
  (`docker-compose.yml:97`). `docker-compose.yml` uses both meanings, at `:55` and
  `:48`.
- `TileCache:PmTilesDir` defaults to `data/map-packages` (`PmTilesFetcher.cs:17`), a
  path in no config file and with **no compose volume mount** — non-persistent in the
  shipped stack.

**Genuinely single-sourced (good):** the PostGIS image across test factories; the
admin key via `PostgisApiFactory.AdminKey`; the pnpm version via `packageManager`
consumed by `pnpm/action-setup` with no version argument; the web→API base URL
(relative paths only — `grep import.meta.env apps/web` returns **zero hits**, dev
proxy in `vite.config.ts:20-23` mirrors `web-nginx.conf:13-25` exactly); pin geometry
in `packages/ui/src/pins.ts`.

**Two CI/README mismatches:** `README.md:60` says `pnpm build`, but root
`package.json:16` filters to `./packages/*` — so the documented local build is a
strict subset of CI's `pnpm -r build`, and a break in `render-worker` or `apps/web`
is invisible locally. `README.md:70` runs `dotnet test dotnet/JourneyBook.Tests` with
no filter, requiring Docker, contradicting both `forge-project.json:22` and
`ci.yml:88-91`.

## 16. Smaller items

- `buildUsngGrid(bbox, _panelWidthPx, _panelHeightPx)` — **both size parameters are
  unused** (`usng-grid.ts:62-63`). Callers must pass two numbers that do nothing;
  `render.ts:473` maintains a `PANEL_PX = 1000` constant for them, unlinked from
  `render.ts:436`'s `panelWidthPx`.
- `effectiveDpi` (`validation.ts:106`) is exported and tested and used by no
  production code. Its test asserts `1125/7.5 === 150` — arithmetic.
- `apps/web/src/components/Hero.tsx` (238 lines) is imported by nothing.
- Web project export/import loses data: `ProjectListPage.tsx:69-83` writes
  `orientation` and `overlap` into the backup; `:106-108` restores only `name`,
  `scalePresetId`, `extent`.
- `RenderService.cs:109` sets `IncludeLandmarks: landmarks.Count > 0` — not the
  caller's flag, which was already consumed at `:82`. The same boolean now means two
  things at two hops.
- `LocationPinSvg.tsx:17,34` hardcodes `#ede4cf` — which is `brand.parchment`, from a
  module the file already imports on line 1.
- `PmTilesReaderTests` is declared as a class name in two files
  (`PmTilesReaderTests.cs:6` and `Api/PmTilesTilesApiTests.cs:12`).
- `"fixture.pmtiles"` is written twice (`PmTilesApiFactory.cs:15`,
  `PmTilesFixture.cs:89`).
- `pnpm-workspace.yaml` lists `apps/web` explicitly rather than `apps/*`; a second JS
  app under `apps/` would silently not be a workspace member.

---

## What is already well built

This is a genuinely well-maintained codebase, and several things are better than the
audit history would lead you to expect.

- **The print-geometry fix was done properly, not patched.** `PAGE_FURNITURE_PT` is
  one object, imported by both packages; the panel is sized *explicitly* rather than
  left to flex; every furniture block is fixed-height and non-shrinking; the notes
  block is reserved whether or not it is drawn. The comments explain the failure mode
  rather than the mechanics. The measured result (415.00 × 549.00 pt on every page,
  1:24,008 against a claimed 1:24,000) is real.
- **`pdf-measure.ts` is the right kind of tool.** A 337-line content-stream
  interpreter that imports only `node:zlib` and knows nothing about the layout it
  measures. Its only baked-in constants are PDF-spec facts. The scale-bar detector
  (`scale-fidelity.test.ts:103-113`), which identifies the bar by a two-rect
  signature rather than by position, is a nice piece of work.
- **The five-variant map-box loop** (`scale-fidelity.test.ts:164-179`) is the single
  most valuable test in the repo — it is the one that makes the flagship bug
  un-reintroducible by the route it originally took.
- **ADR 0004 is actually held.** An exhaustive search found zero geometry maths in
  C#. The landmark split (fetch/rank/persist in C#, per-page spatial selection and
  collision avoidance in TS) is a genuinely well-drawn boundary.
- **The package graph is a clean DAG** with no cycles and no unused packages. `ui`
  earns its separation by being the one thing shared between the PDF renderer and the
  web app.
- **`typecheck-covers-tests.sh`** proves its property with `--listFiles` instead of
  trusting a config file. That is the right instinct, and rare.
- **The security fixes are thoughtful.** `TileEgressPolicy` in a `ConnectCallback`
  (checking the address actually connected to, on every redirect hop) rather than a
  URL-string check; `AdminApiKeyGate` failing *closed*; the exception handler
  discarding messages and logging them instead. Each is documented with what it does
  *not* stop.
- **Comment quality is unusually high** — they explain why a constant is 10% and not
  0%, why the UA string exists, why a `Do` operator's degenerate curves are tolerated.
  There is not a single `TODO`/`FIXME`/`HACK` in the repo.
- **`docs/decisions.md` is a real engineering record**, with symptom/fix/surfaces/
  watch/commit on every entry and a pre-commit hook enforcing it. Its `Watch:` lines
  repeatedly anticipated exactly the fragility this scan found (`:310` names the
  `PAGE_FURNITURE_PT` cross-package contract precisely).
- **`ci.yml` is well-reasoned** — the job split is explained, the pnpm version cannot
  drift, and the Docker job fails legibly via `docker info` rather than inside a
  hundred `DockerUnavailableException` traces.

---

## Suggested order

1. **§1** — pixel-content assertions on the panel crop. This is the last unmeasured
   link in the chain the product is sold on, and the cheapest way to close it.
2. **§4** — one line: assert the height axis against paper.
3. **§7** — use `OverlaySvg` and drop `objectFit: "cover"` on the overview page.
4. **§5 / §9** — relabel `validateAtlas` honestly and put a "historical record"
   header on `staged-build-roadmap.md`. Documentation, but it is documentation that
   actively misleads about print fidelity.
5. **§8** — commit the ADR text (one `.gitignore` line) and add the no-trig-in-C#
   assertion.
6. **§2 / §3** — decide margins/orientation: wire them through, or delete them from
   the API and the UI. The current state is the worst of both. Note **§2's casing
   trap** before wiring.
7. **§6** — make `zoomForBBox` source-aware, or record the 173-DPI ceiling as a known
   limit.
8. **§13 / §15** — a linter, the two missing project references, `Directory.Build.props`.

**Where a wrong refactor is silent and expensive:** `panel.ts:367-388`
(crop/composite), `page.ts:86-115` (the furniture sums), `tilemath.ts`,
`atlas-core/projection.ts`, and `AtlasDocument.tsx:642-696` (the panel row). Changes
here do not throw — they print a map that looks right and is not. Land a failing test
first in every case.
