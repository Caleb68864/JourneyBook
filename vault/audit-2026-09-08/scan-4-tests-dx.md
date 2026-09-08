# Scan 4 — Tests & Developer Experience

Audit date: 2026-09-08 · HEAD `c36f69f` (`feat(locations): zoom ladders and pins through the backend and web app`)
Scope: test coverage/quality, harness, build & release DX, docs-vs-tree. **No source was modified.**

---

## Toolchain run log

Everything below was actually executed from `/home/caleb/Projects/JourneyBook`.

### Environment

```
$ node -v
v26.8.1

$ pnpm -v
zsh: command not found: pnpm          # NOT on PATH
$ corepack --version
zsh: command not found: corepack      # NOT installed

$ dotnet --list-sdks
10.0.111 [/usr/share/dotnet/sdk]

$ docker info >/dev/null 2>&1; echo $?
1
$ docker version --format '{{.Server.Version}}'
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

`pnpm` was recovered from a prior pnpm-tools install at
`/home/caleb/.local/share/pnpm/.tools/pnpm/10.33.0/bin` (v10.33.0, matching root
`package.json` `packageManager: pnpm@10.33.0`) and put on PATH for every command below.
Note this means **`bash harness/init.sh` as written would today attempt a network
`npm install --prefix ~/.npm-global pnpm@10`** — `jb_ensure_pnpm`
(`harness/lib/env.sh:41-77`) does not look in `~/.local/share/pnpm/.tools`.

The Docker daemon is *installed and running* but the user lacks socket permission —
`jb_check_docker` (`harness/lib/env.sh:141-162`) reports "not reachable" and then
suggests `sudo systemctl start docker`, which is the wrong remediation for a
`permission denied` (the fix is `usermod -aG docker`). Minor but real.

### Install

```
$ pnpm install --frozen-lockfile
Scope: all 8 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 1.2s using pnpm v10.33.0
```
**PASS**, offline (store already populated).

### TS build

```
$ pnpm -r build            # BUILD_EXIT=0
Scope: 7 of 8 workspace projects
packages/atlas-core build: Done
packages/ui build: Done
packages/map-sources build: Done
packages/pdf-client build: Done
apps/web build: ✓ 163 modules transformed. ✓ built in 6.64s
  (!) dist/assets/index-CWasPzF1.js  1,438.62 kB │ gzip: 404.62 kB
      Some chunks are larger than 500 kB after minification.
packages/render-cli build: Done
services/render-worker build: Done
```
**PASS** (one non-fatal 1.4 MB bundle-size warning from Vite).

### TS typecheck

```
$ pnpm -r typecheck        # TYPECHECK_EXIT=0
atlas-core / ui / map-sources / pdf-client / render-cli / render-worker / web: Done
```
**PASS** — but see Finding 2: **zero `*.test.ts` files are included in this.**

### TS tests

```
$ pnpm -r test             # TEST_EXIT=0
packages/atlas-core   Test Files 10 passed (10)   Tests 59 passed (59)    944ms
packages/map-sources  Test Files  5 passed  (5)   Tests 32 passed (32)    666ms
packages/render-cli   Test Files  4 passed  (4)   Tests 41 passed (41)   4.76s
services/render-worker Test Files 1 passed  (1)   Tests  6 passed  (6)   1.37s
```
**PASS — 138/138 tests green in 20 workspace test files.**
`packages/pdf-client`, `packages/ui` and `apps/web` have **no `test` script**, so
`pnpm -r test` silently covers none of them.

### .NET build

```
$ dotnet build JourneyBook.slnx --nologo     # DOTNET_BUILD_EXIT=0
    12 Warning(s)
    0 Error(s)
Time Elapsed 00:00:07.77
```
**PASS with 12 warnings**, including:
- `warning NU1903: Package 'SSH.NET' 2025.1.0 has a known high severity vulnerability` (JourneyBook.Tests.csproj, transitive via Testcontainers)
- `warning NU1903: Package 'Microsoft.OpenApi' 2.0.0 has a known high severity vulnerability` (JourneyBook.Api.csproj)
- `warning MSB3277: Found conflicts between different versions of "Microsoft.EntityFrameworkCore"` — 10.0.4 vs 10.0.9; **10.0.4 wins at runtime in the test host**
- 4 × `warning CS0618: PostgreSqlBuilder() is obsolete` (GeocodeApiTests.cs:51, LandmarksApiTests.cs:62, PostgisApiFactory.cs:17, RenderApiTests.cs:39)

### .NET tests

```
$ dotnet test JourneyBook.slnx --nologo --filter "FullyQualifiedName!~Api"
Passed!  - Failed: 0, Passed: 27, Skipped: 0, Total: 27, Duration: 1 s

$ dotnet test dotnet/JourneyBook.Tests --nologo --filter "FullyQualifiedName!~Api"   # README.md:70 form
Passed!  - Failed: 0, Passed: 27, Skipped: 0, Total: 27

$ dotnet test JourneyBook.slnx --nologo                        # EXIT=1
Failed!  - Failed: 68, Passed: 31, Skipped: 0, Total: 99, Duration: 1 s
---- DotNet.Testcontainers.Builders.DockerUnavailableException :
     Docker is either not running or misconfigured.
     Failed to connect to Docker endpoint at 'unix:///var/run/docker.sock'.
