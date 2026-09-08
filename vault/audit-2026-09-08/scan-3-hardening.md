# Scan 3 — Robustness & Hardening

Pass 3 of the 2026-09-08 audit. Scope: tile-fetch resilience, pathological
geometry inputs, API input validation / SSRF, data layer, and ops. Verified
against `c36f69f` (`feat(locations): zoom ladders and pins…`). No source was
modified.

Conventions: **Blast radius** 1–5 = how much of the system a failure reaches.
**Impact** 1–5 = severity if it fires. "Stub" means not built yet; everything
below is built-and-wrong or built-and-unguarded unless said otherwise.

---

## Findings

### F1. Node-side tile fetch has no timeout, no retry, no concurrency cap, and no User-Agent

**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:101-109`
is the entire fetch path:

```ts
async function fetchTile(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
```

No `AbortSignal.timeout`, no `headers`, no retry. `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:153-165`
then fires every covering tile at once: `jobs.push(loadTile(...))` inside the
`ty`/`tx` double loop, resolved with a single `await Promise.all(jobs)`.

**Why it matters** A stalled upstream socket hangs a render indefinitely (Node's
`fetch` has no default timeout), a single transient 503 permanently blanks a tile
(see F4), and one page at the default `panelWidthPx: 1000` issues ~35 simultaneous
GETs — with the render-worker having no job cap (F9) that is unbounded fan-out at
one upstream. The missing User-Agent is a direct violation of the identifiable-UA
requirement in `/home/caleb/Projects/JourneyBook/vault/licensing-and-attribution/osm-tile-usage-policy.md:14`
and of Nominatim/Overpass-style policies generally; the .NET side already gets this
right for Overpass and Nominatim (`DependencyInjection.cs:86`, `:99`) but not here.
Contrast the C# fetcher, which does at least get a configured timeout
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:50-52`).

**Blast radius** 4 · **Effort** S · **Impact** 4 · **Regression risk** low

**First step** In `fetchTile`, pass `{ signal: AbortSignal.timeout(ms), headers: { "User-Agent": … } }`
and wrap in a 2-attempt backoff; replace the `Promise.all(jobs)` in
`renderMapPanel` with a fixed-width worker pool (6–8).

---

### F2. Both tile caches can return a half-written temp file as a cache hit

**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/TileCache.cs:35`
looks up `Directory.EnumerateFiles(dir, $"{y}.*").FirstOrDefault()`, while
`TileCache.cs:64-67` writes:

```csharp
var path = Path.Combine(dir, $"{y}.{ext}");
var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
File.WriteAllBytes(temp, bytes);
```

`5.png.tmp-abc…` matches the glob `5.*`. The Node cache has the identical defect:
`/home/caleb/Projects/JourneyBook/packages/map-sources/src/tilecache.ts:35`
(`f.startsWith(`${y}.`)`) against the temp name built at `tilecache.ts:61`.

**Why it matters** This defeats the atomicity both files' doc comments claim
("so a concurrent reader never sees a torn tile", `TileCache.cs:11`). A reader
racing a writer, or hitting an orphaned temp left by a crash/full disk, gets
truncated bytes with `ext = "tmp-abc…"`, which `TileService.ContentTypeFor`
(`TileService.cs:72-78`) then labels `image/png`. Corrupt tiles are sticky —
the orphan is never cleaned up, so the bad hit repeats forever.

**Blast radius** 3 · **Effort** XS · **Impact** 4 · **Regression risk** low

**First step** Write temp files to a sibling `.tmp/` directory (or prefix them,
e.g. `.tmp-<guid>-5.png`) so they cannot match the `{y}.*` lookup glob; add a
regression test that stores a tile and asserts a concurrent `TryGet` never
returns a `tmp` extension.

---

### F3. The Node cache stores every tile as `.png` regardless of what came back

**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:126-128`:

```ts
if (buf && options?.cacheDir) {
  await storeCachedTile(options.cacheDir, cacheSource, z, x, y, "png", buf);
}
```

