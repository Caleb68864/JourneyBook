/**
 * `journeybook package` — a raster PMTiles archive of USGS topo for a bbox and
 * zoom range (owner decision b, 2026-11-16: raster PMTiles of USGS only).
 *
 * Tiles come through the same path a render's do: `loadTile` from
 * `@journeybook/map-sources`, so `--tile-base-url` sends them through the C#
 * proxy (its `TileCache` and fetchers) and `--tile-cache-dir` reuses the shared
 * disk cache. The tile list is `tileRangeForBBox` per zoom: the TS engine owns
 * the projection (ADR 0004), and C# only reads the finished archive.
 *
 * Strict on purpose: a package is for when there is no signal, so a missing
 * tile is a hole nobody can fill later. Any failed tile fails the package.
 */

import type { BBox } from "@journeybook/atlas-core";
import {
  DEFAULT_TILE_CONCURRENCY,
  USGS_TOPO,
  loadTile,
  mapWithConcurrency,
  readPmTilesTile,
  summarizeTileFailures,
  tileRangeForBBox,
  writePmTiles,
  type PackageTile,
  type RasterBasemap,
  type RasterTileType,
  type RenderPanelOptions,
} from "@journeybook/map-sources";
import { tileBaseUrlError } from "./tile-url.js";

/** Refuse more tiles than this unless the caller raises it: z16 over a county is ~100k tiles. */
export const DEFAULT_PACKAGE_MAX_TILES = 20_000;

export interface PackagePlanZoom {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  tiles: number;
}

export interface PackagePlan {
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  zooms: PackagePlanZoom[];
  tiles: number;
}

export interface PackageOptions extends RenderPanelOptions {
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
  basemap?: RasterBasemap;
  maxTiles?: number;
  /** Entries per leaf directory; tests force small leaves. */
  leafSize?: number;
}

export interface PackageResult {
  archive: Buffer;
  plan: PackagePlan;
  tileType: RasterTileType;
  attribution: string;
}

/** Which tiles a package for `bbox` at `minZoom..maxZoom` holds. Fetches nothing. */
export function planPackage(bbox: BBox, minZoom: number, maxZoom: number, sourceMaxZoom?: number): PackagePlan {
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every(Number.isFinite) || w >= e || s >= n) {
    throw new Error(`--bbox must be W,S,E,N with W < E and S < N (got ${bbox.join(",")})`);
  }
  if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || minZoom > maxZoom) {
    throw new Error(`zooms must be whole numbers with 0 <= min <= max (got ${minZoom}..${maxZoom})`);
  }
  if (sourceMaxZoom !== undefined && maxZoom > sourceMaxZoom) {
    throw new Error(`--max-zoom ${maxZoom} is deeper than the source has (z${sourceMaxZoom}).`);
  }
  const zooms: PackagePlanZoom[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRangeForBBox(bbox, z);
    // A bbox edge on the antimeridian or a pole can land one past the grid.
    const last = 2 ** z - 1;
    const minX = Math.max(0, r.minX);
    const maxX = Math.min(last, r.maxX);
    const minY = Math.max(0, r.minY);
    const maxY = Math.min(last, r.maxY);
    zooms.push({ z, minX, maxX, minY, maxY, tiles: (maxX - minX + 1) * (maxY - minY + 1) });
  }
  return { bbox, minZoom, maxZoom, zooms, tiles: zooms.reduce((a, b) => a + b.tiles, 0) };
}

/** The tile type of an image by its magic bytes; the header is not trusted (a cache hit has none). */
export function sniffRasterType(bytes: Uint8Array): RasterTileType | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** The API's tile-source registry, from the proxy's tile base URL (`…/api/tiles` → `…/api/tile-sources`). */
export function registryUrlFor(tileBaseUrl: string, sourceId: string): string {
  const base = tileBaseUrl.replace(/\/+$/, "").replace(/\/tiles$/, "/tile-sources");
  return `${base}/by-key/${encodeURIComponent(sourceId)}`;
}

/**
 * Refuse to package a source whose terms do not allow offline use (owner decision 2026-11-16).
 * The basemap's own `offlineAllowed` is checked first; through the C# proxy the registry row is
 * the authority, so its `cache.offlineAllowed` is read and must be `true` too. A row that cannot
 * be read is a refusal, not a pass. Runs before any tile is fetched.
 */