```

**PARTIAL.** 31 pass, **68 fail — every one of them purely because Docker is
unavailable**, not because of a code defect. Verified: every class under
`dotnet/JourneyBook.Tests/Api/` binds `PostgisApiFactory` directly or by
inheritance (`TilesApiFactory.cs:16`, `PmTilesApiFactory.cs:10` both
`: PostgisApiFactory`), so the whole `Api` namespace requires the daemon.
**No backend endpoint behaviour was verified in this audit.**

### CLI smoke

```
$ node packages/render-cli/dist/cli.js --help     # EXIT=0
journeybook — headless atlas renderer
Usage: journeybook grid|validate|render …
```
**PASS** — the README/CLAUDE.md headless-render entrypoint works.

### Unavailable / not run

| Thing | Status |
|---|---|
| Backend integration tests (68) | **Not run** — Docker socket permission denied |
| `apps/web` Playwright e2e (1 spec) | **Not run** — needs a manually started Vite dev server; not in any `test` script |
| Coverage numbers | **Not measurable** — no coverage config anywhere (see Finding 14) |
| Lint | **Does not exist** (see Finding 3) |
| CI | **Does not exist** (see Finding 1) |

### Test-file census (all 35 test files)

| Area | Files | Tests | Verified state |
|---|---|---|---|
| `packages/atlas-core/src/*.test.ts` | extent, fixture, grid, landmarks, page, projection, route, scale, scale-fidelity, validation | 59 | pass |
| `packages/map-sources/src/*.test.ts` | overview, panel, tilecache, tilemath, usng-grid | 32 | pass |
| `packages/render-cli/src/*.test.ts` | assemble, cli, locations, render | 41 | pass |
| `services/render-worker/src/*.test.ts` | render-route | 6 | pass |
| `packages/pdf-client`, `packages/ui` | **none** | 0 | — |
| `apps/web/tests/e2e/` | create-render.spec.ts | 1 | not run |
| `dotnet/JourneyBook.Tests/` (non-Api) | ModelTests, DependencyInjectionTests, PmTilesReaderTests, TileCacheTests, Rendering/HttpRenderWorkerClientTests | 27 | pass |
| `dotnet/JourneyBook.Tests/Api/` | GeneratedPdfs, Geocode, Landmarks, Locations, PmTilesTiles, Projects, Render, Tiles, TileSources | 68 | **all fail (Docker)** |

---

## Findings

### 1. No CI pipeline exists at all

- **What & where**: `/home/caleb/Projects/JourneyBook/.github` — **does not exist**. No `.gitlab-ci.yml`, no Azure Pipelines, no Jenkinsfile; the only YAML in the tree is `pnpm-workspace.yaml` and `infra/compose/docker-compose.yml`. The only automation is `/home/caleb/Projects/JourneyBook/scripts/hooks/pre-commit`, which enforces the decision log and **runs no build or test**.
- **Why it matters**: 138 TS tests and 27 runnable .NET tests exist and are green — but nothing enforces that on a push or a merge. Two `Merge … into master` commits are already in the log (`c9da052`, `7f9c062`) with no gate. `harness/checks/*.sh` are the de-facto CI and are invoked by nothing but a human reading `CLAUDE.md:52-57`.
- **Blast radius**: 5
- **Effort**: S
- **Impact**: 5
- **Regression risk**: low
- **First step**: Add `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile`, `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test`, `dotnet build JourneyBook.slnx`, and `dotnet test JourneyBook.slnx` on a Docker-enabled runner (GitHub's `ubuntu-latest` has a working daemon, so all 99 .NET tests can actually run there — the thing the dev box cannot do).

### 2. No test file is ever typechecked — proven empirically

- **What & where**: every package tsconfig excludes tests: `packages/atlas-core/tsconfig.json:8` (`"exclude": ["**/*.test.ts"]`), `packages/map-sources/tsconfig.json:11`, `packages/render-cli/tsconfig.json:14`, `services/render-worker/tsconfig.json:15`. `typecheck` is `tsc --noEmit` against that *same* config, so the exclusion applies to it too. Verified: `cd packages/atlas-core && tsc --noEmit --listFiles | grep -c '\.test\.ts$'` → **0**. Likewise `apps/web/tsconfig.app.json:15` includes only `["src"]` and `apps/web/tsconfig.node.json:11` only `["vite.config.ts"]`, so `apps/web/tests/e2e/create-render.spec.ts` and `apps/web/playwright.config.ts` are typechecked by nothing.
- **Why it matters**: `harness/checks/lint.sh` is the project's only static-analysis gate and it has a blind spot covering 100% of test code (~1,700 LOC of TS tests). A test can reference a renamed export, pass a wrong-shaped object, or drift from `AtlasContract` and both `pnpm -r build` and `pnpm -r typecheck` stay green; the error only appears at vitest runtime, and only if that line executes.
- **Blast radius**: 4
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Add a `tsconfig.test.json` per package (`extends` the package config, `"include": ["src"]`, no exclude, `"noEmit": true`) and make `typecheck` run `tsc --noEmit && tsc -p tsconfig.test.json`. Keep the build exclusion — only the typecheck needs widening.

