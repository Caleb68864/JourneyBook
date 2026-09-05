import sharp from "sharp";
import type { BBox } from "@journeybook/atlas-core";
import {
  TILE_SIZE,
  lngLatToGlobalPixel,
  zoomForBBox,
  tileRangeForBBox,
} from "./tilemath.js";
import { getCachedTile, storeCachedTile } from "./tilecache.js";

/** Parchment fill behind the mosaic, showing wherever a tile fetch failed. */
const PANEL_BACKGROUND = { r: 244, g: 240, b: 230, alpha: 1 } as const;

/** A raster XYZ basemap source with attribution. */
export interface RasterBasemap {
  id: string;
  /** URL template with {z} {x} {y} tokens. */
  urlTemplate: string;
  attribution: string;
}

/**
 * USGS The National Map topo basemap — public domain, no key, land-nav-friendly.
 * NOTE: ArcGIS tile order is {z}/{y}/{x}.
 */
export const USGS_TOPO: RasterBasemap = {
  id: "usgs-topo",
  urlTemplate:
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  attribution: "USGS The National Map",
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
  attribution: string;
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

async function fetchTile(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Read a tile from the shared disk cache when configured, else fetch and (best-effort) cache it. */
async function loadTile(
  basemap: RasterBasemap,
  z: number,
  x: number,
  y: number,
  cacheSource: string,
  options?: RenderPanelOptions,
): Promise<Buffer | null> {
  if (options?.cacheDir) {
    const hit = await getCachedTile(options.cacheDir, cacheSource, z, x, y);
    if (hit) return hit.bytes;
  }

  const buf = await fetchTile(resolveTileUrl(basemap, z, x, y, options));
  if (buf && options?.cacheDir) {
    await storeCachedTile(options.cacheDir, cacheSource, z, x, y, "png", buf);
  }
  return buf;
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
  const zoom = zoomForBBox(bbox, targetWidthPx);
  const range = tileRangeForBBox(bbox, zoom);
  const [west, south, east, north] = bbox;

  const cols = range.maxX - range.minX + 1;
  const rows = range.maxY - range.minY + 1;
  const cacheSource = options?.sourceId ?? basemap.id;

  // Fetch every covering tile (blank where a fetch fails); reuse the shared disk cache if given.
  const jobs: Promise<{ left: number; top: number; input: Buffer } | null>[] = [];
  for (let ty = range.minY; ty <= range.maxY; ty++) {
    for (let tx = range.minX; tx <= range.maxX; tx++) {
      const left = (tx - range.minX) * TILE_SIZE;
      const top = (ty - range.minY) * TILE_SIZE;
      jobs.push(
        loadTile(basemap, zoom, tx, ty, cacheSource, options).then((buf) =>
          buf ? { left, top, input: buf } : null,
        ),
      );
    }
  }
  const placements = (await Promise.all(jobs)).filter((p) => p !== null);

  // Crop window in mosaic pixels.
  const topLeft = lngLatToGlobalPixel(west, north, zoom);
  const bottomRight = lngLatToGlobalPixel(east, south, zoom);
  const left = Math.round(topLeft.x - range.minX * TILE_SIZE);
  const top = Math.round(topLeft.y - range.minY * TILE_SIZE);
  const width = Math.max(1, Math.round(bottomRight.x - topLeft.x));
  const height = Math.max(1, Math.round(bottomRight.y - topLeft.y));

  const format = options?.format ?? DEFAULT_PANEL_FORMAT;
  const quality = options?.quality ?? DEFAULT_PANEL_QUALITY;

  const mosaic = sharp({
    create: {
      width: cols * TILE_SIZE,
      height: rows * TILE_SIZE,
      channels: 4,
      background: PANEL_BACKGROUND,
    },
  })
    .composite(placements)
    .extract({ left, top, width, height });

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
    attribution: basemap.attribution,
  };
}
