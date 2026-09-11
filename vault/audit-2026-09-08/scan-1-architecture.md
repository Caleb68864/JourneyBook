# Scan 1 — Architecture

Audit started: 2026-09-08 against `c36f69f`.
**Re-verified and rewritten: 2026-09-10 against `9cfec8c`** (`Merge branch 'fix/scan-2-gaps'`).

The tree moved under this audit while it was running — a parallel "scan 2" pass landed ~14 commits,
including fixes to the render path and the web client. Every finding below was re-checked against
`9cfec8c` and every file:line was re-pinned. Three original findings were fixed by that pass and are
recorded in *Already fixed* rather than deleted, so a reader can see they were examined, not missed.

Scope: package boundaries + dependency graph, the render pipeline end to end, .NET layering,
cross-language duplication, dead stubs, and `AtlasContract` drift. Read against real code.
Nothing was modified by this pass.

---

## Map

### TypeScript workspace (`pnpm-workspace.yaml`: `apps/web`, `packages/*`, `services/*`)

```
                       @journeybook/atlas-core        (proj4; no workspace deps — the root)
                        │            │        │
        ┌───────────────┘            │        └──────────────┐
        ▼                            ▼                       ▼
@journeybook/map-sources      @journeybook/pdf-client   @journeybook/web (apps/web)
 (sharp, mgrs, proj4*)          │  └── @journeybook/ui ──────┘
        │                       │            (no deps; pure tokens + pin shapes)
        └───────────┬───────────┘
                    ▼
        @journeybook/render-cli   (atlas-core + map-sources + pdf-client)
                    │
                    ▼
        @journeybook/render-worker (services/render-worker; render-cli + fastify)
```

* No cycles. Every cross-package dep uses `workspace:*`. Build order is a clean DAG
  (`ui`, `atlas-core` → `map-sources`, `pdf-client` → `render-cli` → `render-worker`).
* `packages/ui` **is** consumed — `pdf-client/src/AtlasDocument.tsx` and
  `apps/web/src/components/{PinEditor,LocationPinSvg}.tsx`. Not dead.
* `proj4` in `packages/map-sources/package.json:23` is declared but never imported (F13).
* No phantom deps: every non-relative import in `packages/*/src` and `services/*/src` resolves to a
  declared dependency or `node:`/`@types/node`.
* TS project references are now complete (`pdf-client` → `ui` was added by the scan-2 pass).
* `services/geo-worker/` and `services/questpdf-renderer/` are `.gitkeep`-only placeholders matched
  by the `services/*` workspace glob but carrying no `package.json` (F13).

### .NET

```
apps/api (Web SDK, minimal APIs)
  ├─ ProjectReference → JourneyBook.Application  (interfaces + DTOs ONLY)
  └─ ProjectReference → JourneyBook.Infrastructure (EF Core/Npgsql/NTS, ALL service impls)
                          ├─ → JourneyBook.Application
                          └─ → JourneyBook.Domain (entities, enums, value objects; NTS only)
```

Reference direction is correct (nothing points inward-out). The leak is behavioural, not
structural: `AddApplication()` registers nothing and every use case lives in Infrastructure (F03).

### Render pipeline (concrete trace, `9cfec8c`)

