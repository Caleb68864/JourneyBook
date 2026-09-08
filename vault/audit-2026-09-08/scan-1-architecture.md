# Scan 1 — Architecture

Audit date: 2026-09-08 · Head: `c36f69f feat(locations): zoom ladders and pins through the backend and web app`

Scope: package boundaries + dependency graph, the render pipeline end to end, .NET layering,
cross-language duplication, dead stubs, and `AtlasContract` drift. Read against real source, not docs.
Nothing in this pass was modified.

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
* `packages/ui` **is** consumed — `pdf-client/src/AtlasDocument.tsx:26` and
  `apps/web/src/components/{PinEditor,LocationPinSvg}.tsx`. Not dead.
* `proj4` in `packages/map-sources/package.json:20` is declared but never imported (finding F13).
* No phantom deps found: every non-relative import in `packages/*/src` and `services/*/src`
  resolves to a declared dependency or `node:`/`@types/node`.
* TS project references are *incomplete*: `packages/pdf-client/tsconfig.json` references only
  `../atlas-core` despite depending on `@journeybook/ui` (F11).
* `services/geo-worker/` and `services/questpdf-renderer/` are `.gitkeep`-only placeholders
  matched by the `services/*` workspace glob but carrying no `package.json` (F13).

### .NET

```
apps/api (Web SDK, minimal APIs)
  ├─ ProjectReference → JourneyBook.Application  (interfaces + DTOs ONLY)
  └─ ProjectReference → JourneyBook.Infrastructure (EF Core/Npgsql/NTS, ALL service impls)
                          ├─ → JourneyBook.Application
                          └─ → JourneyBook.Domain (entities, enums, value objects; NTS only)
```

Reference direction is correct (nothing points inward-out). The leak is behavioural, not structural:
`AddApplication()` registers nothing and every use case lives in Infrastructure (F03).

### Render pipeline (concrete trace)

```
CLI:  cli.ts:runCli → inputFromArgs (flags, --locations file via locations.ts:loadLocationsFile)
API:  RenderEndpoints.cs:9 → RenderService.cs:22 (loads Project+PageGrid+Extent+Locations+Landmarks)
        → HttpRenderWorkerClient.cs:82 ToWirePayload → POST /render
        → render-route.ts:42 → renderAtlas
                        │
                        ▼
render.ts:426 renderAtlas
  └─ render.ts:288 assembleContract
       ├─ validateInput (render.ts:155)
       ├─ mode "bbox"  → atlas-core/grid.ts:73  buildPageGrid   → page ids A1…
       │   or  cover   → atlas-core/extent.ts:19 enclosingBBox → buildPageGrid
       ├─ per location → atlas-core/grid.ts:32  buildLocationPage → L1 / L1a,L1b (zoom ladder)
       │        each page bbox ← projection.ts:93 pageBBoxAround ← page.ts:54 groundFootprintMeters
       │                                                        ← scale.ts:10 metersPerInch
       ├─ route        → atlas-core/route.ts:79 buildRouteAtlas → R1…Rn
       └─ MAX_ATLAS_PAGES (200) guard → AtlasContract { version, scale, margins, pages[] }
  ├─ basemap: per page → map-sources/panel.ts:138 renderMapPanel
  │      → tilemath.ts:40 zoomForBBox → tilemath.ts:76 tileRangeForBBox
  │      → tilecache.ts:23 getCachedTile / fetch(resolveTileUrl) → sharp mosaic → crop → JPEG/PNG data URI
  ├─ tier ≥ 3 → map-sources/usng-grid.ts:60 buildUsngGrid (UTM projector + mgrs collar)
  ├─ route pages → Liang-Barsky clip (render.ts:225) → RouteOverlay (normalized 0..1)
  ├─ landmarks → atlas-core/landmarks.ts:170 selectPageLandmarks (bucket + label declutter)
  ├─ overview → map-sources/overview.ts:19 buildAtlasOverview (+ its own basemap panel)
  └─ pdf-client/index.ts:57 renderAtlasPdfToFile → AtlasDocument.tsx (Overview → TOC → pages)
```

