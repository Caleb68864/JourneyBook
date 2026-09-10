import sharp from "sharp";
import type { BBox } from "@journeybook/atlas-core";
import {
  TILE_SIZE,
  lngLatToGlobalPixel,
  zoomForBBox,
  tileRangeForBBox,
} from "./tilemath.js";
import { getCachedTile, storeCachedTile, tileExtensionForContentType } from "./tilecache.js";

/** Parchment fill behind the mosaic, showing wherever a tile fetch failed. */
const PANEL_BACKGROUND = { r: 244, g: 240, b: 230, alpha: 1 } as const;

/**
 * Descriptive User-Agent for every outbound tile request.
 *
 * Node's `fetch` sends no UA at all, and the public endpoints this repo talks to
 * treat that as abuse: Overpass answered `406 Not Acceptable` to every landmark
 * import until a UA was added (see `DependencyInjection.cs`), and Nominatim's
 * usage policy requires one. Tile endpoints are the same class of shared public
 * infrastructure, and a UA-less client is the first thing an operator blocks.
 * Same `JourneyBook/1.0 (<what for>)` shape as the two C# clients, so a server
 * log identifies which part of the product is calling.
 */
export const TILE_USER_AGENT = "JourneyBook/1.0 (atlas basemap tiles)";

/** Per-attempt tile timeout. Shorter than Nominatim's 15 s: a tile is small. */
export const DEFAULT_TILE_TIMEOUT_MS = 10_000;

/** Total attempts per tile (1 try + 2 retries). */
export const DEFAULT_TILE_ATTEMPTS = 3;

/**
 * Concurrent tile requests per panel. A letter page covers ~35 tiles, and the
 * previous code opened all of them at once with `Promise.all` — a burst that
 * looks like a scraper to the source and, across a 30-page atlas rendered
 * serially, is the single rudest thing this product does. 6 matches the
 * conventional per-host browser limit.
 */
export const DEFAULT_TILE_CONCURRENCY = 6;

/**
 * Share of a page's tiles allowed to go missing before the panel is rejected.
 *
 * Not zero: raster pyramids have genuine holes. USGS topo has no tiles beyond
 * the CONUS coverage edge, so a page whose bbox clips the coast legitimately
 * 404s a few tiles, and failing that render would break a valid request to
 * protect against a defect it does not have. Those gaps are already handled —
 * they flatten onto the parchment background.
 *
 * Not lenient either: at 10% of ~35 tiles a page tolerates three absent tiles,
 * which reads as a coverage edge, while anything worse — a whole missing row, a
 * throttling source, a total upstream outage — is not a map anyone should print
 * and navigate from. Above the threshold `renderMapPanel` throws, which
 * `render-cli` already turns into a named per-page error and the render worker
 * classifies as a 502. Before this, every tile could fail and the caller got a
 * blank sheet of parchment and HTTP 200.
 */
export const DEFAULT_MAX_FAILED_TILE_FRACTION = 0.1;

/** A raster XYZ basemap source with attribution. */
export interface RasterBasemap {
  id: string;
  /** URL template with {z} {x} {y} tokens. */
  urlTemplate: string;
  attribution: string;
  /**
   * Deepest zoom this source actually has tiles for. Above it every request is a
   * 404 (or, through the C# proxy, a `ZoomOutOfRange` 400), so the panel is
   * rendered at this zoom instead of asking for pixels that do not exist.
   */
  maxZoom?: number;
}

/**
 * USGS The National Map topo basemap — public domain, no key, land-nav-friendly.
 * NOTE: ArcGIS tile order is {z}/{y}/{x}.
 *
 * `maxZoom` mirrors the seeded `TileSource.MaxZoom` in
 * `TileSourceConfiguration.cs`; the C# tile proxy refuses anything deeper with
 * `TileResult.ZoomOutOfRange()`, and the source's own endpoint 404s. The two
 * numbers have to agree, and until now only the C# side wrote one down.
 */
export const USGS_TOPO: RasterBasemap = {
  id: "usgs-topo",
  urlTemplate:
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  attribution: "USGS The National Map",
  maxZoom: 16,
};

/** Encoded image formats a panel can be emitted in (both embeddable in a PDF). */
export type PanelFormat = "jpeg" | "png";