```
CLI:  cli.ts:runCli → inputFromArgs (flags, --locations file via locations.ts:loadLocationsFile)
API:  RenderEndpoints.cs → RenderService.cs:23 (Project + PageGrid + Extent + Locations + Landmarks)
        → HttpRenderWorkerClient.cs ToWirePayload (now carries orientation + margins)
        → POST /render → render-route.ts:42 → renderAtlas
                        │
                        ▼
render.ts renderAtlas → assembleContract
  ├─ validateInput (tier, overlap, bbox/center, orientation, margins, panel knobs, tileBaseUrl)
  ├─ pageSpecOf (render.ts:333) → sheet = LETTER dims, orientation/margins from input
  ├─ mode "bbox" → atlas-core/grid.ts buildPageGrid → ids A1…
  │   or  cover  → atlas-core/extent.ts enclosingBBox → buildPageGrid
  ├─ per location → grid.ts:58 buildLocationPage → L1 / L1a,L1b (zoom ladder)
  │      page bbox ← projection.ts pageBBoxAround ← page.ts groundFootprintMeters ← scale.ts
  ├─ route → route.ts:153 buildRouteAtlas → R1…Rn
  └─ MAX_ATLAS_PAGES (200) guard → AtlasContract { version, scale, margins, pages[] }
  ├─ basemap: per page → map-sources/panel.ts renderMapPanel
  │      → tilemath.ts zoomForBBox / tileRangeForBBox
  │      → tilecache.ts:35 getCachedTile / fetch → sharp mosaic → crop → JPEG/PNG data URI
  ├─ tier ≥ 3 → map-sources/usng-grid.ts buildUsngGrid (UTM projector + mgrs collar)
  ├─ route pages → Liang-Barsky clip → RouteOverlay (normalized 0..1)
  ├─ landmarks → atlas-core/landmarks.ts selectPageLandmarks (bucket + label declutter)
  ├─ overview → map-sources/overview.ts buildAtlasOverview (+ its own basemap panel)
  └─ pdf-client renderAtlasPdfToFile → AtlasDocument.tsx (Overview → TOC → pages)
```

Validation path: `cli.ts validate` → `atlas-core/validation.ts validateAtlas`
(footprint-vs-scale within 0.5 %, neighbour reciprocity).

---

## Already fixed by the scan-2 pass (verified at `9cfec8c`, no action needed)

* **Persisted margins/orientation never reached the engine.** `RenderAtlasInput` now declares
  `margins?`/`orientation?` (`render.ts:84,89`) with validation (`:191,:196`), consumed via
  `pageSpecOf` (`render.ts:333-338`); `HttpRenderWorkerClient.cs:70-71` now sends `Orientation` +
  `Margins` with a `WorkerMargins` record and case conversion (`:101,:106`).
* **Square 1000×1000 `viewBox` over a non-square panel.** Overlays now use
  `viewBox={\`0 0 ${box.width} ${box.height}\`}` (`AtlasDocument.tsx:235`) with the
  `preserveAspectRatio="meet"` reasoning documented at `:199,:227`.
* **`pdf-client` missing a TS project reference to `../ui`.** Now
  `"references": [{ "path": "../atlas-core" }, { "path": "../ui" }]`.

---

## Findings