`fetchTile` (`panel.ts:101`) discards `res.headers.get("content-type")` entirely.
When routed through the C# proxy (`tileBaseUrl`), that proxy legitimately serves
`image/jpeg`, `image/webp` and `application/x-protobuf`
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/TileService.cs:64-70`).

**Why it matters** The two caches are explicitly documented as sharing one key
space and one directory (`tilecache.ts:1-7`, `TileCache.cs:5-8`). Writing JPEG or
MVT bytes under a `.png` name poisons that shared cache for the C# reader, which
trusts the extension to derive the response `Content-Type`. `sharp` sniffs magic
bytes so the Node render still works — which is exactly why this is silent.

**Blast radius** 3 · **Effort** XS · **Impact** 3 · **Regression risk** low

**First step** Return the content-type from `fetchTile`, map it through the same
table `TileService.ExtFor` uses, and pass the real extension into
`storeCachedTile`.

---

### F4. A failed tile becomes parchment; the atlas still reports success

**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/panel.ts:165`
drops every failure on the floor: `const placements = (await Promise.all(jobs)).filter((p) => p !== null);`
The gaps are composited over `PANEL_BACKGROUND` (`panel.ts:12`, `:178-187`), and
for JPEG explicitly flattened so the holes are invisible (`panel.ts:192-197`).
`renderMapPanel` never reports how many tiles it lost, and
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:443-451` only
catches a thrown error — which cannot happen, because nothing throws.

**Why it matters** The failure mode of the product's core deliverable is a
plausible-looking blank map. A user who prints a 40-page atlas for a trip finds
out in the field. There is no counter, no log line, no threshold, and the
render-worker's `isUpstreamError` classifier (`render-route.ts:11-25`) can never
fire for this path, so a total upstream outage returns HTTP 200.

**Blast radius** 4 · **Effort** S · **Impact** 5 · **Regression risk** low

**First step** Have `renderMapPanel` return `{ tilesRequested, tilesFailed }` on
`MapPanel`; in `renderAtlas`, throw a message containing "tile" when the miss
fraction exceeds a threshold (so the worker maps it to 502), and log per-page
counts otherwise.

---

### F5. Neither tile cache ever evicts, and both ignore the per-source cache policy

**What & where** `/home/caleb/Projects/JourneyBook/packages/map-sources/src/tilecache.ts:6`
states the position outright: "No TTL — eviction is a Stage 7 concern."
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/TileCache.cs`
has no delete/expiry member at all. Meanwhile the registry carries a real policy
per source — `MaxAgeSeconds` and `OfflineAllowed`
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Persistence/Configurations/TileSourceConfiguration.cs:21-26`,
seeded `86400` / `false`) — and `TileService.GetTileAsync` reads neither: it caches
unconditionally at `TileService.cs:58` and serves any hit at `:42-44`.

**Why it matters** Two problems. Operationally, `data/cache` is a bind mount
(`infra/compose/docker-compose.yml:55`) that grows without bound — a few large
renders is gigabytes, and there is no prune endpoint (unlike generated PDFs,
which have `POST /api/generated-pdfs/prune`). Legally, `OfflineAllowed: false`
is the flag that encodes "this provider forbids building an offline package,"
and the cache honours it nowhere; combined with the unbounded retention this is
the exact pattern `vault/licensing-and-attribution/caching-restrictions.md` and
the OSM policy warn about.

**Blast radius** 3 · **Effort** M · **Impact** 3 · **Regression risk** low

**First step** Have `TileService` pass `source.Cache` into `TileCache.TryGet`
(treat a file older than `MaxAgeSeconds` as a miss) and skip `Store` when
`OfflineAllowed` is false; add an LRU/size-cap sweep reusing the
`PruneExpiredAsync` shape.

---

### F6. SSRF: an unauthenticated caller registers a tile-source URL the server then fetches

**What & where** `POST /api/tile-sources`
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/TileSourceEndpoints.cs:11-22`)
persists `request.SourceUrl` with no scheme, host, or shape validation —
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/TileSources/TileSourceService.cs:20`
is a bare `SourceUrl = request.SourceUrl`. `RasterXyzFetcher` then does token
substitution and fetches it verbatim
(`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Tiles/RasterXyzFetcher.cs:25-32`),
and `GET /api/tiles/{source}/{z}/{x}/{y}` returns the response body to the caller
(`TileEndpoints.cs:73`). `PmTilesFetcher` takes the same URL for `http(s)`
(`PmTilesFetcher.cs:27-33`) via `HttpRangeStream`.

**Why it matters** `http://169.254.169.254/latest/meta-data/…`,
`http://db:5432/`, or any internal host is reachable, and the bytes come back to
the attacker with a 200. The route group is explicitly anonymous
(`TileEndpoints.cs:13`) and there is no auth on `/api/tile-sources` either. The
`file://` case *was* thought about — `PmTilesFetcher.cs:37-43` confines local
paths to `TileCache:PmTilesDir` — so the local-file half is hardened and the
network half is not. Also unvalidated on the same request: `MaxZoom` (an
arbitrary int that becomes the only zoom ceiling, `TileService.cs:27`) and `Kind`
(an unknown value throws `NotSupportedException` at `TileService.cs:38` → see F15).