### 3. No linter or formatter exists anywhere in the repo

- **What & where**: no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `biome.json` anywhere outside `node_modules`. `harness/checks/lint.sh:2` says so in its own header: `"typecheck stands in for lint (no eslint configured yet)"`, and its success message is `PASS: TS typecheck (no eslint configured)` (`lint.sh:20`). `.editorconfig` exists (charset/EOL/indent only) and no tool enforces it.
- **Why it matters**: `tsc` catches type errors, not `no-floating-promises`, `no-misused-promises`, unused vars, or import cycles. The repo has a *documented, load-bearing* import rule — "engine modules import from the leaf `./model.js`, NOT the barrel `./index.js` (avoids an init cycle)" (`CLAUDE.md:40`, `forge-project.json:29`) — enforced today only by convention and code review. `no-restricted-imports` would make it mechanical. Similarly, `tsconfig.base.json` omits `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `exactOptionalPropertyTypes` despite otherwise strong strictness (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- **Blast radius**: 4
- **Effort**: S
- **Impact**: 3
- **Regression risk**: low (lint-only; no runtime change)
- **First step**: Add a flat `eslint.config.js` with `typescript-eslint` recommended-type-checked + a `no-restricted-imports` rule banning `./index.js` inside `packages/atlas-core/src/**`, then point `harness/checks/lint.sh` at it. Add `noUnusedLocals`/`noUnusedParameters` to `tsconfig.base.json` in the same change.

### 4. 69% of the backend test suite is unrunnable locally and hard-fails rather than skipping

- **What & where**: `dotnet/JourneyBook.Tests/Api/PostgisApiFactory.cs:15-34` starts a real `postgis/postgis:16-3.4` container in `InitializeAsync`. All 9 Api test classes bind it (`TilesApiFactory.cs:16` and `PmTilesApiFactory.cs:10` inherit from it). Measured: `dotnet test JourneyBook.slnx` → `Failed: 68, Passed: 31, Total: 99`, every failure a `DockerUnavailableException`.
- **Why it matters**: the documented top-level command `dotnet test JourneyBook.slnx` (`CLAUDE.md:10`, `forge-project.json:9`) exits 1 on any machine without a Docker socket, producing 68 red results that are indistinguishable at a glance from genuine regressions. This trains the team to ignore a red backend suite. `harness/checks/test.sh:4-6` sidesteps it by not running .NET tests at all — so **no automated check anywhere runs the backend suite**.
- **Blast radius**: 4
- **Effort**: S
- **Impact**: 4
- **Regression risk**: low
- **First step**: Add `Xunit.SkippableFact` (or a custom `[DockerFact]` trait) so `PostgisApiFactory` probes the daemon and the suite reports `Skipped: 68` with a one-line reason instead of `Failed: 68`; add `dotnet test --filter Category!=RequiresDocker` to `harness/checks/test.sh` so the 27 offline tests run in the standard check loop.

### 5. `pdf-client` — the component that actually draws the printed page — has zero tests

- **What & where**: `packages/pdf-client/src/AtlasDocument.tsx` is **797 lines**, the single largest TS file in the repo, and `packages/pdf-client/package.json:17-20` has no `test` script and no vitest dependency. `packages/ui/src/pins.ts` (91 lines, pin geometry) is likewise untested.
- **Why it matters**: `AtlasDocument.tsx` converts the validated `AtlasContract` into @react-pdf primitives — it owns the scale bar's printed length, the compass rose, the alphanumeric reference-grid border, the notes area, the TOC, and pin placement. Every one of those is a *print-fidelity* concern, and `atlas-core`'s excellent geometry tests stop at the contract boundary. The only thing exercising this file is `packages/render-cli/src/render.test.ts`, which asserts "a valid PDF was produced" and page counts — it never inspects what is *on* a page. A scale bar drawn at the wrong length, or a pin offset by half a page, passes every test in the repo.
- **Blast radius**: 5
- **Effort**: M
- **Impact**: 5
- **Regression risk**: low (adding tests only)
- **First step**: Add vitest to `pdf-client`, then extract the pure layout helpers inside `AtlasDocument.tsx` (scale-bar length in points, reference-grid tick positions, pin x/y from `lngLatToPanelFraction`) into testable functions and pin them with known-good values — e.g. a 1 km bar at 1:24,000 must render exactly `1000/609.6 × 72 = 118.1 pt`.

### 6. The single e2e spec is orphaned — in no test script, and it was never run

- **What & where**: `apps/web/tests/e2e/create-render.spec.ts` (171 lines). `apps/web/package.json:11` exposes it only as `test:e2e`, **not** `test`, so `pnpm -r test` skips `apps/web` entirely. It is absent from `harness/checks/test.sh`, from `forge-project.json:10` (`test_command`), and `forge-project.json:12` explicitly sets `"frontend_test": null`. `apps/web/playwright.config.ts:21-22` deliberately starts no web server: *"tests assume the dev stack is running"*.
- **Why it matters**: the only end-to-end proof that create-project → bbox → scale → location → Generate still works requires a human to remember to run `pnpm dev:web` in one terminal and `pnpm --filter @journeybook/web test:e2e` in another. Nothing in the harness or (absent) CI does this. In practice the spec rots: it mocks every API route (`create-render.spec.ts:49-98`) against hand-written shapes that "mirror the C# API contract" — a comment, not a check — so a backend DTO rename would leave the e2e green *and* wrong.
- **Blast radius**: 3
- **Effort**: S
- **Impact**: 4
- **Regression risk**: low
- **First step**: Add `webServer: { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true }` to `playwright.config.ts` and wire `test:e2e` into CI as a separate job. Longer term, generate the mock shapes from the API's OpenAPI document instead of hand-copying them.

### 7. HIGHEST-VALUE GAP — `renderMapPanel`'s tile-composite and crop maths are never exercised

- **What & where**: `packages/map-sources/src/panel.ts:165-173` computes the crop window that georeferences the basemap image:
  ```
  const left   = Math.round(topLeft.x - range.minX * TILE_SIZE);
  const top    = Math.round(topLeft.y - range.minY * TILE_SIZE);
  const width  = Math.max(1, Math.round(bottomRight.x - topLeft.x));
  const height = Math.max(1, Math.round(bottomRight.y - topLeft.y));
  ```
  Every test in `packages/map-sources/src/panel.test.ts` calls `stubFailedTiles()` (`panel.test.ts:38-43`), which stubs `fetch` to return 404 for **every** tile. The test file says so at `panel.test.ts:27-32`. Consequently `placements` (`panel.ts:165`) is always `[]`, `sharp().composite([])` is a no-op, and only the parchment-background encode path runs. `loadTile` (`panel.ts:112-130`) — cache-hit, cache-write, and the resolve-URL-then-fetch branch — is never covered with a successful tile.
- **Why it matters**: this crop is the *sole* thing aligning the printed basemap raster with the USNG/reference-grid vector overlay, the landmark labels, and the pins — all of which are placed via `lngLatToPanelFraction` in a separate code path (`tilemath.ts:65-73`, well tested in isolation). An off-by-one-tile or off-by-`TILE_SIZE` error in `left`/`top` would print a map whose grid lines are 256 px away from the terrain they label — a silent, catastrophic land-nav failure — and **every test in the repo would stay green**. This is the largest untested surface in the geospatial/print pipeline.
- **Blast radius**: 5
- **Effort**: M
- **Impact**: 5
- **Regression risk**: low
- **First step**: Stub `fetch` to return synthetic 256×256 PNGs whose pixels encode their own `(z,x,y)` (e.g. tile index written into the top-left pixel via sharp), then assert that the pixel at panel fraction `[0.5, 0.5]` decodes to the tile that actually contains the bbox centre. Add one cache-hit test asserting `fetch` is not called when `cacheDir` holds the tile.

### 8. `niceScaleBar` violates its own documented contract, and no test covers it

- **What & where**: `packages/atlas-core/src/scale.ts:35-49`. The doc comment promises "the largest 'nice' round ground distance … **whose bar fits within `maxInches`**", but `groundMeters` is seeded to `NICE_STEPS[0]` = 1 (`scale.ts:38`) and the loop only ever *raises* it — there is no floor check. Verified by direct execution against the built `dist`:
  ```
  niceScaleBar(usgs-7-5-min, 0.001) → {groundMeters:1, inches:0.00164…, label:"1 m"}   fits? false
  ```
  `packages/atlas-core/src/scale.test.ts:21-33` has exactly two `niceScaleBar` cases, both comfortably mid-range (3 in and 0.9 in at 1:24,000), so the boundary is untouched. There is also no test asserting the invariant `bar.inches <= maxInches` for *any* input, and no case at the coarse end of `SCALE_PRESETS` (1:100,000).
- **Why it matters**: a scale bar longer than the space allotted overflows the page furniture at coarse scales / narrow panels — and a scale bar is the one element on a land-nav sheet that must not lie. The contract is documented but unenforced and unasserted.
- **Blast radius**: 2
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Add a loop test over all five `SCALE_PRESETS` × `maxInches ∈ {0.001, 0.1, 1, 3, 7.5}` asserting `bar.inches <= maxInches` and `bar.groundMeters` is of the form `{1,2,5}×10ⁿ`. That single test both documents and pins the contract.

### 9. `buildPageGrid` has no coverage invariant and no bad-input tests

- **What & where**: `packages/atlas-core/src/grid.ts:73-136`. `packages/atlas-core/src/grid.test.ts` has five cases: labels, neighbour wiring, per-page footprint, "more overlap → more pages", and tier propagation. **None of them asserts that the resulting pages actually cover the requested bbox.** This matters specifically because `projection.ts:88-91` documents that per-page re-centring makes adjacent bboxes "overlap or gap by that same fraction of a page" — a deliberate trade with no test bounding the gap. Separately, `grid.ts:102-103` divides by `stepX`/`stepY` with no guard on `overlap`; verified by direct execution, `overlap: 1` produces `stepX = 0` and the run dies with `coordinates must be finite numbers` — a proj4 error, three layers below the actual mistake. There is no test for `overlap >= 1`, for a zero-area bbox, or for a reversed (`west > east`) bbox at the `buildPageGrid` layer (`render.ts` guards the reversed case, `render.test.ts:285`, but the engine itself does not).
- **Why it matters**: "does my atlas actually contain the ground I asked for?" is *the* correctness question for an extent-driven atlas, and it is the one property nothing checks. The scale-fidelity suite proves each page is the right *size*; nothing proves the pages are in the right *places* relative to the requested extent.
- **Blast radius**: 4
- **Effort**: S
- **Impact**: 4
- **Regression risk**: low
- **First step**: Add a coverage test: for a grid over a known bbox, sample a lattice of ~200 points inside the bbox and assert every one falls inside at least one page bbox; assert the largest inter-page gap along a row is under a documented fraction of a page. Add `expect(() => buildPageGrid({…, overlap: 1})).toThrow(/overlap/)` to force a real guard.

### 10. `enclosingBBox` silently returns a whole-world box across the antimeridian

- **What & where**: `packages/atlas-core/src/extent.ts:26-40` takes a naive min/max over longitudes with no dateline handling. Verified by execution:
  ```
  enclosingBBox([{lng:179.5,lat:40},{lng:-179.5,lat:41}])
    → [-180, 39.95, 180, 41.05]        // 360° wide for two points 1° apart
  ```
  `packages/atlas-core/src/extent.test.ts` has five cases (default pad, single point, custom pad, clamping, empty throw) and none crosses ±180. The clamping test (`extent.test.ts:31-37`) even *looks* like it covers the edge, but it only tests a point near 180 on one side.
- **Why it matters**: `enclosingBBox` backs both the CLI's `--cover` and the web editor's "Enclose N Locations" (`extent.ts:14-17`). Feeding the resulting 360° box into `buildPageGrid` at 1:24,000 asks for tens of thousands of pages; the `MAX_ATLAS_PAGES` guard turns that into a confusing rejection rather than a clear "your locations straddle the dateline". Also `utmZoneForLongitude(180)` returns 1 while `utmZoneForLongitude(179.999)` returns 60, with no boundary test in `projection.test.ts:10-16`.
- **Blast radius**: 2
- **Effort**: S
- **Impact**: 2
- **Regression risk**: low
- **First step**: Add an antimeridian test asserting either a correct wrapped box or an explicit, named throw — decide the policy first, then pin it. Add ±180 boundary cases to the `utmZoneForLongitude` test.

### 11. No property or invariant testing anywhere — every geospatial test is a fixed example

- **What & where**: `grep -ci 'fast-check\|jsverify' pnpm-lock.yaml` → **0**. All 138 TS tests are hand-picked examples. The nearest thing to an invariant test is `packages/atlas-core/src/route.test.ts:117-147` ("no internal gap between consecutive corridor pages") and `packages/atlas-core/src/scale-fidelity.test.ts:58-81` — both genuinely good, both still single fixed inputs (Lincoln→Omaha, `-98/41`).
- **Why it matters**: the geometry layer is exactly the domain where property tests pay: round-trip (`inverse(forward(p)) ≈ p`) is asserted at *one* point (`projection.test.ts:19-28`); footprint-equals-scale is asserted at a handful of hand-chosen centres. The properties that must hold *everywhere* — round-trip for all lng/lat in CONUS, `worstFootprintError < 0.005` for any centre and any preset, `pageBBoxAround` symmetric about its centre — are stated in doc comments (`projection.ts:73-91` even quotes numeric error bounds: ~0.17% residual, ~0.7% at 40 km, ~1.1% at 60 km) and asserted only at sample points. **Notably `pageBBoxAround` itself — the function whose regression was the subject of commit `da541ad`, and the one carrying those documented error bounds — has no direct unit test in `projection.test.ts` at all**; it is only reached transitively through `grid`/`route`/`scale-fidelity`.
- **Blast radius**: 4
- **Effort**: M
- **Impact**: 4
- **Regression risk**: low
- **First step**: Add `fast-check` to `atlas-core` and write three properties: (a) `createProjector(c).inverse(forward(p)) ≈ p` to 1e-7° for arbitrary `c`,`p` in CONUS; (b) `pageBBoxAround(c, w, h)` is centred on `c` and measures `2w × 2h` ground metres to within 0.5% for arbitrary `c` and any `SCALE_PRESET`; (c) `niceScaleBar(s, m).inches <= m` for arbitrary `s`,`m`. (b) alone would have caught the `da541ad` bug directly rather than transitively.

### 12. Scale-fidelity and validation both hard-code an 8.5×11 sheet — the test mirrors the implementation, not ground truth

- **What & where**: `packages/atlas-core/src/validation.ts:58-63` builds its expected footprint from a literal `{ widthIn: 8.5, heightIn: 11 }`, ignoring any other sheet. `packages/atlas-core/src/scale-fidelity.test.ts:23-28` then constructs its *expected* value from the same literal `{ widthIn: 8.5, heightIn: 11 }`. The oracle and the implementation share the assumption, so the test can never detect that the assumption is wrong.
- **Why it matters**: `AtlasContract` carries `margins` but no sheet size, and `PageSpec` (`page.ts:11-17`) is fully general — `LETTER_PORTRAIT` is only *one* of the shapes `groundFootprintMeters` accepts. The moment an A4 or Tabloid preset is added, `validateAtlas` will compute a Letter-sized expectation, declare the scale bar false, and fail every page — and the scale-fidelity suite will agree with it, because it shares the bug. There is no test at any non-Letter sheet size.
- **Blast radius**: 3
- **Effort**: S
- **Impact**: 3
- **Regression risk**: med (fixing it means adding sheet size to `AtlasContract` — a persisted contract change)
- **First step**: Add a failing-first test that validates an A4 atlas, then carry sheet dimensions on `AtlasContract` (or on each `AtlasPage`, alongside the existing per-page `scale`) so `validation.ts:58-63` stops guessing. Derive the scale-fidelity expectation from that field rather than a second literal.

### 13. Assert-nothing and premise-only tests

- **What & where**:
  - `packages/map-sources/src/usng-grid.test.ts:14-18` — `it("exports buildUsngGrid as a function", () => expect(typeof buildUsngGrid).toBe("function"))`. This is tautological: the `import` at line 6 would already throw if it were absent, and it cannot fail while any other test in the file passes.
  - `packages/map-sources/src/usng-grid.test.ts:158-161` — `"1000 m interval on the same bbox would exceed 60 lines (validates the test premise)"` tests the *test's* setup, not the product. Harmless but it inflates the count.
  - `packages/map-sources/src/tilemath.test.ts:37-42` — `tileRangeForBBox` is asserted only to be "well-ordered" (`maxX >= minX`), which is true for essentially any implementation including a wrong one. No expected tile indices are pinned, despite Web Mercator tile indices being trivially checkable ground truth.
  - `packages/map-sources/src/tilemath.test.ts:32-35` — `zoomForBBox` is asserted only to be monotonic in `targetWidthPx`; the actual zoom chosen for a known bbox is never pinned.
- **Why it matters**: the headline TS number is "138 tests passing", and a handful of those cannot fail. More importantly, the two `tilemath` cases guard the *inputs* to the untested `renderMapPanel` crop (Finding 7) — pinning real values there is cheap and would meaningfully raise confidence in that path.
- **Blast radius**: 2
- **Effort**: XS
- **Impact**: 2
- **Regression risk**: low
- **First step**: Delete `usng-grid.test.ts:14-18`; replace the two `tilemath` assertions with pinned expected values (e.g. for `[-98.05, 40.95, -97.95, 41.05]` at z14, assert the exact `{minX,minY,maxX,maxY}`, cross-checked against an independent slippy-map calculator).

### 14. No coverage measurement exists on either stack

- **What & where**: no `vitest.config.*` anywhere in the repo (the four vitest packages run on defaults), no `@vitest/coverage-*` dependency, no `coverage` script in any `package.json`. On the .NET side `coverlet.collector` 6.0.4 is referenced (`dotnet/JourneyBook.Tests/JourneyBook.Tests.csproj:12`) but no command anywhere passes `--collect:"XPlat Code Coverage"`, so it never produces anything.
- **Why it matters**: the gaps in Findings 5, 7, 9 and 11 are invisible without it. A `--coverage` run would have surfaced `AtlasDocument.tsx` at 0% and the `panel.ts` composite branch as uncovered immediately, rather than requiring a line-by-line read.
- **Blast radius**: 3
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Add `@vitest/coverage-v8` and a root `pnpm coverage` script (`pnpm -r exec vitest run --coverage`); add `--collect:"XPlat Code Coverage"` to the `dotnet test` invocation in CI. Publish the numbers before setting any threshold.

### 15. `harness/progress.json` is 130 commits and ~2.5 months stale, and carries no history

- **What & where**: `/home/caleb/Projects/JourneyBook/harness/progress.json`:
  ```json
  { "last_known_good_commit": "7f192299fa921f45470696b5f9dae1bdbfca38e6",
    "environment_state": "healthy", "features": [], "session_history": [] }
  ```
  Verified: that SHA is `forge-init: project config, harness, code graph, CLAUDE.md`, dated **2026-06-24**. HEAD is `c36f69f`, dated **2026-09-06**. `git rev-list --count 7f19229..HEAD` → **130**. `features` and `session_history` have never been written to.
- **Why it matters**: "last known good" is the harness's rollback anchor. Pointing it at the scaffolding commit means any automated recovery would discard the entire project. `environment_state: "healthy"` is also a stale literal — on this machine Docker is unreachable and 68 tests fail, which the harness's own `00-env.sh` would report as a WARN.
- **Blast radius**: 2
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Either have `harness/init.sh` write `last_known_good_commit` (and a real `environment_state`) after the `build.sh` verification passes, or delete the fields — a lying anchor is worse than no anchor.

### 16. Harness checks are correct but wired into nothing, and their README undercounts them

- **What & where**: `harness/checks/README.md:7-11` documents a three-row table (`build.sh`, `test.sh`, `lint.sh`) — but four scripts exist; `harness/checks/00-env.sh` (the preflight that produces the most useful diagnostics) is undocumented. The checks are invoked only by a copy-pasted loop in `CLAUDE.md:52-57` and by `harness/init.sh:41`. `git config core.hooksPath` → `scripts/hooks`, and the only hook there is the decision-log `pre-commit`, which runs no check. Separately, `scripts/render-fidelity-check.mjs` (a 40+ line documented harness proving the worker render path byte-matches a direct `renderAtlas`) is referenced by **nothing** — not `package.json`, not `harness/`, not any `.md`, verified by grep.
- **Why it matters**: three well-written checks and a bespoke fidelity harness exist and are load-bearing in intent, but nothing runs them. `render-fidelity-check.mjs` in particular guards ADR 0005's determinism claim and is pure dead weight as written.
- **Blast radius**: 3
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Add `00-env.sh` to the README table; add a `pre-push` hook in `scripts/hooks/` running `harness/checks/lint.sh` and `test.sh`; add `"fidelity": "node scripts/render-fidelity-check.mjs"` to the root `package.json` and run it in CI.

### 17. `.gitignore` ignores `docs/*`, so every ADR and spec the codebase cites is untracked

- **What & where**: `.gitignore:170-171`:
  ```
  docs/*
  !docs/decisions.md
  ```
  `git ls-files docs/` returns exactly one file: `docs/decisions.md`. Contradicted by:
  - `README.md:12` — "Architecture decisions are in [`docs/decisions/`](docs/decisions/)" → **broken link**; the path is a file (`docs/decisions.md`), not a directory.
  - `packages/map-sources/src/panel.ts:136` — "See docs/decisions/0003-map-panel-rendering.md" → **file does not exist in the repo**.
  - `CLAUDE.md:21` — "`docs/` — ADRs, specs, notes" → only the decision log is tracked.
  - `forge-project.json:15-16` — `spec_output_dir: "docs/specs"`, `notes_dir: "docs/notes"` → **neither directory exists**.
  - `vault/staged-build-roadmap.md:208,310,361,440,500` all direct work into `docs/decisions/`.
  - `docs/decisions.md:49` already records this as a known trap: *"The `docs/*` .gitignore means Phase C specs/ADRs (e.g. docs/decisions/0005) are untracked even when written."*
  ADR 0003, 0004 and 0005 are cited across `CLAUDE.md:19,25`, `forge-project.json:32`, and two C# source files — none of them can be read by anyone cloning the repo.
- **Why it matters**: the project's stated architectural constraints ("never reimplement projection math in C#", the render-worker determinism caveat) live in documents that do not survive a clone. New contributors and agents are pointed at citations that resolve to nothing.
- **Blast radius**: 3
- **Effort**: XS
- **Impact**: 4
- **Regression risk**: low
- **First step**: Change the ignore to something narrow (`docs/scratch/`, `docs/*.local.md`) and `git add` the ADR files that exist on disk; fix the `README.md:12` link to `docs/decisions.md` or create the directory it promises.

### 18. README "Status" and "Layout" are contradicted by the tree and by `git log`

- **What & where**: `/home/caleb/Projects/JourneyBook/README.md`:
  - `README.md:16-19` — "**Stage 0 — Foundation Skeleton.** Monorepo, headless atlas engine **stubs**…". `git log --oneline -60` shows Stage 6, 6B, 6C, and `09a1997 docs(roadmap): Stage 9 MVP polish core built`. The engine is 2,000 LOC with 59 tests; nothing here is a stub.
  - `README.md:40-41` — "`db/` Migrations + seeds". Verified: `infra/db/migrations/` and `infra/db/seeds/` contain **only `.gitkeep`**. The real migrations are EF Core code in `dotnet/JourneyBook.Infrastructure/Migrations/`.
  - `README.md:43` — "`docs/` Architecture decisions + specs" — see Finding 17.
  - `README.md:24-45` (Layout) omits `services/` entirely, including `services/render-worker` — a shipped, tested Fastify service that `CLAUDE.md:19` calls essential to the render path. It also omits `harness/`, `scripts/`, and `vault/audit-*`.
  - `services/geo-worker/` and `services/questpdf-renderer/` are `.gitkeep`-only stubs matched by `pnpm-workspace.yaml:4` (`services/*`) but with no `package.json` — harmless today, but they will silently join the workspace the moment anyone adds one.
  - `README.md:70` says `dotnet test dotnet/JourneyBook.Tests` while `CLAUDE.md:10` says `dotnet test JourneyBook.slnx`. Both were run; both work; they are just inconsistent.
  - `CLAUDE.md:59-91` — a 33-line block instructing every agent to query a SQLite code graph at `<repo root>/graphify-out/graph.db` **before** using Grep. Verified: `graphify-out/` **does not exist**, and `.gitignore:198` ignores it. Every session pays those tokens and then falls back to grep.
- **Why it matters**: the README is the first thing a new contributor (human or agent) reads, and its headline claim understates the project by nine stages. The `graphify-out` block is the costliest single instance — it is unconditional, prominent, and describes infrastructure that is not present.
- **Blast radius**: 2
- **Effort**: XS
- **Impact**: 3
- **Regression risk**: low
- **First step**: Rewrite `README.md:14-19` to the actual stage; add `services/`, `harness/`, `scripts/` to the Layout block; either generate `graphify-out/` in `harness/init.sh` or make the `CLAUDE.md` code-graph section conditional on the directory existing.

### 19. .NET build ships two high-severity CVE warnings and an unresolved EF Core version conflict, with no warning gate

- **What & where**: `dotnet build JourneyBook.slnx --nologo` → `12 Warning(s), 0 Error(s)`, including `NU1903` for `SSH.NET 2025.1.0` (transitive into `dotnet/JourneyBook.Tests/JourneyBook.Tests.csproj` via Testcontainers) and `NU1903` for `Microsoft.OpenApi 2.0.0` (`apps/api/JourneyBook.Api.csproj:11`), plus `MSB3277` resolving `Microsoft.EntityFrameworkCore` **10.0.4 over 10.0.9** in the test host. There is **no `Directory.Build.props`, no `Directory.Packages.props`, no `global.json`, and no `NuGet.config`** anywhere in the repo (verified by find). No project sets `TreatWarningsAsErrors`, `EnableNETAnalyzers`, `AnalysisLevel`, or `WarningsAsErrors`; the four csprojs set only `TargetFramework`, `ImplicitUsings` and `Nullable` (`JourneyBook.Api.csproj:5-8`, `JourneyBook.Domain.csproj:4-8`, `JourneyBook.Application.csproj:12-16`, `JourneyBook.Infrastructure.csproj:19-23`). Package versions are duplicated by hand across four files (`10.0.9` appears in three).
- **Why it matters**: 12 warnings on every build is 12 warnings nobody reads, so the next one — a real `CS8600` nullability leak, say — lands invisibly. The EF Core conflict means the **test host runs a different EF Core build than the app**, which is precisely the kind of divergence that makes an integration test pass while production fails. The four csprojs will drift further with every added package.
- **Blast radius**: 3
- **Effort**: S
- **Impact**: 3
- **Regression risk**: med (turning warnings into errors will initially break the build until the 12 are cleared)
- **First step**: Add a `Directory.Build.props` at the repo root setting `Nullable`, `ImplicitUsings`, `EnableNETAnalyzers`, `AnalysisLevel=latest` and `TreatWarningsAsErrors` (start with `WarningsAsErrors` scoped to a list, widen later); add `Directory.Packages.props` with `ManagePackageVersionsCentrally` to pin one EF Core version and clear `MSB3277`; bump `Microsoft.OpenApi` and Testcontainers to clear both `NU1903`s.

---

## Summary

| # | Finding | Blast | Effort | Impact | Risk |
|---|---|---|---|---|---|
| 1 | No CI pipeline exists at all | 5 | S | 5 | low |
| 2 | No test file is ever typechecked (proven: 0 files) | 4 | XS | 3 | low |
| 3 | No linter or formatter anywhere | 4 | S | 3 | low |
| 4 | 68/99 .NET tests hard-fail without Docker instead of skipping | 4 | S | 4 | low |
| 5 | `pdf-client` (797-LOC print renderer) has zero tests | 5 | M | 5 | low |
| 6 | The single e2e spec is in no test script and never runs | 3 | S | 4 | low |
| 7 | `renderMapPanel` composite/crop maths never exercised | 5 | M | 5 | low |
| 8 | `niceScaleBar` violates its documented contract, untested | 2 | XS | 3 | low |
| 9 | `buildPageGrid` has no coverage invariant; `overlap:1` dies opaquely | 4 | S | 4 | low |
| 10 | `enclosingBBox` returns a whole-world box across the antimeridian | 2 | S | 2 | low |
| 11 | No property/invariant tests; `pageBBoxAround` has no direct test | 4 | M | 4 | low |
| 12 | Validation + its own fidelity test share a hard-coded 8.5×11 sheet | 3 | S | 3 | med |
| 13 | Assert-nothing / premise-only tests (usng-grid, tilemath) | 2 | XS | 2 | low |
| 14 | No coverage measurement on either stack | 3 | XS | 3 | low |
| 15 | `harness/progress.json` 130 commits stale, empty history | 2 | XS | 3 | low |
| 16 | Harness checks + fidelity script wired into nothing | 3 | XS | 3 | low |
| 17 | `.gitignore docs/*` — every cited ADR/spec is untracked | 3 | XS | 4 | low |
| 18 | README Status/Layout and the `graphify-out` block contradict the tree | 2 | XS | 3 | low |
| 19 | Two CVE warnings + EF Core version conflict; no warning gate | 3 | S | 3 | med |

**Test health.** The geospatial engine is the best-tested part of the repo and it is genuinely good: `atlas-core` and `map-sources` use real external ground truth (609.6 m/in at 1:24,000, 110.57 km per degree of latitude, 156543 m/px at z0, `mgrs.forward` as an independent oracle for the USNG collar), `scale-fidelity.test.ts` and `route.test.ts` encode real invariants rather than restating the implementation, and the recent `pageBBoxAround` regression left behind a proper regression suite. The gaps are not in the maths that *is* tested but at the two boundaries either side of it — `renderMapPanel`'s tile composite/crop (Finding 7) and `AtlasDocument.tsx`'s page drawing (Finding 5) — which together own every remaining way a printed sheet can lie while the suite stays green. Around all of it, the process layer is absent: no CI, no lint, no coverage, no typechecked tests, a backend suite that cannot run locally, and an e2e spec nothing invokes.