### F01 — Grid page ids collide with the `L#`/`R#` namespaces the renderer dispatches on
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:53-54`
(`pageLabel` = row letter + column number) produces `"L1"` at row index 11 and `"R1"` at row index 17.
Those exact strings are also minted by `grid.ts:58` (`buildLocationPage`, `L#`) and
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/route.ts:153` (`R${i + 1}`). The engine and
renderer then branch on the id's first character:
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:583`
(`if (!page.id.startsWith("R")) continue;`),
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:708`
(`route && page.id.startsWith("R")`) and `:717` (`page.id.startsWith("L")` → draw a centre pin).
**Why it matters** A 12-row grid (≈66 km N–S at 1:24,000 — well inside the 200-page cap) emits a page
literally named `L1`, and the PDF stamps a location pin at its centre. For a project with both an
extent and locations (a case the client explicitly supports), the contract carries **two pages with
the same id**, which corrupts the `pageNumbers` map in `AtlasDocument.tsx` (last write wins), the TOC
page numbers, and the `byId` map in `validation.ts`, so `neighbor-reciprocity` can pass or fail
against the wrong page. Page ids are the atlas's primary key and its type discriminator at once.
**Blast radius** 3 **Effort** S **Impact** 4 **Regression risk** med
**First step** Add a failing test in `packages/atlas-core/src/grid.test.ts` asserting `buildPageGrid`
over an 18-row extent yields no id matching `/^[LR]\d/`; then either prefix grid ids (`G-A1`) or add
an explicit `kind: "grid" | "location" | "route"` to `AtlasPage` and replace every `startsWith`
dispatch with it.

### F02 — The Application layer is an empty shell; every use case lives in Infrastructure
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/DependencyInjection.cs:12-16`
returns `services` unchanged (the only registration is commented out, "Stage 2+"). All service
implementations sit in Infrastructure and are registered there —
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:43,86,106`
— each taking `JourneyBookDbContext` directly, e.g.
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs:12`
and `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:23`
(orchestration + business rules over EF `Include` chains).
**Why it matters** The project bills itself as Clean Architecture (CLAUDE.md, csproj graph, three
libraries) but the Application layer holds only interfaces and DTOs. `RenderService` — the richest
piece of business logic in the backend (validation, lifecycle, tile-proxy policy, failure
classification) — is welded to EF Core, so it is reachable only through Testcontainers PostGIS.
`DependencyInjectionTests` "proves the layered wiring is intact" by resolving a DbContext, which is
precisely the coupling in question. Documented as the "Stage 2B" pattern, so this is a deliberate
trade-off — but it leaves the Application project as ceremony.
**Blast radius** 4 **Effort** L **Impact** 3 **Regression risk** med
**First step** Do not relayer everything. Move `RenderService` alone into
`JourneyBook.Application/Rendering/`, behind a narrow `IProjectRenderData` query port implemented in
Infrastructure; that yields a unit-testable orchestrator and makes `AddApplication()` non-empty,
establishing the shape for the rest.

### F03 — The render worker trusts the entire engine input from the wire, unvalidated
**What & where** `/home/caleb/Projects/JourneyBook/services/render-worker/src/render-route.ts:75`
(`renderAtlas({ ...(body as RenderAtlasInput), outputPath: fullOutputPath })`). Fastify is registered
with no JSON schema — only `bodyLimit`/`requestTimeout` in `server.ts`. The route hand-checks four
fields plus `outputPath` traversal, then forwards everything else verbatim.
**Why it matters** `outputPath` is carefully confined, but `cacheDir` is not: spread straight into
`renderAtlas`, it flows to `packages/map-sources/src/tilecache.ts:58 storeCachedTile`, which will
`mkdir -p` and write tile bytes to **any absolute path on the worker's filesystem**. `tileBaseUrl` is
only weakly guarded (any `http(s)` host — outbound SSRF from inside the compose network), and
`panelWidthPx` up to 8000 × 200 pages is an unbounded resource request. The worker is
unauthenticated by design (compose `expose`, not `ports`), so the API is the only thing between a
client and this surface — yet the two disagree about what the contract is: the API never sends
`cacheDir` or `panelWidthPx`, so nothing legitimate would break by refusing them.
**Blast radius** 3 **Effort** S **Impact** 4 **Regression risk** low
**First step** Attach a Fastify JSON schema to `POST /render` listing exactly the fields the API
sends, with `additionalProperties: false`; drop `cacheDir` from the accepted set entirely and read it
from `process.env.TILE_CACHE_DIR` instead.

