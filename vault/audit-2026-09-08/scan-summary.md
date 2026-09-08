# JourneyBook Audit — Consolidated Ranked Findings

Audit date **2026-09-08** · working tree at `c36f69f` · five scan passes, all reading real code.

| Pass | File | Findings |
|---|---|---|
| 1 Architecture | `scan-1-architecture.md` | 17 |
| 2 Correctness (geo/print maths) | `scan-2-correctness.md` | 18 + 6 verified-correct |
| 3 Hardening | `scan-3-hardening.md` | 20 |
| 4 Tests & DX | `scan-4-tests-dx.md` | 18 (+ full toolchain run log) |
| 5 Features & UX | `scan-5-features-ux.md` | 22 (12 weak / 6 stubbed / 4 absent) |

## Toolchain status (actually executed, not assumed)

- `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` — **all PASS, 138/138 TS tests**.
- `dotnet build JourneyBook.slnx` — **PASS**, 12 warnings incl. 2 high-severity CVE advisories
  (NU1903: SSH.NET, Microsoft.OpenApi) and an EF Core 10.0.4↔10.0.9 version conflict.
- `dotnet test --filter "!~Api"` — **PASS 27/27**. Full `dotnet test` — **68 failed / 31 passed**,
  every failure `DockerUnavailableException` (docker socket permission denied on this machine).
- `pnpm` was not on PATH; recovered from `~/.local/share/pnpm/.tools/`.
- No linter, no coverage, no CI. The single Playwright e2e spec is in no test script.

---

## THE HEADLINE

**The printed map is ~30% smaller than the scale bar under it claims, and nothing in the repo can
detect that.** Verified numerically: a nominal 1:24,000 page prints at **~1:31,200**; a bar labelled
"2 km" prints 3.281 in where its true length is 2.521 in. Three of the five passes reached this
independently, from different directions. It is the product's one differentiating promise, and it is
not met. See `scan-2-correctness.md` P2-1 and `scan-5-features-ux.md` A1.

The cause is a seam, not a formula: `groundFootprintMeters` sizes every page bbox from the **full
printable area** (7.5 × 10 in), while `AtlasDocument` draws that bbox into a panel that is
**415 pt (5.76 in)** wide after the neatline border/padding and two fixed 54 pt edge-label columns.
Every underlying maths function is correct in isolation — which is exactly why the test suite is
green.

---

## Ranked findings — best value first

Ranking favours small blast radius + low effort + high impact. The flagship print-fidelity items are
promoted above strict value order because everything else in the product inherits them.