Validation path: `cli.ts:297 validate` → `atlas-core/validation.ts:41 validateAtlas`
(footprint-vs-scale within 0.5 %, neighbour reciprocity).

---

## Findings

### F01 — Grid page ids collide with the `L#`/`R#` namespaces the renderer dispatches on
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:27`
(`pageLabel` = row letter + column number) produces `"L1"` for row index 11 and `"R1"` for row
index 17. Those exact strings are also minted by
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:44` (`L#`) and
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/route.ts:154` (`R#`). The renderer and
the engine then branch on the id's first character:
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:477`
(`if (!page.id.startsWith("R")) continue;`),
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:539`
(`route && page.id.startsWith("R")`) and
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:546`
(`page.id.startsWith("L")` → draw a centre pin).
**Why it matters** A 12-row grid (≈66 km N–S at 1:24,000 — well inside the 200-page cap) emits a
page literally named `L1`; the PDF then stamps a location pin at its centre. With a project that has
both an extent and locations (the case `HttpRenderWorkerClient.cs:112` explicitly supports), the
contract carries **two pages with the same id**, which corrupts
`AtlasDocument.tsx:762` (`pageNumbers[page.id] = …`, last write wins), the TOC page numbers, and
`validation.ts:81` (`byId` Map) so `neighbor-reciprocity` can pass or fail on the wrong page.
Page ids are the atlas's primary key and its type discriminator at the same time.
**Blast radius** 3 **Effort** S **Impact** 4 **Regression risk** med
**First step** Add a failing test in `packages/atlas-core/src/grid.test.ts` asserting
`buildPageGrid` over an 18-row extent yields no id matching `/^[LR]\d/`, then either prefix grid
ids (`G-A1`) or add an explicit `kind: "grid" | "location" | "route" | "overview"` field to
`AtlasPage` and replace every `startsWith` dispatch with it.

### F02 — Persisted page-grid margins and orientation never reach the render engine
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/Rendering/RenderDtos.cs:39-41`
declares `Orientation`, `Overlap` and `Margins` on `RenderWorkerRequest`;
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:52-56`
faithfully reads them off `AtlasPageGrid`. But
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs:114-133`
never copies `Margins` or `Orientation` into `WorkerRenderPayload` (which has no such fields), and
`RenderAtlasInput` (`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:55`) has no
margins/page-size concept at all —
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:317,331,362,383,399,408`
hardcode `LETTER_PORTRAIT` and `LETTER_PORTRAIT.margins`.
**Why it matters** Contract drift with a full round trip: `AtlasPageGrid.Margins` (a value object,
a migration, an EF owned type, DTOs, and a `PUT /api/projects/{id}` field) is user-visible
configuration that is silently discarded. `apps/web/src/api/client.ts:196` even hardcodes
`{top:0.5,…}` on rename, so any gutter a user sets is destroyed by an unrelated action. Binder
gutter is a stated product feature (`model.ts:26`) and is currently unreachable end to end.
**Blast radius** 4 **Effort** M **Impact** 4 **Regression risk** med
**First step** Add `margins?: PageMargins` and `orientation?: PageOrientation` to
`RenderAtlasInput`, thread them into the `PageSpec` built in `assembleContract`, then extend
`WorkerRenderPayload` and the mapping in `ToWirePayload`. Cover with an
`HttpRenderWorkerClientTests` assertion on the serialized body.

### F03 — The Application layer is an empty shell; every use case lives in Infrastructure
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Application/DependencyInjection.cs:12-16`
returns `services` unchanged (the only registration is commented out, "Stage 2+"). All seven
service implementations sit in Infrastructure and are registered there:
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:41-74`.
Each takes `JourneyBookDbContext` directly, e.g.
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs:12`
and `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:15-20`
(orchestration + business rules over EF `Include` chains).
**Why it matters** The project bills itself as Clean Architecture (CLAUDE.md, csproj graph, three
libraries) but the Application layer holds only interfaces and DTOs. `RenderService` — the single
richest piece of business logic in the backend (validation, lifecycle, tile-proxy policy, failure
classification) — is welded to EF Core, so it can only be tested through Testcontainers PostGIS.
`DependencyInjectionTests.cs:23` "proves the layered wiring is intact" by resolving a DbContext,
which is precisely the coupling in question. This is a deliberate documented pattern ("Stage 2B"),
not an accident — but it makes the Application project pure ceremony.
**Blast radius** 4 **Effort** L **Impact** 3 **Regression risk** med
**First step** Do not relayer everything. Move `RenderService` alone to
`JourneyBook.Application/Rendering/`, behind a narrow `IProjectRenderData` query port implemented in
Infrastructure; that yields a unit-testable orchestrator and makes `AddApplication()` non-empty,
establishing the shape for the rest.