### F04 — Location CSV parsing is implemented twice, in two languages, and has already diverged
**What & where** `/home/caleb/Projects/JourneyBook/packages/render-cli/src/locations.ts:85`
(`parseLocationsCsv`, 233 lines) and
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Locations/LocationCsv.cs:44`
(`Parse`, 164 lines) — same header aliases, same quote handling, same all-or-nothing aggregation,
near-identical error strings ("CSV has a header but no location rows.").
**Why it matters** Both docblocks claim "one file works in both", which is already false: the TS side
accepts `label` as an alias for `name` and validates `scale`/`zoom` ids against `SCALE_PRESETS` at
parse time; the C# side does neither (it defers id validation to `LocationService`). A CSV that
imports cleanly in the web app can fail in the CLI and vice versa, and every future column must be
added twice.
**Blast radius** 3 **Effort** M **Impact** 3 **Regression risk** low
**First step** Write one shared fixture set under `data/fixtures/` (valid + one file per error class)
and run it through both parsers in their respective suites. That pins current behaviour and makes the
divergences fail loudly, before deciding which side becomes canonical.

### F05 — Scale presets are declared in three places with no consistency check
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:55`
(`SCALE_PRESETS`, the CLAUDE.md-declared source of truth),
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Persistence/Configurations/ScalePresetConfiguration.cs:17`
(EF `HasData` seed, comment: "Seed matches SCALE_PRESETS"), and the baked copy inside
`dotnet/JourneyBook.Infrastructure/Migrations/20260624165320_InitialSchema.cs`.
**Why it matters** `ProjectService.EnsureScalePresetAsync` and `LocationService.ValidateZoomLevelsAsync`
validate against the DB copy, while `assembleContract` and `resolveScaleOrThrow` validate against the
TS copy. Adding a preset to one side yields a project the API accepts and the engine rejects with
`Unknown scalePresetId`, classified into an HTTP status only by prefix string-matching in the worker.
Three hand-synchronised copies of reference data with no test asserting they agree.
**Blast radius** 3 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add a test in `dotnet/JourneyBook.Tests` that reads the preset ids from
`packages/atlas-core` (directly, or via a small JSON the `atlas-core` build emits) and asserts the
seeded `ScalePresets` table matches id-for-id.

### F06 — Tile fetching and the disk cache are implemented independently in C# and TypeScript
**What & where** C#: `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/TileCache.cs`
(+ `RasterXyzFetcher.cs`, `TileService.cs:14`). TS:
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/tilecache.ts:35,58` (+ the inline
`fetchTile`/`loadTile` in `panel.ts`). Both implement the same `{source}/{z}/{x}/{y}.{ext}` key, the
same "discover whichever `{y}.*` exists" lookup, the same resolved-path `startsWith(root + sep)`
confinement, and the same atomic temp-file rename.
**Why it matters** Duplication by design (the CLI and API are meant to share one cache directory), so
not a mistake — but it costs twice and the copies already differ:
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:298` stores every fetched tile
with a hardcoded `"png"` extension regardless of the real content type, while `TileService.cs` derives
the extension from the response `Content-Type`. A JPEG tile cached by the CLI is filed as `.png` and
the C# proxy will later serve it as `image/png`. In the deployed topology the TS cache is dead weight
anyway: `RenderService` routes the worker through the C# proxy, and `docker-compose.yml` does not
mount `data/cache` into the worker at all.
**Blast radius** 3 **Effort** M **Impact** 2 **Regression risk** low
**First step** Cheapest correctness fix now: derive the real extension from the fetch response and
pass it into `storeCachedTile` at `panel.ts:298`. Then decide whether the TS cache stays a CLI-only
convenience or is deleted in favour of always proxying.

### F07 — The ADRs the codebase treats as binding are still missing
**What & where** `/home/caleb/Projects/JourneyBook/.gitignore:170-176` is `docs/*` /
`!docs/decisions.md` / `!docs/decisions/`. The scan-2 pass added the `!docs/decisions/` exception and
the directory now exists — but it contains only `0006-asynchronous-rendering.md` and `README.md`.
ADRs **0003, 0004 and 0005** are still absent, while being cited as authority in `CLAUDE.md` ("The API
owns no geometry/render (ADR 0004/0005)"), in code
(`packages/map-sources/src/panel.ts` → "See docs/decisions/0003-map-panel-rendering.md";
`dotnet/JourneyBook.Infrastructure/GeneratedPdfs/GeneratedPdfService.cs` → "ADR 0004") and in
`scripts/render-fidelity-check.mjs` ("See ADR 0005").
**Why it matters** The single most important invariant in this project — geometry lives in TS, never
in C# — is enforced only by a CLAUDE.md sentence and reviewer memory. The ignore rule is now fixed, so
this is purely a matter of writing the three documents everything already points at.
**Blast radius** 4 **Effort** XS **Impact** 3 **Regression risk** low
**First step** Write `docs/decisions/0004-geometry-in-typescript.md` first — it is the one every other
finding leans on — then 0003 and 0005 to match their existing citations.

### F08 — The API cannot render without a basemap, and cannot control panel resolution
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs:153`
and `:180` both hardcode `Basemap: true`. The wire payload record (`:41`) has no `panelWidthPx` /
`panelFormat` / `panelQuality`, so the worker always falls back to the engine defaults (1000 px, JPEG
q90). `RenderProjectRequest` in
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Rendering/RenderDtos.cs` exposes
seven furniture toggles but none of these.
**Why it matters** Every API render performs a full tile fetch — the slowest, most failure-prone part
of the pipeline. There is no way for the web app to produce a fast line-art preview and no way to
raise DPI for a print run, even though the engine supports both and the CLI exposes both
(`--panel-px`, `--panel-format`, `--panel-quality`). The capability exists and is simply not plumbed:
a headless-first project whose UI can reach less than its own CLI.
**Blast radius** 2 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add `Basemap`, `PanelWidthPx` and `PanelFormat` through `RenderProjectRequest` →
`RenderWorkerRequest` → the wire payload with today's values as defaults; assert the serialized body
in `HttpRenderWorkerClientTests`.

### F09 — `AtlasContract` has no page size, so the validator hardcodes Letter
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:139`
(`AtlasContract` = version/scale/margins/pages — no sheet dimensions). Consumers therefore re-supply
the sheet themselves: `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:104-105`
(`widthIn: 8.5, heightIn: 11`),
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:177`
(`mapBoxInches({ widthIn: 8.5, heightIn: 11, … })`), and `render.ts:335-336`
(`LETTER_PORTRAIT.widthIn/heightIn`).
**Why it matters** The contract is documented as the one artefact flowing engine → renderer →
validator, yet a page's most basic property travels out of band in three independent copies of
"8.5 × 11". The scan-2 pass correctly moved *margins and orientation* into the contract's input path
but left sheet size behind, so the gap is now the odd one out. Any A4 support would be a three-place
change with a validator that silently compares an A4 page's footprint against Letter's expectation
and fails `scale-consistency` with a misleading message. Latent design gap, not a live bug — only
Letter is supported today.
**Blast radius** 2 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add `sheet: { widthIn, heightIn }` to `AtlasContract` (defaulted to Letter in
`assembleContract`), consume it in `validation.ts` and `AtlasDocument.tsx`, and delete the literals.

### F10 — `AtlasPage` / grid-derivation schema is dead: tables and columns nothing ever writes
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Domain/Entities/AtlasPage.cs`
(entity, "the table exists from Stage 2A so derivation has somewhere to write"),
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Persistence/JourneyBookDbContext.cs:18`
(`DbSet<AtlasPage>`),
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Persistence/Configurations/ProjectAggregateConfigurations.cs:71-86`
(full config including a unique index on `(PageGridId, Label)`), plus
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Domain/Entities/AtlasPageGrid.cs:22-23`
(`Rows`/`Columns`). Neither `RenderService` nor `ProjectService` — the only plausible writers —
references `AtlasPages`, `Rows` or `Columns` anywhere.
**Why it matters** Clearly *stub, not built yet* rather than broken — but it is schema, a migration
and an index carried by every deploy for a derivation step that ADR 0004 says will never live in C#
anyway (the engine derives pages and hands them straight to the renderer). It misleads readers into
thinking pages are persisted and reusable across renders; they are recomputed every time.
**Blast radius** 2 **Effort** S **Impact** 2 **Regression risk** low
**First step** Decide the intent explicitly. Either add a decision-log entry that `AtlasPage` is a
reserved future table, or drop the entity, its configuration and `Rows`/`Columns` in one migration.

### F11 — The worker rejects an input shape the engine accepts (`mode:"location"` without `center`)
**What & where** `/home/caleb/Projects/JourneyBook/services/render-worker/src/render-route.ts:48`
returns 400 for `mode === "location" && !body.center`. The engine explicitly permits it —
`render.ts` requires `center` *only* when `locations` is empty, resolving the location list first.
**Why it matters** The worker enforces a stricter, older contract than the engine it wraps, so a valid
`{mode:"location", locations:[…]}` request is refused at the edge. It works today only because
`HttpRenderWorkerClient` defensively duplicates the first location into `center` ("passing the first
as `center` for legacy validation"). Two components hold two definitions of a required field and a
third works around both.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Change the guard to `mode === "location" && !body.center && !body.locations?.length`,
add a `render-route.test.ts` case for locations-without-center, then delete the legacy `center`
duplication in `ToWirePayload`.

### F12 — Four representations of a bounding box, and landmarks depend on the *rendering* one
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Projects/ProjectDtos.cs`
declares `BBoxDto(West, South, East, North)`;
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Rendering/RenderDtos.cs` declares
`RenderBBoxDto(West, South, East, North)` — identical shape, same assembly. The landmark feature
depends on the rendering one:
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Landmarks/IOverpassClient.cs` opens
with `using JourneyBook.Application.Rendering;` and takes `RenderBBoxDto`, as does
`ImportLandmarksRequest` in `Landmarks/LandmarkDtos.cs` ("reusing the rendering extent contract").
TS adds a third form (`BBox` tuple `[W,S,E,N]`) and the web client a fourth (`ApiBBox`).
**Why it matters** A feature-scoped *rendering* DTO has become an implicit shared kernel: any change
to the render extent contract is a breaking change to the Overpass client and the landmark import API,
for no reason other than that it was there first. The `BBoxDto`/`RenderBBoxDto` pair also means two
identical records drift independently within one assembly.
**Blast radius** 2 **Effort** S **Impact** 2 **Regression risk** low
**First step** Promote one `BBoxDto` to a shared `JourneyBook.Application.Common` namespace and have
Projects, Rendering and Landmarks all reference it; delete `RenderBBoxDto`.

### F13 — Stage-0 residue in `map-sources`: an unused dependency and a dead type registry
**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/package.json:23,28` declare
`proj4` and `@types/proj4`; there is no `proj4` import anywhere under `packages/map-sources/src/`
(the real projector comes from `atlas-core`).
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/index.ts:9,19,33` export `TileFormat`,
`TileSource` and `composeAttribution` — described in the file header as a "Stage 0 skeleton …
attribution stub" — none imported outside that file. `TileSource`/`TileCachePolicy` duplicate
`dotnet/JourneyBook.Domain/Entities/TileSource.cs` and
`dotnet/JourneyBook.Application/TileSources/TileSourceDtos.cs` (the real registry), and the actual
attribution string is hardcoded in `AtlasDocument.tsx`. Other unused public surface: `effectiveDpi`
(`validation.ts`), `renderAtlasPdfToBuffer` (`pdf-client/index.ts`), `LETTER_PORTRAIT_PT`
(`model.ts:15`), and the four `*_VERSION` constants. `services/geo-worker/` and
`services/questpdf-renderer/` hold only `.gitkeep`.
**Why it matters** A third `TileSource` shape invites someone to wire up the wrong one, and a
declared-but-unused dependency draws audit and upgrade churn for a library the package never loads.
Small individually; together they blur what `map-sources` actually owns.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Drop `proj4`/`@types/proj4` from `packages/map-sources/package.json` and run
`pnpm -r typecheck`; delete the `TileSource`/`TileFormat`/`TileCachePolicy`/`composeAttribution` block
from `map-sources/src/index.ts` in the same change.

### F14 — The root `build` script builds a different set of packages than the documented command
**What & where** `/home/caleb/Projects/JourneyBook/package.json:16`:
`"build": "pnpm -r --filter \"./packages/*\" run build"`. CLAUDE.md's Commands section and
`/home/caleb/Projects/JourneyBook/harness/checks/build.sh` both run `pnpm -r build`.
**Why it matters** `pnpm build` at the root silently skips `services/render-worker` and `apps/web`, so
a change that breaks the worker's compile passes the root script and only fails in the harness or in
Docker. Two build entry points with different coverage is what makes "it built locally" untrustworthy.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Change the root script to `pnpm -r run build` (or have `build.sh` invoke `pnpm build`)
so there is exactly one definition of "the build".

### F15 — `ITileFetcher` is an Infrastructure abstraction that consumes an Application DTO
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/ITileFetcher.cs:13`
lives in Infrastructure while its sibling `ITileService` lives in
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Tiles/ITileService.cs:36`. Its method
takes `TileSourceResponse` — an Application *response DTO* — as its input (`ITileFetcher.cs:17`, used
by `RasterXyzFetcher` and `PmTilesFetcher`). Registration is also unusual:
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:79,84`
calls `AddScoped<ITileFetcher>` twice, which works only because `TileService.cs:14` injects
`IEnumerable<ITileFetcher>`; any `GetRequiredService<ITileFetcher>()` would silently get only
`PmTilesFetcher`.
**Why it matters** A read-model DTO is the internal contract between two infrastructure components, so
any change to the tile-source *API response* is a breaking change to the *fetcher* interface. And the
abstraction/implementation split for tiles is inverted relative to every other feature (all of which
put `I<X>` in Application), making the convention unlearnable from the code.
**Blast radius** 2 **Effort** S **Impact** 2 **Regression risk** low
**First step** Introduce a small `TileSourceDescriptor` record (key, url, kind, maxZoom) in
Infrastructure, change `ITileFetcher.FetchAsync` to take it, and map from `TileSourceResponse` once,
in `TileService`.

---

## Notes on what is healthy (so a later pass does not re-litigate it)

* The TS dependency graph is acyclic, `workspace:*` throughout, with no phantom imports and now
  complete project references.
* `atlas-core` genuinely is the geometry monopoly. Verified by reading every C# file in Domain,
  Application and Infrastructure (recursive grep is unusable in this repo — see below): no projection,
  scale, or tile math anywhere in C#. `LandmarkService` does tag-mapping and scalar scoring;
  `OverpassClient` only formats a bbox into a query string; `LocationService`/`ProjectService` only
  construct NTS `Point`/`Polygon` at SRID 4326. The one piece of C# "tile math" is
  `PmTilesReader.ZxyToTileId` — a Hilbert curve required by the PMTiles archive format, not map
  projection — which does not violate the CLAUDE.md constraint.
* Minimal-API endpoints are genuinely thin: every handler in `apps/api/Endpoints/*.cs` maps a service
  result to a status code and nothing else. The only Infrastructure type reaching the API is
  `JourneyBookDbContext` in the `/health/db` readiness probe — acceptable.
* No `NotImplementedException`, `TODO` or `FIXME` in the C# or TS source.
* Path-traversal confinement is implemented consistently and correctly in four independent places
  (`TileCache.cs`, `tilecache.ts`, `GeneratedPdfEndpoints.cs`, `render-route.ts`).
* No build artefacts are tracked in git (`dist/`, `bin/`, `obj/`, `data/cache/` all ignored).

### Tooling note for the next pass

Recursive `grep -r` / `find` from the repo root (and even scoped to `dotnet/`) reliably times out at
>120 s here — `data/cache/` holds tens of thousands of tile PNGs and `bin`/`obj` trees compound it.
Single-file `cat`/`grep` is fast. Use `git ls-files`-free, explicitly-listed file paths, or prune
aggressively; budget accordingly.
