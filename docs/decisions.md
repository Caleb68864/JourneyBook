# Decision Log

Record fixes, workarounds, and intentional trade-offs here. A pre-commit hook (`scripts/hooks/pre-commit`) scaffolds a placeholder entry on any code commit that lacks one, and blocks commits whose decisions.md still contains an unfilled placeholder. Bypass (sparingly): `git commit --no-verify`.

Each entry follows this shape:

- **Symptom:** what the user / future reader experienced or saw.
- **Fix:** what was done.
- **Surfaces:** greppable tokens (file paths, symbol names) so future debugging can find this entry via `grep -r <token> docs/decisions.md`.
- **Watch:** what could go wrong next, or a related edge case. Use "None" if nothing applies.
- **Commit:** the commit SHA the Fix landed in (filled at commit time, can be "(pending)").

**Never include secrets, tokens, connection strings, or PII in entries — this file is committed.**

---

## 2026-06-24 — Install decision log enforcement
- Symptom: No structured record of why changes were made across this repo's history.
- Fix: Installed pre-commit decision-log enforcement per forge-init Step 6g (mixed Node/TS + .NET filter).
- Surfaces: scripts/hooks/pre-commit, docs/decisions.md, CLAUDE.md, forge-project.json
- Watch: Commits bypassing with `--no-verify` escape the log; the factory's `[factory-managed]` commits (committer email == forge.json git_username "caleb") are intentionally exempt.
- Commit: (populated at commit time)