/** Default panel encoding — see {@link RenderPanelOptions.format} for the reasoning. */
export const DEFAULT_PANEL_FORMAT: PanelFormat = "jpeg";
export const DEFAULT_PANEL_QUALITY = 90;

export interface MapPanel {
  /** Encoded image bytes of the panel cropped exactly to the bbox. */
  bytes: Buffer;
  /** How {@link bytes} is encoded. */
  format: PanelFormat;
  /** MIME type for {@link format}, ready for a `data:` URI. */
  mimeType: string;
  widthPx: number;
  heightPx: number;
  zoom: number;
  /**
   * The panel wanted a deeper zoom than the source has tiles for, and was
   * rendered at the source's ceiling instead. The map is correct and correctly
   * georeferenced; it is simply softer than `targetWidthPx` asked for, and the
   * caller should say so rather than let a print silently miss its DPI target.
   */
  zoomClamped: boolean;
  attribution: string;
  /** Tiles the panel needed. */
  tilesRequested: number;
  /**
   * Tiles that produced no pixels and were left as parchment. Always within the
   * accepted threshold (above it `renderMapPanel` throws), but reported so a
   * caller can warn: a tolerated hole is still a hole in a printed map.
   */
  tilesMissing: number;
}

/**
 * How a panel's tiles are sourced.
 *  - default (no options): fetch the basemap's URL template directly — zero infrastructure.
 *  - `tileBaseUrl`: route through the C# proxy (`{base}/{source}/{z}/{x}/{y}`), reusing its cache
 *    and unlocking PMTiles sources.
 *  - `cacheDir`: also read/write a local disk cache honoring the shared `{source}/{z}/{x}/{y}` key.
 */
export interface RenderPanelOptions {
  tileBaseUrl?: string;
  sourceId?: string;
  cacheDir?: string;
  /**
   * Deepest zoom the source being used actually has, overriding the basemap's
   * own {@link RasterBasemap.maxZoom}. Needed with `tileBaseUrl` + `sourceId`,
   * where the tiles come from a registered `TileSource` whose `MaxZoom` this
   * process cannot see; the proxy enforces it either way, so without this a
   * deep-zoom request fails every tile instead of rendering the map the source
   * can give.
   */
  maxZoom?: number;
  /**
   * Panel encoding. Defaults to JPEG, which is what keeps a printable atlas a
   * sane size: a page panel of USGS topo raster encodes to ~2.9 MB as RGBA PNG
   * but ~480 KB as JPEG q90, so a 34-page basemap atlas goes from ~110 MB (too
   * big to mail) to ~18 MB. Measured at 1:1 on dense town detail, q90 is visually
   * indistinguishable from the PNG — road labels and contour lines stay crisp,
   * because the lossy term lands on the smooth pale fills where it is invisible.
   * Choose `"png"` for a lossless panel (roughly 6x the bytes).
   *
   * Both formats embed directly in a PDF; WebP/AVIF cannot, so they are not offered.
   * Tier makes no difference here — the USNG grid and every other overlay is drawn
   * as vector furniture over the panel, never baked into these pixels.
   */
  format?: PanelFormat;
  /** JPEG quality 1–100 (ignored for PNG). Default 90. */
  quality?: number;
  /** Per-attempt tile timeout in ms. Default {@link DEFAULT_TILE_TIMEOUT_MS}. */
  tileTimeoutMs?: number;
  /** Total attempts per tile. Default {@link DEFAULT_TILE_ATTEMPTS}. */
  tileAttempts?: number;
  /** Max concurrent tile requests. Default {@link DEFAULT_TILE_CONCURRENCY}. */
  tileConcurrency?: number;
  /**
   * Share of a page's tiles allowed to go missing before the panel is rejected,
   * 0..1. Default {@link DEFAULT_MAX_FAILED_TILE_FRACTION}; set 1 to accept any
   * number of holes (the pre-2026-09 behaviour), 0 to demand every tile.
   */
  maxFailedTileFraction?: number;
  /**
   * Credit line for the tiles, when the caller knows it and the source cannot
   * say so itself. Overridden by the proxy's `X-Tile-Attribution` header.
   */
  attribution?: string;
}