### F04 — SVG overlays use a square `viewBox` over a non-square panel, so every overlay is mis-registered
**What & where** All four overlay layers set `viewBox="0 0 1000 1000"` on a `<Svg width="100%"
height="100%">` stretched over the map panel:
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:207` (RouteLayer),
`:263` (ReferenceGrid), `:359` (UsngGridLayer), `:410` (LandmarkLayer), `:611` (overview).
None passes `preserveAspectRatio`. The installed renderer defaults to letterboxing —
`node_modules/.pnpm/@react-pdf+render@4.5.1/…/lib/index.js:1109`:
`const { meetOrSlice = 'meet', align = 'xMidYMid' } = preserveAspectRatio || {};`
**Why it matters** The panel is Letter-portrait printable area (7.5 × ~9.6 in, ratio ≈ 0.78), so a
1000×1000 viewBox under `meet` scales to the *width* and centres vertically: every normalized
`[0,1]` coordinate produced by `buildUsngGrid`, `buildAtlasOverview`, `selectPageLandmarks` and the
route clipper lands in a square band, vertically compressed by ~22 % and offset. The USNG grid is
the tier-3 land-nav promise; a grid line that does not sit where the map says it sits is worse than
no grid. `lngLatToPanelFraction` is documented as "THE shared panel↔grid mapping" — the consumer
breaks the contract, not the producer. (Related: `AtlasDocument.tsx:529-534` renders the same panel
image two different ways — a plain stretch at tier 3+ and `objectFit:"cover"` (a crop) below it —
so panel-to-overlay registration also depends on tier.)
**Blast radius** 3 **Effort** XS **Impact** 4 **Regression risk** low
**First step** Verify first: render `journeybook render --location -98.5795,39.8283 --tier 3
--scale usgs-7-5-min --out /tmp/t.pdf` and check whether grid lines reach the panel's top and
bottom edges. If they do not, add `preserveAspectRatio="none"` to each `<Svg>` (that is exactly the
semantics normalized coordinates want) and add a fidelity assertion to
`scripts/render-fidelity-check.mjs`.

### F05 — The render worker trusts the entire engine input from the wire, unvalidated
**What & where** `/home/caleb/Projects/JourneyBook/services/render-worker/src/render-route.ts:43`
(`const body = req.body as Partial<RenderAtlasInput>;`) and `:75`
(`renderAtlas({ ...(body as RenderAtlasInput), outputPath: fullOutputPath })`). Fastify is
registered with no JSON schema (`server.ts:11-15` sets only `bodyLimit`/`requestTimeout`). The
route hand-checks four fields plus `outputPath` traversal, then forwards everything else verbatim.
**Why it matters** `outputPath` is carefully confined, but `cacheDir` is not: it flows to
`packages/map-sources/src/tilecache.ts:46 storeCachedTile`, which will `mkdir -p` and write tile
bytes to **any absolute path on the worker's filesystem**. `tileBaseUrl` is only weakly guarded
(`render.ts:213` allows any `http(s)` host — outbound SSRF from inside the compose network).
`panelWidthPx` up to 8000 × 200 pages is an unbounded resource request. The worker is
unauthenticated by design (compose `expose`, not `ports`), so the API is the only thing standing
between a client and this surface — but the API and the worker disagree about what the contract
even is (the API never sends `cacheDir` or `panelWidthPx`, so nothing legitimate would break).
**Blast radius** 3 **Effort** S **Impact** 4 **Regression risk** low
**First step** Attach a Fastify JSON schema to `POST /render` listing exactly the fields the API
sends, with `additionalProperties: false`; drop `cacheDir` from the accepted set entirely and take
it from `process.env.TILE_CACHE_DIR` instead.

### F06 — Location CSV parsing is implemented twice, in two languages, and has already diverged
**What & where** `/home/caleb/Projects/JourneyBook/packages/render-cli/src/locations.ts:85`
(`parseLocationsCsv`) and
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Locations/LocationCsv.cs:44`
(`Parse`) — same header aliases, same quote handling, same all-or-nothing aggregation, near-identical
error strings ("CSV has a header but no location rows.").
**Why it matters** Both docblocks claim "one file works in both", which is already false:
`locations.ts:94` accepts `label` as an alias for `name`, `LocationCsv.cs:51` does not;
`locations.ts:137` validates `scale`/`zoom` ids against `SCALE_PRESETS` at parse time while
`LocationCsv.cs:37` defers that to the service. A user whose CSV imports cleanly in the web app can
fail in the CLI, and vice versa. Every future column must be added twice.
**Blast radius** 3 **Effort** M **Impact** 3 **Regression risk** low
**First step** Write one shared fixture set under `data/fixtures/` (valid + each error class) and
run it through both parsers in their respective test suites. That pins current behaviour and makes
the divergences fail loudly before deciding which side becomes canonical.

