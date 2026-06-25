/**
 * Minimal Node-side disk tile cache, honoring the same `{source}/{z}/{x}/{y}.{ext}` key as the
 * C# proxy cache (so the headless CLI and the API share one cache directory). The store records
 * the real extension; the lookup discovers whichever `{y}.*` exists. Paths are confined to the
 * cache root (a `../` key resolves outside and is treated as a miss / skipped store). No TTL —
 * eviction is a Stage 7 concern.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

function resolveTileDir(cacheDir: string, source: string, z: number, x: number): string | null {
  const root = path.resolve(cacheDir);
  const dir = path.resolve(root, source, String(z), String(x));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!dir.startsWith(rootWithSep)) {
    return null; // escapes the cache root
  }
  return dir;
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
    const match = entries.find((f) => f === `${y}` || f.startsWith(`${y}.`));
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
