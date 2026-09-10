import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getCachedTile,
  storeCachedTile,
  tileExtensionForContentType,
  contentTypeForTileExtension,
} from "./tilecache.js";

const roots: string[] = [];
async function tmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jb-node-tilecache-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  for (const r of roots.splice(0)) {
    await fs.rm(r, { recursive: true, force: true });
  }
});

describe("tilecache", () => {
  it("returns null on a miss", async () => {
    const root = await tmpRoot();
    expect(await getCachedTile(root, "usgs-topo", 2, 1, 1)).toBeNull();
  });

  it("round-trips bytes and discovers the stored ext", async () => {
    const root = await tmpRoot();
    const payload = Buffer.from([1, 2, 3, 4]);
    await storeCachedTile(root, "usgs-topo", 5, 9, 9, "png", payload);

    const hit = await getCachedTile(root, "usgs-topo", 5, 9, 9);
    expect(hit).not.toBeNull();
    expect(hit!.bytes.equals(payload)).toBe(true);
    expect(hit!.ext).toBe("png");
  });

  it("[BEHAVIORAL] does not serve a half-written .tmp file as a hit", async () => {
    const root = await tmpRoot();
    // Exactly what storeCachedTile leaves on disk mid-write: the final name plus
    // its temp suffix. A `{y}.*` prefix lookup matches it and hands back a torn
    // tile, which is the failure atomic temp+rename exists to prevent.
    const dir = path.join(root, "usgs-topo", "5", "9");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "9.png.tmp-1234-5678"), Buffer.from([0xde, 0xad]));

    expect(await getCachedTile(root, "usgs-topo", 5, 9, 9)).toBeNull();

    // Once the rename lands, the same key is a hit with the real bytes.
    const payload = Buffer.from([1, 2, 3, 4]);
    await storeCachedTile(root, "usgs-topo", 5, 9, 9, "png", payload);
    const hit = await getCachedTile(root, "usgs-topo", 5, 9, 9);
    expect(hit!.bytes.equals(payload)).toBe(true);
    expect(hit!.ext).toBe("png");
  });

  it("does not confuse a longer tile number with the one asked for", async () => {
    const root = await tmpRoot();
    await storeCachedTile(root, "usgs-topo", 5, 9, 91, "png", Buffer.from([7]));
    expect(await getCachedTile(root, "usgs-topo", 5, 9, 9)).toBeNull();
  });

  it("does not write outside the cache root for a traversal key", async () => {
    const root = await tmpRoot();
    const probe = path.resolve(root, "..", "jb-node-escape-probe.png");
    await fs.rm(probe, { force: true });

    await storeCachedTile(root, "../jb-node-escape-dir", 0, 0, 0, "png", Buffer.from([9]));

    await expect(fs.access(probe)).rejects.toBeTruthy();
    expect(await getCachedTile(root, "../jb-node-escape-dir", 0, 0, 0)).toBeNull();
  });
});

/**
 * The extension table is a CROSS-LANGUAGE contract, so it is tested against a
 * fixture rather than against a copy of itself.
 *
 * `packages/map-sources/src/tilecache.ts` and
 * `dotnet/JourneyBook.Infrastructure/Tiles/TileService.cs` write into one
 * directory layout and each reads back what the other stored. Asserting the TS
 * switch against a TS literal in this file would prove only that the switch is
 * the switch. `data/fixtures/tile-content-types.json` is read by this suite and
 * by `TileMediaTypeParityTests` in the .NET suite, so a change to either mapping
 * fails in both places.
 */
describe("tile media types (shared with the C# proxy cache)", () => {
  const fixturePath = fileURLToPath(
    new URL("../../../data/fixtures/tile-content-types.json", import.meta.url),
  );
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    extensionForContentType: Record<string, string>;
    contentTypeForExtension: Record<string, string>;
  };

  it("[CONTROL] the fixture was found and is not empty", () => {
    // Without this, every loop below is vacuously green if the path is wrong —
    // which is exactly how a parity test comes to test nothing.
    expect(Object.keys(fixture.extensionForContentType).length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(fixture.contentTypeForExtension).length).toBeGreaterThanOrEqual(5);
  });

  it("maps every content type in the shared fixture to the same extension", () => {
    for (const [contentType, ext] of Object.entries(fixture.extensionForContentType)) {
      expect(tileExtensionForContentType(contentType), `content type "${contentType}"`).toBe(ext);
    }
  });

  it("maps every extension in the shared fixture back to the same content type", () => {
    for (const [ext, contentType] of Object.entries(fixture.contentTypeForExtension)) {
      expect(contentTypeForTileExtension(ext), `extension "${ext}"`).toBe(contentType);
    }
  });

  it("normalises a parameterised content type the bare switch would miss", () => {
    expect(tileExtensionForContentType("image/jpeg; charset=binary")).toBe("jpg");
    expect(tileExtensionForContentType("IMAGE/JPEG")).toBe("jpg");
    expect(tileExtensionForContentType(null)).toBe("png");
  });
});