### F07 — Scale presets are declared in three places with no consistency check
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:54-60`
(`SCALE_PRESETS`, the CLAUDE.md-declared source of truth),
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Persistence/Configurations/ScalePresetConfiguration.cs:16-21`
(EF `HasData` seed, comment: "Seed matches SCALE_PRESETS"), and the baked copy inside
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Migrations/20260624165320_InitialSchema.cs`.
**Why it matters** `ProjectService.EnsureScalePresetAsync` (`ProjectService.cs:159`) validates
against the DB copy, while `assembleContract` (`render.ts:291`) and
`resolveScaleOrThrow` (`render.ts:261`) validate against the TS copy. Adding a preset to one side
produces a project the API accepts and the engine rejects with `Unknown scalePresetId` — surfaced
to the user as a 502 (`render-route.ts:108` only maps `Invalid `/`Unknown scalePresetId` prefixes,
and this one *is* caught, so a 400 — but only by string matching). Three hand-synchronised copies of
reference data with no test asserting they agree.
**Blast radius** 3 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add a test in `dotnet/JourneyBook.Tests` that reads
`packages/atlas-core/src/model.ts`'s preset ids (or a small generated JSON emitted by the
`atlas-core` build) and asserts the seeded `ScalePresets` table matches id-for-id.

### F08 — Tile fetching and the disk cache are implemented independently in C# and TypeScript
**What & where** C#: `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/TileCache.cs:13`
(+ `RasterXyzFetcher.cs:23`, `TileService.cs:19`). TS:
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/tilecache.ts:23,46` (+ the inline
`fetchTile`/`loadTile` in `panel.ts:101-130`). Both implement the same
`{source}/{z}/{x}/{y}.{ext}` key, the same "discover whichever `{y}.*` exists" lookup, the same
resolved-path `startsWith(root + sep)` confinement, and the same atomic temp-file rename.
**Why it matters** This is a deliberate, documented parallel (the CLI and the API share a cache
directory), so it is duplication-by-design rather than a mistake — but it costs twice. The two
already differ: `panel.ts:127` stores every fetched tile with a hardcoded `"png"` extension
regardless of the real content type, while `TileService.cs:58` derives the extension from the
response `Content-Type`. A JPEG tile cached by the CLI is therefore filed as `.png`, and the C#
proxy will later serve it with `image/png` (`TileService.cs:72`). In the deployed topology the CLI
path is unused (`RenderService.cs:93` routes the worker through the C# proxy) and
`infra/compose/docker-compose.yml` does not even mount `data/cache` into the worker — so the TS
cache is dead weight in production.
**Blast radius** 3 **Effort** M **Impact** 2 **Regression risk** low
**First step** Cheapest correctness fix now: pass the real extension into
`storeCachedTile` in `panel.ts:127` (derive it from the fetch response's content type). Then decide
whether the TS cache stays a CLI-only convenience or is deleted in favour of always proxying.

### F09 — `AtlasPage` / grid-derivation schema is dead: tables and columns nothing ever writes
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Domain/Entities/AtlasPage.cs`
(entity, "the table exists from Stage 2A so derivation has somewhere to write"),
`JourneyBookDbContext.cs:18` (`DbSet<AtlasPage>`),
`Persistence/Configurations/ProjectAggregateConfigurations.cs:71-86` (full config incl. a unique
index on `(PageGridId, Label)`), plus `AtlasPageGrid.Rows`/`.Columns`
(`Entities/AtlasPageGrid.cs:24-25`). A grep across `JourneyBook.Application` and
`JourneyBook.Infrastructure` finds **no** write to `AtlasPages` and no assignment to `Rows`/`Columns`.
**Why it matters** Clearly *stub, not built yet* rather than broken — but it is schema, migrations
and an index carried by every deploy for a derivation step that ADR 0004 says will never live in
C# anyway (the engine derives pages and hands them straight to the PDF renderer). It misleads
readers into thinking pages are persisted and reusable across renders; they are recomputed every time.
**Blast radius** 2 **Effort** S **Impact** 2 **Regression risk** low
**First step** Decide the intent explicitly. Either write a decision-log entry that `AtlasPage` is
a reserved future table, or drop the entity + config + `Rows`/`Columns` in one migration.

### F10 — The ADRs the codebase treats as binding are not in the repository
**What & where** `/home/caleb/Projects/JourneyBook/.gitignore:170-171` is `docs/*` /
`!docs/decisions.md`, so `docs/` contains exactly one tracked file. Yet ADRs are cited as
authority in `CLAUDE.md` ("The API owns no geometry/render (ADR 0004/0005)", "ADR 0004" under Key
Conventions), in code —
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:136`
("See docs/decisions/0003-map-panel-rendering.md"),
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/GeneratedPdfs/GeneratedPdfService.cs:13`
("ADR 0004") — and in `scripts/render-fidelity-check.mjs:23` ("See ADR 0005"). `docs/decisions.md:49`
admits it: "The `docs/*` .gitignore means Phase C specs/ADRs (e.g. docs/decisions/0005) are
untracked even when written."
**Why it matters** The single most important architectural invariant in this project — geometry
lives in TS, never in C# — is enforced only by a CLAUDE.md sentence and reviewer memory. Anyone
cloning the repo gets the rules' citations but not the rules.
**Blast radius** 4 **Effort** XS **Impact** 3 **Regression risk** low
**First step** Narrow the ignore to the actually-local paths (`docs/local/`, `docs/specs/`) and
commit `docs/decisions/0003…0005`. If they were never written, write 0004 first — it is the one
every other finding leans on.

### F11 — `pdf-client` depends on `@journeybook/ui` without a TS project reference
**What & where** `/home/caleb/Projects/JourneyBook/packages/pdf-client/package.json:21` declares
`"@journeybook/ui": "workspace:*"` and `src/AtlasDocument.tsx:26` imports from it, but
`/home/caleb/Projects/JourneyBook/packages/pdf-client/tsconfig.json:11` lists only
`{ "path": "../atlas-core" }`.
**Why it matters** `tsc -b` in `pdf-client` will not rebuild `ui`, so an edit to
`packages/ui/src/pins.ts` can leave `pdf-client` compiling against a stale `ui/dist`. It works today
only because pnpm's topological `-r build` happens to build `ui` first. Same class of gap:
`services/render-worker/tsconfig.json` overrides `module`/`moduleResolution` to `NodeNext` while
every other package uses `ESNext`/`Bundler` — a divergence that will bite on the first
conditional-exports change.
**Blast radius** 1 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Add `{ "path": "../ui" }` to `packages/pdf-client/tsconfig.json` references.

### F12 — The root `build` script builds a different set of packages than the documented command
**What & where** `/home/caleb/Projects/JourneyBook/package.json:20`:
`"build": "pnpm -r --filter \"./packages/*\" run build"`. CLAUDE.md's Commands section and
`/home/caleb/Projects/JourneyBook/harness/checks/build.sh:24` both run `pnpm -r build`.
**Why it matters** `pnpm build` at the root silently skips `services/render-worker` and
`apps/web`, so a change that breaks the worker's compile passes the root script and only fails in
the harness or in Docker. Two build entry points with different coverage is the kind of drift that
makes "it built locally" untrustworthy.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Change the root script to `pnpm -r run build` (or make `build.sh` invoke
`pnpm build`) so there is exactly one definition of "the build".

### F13 — Stage-0 residue in `map-sources`: an unused dependency and a dead type registry
**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/package.json:20,25`
declare `proj4` and `@types/proj4`; the only occurrence of the string `proj4` under
`packages/map-sources/src/` is a comment at `usng-grid.ts:74` (the real projector comes from
`atlas-core`). `/home/caleb/Projects/JourneyBook/packages/map-sources/src/index.ts:9-43` exports
`TileFormat`, `TileCachePolicy`, `TileSource` and `composeAttribution` — described in the file
header as a "Stage 0 skeleton … attribution stub" — none of which is imported anywhere outside that
file. `TileSource`/`TileCachePolicy` duplicate
`dotnet/JourneyBook.Domain/Entities/TileSource.cs` and
`dotnet/JourneyBook.Application/TileSources/TileSourceDtos.cs` (the real registry), and the real
attribution string is hardcoded at `AtlasDocument.tsx:566`. Also unused public surface:
`validation.ts:106 effectiveDpi`, `pdf-client/index.ts:65 renderAtlasPdfToBuffer`,
`model.ts:15 LETTER_PORTRAIT_PT`, and the four `*_VERSION` constants. Empty workspace placeholders
`services/geo-worker/` and `services/questpdf-renderer/` contain only `.gitkeep`.
**Why it matters** A third `TileSource` shape invites someone to "wire up" the wrong one, and a
declared-but-unused dependency means `pnpm audit`/upgrade churn on a library the package does not
use. Small individually; together they blur the boundary of what `map-sources` actually owns.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Drop `proj4`/`@types/proj4` from `packages/map-sources/package.json` and run
`pnpm -r typecheck`; delete the `TileSource`/`TileFormat`/`TileCachePolicy`/`composeAttribution`
block from `map-sources/src/index.ts` in the same change.

### F14 — The API cannot render without a basemap, and cannot control panel resolution
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs:122`
and `:147` both hardcode `Basemap: true`. `WorkerRenderPayload` (`:33-57`) has no
`panelWidthPx` / `panelFormat` / `panelQuality`, so the worker always falls back to
`render.ts:436` (`1000` px) and `panel.ts:37-38` (JPEG q90). `RenderProjectRequest`
(`RenderDtos.cs:4-16`) exposes seven furniture toggles but none of these.
**Why it matters** Every API render performs a full tile fetch — the slowest, most failure-prone
part of the pipeline, run serially page by page (`render.ts:441-452`). There is no way for the web
app to produce a fast line-art preview, and no way to raise DPI for a print run, even though the
engine supports both and the CLI exposes both (`cli.ts:57-59`). The capability exists and is simply
not plumbed — a headless-first project whose UI can reach less than its CLI.
**Blast radius** 2 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add `Basemap`, `PanelWidthPx` and `PanelFormat` to `RenderProjectRequest` +
`RenderWorkerRequest` + `WorkerRenderPayload` with today's values as defaults; assert the
serialized payload in `HttpRenderWorkerClientTests`.

### F15 — The worker rejects an input shape the engine accepts (`mode:"location"` without `center`)
**What & where** `/home/caleb/Projects/JourneyBook/services/render-worker/src/render-route.ts:48`
returns 400 for `mode === "location" && !body.center`. The engine explicitly permits it —
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:179` requires `center` *only*
when `locations` is empty, and `render.ts:300-305` resolves the location list first.
**Why it matters** The worker enforces a stricter, older contract than the engine it wraps, so a
valid `{mode:"location", locations:[…]}` request is refused at the edge. It happens to work today
only because `HttpRenderWorkerClient.cs:142` defensively duplicates the first location into
`center` ("passing the first as `center` for legacy validation"). Two components hold two different
definitions of a required field, and the third works around both.
**Blast radius** 2 **Effort** XS **Impact** 2 **Regression risk** low
**First step** Change the guard to `mode === "location" && !body.center && !body.locations?.length`,
add a `render-route.test.ts` case for locations-without-center, then delete the legacy `center`
duplication in `ToWirePayload`.

### F16 — `AtlasContract` has no page size, so the validator hardcodes Letter
**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/model.ts:134-139`
(`AtlasContract` = version/scale/margins/pages — no sheet dimensions) forces
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/validation.ts:58-63` to rebuild a
`PageSpec` with literal `widthIn: 8.5, heightIn: 11`. The same literals reappear in
`/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:113`
(`sheetWidthInches`) and as `size="LETTER"` at `:494`, `:598`, `:686`.
**Why it matters** The contract is documented as the one artefact that flows engine → renderer →
validator, but a page's most basic property is carried out of band by three independent copies of
"8.5 × 11". Any A4 or Tabloid support is a three-place change with a validator that would silently
pass wrong pages (it would compare an A4 page's ground footprint against Letter's expectation and
fail *scale-consistency* with a misleading message). This is a latent design gap, not a live bug —
only Letter is supported today.
**Blast radius** 2 **Effort** S **Impact** 3 **Regression risk** low
**First step** Add `page: { widthIn, heightIn }` to `AtlasContract` (defaulted to Letter at
`assembleContract`), consume it in `validation.ts` and `AtlasDocument.tsx`, and delete the literals.

### F17 — `ITileFetcher` is an Infrastructure abstraction that consumes an Application DTO
**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/ITileFetcher.cs:13`
lives in Infrastructure while its sibling `ITileService` lives in
`dotnet/JourneyBook.Application/Tiles/ITileService.cs:38`. Its method signature takes
`TileSourceResponse` — an Application *response DTO* — as its input parameter (`ITileFetcher.cs:17`,
used at `RasterXyzFetcher.cs:23` and `PmTilesFetcher.cs:22`). Registration is also unusual:
`DependencyInjection.cs:53,57` calls `AddScoped<ITileFetcher>` twice, which works only because
`TileService.cs:15` injects `IEnumerable<ITileFetcher>`; a `GetRequiredService<ITileFetcher>()`
anywhere would silently get only `PmTilesFetcher`.
**Why it matters** A read-model DTO is being used as the internal contract between two
infrastructure components, so any change to the tile-source *API response* is a breaking change to
the *fetcher* interface. And the abstraction/implementation split for tiles is inverted relative to
every other feature in the codebase (all of which put `I<X>` in Application), which makes the
convention unlearnable from the code.
**Blast radius** 2 **Effort** S **Impact** 2 **Regression risk** low
**First step** Introduce a small `TileSourceDescriptor` record (key, url, kind, maxZoom) in
Infrastructure and change `ITileFetcher.FetchAsync` to take it; map from `TileSourceResponse` once,
in `TileService`.

---

## Notes on what is healthy (so a later pass does not re-litigate it)

* The TS dependency graph is acyclic, `workspace:*` throughout, with no phantom imports.
* `atlas-core` genuinely is the geometry monopoly: no projection, scale, or grid math exists in C#.
  The only C# "tile math" is `PmTilesReader.ZxyToTileId` (a Hilbert curve required by the PMTiles
  archive format, not map projection) — that does not violate the CLAUDE.md constraint.
* Minimal-API endpoints are genuinely thin: every handler in `apps/api/Endpoints/*.cs` maps a
  service result to a status code and nothing else. The only Infrastructure type reaching the API is
  `JourneyBookDbContext` in the `/health/db` readiness probe (`Program.cs:54`) — acceptable.
* No `NotImplementedException`, `TODO` or `FIXME` anywhere in the C# or TS source.
* Path-traversal confinement is implemented consistently and correctly in four independent places
  (`TileCache.cs:79`, `tilecache.ts:12`, `GeneratedPdfEndpoints.cs:44-51`, `render-route.ts:58-67`).
* No build artefacts are tracked in git (`dist/`, `bin/`, `obj/`, `data/cache/` all ignored).