| # | Finding | Where | Blast | Effort | Impact | Risk | Pass |
|---|---|---|---|---|---|---|---|
| 1 | USNG grid labels computed then discarded — Tier 3 grid is unreadable | `pdf-client/src/AtlasDocument.tsx:354-373` vs `map-sources/src/usng-grid.ts:123-139` | 2 | XS | 5 | low | 2/5 |
| 2 | Every vector overlay drawn in a square `viewBox` on a non-square panel → letterboxed & offset | `AtlasDocument.tsx:207,263,359,410,611` | 3 | XS | 5 | low | 1/2/5 |
| 3 | `buildPageGrid` materializes every page *before* the 200-page cap | `atlas-core/src/grid.ts:102-134` vs `render-cli/src/render.ts:412` | 4 | XS | 5 | low | 3 |
| 4 | **Printed scale ~30% wrong** — panel box ≠ the printable area the bbox was sized from | `atlas-core/src/page.ts:41-61`, `AtlasDocument.tsx:520-552,121-139` | 4 | M | 5 | med | 2/5 |
| 5 | Nothing ever measures a rendered PDF; `pdf-client` (797 LOC) has zero tests | `atlas-core/src/validation.ts:54-77`, `packages/pdf-client/` | 4 | M | 5 | low | 2/4/5 |
| 6 | Both tile caches return half-written `.tmp` files as hits | `map-sources/src/tilecache.ts:35,61`, `Infrastructure/Tiles/TileCache.cs:35,64-67` | 3 | XS | 4 | low | 3 |
| 7 | `.dockerignore` omits `.env` → secrets baked into two images | `/.dockerignore`, `infra/docker/*.Dockerfile` | 3 | XS | 4 | low | 3 |
| 8 | SSRF: anonymous POST registers a tile-source URL the server then fetches and returns | `TileSourceEndpoints.cs:11`, `RasterXyzFetcher.cs:25-32`, `TileEndpoints.cs:73` | 5 | S | 5 | low | 3 |
| 9 | Failed tiles become parchment; the render reports success | `map-sources/src/panel.ts:165,186-197`, `render.ts:443` | 4 | S | 5 | low | 3 |
| 10 | No CI pipeline at all — 165 green tests enforced by nobody | `.github/` absent | 5 | S | 5 | low | 4 |
| 11 | Grid page ids collide with the `L#`/`R#` namespaces the renderer dispatches on | `atlas-core/src/grid.ts:15-29`, `AtlasDocument.tsx:536-541` | 3 | S | 4 | med | 1 |
| 12 | Panel `objectFit: "cover"` at tier 1-2 vs stretch at tier 3+ — two geometries, one atlas | `AtlasDocument.tsx:529-533,606` | 2 | XS | 3 | low | 2/5 |
| 13 | No exception handler → ordinary bad input returns an unhandled 500 (stack traces in Dev) | `apps/api/Program.cs:40-71`, `GeneratedPdfService.cs:141`, `TileService.cs:32-38` | 4 | XS | 3 | low | 3 |
| 14 | Node tile fetch: no timeout, no retry, no concurrency cap, no `User-Agent` | `map-sources/src/panel.ts:101-109,153-165` | 4 | S | 4 | low | 2/3 |
| 15 | PDF prints a hardcoded attribution; the real one is plumbed to four layers and dropped | `AtlasDocument.tsx:562-564`, `render.ts:565-567`, `panel.ts:206` | 3 | S | 4 | low | 2/3/5 |
| 16 | Compose defaults to `Development` with a shipped default DB password on a published port | `infra/compose/docker-compose.yml:15-17,35` | 4 | S | 4 | low | 3 |
| 17 | Scale picker is a no-op after project creation — the headline setting silently doesn't apply | `ProjectEditorPage.tsx:111-117`, `api/client.ts:189` | 3 | S | 4 | low | 5 |
| 18 | No test file is ever typechecked (proven via `tsc --listFiles`) | `packages/*/tsconfig.json` (`exclude: **/*.test.ts`) | 4 | XS | 3 | low | 4 |
| 19 | Tier 4 selectable in the UI, renders exactly as Tier 3 (roadmap says deferred; picker doesn't) | `TierPicker.tsx:7`, `AtlasDocument.tsx:487-488` | 2 | XS | 4 | low | 2/5 |
| 20 | Render is one synchronous request: serial panels, no progress, no ETA, no cancel | `GenerateButton.tsx:23-38`, `render.ts:440-453`, `RenderService.cs:117` | 4 | M | 5 | med | 5 |
| 20b | Render worker takes the entire engine input off the wire unvalidated; `cacheDir` writes tiles to any absolute path | `services/render-worker/src/render-route.ts:43,75` → `tilecache.ts:46` | 3 | S | 4 | low | 1 |
| 21 | `renderMapPanel` composite/crop maths untested — the test stubs every fetch to 404 | `map-sources/src/panel.test.ts:38-43` | 5 | M | 5 | low | 4 |
| 22 | Persisted margins / orientation / gutter dropped at the worker wire | `HttpRenderWorkerClient.cs:33-58`, `render.ts:317-408` | 3-4 | S-M | 3-4 | med | 1/5 |
| 23 | No linter or formatter anywhere; the load-bearing `./model.js` import rule is convention-only | repo-wide; `harness/checks/lint.sh:2` admits it | 4 | S | 3 | low | 4 |
| 24 | Neither tile cache ever evicts; per-source `TileCachePolicy` ignored | `tilecache.ts`, `TileCache.cs`, `ValueObjects/TileCachePolicy.cs` | 3 | M | 3 | low | 3 |
| 25 | All panels held simultaneously as base64 data URIs (~128 MB JPEG / ~750 MB PNG at the cap) | `render-cli/src/render.ts:444` | 3 | M | 3 | med | 2/3 |
| 26 | Unpaged list endpoints, tracked read queries | `apps/api/Endpoints/*.cs`, Infrastructure services | 3 | S | 3 | low | 3 |
| 27 | ADRs the code cites as binding are untracked (`.gitignore:170` `docs/*`) | `.gitignore:170`, `panel.ts:136` | 4 | XS | 3 | low | 4 |
| 28 | Location CSV parsing implemented twice (C# + TS) and already diverged | `Infrastructure/Locations/LocationCsv.cs`, `render-cli/src/locations.ts` | 3 | M | 3 | low | 1 |
| 29 | Scale presets declared in three places with no consistency check | `atlas-core/src/model.ts:54-60` + backend + web | 3 | S | 3 | low | 1 |
| 30 | `effectiveDpi` is dead code; no minimum print-DPI guard; docstring arithmetic wrong | `atlas-core/src/validation.ts:105-108`, `render.ts:113-117` | 2 | S | 3 | low | 2 |
| 31 | Landmark legend overlaps the reference-grid border labels | `AtlasDocument.tsx:~480-510` | 1 | XS | 3 | low | 5 |
| 32 | Binder gutter always added to the left — wrong on every verso page | `atlas-core/src/page.ts:45-50`, `AtlasDocument.tsx:496-501` | 2 | S | 3 | low | 5 |
| 33 | Stage 4 brand landing page (`Hero.tsx`, 238 LOC) is never mounted | `apps/web/src/components/Hero.tsx` | 1 | XS | 2 | low | 1/5 |
| 34 | Default page `overlap` is 0 → pin-point holes where four pages meet | `atlas-core/src/grid.ts:75` | 1 | XS | 2 | low | 2 |
| 35 | `harness/progress.json` 130 commits stale; README still says "Stage 0 — stubs" | `harness/progress.json`, `README.md:17-20` | 1 | XS | 2 | low | 4 |

Lower-ranked items (corridor step by page width, USNG clamp-not-clip, USNG collar from centre only,
antimeridian handling, `niceScaleBar` contract violation, `zoomForBBox` 2× overshoot, Application-layer
shell, dead `AtlasPage` schema, TileSource registry unreachable from the UI, no cover page, no page-size
choice, no URL routing) are documented in full in the individual pass files.

---

## Recommended first move

**Fix the print-fidelity chain and land a test that measures the rendered PDF** — items 1-5 above, in
that order. Items 1, 2 and 3 are XS wins that can be done in a single sitting and each independently
improves a printed page. Item 4 is the real work: make the *renderer* the source of truth for the
printed map box (export the layout constants from `pdf-client`, derive `printableAreaInches` from
them, feed that into `groundFootprintMeters`). Item 5 is what stops it recurring: a test that opens
the produced PDF, measures the panel rectangle and the scale-bar rectangle, and asserts
`barLength / panelWidth == barGroundMetres / pageFootprintMetres`. Write item 5's test *first* and
watch it fail at 30% — that is the missing feedback loop that let this ship as "verified".

Do items 6-10 (cache `.tmp` hits, `.env` leak, SSRF, silent blank tiles, CI) in the same pass; they
are cheap, low-risk, and item 10 is what keeps the rest of the list from regressing.