export async function assertOfflineAllowed(basemap: RasterBasemap, tileBaseUrl?: string, sourceId?: string): Promise<void> {
  if (basemap.offlineAllowed !== true) {
    throw new Error(
      `Source ${basemap.id} does not allow offline use, so it cannot be packaged. ` +
        `Only sources whose terms allow offline use (OfflineAllowed) can be made into a package.`,
    );
  }
  if (!tileBaseUrl || !sourceId) return;
  const url = registryUrlFor(tileBaseUrl, sourceId);
  let row: { cache?: { offlineAllowed?: unknown } } | undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    row = (await res.json()) as typeof row;
  } catch (err) {
    throw new Error(
      `Could not read tile source ${sourceId} from the registry (${url}: ${err instanceof Error ? err.message : String(err)}), ` +
        `so its offline terms are unknown and no package was made.`,
    );
  }
  if (row?.cache?.offlineAllowed !== true) {
    throw new Error(
      `Tile source ${sourceId} does not allow offline use (its registry row has OfflineAllowed false), ` +
        `so it cannot be packaged.`,
    );
  }
}

/** Tiles fetched per zoom for a size estimate, unless the caller asks for more or fewer. */
export const DEFAULT_ESTIMATE_SAMPLES_PER_ZOOM = 8;

export interface PackageEstimateZoom {
  z: number;
  tiles: number;
  /** Samples fetched and measured at this zoom. */
  sampled: number;
  /** Samples that failed (not counted in the mean). */
  failed: number;
  meanBytes: number;
  /** `tiles × meanBytes`, rounded. */
  estimatedBytes: number;
}

export interface PackageEstimate {
  plan: PackagePlan;
  zooms: PackageEstimateZoom[];
  /** Sum of each zoom's `tiles × mean sample size`. */
  estimatedBytes: number;
  /** Each zoom at its smallest sample, and at its largest: the spread the samples show, not a bound. */
  lowBytes: number;
  highBytes: number;
  sampled: number;
  failed: number;
}

/**
 * `count` indices spread evenly over `0..n-1`, first and last included, no repeats. Deterministic, so
 * two estimates of one plan fetch the same tiles (and a second one is served from the cache).
 */
export function spreadIndices(n: number, count: number): number[] {
  if (n <= 0 || count <= 0) return [];
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  if (count === 1) return [Math.floor((n - 1) / 2)];
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (n - 1)) / (count - 1)));
  return [...out];
}

/**
 * Estimate a package's size by MEASURING a few real tiles per zoom, not by guessing a per-tile
 * figure: USGS tile size varies with terrain (open plains compress far better than a town), so a
 * constant would be invented. Fetches through `loadTile`, the package's own path, so the samples
 * warm the cache the package will read. The archive adds its directories on top (a few bytes
 * per tile entry), which this leaves out.
 */
export async function estimatePackageSize(
  options: PackageOptions & { samplesPerZoom?: number },
): Promise<PackageEstimate> {
  const basemap = options.basemap ?? USGS_TOPO;
  const urlError = tileBaseUrlError(options.tileBaseUrl);
  if (urlError) throw new Error(urlError);
  const plan = planPackage(options.bbox, options.minZoom, options.maxZoom, basemap.maxZoom);
  const per = options.samplesPerZoom ?? DEFAULT_ESTIMATE_SAMPLES_PER_ZOOM;
  if (!Number.isInteger(per) || per < 1) throw new Error(`samples per zoom must be a whole number ≥ 1 (got ${per})`);
  const cacheSource = options.sourceId ?? basemap.id;
  const { maxZoom: _ignored, ...tileOptions } = options;
  void _ignored;

  const zooms: PackageEstimateZoom[] = [];
  let low = 0;
  let high = 0;
  for (const zr of plan.zooms) {
    const width = zr.maxX - zr.minX + 1;
    const picks = spreadIndices(zr.tiles, per).map((i) => ({ x: zr.minX + (i % width), y: zr.minY + Math.floor(i / width) }));
    const results = await mapWithConcurrency(
      picks.map(({ x, y }) => () => loadTile(basemap, zr.z, x, y, cacheSource, tileOptions)),
      options.tileConcurrency ?? DEFAULT_TILE_CONCURRENCY,
    );
    const sizes = results.filter((r) => typeof r !== "string").map((r) => (r as { bytes: Uint8Array }).bytes.length);
    const failures = results.filter((r): r is string => typeof r === "string");
    if (sizes.length === 0) {
      throw new Error(
        `Every sample at z${zr.z} failed from ${cacheSource}, so there is nothing to estimate from. ` +
          `Causes: ${summarizeTileFailures(failures)}.`,
      );
    }
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    low += zr.tiles * Math.min(...sizes);
    high += zr.tiles * Math.max(...sizes);
    zooms.push({
      z: zr.z,
      tiles: zr.tiles,
      sampled: sizes.length,
      failed: failures.length,
      meanBytes: Math.round(mean),
      estimatedBytes: Math.round(zr.tiles * mean),
    });
  }
  return {
    plan,
    zooms,
    estimatedBytes: zooms.reduce((a, z) => a + z.estimatedBytes, 0),
    lowBytes: low,
    highBytes: high,
    sampled: zooms.reduce((a, z) => a + z.sampled, 0),
    failed: zooms.reduce((a, z) => a + z.failed, 0),
  };
}

