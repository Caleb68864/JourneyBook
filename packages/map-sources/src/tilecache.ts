/**
 * Minimal Node-side disk tile cache, honoring the same `{source}/{z}/{x}/{y}.{ext}` key as the
 * C# proxy cache (so the headless CLI and the API share one cache directory). The store records
 * the real extension; the lookup discovers whichever `{y}.*` exists. Paths are confined to the
 * cache root (a `../` key resolves outside and is treated as a miss / skipped store). No TTL —
 * eviction is a Stage 7 concern.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Cache file extension for a tile's `Content-Type`.
 *
 * The C# proxy (`TileService.ExtFor`) and this module write into the SAME
 * directory layout — `{source}/{z}/{x}/{y}.{ext}` — and each reads back what the
 * other stored, so the extension is a shared contract, not a local choice. The
 * store site in `panel.ts` used to pass a literal `"png"` for every tile it had
 * just fetched, so a JPEG cached by the headless CLI was filed as `.png` and the
 * proxy then served those bytes as `image/png` (`ContentTypeFor("png")`).
 *
 * `data/fixtures/tile-content-types.json` is the table both languages are tested
 * against; this function must not be edited without it.
 *
 * A content type with parameters (`image/jpeg; charset=binary`) is normalised to
 * its media type first — the C# switch matches the bare string and would fall to
 * its `png` default there. That is a superset, not a divergence: every bare type
 * maps identically, and the parameterised form is one the C# path gets wrong.
 */
export function tileExtensionForContentType(contentType: string | null | undefined): string {
  const media = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  switch (media) {
    case "application/x-protobuf":
    case "application/vnd.mapbox-vector-tile":
      return "pbf";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      // Unknown or absent: png, matching the C# default arm. Guessing wrong is
      // recoverable (the bytes are intact and re-fetchable); refusing to cache
      // a tile because its source omitted a header is not.
      return "png";
  }
}

/** Inverse of {@link tileExtensionForContentType}; mirrors `TileService.ContentTypeFor`. */
export function contentTypeForTileExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case "pbf":
      return "application/x-protobuf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function resolveTileDir(cacheDir: string, source: string, z: number, x: number): string | null {
  const root = path.resolve(cacheDir);
  const dir = path.resolve(root, source, String(z), String(x));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!dir.startsWith(rootWithSep)) {
    return null; // escapes the cache root
  }
  return dir;
}

/**
 * True for a finished cache entry named `{y}` or `{y}.{ext}` and nothing else.
 *
 * A `startsWith("{y}.")` prefix test also matches the `{y}.{ext}.tmp-{pid}-{ms}`
 * file storeCachedTile writes before its rename, so a concurrent reader would be
 * served a half-written tile as a hit — defeating the atomicity the temp-file
 * dance exists for. A single alphanumeric extension segment is the whole rule.
 */
function isTileName(name: string, y: number): boolean {
  return name === `${y}` || new RegExp(`^${y}\\.[A-Za-z0-9]+$`).test(name);
}

/** Returns the cached tile bytes + discovered extension, or null on a miss. */
export async function getCachedTile(
  cacheDir: string,
  source: string,
  z: number,
  x: number,
  y: number,
): Promise<{ bytes: Buffer; ext: string } | null> {
  const dir = resolveTileDir(cacheDir, source, z, x);
  if (dir === null) return null;

  try {
    const entries = await fs.readdir(dir);
    const match = entries.find((f) => isTileName(f, y));
    if (!match) return null;
    const bytes = await fs.readFile(path.join(dir, match));
    const ext = path.extname(match).replace(/^\./, "");
    return { bytes, ext };
  } catch {
    return null;
  }
}

/** Writes a tile to the cache (atomic temp-file + rename). No-op if the key escapes the root. */
export async function storeCachedTile(
  cacheDir: string,
  source: string,
  z: number,
  x: number,
  y: number,
  ext: string,
  bytes: Buffer,
): Promise<void> {
  const dir = resolveTileDir(cacheDir, source, z, x);
  if (dir === null) return;

  try {
    await fs.mkdir(dir, { recursive: true });
    const final = path.join(dir, `${y}.${ext}`);
    const temp = `${final}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, bytes);
    await fs.rename(temp, final);
  } catch {
    // best-effort: a cache write failure must not break rendering
  }
}