/** Resolve the URL for a single tile, either via the proxy base or the source's own template. */
export function resolveTileUrl(
  basemap: RasterBasemap,
  z: number,
  x: number,
  y: number,
  options?: RenderPanelOptions,
): string {
  if (options?.tileBaseUrl) {
    const source = options.sourceId ?? basemap.id;
    const base = options.tileBaseUrl.replace(/\/+$/, "");
    return `${base}/${source}/${z}/${x}/${y}`;
  }
  return basemap.urlTemplate
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/**
 * Is this status worth trying again? 429 and 5xx are the source telling us it is
 * busy or broken — transient by definition. 404/403 are answers, not failures:
 * the tile is genuinely absent or forbidden, and retrying it twice more just
 * triples the load on a coverage edge that will never return pixels.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** A tile's bytes, plus whatever the source said about how it must be credited. */
interface FetchedTile {
  bytes: Buffer;
  /**
   * `X-Tile-Attribution` as returned by the C# tile proxy, which knows the
   * registered `TileSource` the bytes actually came from. Absent when talking to
   * a basemap's own URL template, which carries no such header.
   */
  attribution?: string;
  /**
   * The tile's own `Content-Type`, kept for one reason: it decides the extension
   * the shared disk cache files these bytes under. The panel itself re-encodes
   * everything through sharp, so it never reads this to decode.
   */
  contentType?: string;
}

async function fetchTile(
  url: string,
  timeoutMs: number,
  attempts: number,
): Promise<FetchedTile | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let retryable: boolean;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": TILE_USER_AGENT },
        // Without this a hung source stalls the whole render forever: Node's
        // fetch has no default timeout, and a page waits on every one of its
        // tiles before it can be composited.
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        const attribution = res.headers?.get?.("x-tile-attribution") ?? null;
        const contentType = res.headers?.get?.("content-type") ?? null;
        return {
          bytes,
          ...(attribution ? { attribution } : {}),
          ...(contentType ? { contentType } : {}),
        };
      }
      retryable = isRetryableStatus(res.status);
    } catch {
      // Network error or timeout — the transient case retries exist for.
      retryable = true;
    }
    if (!retryable || attempt === attempts) return null;
    // Exponential backoff (200 ms, 400 ms). Retrying a throttled source
    // immediately is how a 429 becomes a ban.
    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
  }
  return null;
}

/**
 * Run `jobs` with at most `limit` in flight, preserving result order. Kept local
 * and dependency-free — the only concurrency this package needs.
 */