/** Fetch every tile in the plan and write the archive. Throws on any failed or non-raster tile. */
export async function buildRasterPackage(options: PackageOptions): Promise<PackageResult> {
  const basemap = options.basemap ?? USGS_TOPO;
  const urlError = tileBaseUrlError(options.tileBaseUrl);
  if (urlError) throw new Error(urlError);
  const plan = planPackage(options.bbox, options.minZoom, options.maxZoom, basemap.maxZoom);
  const maxTiles = options.maxTiles ?? DEFAULT_PACKAGE_MAX_TILES;
  if (plan.tiles > maxTiles) {
    throw new Error(`The package would hold ${plan.tiles} tiles, over the limit of ${maxTiles}. Raise --max-tiles to allow it.`);
  }
  await assertOfflineAllowed(basemap, options.tileBaseUrl, options.sourceId ?? basemap.id);
  const cacheSource = options.sourceId ?? basemap.id;
  // `RenderPanelOptions.maxZoom` would clamp a panel's zoom; a package asks for exact zooms.
  const { maxZoom: _ignored, ...tileOptions } = options;
  void _ignored;

  const jobs: (() => Promise<PackageTile | string>)[] = [];
  for (const zr of plan.zooms) {
    for (let y = zr.minY; y <= zr.maxY; y++) {
      for (let x = zr.minX; x <= zr.maxX; x++) {
        const z = zr.z;
        jobs.push(async () => {
          const tile = await loadTile(basemap, z, x, y, cacheSource, tileOptions);
          if (typeof tile === "string") return tile;
          return { z, x, y, bytes: tile.bytes };
        });
      }
    }
  }
  const loaded = await mapWithConcurrency(jobs, options.tileConcurrency ?? DEFAULT_TILE_CONCURRENCY);
  const failures = loaded.filter((t): t is string => typeof t === "string");
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${plan.tiles} tiles failed from ${cacheSource}, so no package was written. ` +
        `Causes: ${summarizeTileFailures(failures)}.`,
    );
  }
  const tiles = loaded as PackageTile[];

  // One tile type per archive (PMTiles header). Mixed sources are refused, not re-encoded.
  const types = new Map<string, number>();
  for (const t of tiles) {
    const type = sniffRasterType(t.bytes) ?? "unknown";
    types.set(type, (types.get(type) ?? 0) + 1);
  }
  if (types.size !== 1 || types.has("unknown")) {
    const counts = [...types.entries()].map(([k, v]) => `${v} ${k}`).join(", ");
    throw new Error(`A package holds one raster type; these tiles are ${counts}.`);
  }
  const tileType = [...types.keys()][0] as RasterTileType;

  const attribution = options.attribution ?? basemap.attribution;
  const archive = writePmTiles(tiles, {
    tileType,
    bounds: options.bbox,
    minZoom: plan.minZoom,
    maxZoom: plan.maxZoom,
    metadata: {
      name: `${cacheSource} ${options.bbox.join(",")} z${plan.minZoom}-${plan.maxZoom}`,
      attribution,
      source: cacheSource,
      format: tileType,
      type: "baselayer",
      generator: "journeybook package",
    },
    ...(options.leafSize !== undefined ? { leafSize: options.leafSize } : {}),
  });

  // Read every tile back before handing the archive out.
  for (const t of tiles) {
    const back = readPmTilesTile(archive, t.z, t.x, t.y);
    if (!back || !Buffer.from(t.bytes).equals(back)) {
      throw new Error(`Package self-check failed at ${t.z}/${t.x}/${t.y}.`);
    }
  }
  return { archive, plan, tileType, attribution };
}