**Blast radius** 5 · **Effort** S · **Impact** 5 · **Regression risk** low

**First step** Validate on write in `TileSourceService.CreateAsync`/`UpdateAsync`:
require `https?` scheme, require the `{z}`/`{x}`/`{y}` tokens for XYZ kinds,
reject literal/loopback/link-local/private hosts, bound `MaxZoom` to 0–24, and
constrain `Kind` to the set the fetchers actually handle.

---

### F7. `buildPageGrid` materializes every page before the `MAX_ATLAS_PAGES` guard runs

**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/grid.ts:102-134`:

```ts
const columns = Math.max(1, Math.ceil(extentWidth / stepX));
const rows = Math.max(1, Math.ceil(extentHeight / stepY));
…
for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) { … pages.push({ … }) }
```

`rows`/`columns` are unbounded, and each iteration calls `projector.inverse` plus
`pageBBoxAround` (which itself builds a fresh proj4 projector,
`/home/caleb/Projects/JourneyBook/packages/atlas-core/src/projection.ts:98`). The
200-page cap (`packages/atlas-core/src/model.ts:92`) is only checked *after* the
array is fully built, at
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:412-416`.

**Why it matters** A continental extent at `usgs-7-5-min` (≈4.5 km page
footprint) implies millions of rows × columns; the process hangs or OOMs before
it can reject the request. The route path already learned this lesson and checks
early — `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/route.ts:114-119`
caps `candidates.length` *before* the O(n²) dedup, with a comment explaining
exactly why. The grid path did not get the same treatment. Reachable from
`POST /api/projects/{id}/render` with any extent (see F11) and from
`POST /render` on the worker with `mode: "bbox"`.

**Blast radius** 4 · **Effort** XS · **Impact** 5 · **Regression risk** low

**First step** In `buildPageGrid`, compute `rows * columns` and throw the same
`Invalid request: … exceeds the ${MAX_ATLAS_PAGES}-page limit` message before
entering the loop, mirroring `route.ts:114`.

---

### F8. Antimeridian pages silently degrade to a whole-world bbox

**What & where** `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/projection.ts:106-108`
takes a naive min/max over the four projected corners:

```ts
const lngs = corners.map((c) => c.lng);
return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
```

For a page centred near ±180°, one corner wraps to the opposite sign, so the
"page" bbox spans ~360°. `/home/caleb/Projects/JourneyBook/packages/atlas-core/src/extent.ts:33-40`
(`enclosingBBox`, used by `--cover` and the web "Enclose N Locations") has the
same flaw for stops straddling the line. `validateInput`
(`render.ts:185-199`) checks ranges and `w < e` but nothing about wrapping.

**Why it matters** `zoomForBBox` then picks z≈2 instead of z≈15
(`packages/map-sources/src/tilemath.ts:40-49`), so the page prints the whole
world at the wrong scale — and `validateAtlas`'s footprint check
(`packages/atlas-core/src/validation.ts:57-72`) fails, so the atlas is rejected
or, in the render path which never calls it, ships a scale bar that lies. In the
`enclosingBBox` case it also feeds F7 directly. Narrow geography (Fiji, NZ, the
Aleutians), which is why it has not been noticed, but it is a wrong answer rather
than an error.