async function mapWithConcurrency<T>(
  jobs: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

/** Read a tile from the shared disk cache when configured, else fetch and (best-effort) cache it. */
async function loadTile(
  basemap: RasterBasemap,
  z: number,
  x: number,
  y: number,
  cacheSource: string,
  options?: RenderPanelOptions,
): Promise<FetchedTile | null> {
  if (options?.cacheDir) {
    // A cache hit carries no attribution: the disk cache stores bytes, not the
    // headers they arrived with. That is why the panel falls back to the
    // configured source attribution rather than depending on the header.
    const hit = await getCachedTile(options.cacheDir, cacheSource, z, x, y);
    if (hit) return { bytes: hit.bytes };
  }

  const tile = await fetchTile(
    resolveTileUrl(basemap, z, x, y, options),
    options?.tileTimeoutMs ?? DEFAULT_TILE_TIMEOUT_MS,
    options?.tileAttempts ?? DEFAULT_TILE_ATTEMPTS,
  );
  if (tile && options?.cacheDir) {
    // The extension is derived, not assumed. This site used to pass a literal
    // "png" for every tile: the C# proxy shares this cache directory, discovers
    // whichever `{y}.*` exists and serves it with `ContentTypeFor(ext)`, so a
    // JPEG cached here went back out to a browser as `image/png`.
    await storeCachedTile(
      options.cacheDir,
      cacheSource,
      z,
      x,
      y,
      tileExtensionForContentType(tile.contentType),
      tile.bytes,
    );
  }
  return tile;
}

/**
 * Credit line for the tiles this panel is actually built from — a licensing
 * obligation in both directions, so it must not be a guess.
 *
 * Precedence, most authoritative first:
 *  1. `X-Tile-Attribution` from the C# tile proxy, which looks the credit up on
 *     the registered `TileSource` the bytes really came from.
 *  2. An explicit `options.attribution` from the caller.
 *  3. The basemap's own declared attribution — correct when we fetched that
 *     basemap's URL template directly, which is the default path.
 *
 * The one case with no honest answer is a proxied `sourceId` that returned no
 * header (an older proxy, or every tile served from the local disk cache, which
 * stores bytes without headers). Printing the default basemap's credit there
 * would be a false claim about a source we never contacted, so the panel says
 * which source it used and leaves the crediting to whoever registered it.
 */
function resolveAttribution(
  basemap: RasterBasemap,
  placements: { attribution?: string }[],
  options?: RenderPanelOptions,
): string {
  const fromSource = placements.find((p) => p.attribution)?.attribution;
  if (fromSource) return fromSource;
  if (options?.attribution) return options.attribution;
  const proxiedSourceId = options?.tileBaseUrl ? options.sourceId : undefined;
  if (proxiedSourceId && proxiedSourceId !== basemap.id) {
    return `Map tiles: ${proxiedSourceId}`;
  }
  return basemap.attribution;
}

/**
 * Render a map panel for a page's bbox by fetching Web Mercator raster tiles,
 * compositing them, and cropping to the exact bbox. Within a single small page
 * Web Mercator is locally true-to-scale, so the page's (locally-projected) scale
 * bar remains valid. See docs/decisions/0003-map-panel-rendering.md.
 */
export async function renderMapPanel(
  bbox: BBox,
  targetWidthPx: number,
  basemap: RasterBasemap = USGS_TOPO,
  options?: RenderPanelOptions,
): Promise<MapPanel> {
  // Zoom, clamped to what the source actually has.
  //
  // At 1:24,000 — the default scale — a 1000 px panel over the 5.76 in map box
  // selects z16, and USGS Topo's ceiling is z16. Zero headroom: `--panel-px
  // 2000` asks for z17 and every single tile 404s, so a request for a sharper
  // print produced no print at all. Clamping renders the deepest map the source
  // can give and reports it, which is a softer page rather than a missing one.
  // On the DPI, corrected 2026-09-10: this used to read "1000 px over 5.76 in is
  // ~173 DPI; the roadmap's 300 DPI target needs z17". That treated
  // `targetWidthPx` as the delivered width. It is not — nothing resamples; the
  // crop below is at native tile resolution, so the panel is as wide as the bbox
  // is at `zoom`, which is >= the target and up to 2x it. At z16 the page above
  // is ~1947 px over 5.76 in = ~338 DPI, so the 300 DPI target IS met at z16 and
  // z17 is not needed for it. `tilemath.test.ts` pins both numbers.
  // What z17 would buy is headroom, and USGS Topo has none at this scale.
  const wantedZoom = zoomForBBox(bbox, targetWidthPx);
  const ceiling = options?.maxZoom ?? basemap.maxZoom;
  const zoom = ceiling === undefined ? wantedZoom : Math.min(wantedZoom, ceiling);
  const zoomClamped = zoom < wantedZoom;
  const range = tileRangeForBBox(bbox, zoom);
  const [west, south, east, north] = bbox;

  const cols = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;
  const cacheSource = options?.sourceId ?? basemap.id;

  // Fetch every covering tile, at most `tileConcurrency` at a time; reuse the
  // shared disk cache if given.
  const jobs: (() => Promise<
    { left: number; top: number; input: Buffer; attribution?: string } | null
  >)[] = [];
  for (let ty = range.minY; ty <= range.maxY; ty++) {
    for (let tx = range.minX; tx <= range.maxX; tx++) {
      const left = (tx - range.minX) * TILE_SIZE;
      const top = (ty - range.minY) * TILE_SIZE;
      jobs.push(async () => {
        const tile = await loadTile(basemap, zoom, tx, ty, cacheSource, options);
        return tile
          ? { left, top, input: tile.bytes, ...(tile.attribution ? { attribution: tile.attribution } : {}) }
          : null;
      });
    }
  }
  const loaded = await mapWithConcurrency(
    jobs,
    options?.tileConcurrency ?? DEFAULT_TILE_CONCURRENCY,
  );
  const placements = loaded.filter((p) => p !== null);

  // A tile that produced no pixels leaves a parchment hole in a map somebody is
  // going to print and navigate from. Below the threshold that is a coverage
  // edge and acceptable; above it the panel is not a map, and returning it as a
  // success is how a total upstream outage used to yield HTTP 200 and a blank
  // atlas. Throwing here is what `render-cli` already expects: it wraps the
  // failure with the page id, and the render worker maps it to a 502.
  const tilesRequested = jobs.length;
  const tilesMissing = tilesRequested - placements.length;
  const maxFailedFraction = options?.maxFailedTileFraction ?? DEFAULT_MAX_FAILED_TILE_FRACTION;
  if (tilesMissing > 0 && tilesMissing / tilesRequested > maxFailedFraction) {
    throw new Error(
      `Tile fetch failed for ${tilesMissing} of ${tilesRequested} tiles at z${zoom} from ` +
        `${cacheSource} (limit ${(maxFailedFraction * 100).toFixed(0)}%). ` +
        `The map panel would be mostly blank, so it is not rendered.`,
    );
  }

  // Crop window in mosaic pixels.
  const topLeft = lngLatToGlobalPixel(west, north, zoom);
  const bottomRight = lngLatToGlobalPixel(east, south, zoom);
  const mosaicWidth = cols * TILE_SIZE;
  const mosaicHeight = rows * TILE_SIZE;
  const left = Math.round(topLeft.x - range.minX * TILE_SIZE);
  const top = Math.round(topLeft.y - range.minY * TILE_SIZE);
  // Clamp to the mosaic: the tile range covers the bbox by construction, but
  // rounding can put the far edge a pixel past the last tile, and sharp treats
  // an out-of-bounds extract as a hard error.
  const width = Math.max(1, Math.min(Math.round(bottomRight.x - topLeft.x), mosaicWidth - left));
  const height = Math.max(1, Math.min(Math.round(bottomRight.y - topLeft.y), mosaicHeight - top));

  const format = options?.format ?? DEFAULT_PANEL_FORMAT;
  const quality = options?.quality ?? DEFAULT_PANEL_QUALITY;

  // The mosaic has to be MATERIALIZED before the crop. sharp's pipeline order is
  // fixed, not call order: an `extract` chained onto a `composite` is applied as
  // a pre-extract on the *input* image, so the blank canvas was cropped first and
  // the tiles were then composited onto the crop at their full-mosaic offsets.
  // The panel that came out was the top-left `width x height` of the tile grid,
  // anchored on the tile boundary instead of on the bbox — misregistered by up to
  // a whole tile (~460 m of ground at 1:24,000) on a printed page whose entire
  // purpose is true-scale land navigation, and clipping the east/south edge the
  // bbox asked for. Every tile fixture in the tests served the same flat colour,
  // so the composite was uniform and the misplaced window was byte-identical to
  // the right one; `panel.test.ts` now serves self-locating tiles that decode
  // back to the ground they show. Round-tripping through a raw buffer (no
  // re-encode) puts the crop in a second pipeline, where it means what it reads.
  const composited = await sharp({
    create: {
      width: mosaicWidth,
      height: mosaicHeight,
      channels: 4,
      background: PANEL_BACKGROUND,
    },
  })
    // Strip the attribution field: sharp rejects unknown keys on a composite.
    .composite(placements.map(({ left: l, top: t, input }) => ({ left: l, top: t, input })))
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mosaic = sharp(composited.data, {
    raw: {
      width: composited.info.width,
      height: composited.info.height,
      channels: composited.info.channels,
    },
  }).extract({ left, top, width, height });

  const bytes =
    format === "png"
      ? await mosaic.png().toBuffer()
      : // JPEG has no alpha, so flatten onto the same parchment the mosaic was
        // created with — otherwise any gap left by a failed tile fetch turns black.
        await mosaic
          .flatten({ background: PANEL_BACKGROUND })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();

  return {
    bytes,
    format,
    mimeType: format === "png" ? "image/png" : "image/jpeg",
    widthPx: width,
    heightPx: height,
    zoom,
    zoomClamped,
    attribution: resolveAttribution(basemap, placements, options),
    tilesRequested,
    tilesMissing,
  };
}