## 2026-06-24 — Stage 3 (tile proxy + cache) implemented by hand after the dark factory left it unbuilt
- Symptom: The dark-factory run for Stage 3 ended `partial_success` — the foreground run hit the harness's 10-min Bash cap mid-`verify-integrated` (killed), and the resume cascade-blocked on SS-01's whole-solution `dotnet test` gate while the gap-sweep went inconclusive on sustained 429s. Worker code was uncommitted and lost in the kill/resume branch juggling; only an orphaned `AddTileSourceKind` migration (no matching entity property, no ModelSnapshot update) survived.
- Fix: Discarded the throwaway factory branches + orphan migration, branched fresh from master, and implemented all 5 sub-specs directly with TDD against the forged/red-teamed spec. SS-01: `TileSource.Kind` discriminator (`usgs-raster`/`xyz-server`/`pmtiles`, default `usgs-raster`) + EF migration + DTO/service mapping. SS-02: `TileCache` (disk, path-confined via the `GeneratedPdfService.TryDeleteArtifact` idiom, discovered-ext lookup, atomic temp+rename), `RasterXyzFetcher` (typed HttpClient w/ timeout, literal `{z}/{x}/{y}` template replacement), `ITileService`/`TileService` (outcome-enum result — refined from the spec's nullable+bool default because the endpoint must distinguish 200/204/400/404/502). SS-03: `GET /api/tiles/{source}/{z}/{x}/{y}` + DI registration. SS-04: hand-rolled PMTiles v3 reader (header + varint directory + Hilbert tile-id + leaf recursion + gzip), `PmTilesFetcher` (local archives confined to `TileCache:PmTilesDir`; remote via `HttpRangeStream`), code-generated fixture. SS-05: `renderMapPanel` `tileBaseUrl`/`cacheDir` options + Node `tilecache.ts` honoring the same key + `--tile-base-url`/`--tile-source`/`--tile-cache-dir` CLI flags.
- Surfaces: apps/api/Endpoints/TileEndpoints.cs, dotnet/JourneyBook.Infrastructure/Tiles/, dotnet/JourneyBook.Application/Tiles/ITileService.cs, dotnet/JourneyBook.Infrastructure/DependencyInjection.cs, packages/map-sources/src/tilecache.ts, packages/map-sources/src/panel.ts, packages/render-cli/src/cli.ts, resolveTileUrl, PmTilesReader, ZxyToTileId, TileCache, AddTileSourceKind
- Watch: PMTiles remote (`http(s)`) archives use `HttpRangeStream` and are NOT covered by an automated test (only the local-file fixture path is) — verify a real remote archive before relying on it. The whole-solution `dotnet test` gate means a compile error in any sub-spec fails the first sub-spec's gate under strict-order; build incrementally. The dark factory's worker output must be committed per-sub-spec or it does not survive a kill/resume.
- Commit: (pending)

## 2026-06-24 — Stage 2C-2E SS-04 wiring gaps left by the dark factory
- Symptom: After the dark-factory run (partial_success — SS-01 hollow-success deferred under strict-order; gap-sweep bailed on sustained 429s), the GeneratedPdfs API tests failed. Mapping the endpoints then cratered the WHOLE suite to 26 failures (every endpoint 500'd with "Failure to infer one or more parameters: service → UNKNOWN").
- Fix: The SS-04 worker created GeneratedPdfEndpoints + GeneratedPdfService but never (a) wired `app.MapGeneratedPdfEndpoints()` into Program.cs nor (b) registered `AddScoped<IGeneratedPdfService, GeneratedPdfService>()`. An unresolved minimal-API service param fails the entire route-table build, not just that endpoint. Added both. Also fixed a test that asserted byte-exact equality of a `jsonb` column (Postgres normalizes key order/whitespace) → compare with `JsonNode.DeepEquals`.
- Surfaces: apps/api/Program.cs, dotnet/JourneyBook.Infrastructure/DependencyInjection.cs, dotnet/JourneyBook.Tests/Api/GeneratedPdfsApiTests.cs, MapGeneratedPdfEndpoints, IGeneratedPdfService, SourceMetadataSnapshot
- Watch: A missing minimal-API DI registration is a whole-app failure (route table build), not a localized 404/500 — check DI registration first when many endpoints 500 at once. Factory strict-order + a hollow-success on the first sub-spec blocks all downstream sub-specs.
- Commit: (populated at commit time)

## 2026-06-24 — Converge: path-traversal confinement was code-correct but untested
- Symptom: /forge-converge adversarial pass flagged that GeneratedPdfService prune's path-confinement guard (red-team C-1) was implemented correctly but had NO test exercising a `..`/escape FilePath — "Met by reading" is unverified.
- Fix: Added GeneratedPdfsApiTests.Prune_does_not_delete_files_outside_the_generated_dir — plants a sentinel outside data/generated, points a record's FilePath at it, prunes, asserts the sentinel survives while the record is removed. Fails if the StartsWith(root) guard is broken.
- Surfaces: dotnet/JourneyBook.Tests/Api/GeneratedPdfsApiTests.cs, GeneratedPdfService.TryDeleteArtifact, Prune_does_not_delete_files_outside_the_generated_dir
- Watch: Security guards that are correct-by-reading still need an executed negative test; the converge adversarial pass is what surfaced it.
- Commit: (populated at commit time)

## 2026-06-24 — Converge (Phase C): render-cli/render-worker shipped without tests; build "passed" hid a stale-install failure
- Symptom: The Phase C dark-factory run ended `partial_success` reporting SS-05 as a real `apps/web` build failure and SS-06 as blocked. On the canonical branch the failure did NOT reproduce: `pnpm install` resolved the worker-added `maplibre-gl` dep and `pnpm -r build` + 67 backend tests went green. The /forge-converge adversarial scan instead found the true gap — SS-01's `renderAtlas` and SS-02's render-worker route had ZERO automated tests (render-cli never had a test script; the worker package had none), so their `[MECHANICAL]`/`[BEHAVIORAL]` acceptance criteria were "met by reading" only.
- Fix: Added `packages/render-cli/src/render.test.ts` (4 tests: location/bbox PDF output, unknown-preset + missing-center throws) and `services/render-worker/src/render-route.test.ts` (5 tests: render→200 + relative path, traversal→400, absolute→400, missing-field→400, unknown-preset→400 via Fastify `inject`). Wired vitest into both packages (`test` script + devDep + `exclude` of `**/*.test.ts` from `tsc -b` so the build still emits only `src`).
- Surfaces: packages/render-cli/src/render.test.ts, packages/render-cli/package.json, packages/render-cli/tsconfig.json, services/render-worker/src/render-route.test.ts, services/render-worker/package.json, services/render-worker/tsconfig.json, renderAtlas, renderRoute
- Watch: A factory `partial_success` build failure can be a stale-install artifact (worker edits package.json but the run never re-installs) — reproduce on the branch with a fresh `pnpm install` before treating it as a code defect. A green `tsc -b`/build is not coverage: assert behavior with executed tests, never by reading. The `docs/*` .gitignore means Phase C specs/ADRs (e.g. docs/decisions/0005) are untracked even when written.
- Commit: (populated at commit time)

## 2026-06-25 — Converge (Phase C): C#→worker render contract was mismatched; stub hid it
- Symptom: The /forge-converge adversarial pass found that the real C#→render-worker render call would 400 on every request. `HttpRenderWorkerClient` POSTed the C# `RenderWorkerRequest` verbatim — `{scalePresetId, tier, orientation, overlap, margins, extent, locations, outputFileName}` — but the Fastify worker's `POST /render` requires the TS engine's `RenderAtlasInput` shape — `{mode, bbox|center, scalePresetId, tier, outputPath}`. Missing `mode`/`outputPath` → worker 400; `extent`≠`bbox`, `locations`≠`center`. The `RenderApiTests` passed only because they inject a `FakeRenderWorkerClient` that never validates the wire shape, so a stub masked a production-breaking defect.
- Fix: `HttpRenderWorkerClient` now maps `RenderWorkerRequest` → a `WorkerRenderPayload` matching `RenderAtlasInput` (extent → `mode:"bbox"` + `bbox:[W,S,E,N]`; else first location → `mode:"location"` + `center:{lng,lat}`; `outputFileName` → `outputPath`; `basemap:true`; throws if neither extent nor locations). Added `HttpRenderWorkerClientTests` (3 tests) that capture the outgoing JSON via a stub `HttpMessageHandler` and assert the worker-contract fields are present and the legacy C# fields (`extent`/`locations`/`outputFileName`/`margins`/`orientation`) are absent — verification a fake client cannot provide.
- Surfaces: dotnet/JourneyBook.Infrastructure/Rendering/HttpRenderWorkerClient.cs, dotnet/JourneyBook.Tests/Rendering/HttpRenderWorkerClientTests.cs, RenderWorkerRequest, RenderAtlasInput, ToWirePayload
- Watch: When two services are bridged by an injected client interface, an integration test that stubs that interface verifies NOTHING about the cross-service wire contract — test the real serializer against the consumer's required shape. A C# record POSTed with camelCase is still the C# field set, not the peer's contract.
- Commit: (populated at commit time)

## 2026-06-25 — Converge (Phase C): the React API client drifted from the C# DTOs across several fields
- Symptom: A second /forge-converge adversarial pass (web↔API seam) found the SS-05 web client `apps/web/src/api/client.ts` did not match the tested C# contracts: (1) location create POSTed `{label,...}` but `CreateLocationRequest` requires `Name` → null-name locations; (2) the list/markers read `loc.label` (which is the L-series id "L1", not the name) → wrong display; (3) `PUT /extent` was sent `{extent:[w,s,e,n]}` but the endpoint binds a `BBoxDto {west,south,east,north}` directly → extent saved as zeros, and `project.extent` (a C# object) was array-destructured → undefined; (4) `Project`/create carried a `tier` field the API neither accepts nor returns, while the render call sent no tier → the TierPicker was dead and every render used tier 1; (5) `RenderResult` read `jobId` instead of the returned `generatedPdfId`.
- Fix: Made `client.ts` the single adapter between the C# wire shapes and the web's internal `BBox` tuple — `normalizeProject` maps the extent object→`[W,S,E,N]`; `setExtent` sends the unwrapped `{west,south,east,north}`; location create sends `name`; `Location` exposes both `name` (display) and `label` (L-series badge); render carries the chosen `tier` in the body; `RenderResult` uses `generatedPdfId`/`downloadUrl`. Threaded tier as local editor state (no project-level tier field exists) into `GenerateButton`. Updated LocationList/MapPreview/ProjectListPage/ProjectEditorPage to the corrected shapes. `pnpm --filter @journeybook/web build` (tsc -b + vite) clean.
- Surfaces: apps/web/src/api/client.ts, apps/web/src/components/{GenerateButton,LocationList,MapPreview}.tsx, apps/web/src/routes/{ProjectListPage,ProjectEditorPage}.tsx, normalizeProject, setExtent
- Watch: A frontend hand-written against an API it doesn't share types with WILL drift — field names (`name` vs `label`), wrapping (`{extent:…}` vs the bare DTO), and array-vs-object extent are the classic breaks; a green `tsc` does not catch them because the client declared its own (wrong) interfaces. Consider generating the web client types from the C# contract. Full request/response parity here was verified by reading both sides + type-check + the 70 backend tests; live browser→API→worker round-trip remains manual (Docker).
- Commit: (populated at commit time)