**Blast radius** 2 · **Effort** M · **Impact** 4 · **Regression risk** med

**First step** Detect the wrap in `pageBBoxAround` (corner span > 180°) and
either normalise to a continuous ±180-crossing bbox or reject with an
`Invalid …` message; do the same in `enclosingBBox`. Add fixtures at lng 179.99
and −179.99.

---

### F9. render-worker has no job concurrency cap and no render deadline

**What & where** `/home/caleb/Projects/JourneyBook/services/render-worker/src/server.ts:11-15`:

```ts
const app = Fastify({ logger: true, bodyLimit: 64 * 1024, requestTimeout: 120_000 });
```

The comment claims this bounds "request time … so a stalled upstream tile fetch
can't pin a connection open forever," but Fastify's `requestTimeout` maps to
Node's `server.requestTimeout`, which bounds *receiving* the request, not
producing the response. `/home/caleb/Projects/JourneyBook/services/render-worker/src/render-route.ts:42-75`
calls `renderAtlas` with no `AbortSignal`, no queue, and no in-flight counter.

**Why it matters** N concurrent POSTs run N full renders, each holding every
page's panel in memory (F10) and each fanning out unbounded tile fetches (F1).
The API side does have a client-side ceiling
(`RenderWorker:TimeoutSeconds`, default 120s,
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:63-68`)
but that only abandons the HTTP call — the worker keeps rendering. There are no
container memory/CPU limits either (`infra/compose/docker-compose.yml:57-79`), so
the OOM killer is the only backstop.

**Blast radius** 4 · **Effort** S · **Impact** 4 · **Regression risk** low

**First step** Add a semaphore (default 1–2) around the `renderAtlas` call
returning 429 when saturated, thread `req.raw` abort + a hard
`AbortSignal.timeout` into the render, and add `mem_limit`/`cpus` to the
compose service.

---

### F10. Every page's panel is held in memory as a base64 data URI

**What & where** `/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:438-452`:

```ts
panels = {};
for (const page of contract.pages) {
  const panel = await renderMapPanel(page.bbox, panelWidthPx, undefined, panelOptions);
  panels[page.id] = `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`;
```

The whole map is then passed to `renderAtlasPdfToFile` (`render.ts:546-559`).

**Why it matters** The package's own measurement (`packages/map-sources/src/panel.ts:64-74`)
puts a JPEG q90 panel at ~480 KB and a PNG at ~2.9 MB. At the `MAX_ATLAS_PAGES`
ceiling of 200 that is ~130 MB of base64 strings for JPEG and ~780 MB for PNG —
held simultaneously, on top of `@react-pdf/renderer`'s own buffers, in a worker
that may be running several of these at once (F9). `panelWidthPx` is capped at
8000 (`render.ts:200-204`), which multiplies the per-panel cost by ~64× at the top
of the allowed range. The team has already fought this battle once — the JPEG
default landed in `e866666 perf(map-sources): encode basemap panels as JPEG by
default` — but the accumulation pattern is unchanged.

**Blast radius** 3 · **Effort** M · **Impact** 4 · **Regression risk** med

**First step** Cheapest guard first: reject `panelFormat: "png"` (or clamp
`panelWidthPx`) above a page count, and log peak panel bytes. Structurally,
stream panels to temp files and hand the renderer paths instead of data URIs.

---

### F11. `PUT /api/projects/{id}/extent` accepts any bbox with zero validation

**What & where** `/home/caleb/Projects/JourneyBook/apps/api/Endpoints/ProjectEndpoints.cs:51-52`
binds `BBoxDto bbox` and calls straight through — no `try`/`catch`, no checks.
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Projects/ProjectService.cs:180-192`
(`ToPolygon`) builds the ring from the raw doubles. No `west < east`, no
`south < north`, no ±180/±90 range check, no area cap — compare `CreateProjectRequest`,
where the scale preset *is* validated (`ProjectService.cs:159-165`), and the
TS render path, which validates all four (`packages/render-cli/src/render.ts:185-199`).

**Why it matters** The stored extent is what `RenderService` forwards to the
worker (`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Rendering/RenderService.cs:67-71`),
so a global extent is the direct trigger for F7. A degenerate (zero-area) or
inverted box is accepted and persisted as an invalid PostGIS polygon; the failure
surfaces later as a 502 from the worker rather than a 400 at the point of entry.

**Blast radius** 3 · **Effort** XS · **Impact** 4 · **Regression risk** low

**First step** Add a `ProjectValidationException` guard in `SetExtentAsync`
(finite, in range, `west < east`, `south < north`, plus a max span) and wrap the
endpoint in the same `try`/`catch` the `POST`/`PUT` project handlers already use.

---

### F12. Location lat/lng is validated on CSV import but not on the JSON create/update path

**What & where** `/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Locations/LocationService.cs:34`
(`Location = ToPoint(request.Lng, request.Lat)`) and `:141` (the update path) do
no range check. The CSV path right next door does:
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Locations/LocationCsv.cs:83-92`
rejects `lng` outside [−180, 180] and `lat` outside [−90, 90] with a per-row error.
`Name` (max 200) and `Notes` (max 2000) are length-capped in EF
(`ImportantLocationConfiguration.cs:11`, `:25`) but over-length input surfaces as a
DbUpdateException → 500 rather than a 400.

**Why it matters** A single out-of-range location poisons the project
permanently: `RenderService` forwards all locations unconditionally
(`RenderService.cs:73-76`), and the TS engine rejects the *whole* render with
`Invalid location[i].center` (`packages/render-cli/src/render.ts:168-174`). Every
subsequent render of that project fails with an error naming an array index the
user cannot map back to a row. Two code paths writing the same column disagree on
what is valid.

**Blast radius** 3 · **Effort** XS · **Impact** 3 · **Regression risk** low

**First step** Extract the range check from `LocationCsv.Parse` into a shared
guard and call it from `CreateAsync`/`UpdateAsync`, throwing
`LocationValidationException` (already mapped to 400 at `LocationEndpoints.cs:19`).

---

### F13. Landmark import: unbounded bbox to Overpass, and repeat imports duplicate rows

**What & where** `/home/caleb/Projects/JourneyBook/apps/api/Endpoints/LandmarkEndpoints.cs:11-14`
passes `request.Bbox` through untouched;
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/Landmarks/LandmarkService.cs:27`
hands it straight to Overpass, which interpolates it into a query over twelve
`nwr[…]` clauses (`OverpassClient.cs:101-117`). No area cap, no result cap.
`LandmarkService.cs:42-53` then `db.Landmarks.Add(landmark)` for every survivor
with no dedup against what is already stored.

**Why it matters** A global bbox produces a query the public Overpass instance
will refuse (or, worse, will attempt) — the kind of request that gets an IP
blocked, which `vault/pitfalls/tile-rate-limits.md` flags as a known risk. And
because import is purely additive, clicking Import twice doubles the landmark
count; those rows are then forwarded into every render
(`RenderService.cs:82-87`), so the map degrades with each retry. Injection itself
is *not* a concern here — the bbox is formatted from `double`s under
`InvariantCulture` (`OverpassClient.cs:103-107`), so no attacker-controlled text
reaches the QL string.

**Blast radius** 3 · **Effort** S · **Impact** 3 · **Regression risk** low

**First step** Validate + area-cap `request.Bbox` before calling Overpass (reject
above, say, 2°×2°), and make the import idempotent — key on
`(ProjectId, rounded lat/lng, Name)` and skip existing rows.

---

### F14. Unauthenticated Nominatim/Overpass proxies with no rate limiting

**What & where** `GET /api/geocode`
(`/home/caleb/Projects/JourneyBook/apps/api/Endpoints/GeocodeEndpoints.cs:14-35`)
requires only a non-empty `q` — no length bound, no throttle. `grep -rn
"RateLimit\|Semaphore\|Polly" dotnet apps` returns nothing; `Program.cs` registers
no `AddRateLimiter`. The clients do have timeouts and a descriptive User-Agent
(`DependencyInjection.cs:90-100`, `:76-87`), and `NominatimClient` correctly
escapes the query (`NominatimClient.cs:78`) — so the *outbound* etiquette is
right except for the one rule that matters most.

**Why it matters** Nominatim's policy is an absolute maximum of 1 request/second
from one source; the code acknowledges this in a comment
(`NominatimClient.cs:17-21` — "tolerates light, occasional use") but enforces
nothing. Anyone who can reach the API can drive it at whatever rate they like and
get the deployment's IP blocked at OSM. Because both clients swallow failures
into an empty list (`NominatimClient.cs:44-47`, `OverpassClient.cs:57-61`), the
block presents to users as "search returns nothing," with no signal that it is a
policy ban rather than a bug — the same class of silent failure that produced
`923407e fix(landmarks): send a User-Agent to Overpass (was 406 -> 0 landmarks live)`.

**Blast radius** 3 · **Effort** S · **Impact** 4 · **Regression risk** low

**First step** Add ASP.NET Core rate limiting (a 1 rps token bucket per
outbound provider, plus a per-IP limiter on `/api/geocode` and
`/api/projects/{id}/landmarks/import`), bound `q` to ~200 chars, and log a
distinguishable warning on 429/403 from upstream instead of returning `[]`.

---

### F15. No exception handler: ordinary bad input returns an unhandled 500

**What & where** `/home/caleb/Projects/JourneyBook/apps/api/Program.cs:40-71` builds
the pipeline with `UseCors` and the endpoint maps only — no
`UseExceptionHandler`, no `AddProblemDetails`, no `UseStatusCodePages`. Three
reachable throws have no handler:

- `PUT /api/generated-pdfs/{id}/status` with any status string outside the enum:
  `GeneratedPdfEndpoints.cs:25-26` has no `try`/`catch`, and
  `GeneratedPdfService.cs:141-144` throws `ArgumentException`.
- A tile source whose `Attribution` is blank: `TileService.cs:32-35` throws
  `InvalidOperationException` ("refusing to serve" — a deliberate policy, wrong
  status code).
- A tile source with an unrecognised `Kind`: `TileService.cs:37-38` throws
  `NotSupportedException`.

**Why it matters** Each is a 400-class condition returned as 500. Worse, the
Compose default is `ASPNETCORE_ENVIRONMENT: Development`
(`infra/compose/docker-compose.yml:35`), where the developer exception page
renders the full stack trace, connection string fragments and source snippets to
the caller. Note the project *does* handle this well elsewhere — projects,
locations and renders all catch their validation exceptions and return 400 —
so this is three gaps in an otherwise consistent convention, not an absent one.

**Blast radius** 4 · **Effort** XS · **Impact** 3 · **Regression risk** low

**First step** Add `builder.Services.AddProblemDetails()` and
`app.UseExceptionHandler()` in `Program.cs`, and catch the three specific
exception types at their endpoints to return 400/409.

---

### F16. Every list endpoint is unpaged, and every read query tracks entities

**What & where** All five collection endpoints return the full table:
`ProjectEndpoints.cs:24`, `LocationEndpoints.cs:39`, `LandmarkEndpoints.cs:16`,
`TileSourceEndpoints.cs:24`, `GeneratedPdfEndpoints.cs:17` — none takes `skip`/
`take`. `grep -rn "AsNoTracking" dotnet apps` returns **zero hits**, so read-only
queries such as `ProjectService.ListAsync` (`ProjectService.cs:46-51`, with two
`Include`s), `LandmarkService.ListAsync` (`LandmarkService.cs:72-76`) and
`LocationService.ListAsync` (`LocationService.cs:117-121`) all populate the change
tracker.

Two related data-layer notes: there is **no spatial (GIST) index** on
`ImportantLocation.Location`, `Landmark.Location` or `AtlasExtent.Bounds` — which
is currently *correct*, since every query filters on `ProjectId` (indexed at
`ImportantLocationConfiguration.cs:38`, `LandmarkConfiguration.cs:48`,
`GeneratedPdfConfiguration.cs:22`) and no `ST_*` predicate exists anywhere; and
`DbSet<AtlasPage> AtlasPages` (`JourneyBookDbContext.cs:18`) plus its table and
unique index are **never written by any code path** — dead schema from the Stage 2
design, not a bug.

**Why it matters** `GET /api/projects/{id}/landmarks` after a county-sized import
(thousands of rows, each with a `jsonb` `SourceTags` blob deserialized through a
`ValueConverter`, `LandmarkConfiguration.cs:30-46`) is a slow, memory-heavy
response with no way for the client to ask for less. The missing `AsNoTracking`
compounds it: EF materializes, snapshots and fixes up every entity it will never
save. On the plus side, no N+1 and no cartesian explosion exist today — the
`Include`s in `RenderService.cs:33-38` fan out from a single project, and there is
zero raw SQL anywhere.

**Blast radius** 2 · **Effort** S · **Impact** 2 · **Regression risk** low

**First step** Add `.AsNoTracking()` to the six read-only queries (mechanical, no
behaviour change since none of the returned entities is mutated), then add
`skip`/`take` with a default cap of 100 to the landmarks and locations lists.

---

### F17. The PDF prints a hardcoded attribution that ignores the source actually used

**What & where** `/home/caleb/Projects/JourneyBook/packages/pdf-client/src/AtlasDocument.tsx:562-563`:

```tsx
<Text style={styles.attribution}>
  {"© OpenStreetMap contributors · USGS — Journey Book"}
</Text>
```

`renderAtlas` does the same at
`/home/caleb/Projects/JourneyBook/packages/render-cli/src/render.ts:564-566`
(a ternary between two fixed strings). Yet the real attribution is available and
plumbed at every layer and discarded at each: `MapPanel.attribution`
(`packages/map-sources/src/panel.ts:50`, `:206`) is never read by the caller;
`composeAttribution` (`packages/map-sources/src/index.ts:33-43`) has no call
sites outside tests; the API returns `X-Tile-Attribution` per tile
(`apps/api/Endpoints/TileEndpoints.cs:61`) and `panel.ts` ignores the header;
and `TileService` goes so far as to *refuse to serve* a source with no
attribution (`TileService.cs:32-35`).

**Why it matters** The whole point of that refusal is that attribution must
travel with the pixels. Point a project at any non-USGS source — which
`POST /api/tile-sources` freely allows (F6) — and the printed atlas asserts a
provenance that is false, omitting the attribution that source's licence
requires. `vault/pitfalls/missing-attribution.md` and
`vault/licensing-and-attribution/printed-map-attribution-placement.md` both call
this out as a top-priority risk. This is the highest-severity *licensing*
finding in the pass: everything needed to fix it already exists.

**Blast radius** 3 · **Effort** S · **Impact** 4 · **Regression risk** low

**First step** Thread `MapPanel.attribution` (or the `X-Tile-Attribution`
header) up through `renderAtlas` into `AtlasContract`, run it through
`composeAttribution`, and render that string in `AtlasDocument` instead of the
literal.

---

### F18. Compose defaults to Development, with a shipped default database password

**What & where** `/home/caleb/Projects/JourneyBook/infra/compose/docker-compose.yml:35`:
`ASPNETCORE_ENVIRONMENT: ${ASPNETCORE_ENVIRONMENT:-Development}`, reinforced by
`/home/caleb/Projects/JourneyBook/.env.example:17` (`ASPNETCORE_ENVIRONMENT=Development`).
The credential `journeybook`/`journeybook` is the default in three places:
`docker-compose.yml:15-17`, `.env.example:4-6`, and hardcoded in
`/home/caleb/Projects/JourneyBook/apps/api/appsettings.json` ("ConnectionStrings.Postgres")
plus as a literal fallback in
`/home/caleb/Projects/JourneyBook/dotnet/JourneyBook.Infrastructure/DependencyInjection.cs:36`.
Postgres is host-published on 5433 (`docker-compose.yml:21`). Also:
`"AllowedHosts": "*"`, no `UseHttpsRedirection`, no HSTS, no `restart:` policy on
any service, and `Database__MigrateOnStartup: "true"` (`:39`) auto-migrates on
every boot.

**Why it matters** README's "Run the full stack" section (`README.md`) points
straight at this file, so the documented way to run the project is the insecure
way: stack traces to any caller (F15), OpenAPI exposed (`Program.cs:42-45`), and
a guessable superuser on a published port. Nothing here is wrong *for local dev*
— the problem is that no hardened profile exists alongside it, so the first
deployment inherits all of it.

**Blast radius** 4 · **Effort** S · **Impact** 4 · **Regression risk** low

**First step** Add a `docker-compose.prod.yml` overlay pinning
`ASPNETCORE_ENVIRONMENT=Production`, requiring `POSTGRES_PASSWORD` with no
default (`${POSTGRES_PASSWORD:?set in .env}`), dropping the db port publish, and
setting `restart: unless-stopped`; remove the password from `appsettings.json`.

---

### F19. `.dockerignore` does not exclude `.env`, so secrets are baked into two images

**What & where** `/home/caleb/Projects/JourneyBook/.dockerignore` excludes
`node_modules`, `dist`, `bin`, `obj`, `.git`, `*.md`, `vault/`, `docs/` — but not
`.env`. Both `/home/caleb/Projects/JourneyBook/infra/docker/render-worker.Dockerfile:14`
and `/home/caleb/Projects/JourneyBook/infra/docker/web.Dockerfile:13` do a bare
`COPY . .`, and the worker's runtime stage copies the whole tree forward
(`render-worker.Dockerfile:27`: `COPY --from=build /repo ./`). `.env` *is*
gitignored (`.gitignore:24`), so it exists on any developer machine that followed
the README's `cp .env.example .env`.

**Why it matters** `docker compose up --build` bakes the local `.env` — including
`POSTGRES_PASSWORD` — into the render-worker image layers, where it survives into
any registry push. The same `COPY --from=build /repo ./` also ships the full
monorepo source and all devDependencies (typescript, vitest, playwright) in the
runtime image, and no Dockerfile sets a `USER`, so all three containers run as
root.

**Blast radius** 3 · **Effort** XS · **Impact** 4 · **Regression risk** low

**First step** Add `.env`, `.env.*`, `!.env.example`, and `**/*.tsbuildinfo`
already present, to `.dockerignore`; then add `USER node` (worker) and a
production-only `pnpm install --prod` runtime stage.

---

### F20. No CI: the harness checks are local-only, and `infra/db` in the README does not exist

**What & where** There is no `.github/` directory (nor any other CI config) in the
repo. Quality gates live in `/home/caleb/Projects/JourneyBook/harness/checks/`
(`00-env.sh`, `build.sh`, `lint.sh`, `test.sh`) and run only when someone invokes
them. Separately, `README.md`'s Layout section documents
`infra/db/ Migrations + seeds`, which does not exist — `infra/` contains only
`compose/` and `docker/`. (Migrations do live in
`dotnet/JourneyBook.Infrastructure/Migrations/`, so the work is done; the README
path is stale.)

**Why it matters** Nothing prevents a broken build or a failing test from
landing, and the Docker builds — which are where the F19 secret-baking and the
`--frozen-lockfile` pinning actually get exercised — are never run automatically.
Dependency pinning itself is in decent shape: `pnpm-lock.yaml` is committed, both
Dockerfiles use `--frozen-lockfile`, `packageManager` is pinned exactly
(`package.json:8`, `pnpm@10.33.0`), and every `PackageReference` across the four
`.csproj` files uses an exact version — the caret ranges in `package.json` are
lockfile-governed and fine.

**Blast radius** 2 · **Effort** S · **Impact** 3 · **Regression risk** low

**First step** Add a GitHub Actions workflow running `harness/checks/*.sh` plus
`docker compose -f infra/compose/docker-compose.yml build` on PRs; fix or drop
the `infra/db` line in the README.

---

## Cross-cutting note

The recurring shape across F1/F4/F13/F14 is **graceful degradation with no
signal**: `fetchTile` returns `null`, `NominatimClient` and `OverpassClient`
return `[]`, missing tiles become parchment. Each choice is individually
defensible and individually documented, but together they mean the system's
dominant failure mode is a quiet wrong answer rather than an error. The
`923407e` Overpass User-Agent fix is the precedent — a total failure that
presented as "0 landmarks" and needed a human to notice. Adding counters and
threshold-based failures to these four paths would be the single highest-leverage
robustness change in this pass.
