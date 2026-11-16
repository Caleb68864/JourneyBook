import { describe, it, expect } from "vitest";
import { PMTILES_ROOT_LIMIT, pmtilesTileId, readPmTilesHeader, readPmTilesTile, writePmTiles, type PackageTile } from "./pmtiles.js";

describe("pmtilesTileId", () => {
  it("matches the spec's base offsets and C#'s PmTilesReader.ZxyToTileId cases", () => {
    expect(pmtilesTileId(0, 0, 0)).toBe(0n);
    expect(pmtilesTileId(1, 0, 0)).toBe(1n);
    expect(pmtilesTileId(2, 0, 0)).toBe(5n);
    // The four z1 tiles take ids 1..4 in Hilbert order.
    expect([pmtilesTileId(1, 0, 0), pmtilesTileId(1, 0, 1), pmtilesTileId(1, 1, 1), pmtilesTileId(1, 1, 0)]).toEqual([1n, 2n, 3n, 4n]);
  });
});

describe("writePmTiles", () => {
  const png = (tail: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(tail)]);
  const opts = { tileType: "png" as const, bounds: [-1, -1, 1, 1] as [number, number, number, number], minZoom: 12, maxZoom: 12, metadata: {} };

  it("moves entries to leaf directories when the root would pass 16 KiB", () => {
    const tiles: PackageTile[] = [];
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) tiles.push({ z: 12, x, y, bytes: png(`${x}/${y}`) });
    const archive = writePmTiles(tiles, opts);
    expect(Number(archive.readBigUInt64LE(16)) + 127).toBeLessThanOrEqual(PMTILES_ROOT_LIMIT);
    expect(Number(archive.readBigUInt64LE(48))).toBeGreaterThan(0); // leaf directories exist
    expect(readPmTilesHeader(archive).addressedTiles).toBe(4096);
    for (const t of [tiles[0]!, tiles[2047]!, tiles[4095]!]) expect(readPmTilesTile(archive, t.z, t.x, t.y)?.equals(t.bytes as Buffer)).toBe(true);
  });

  it("stores identical tiles once", () => {
    const same = png("same");
    const tiles: PackageTile[] = [0, 1, 2, 3].map((x) => ({ z: 12, x, y: 0, bytes: same }));
    const archive = writePmTiles(tiles, opts);
    expect(Number(archive.readBigUInt64LE(64))).toBe(same.length); // tile data length
    expect(Number(archive.readBigUInt64LE(88))).toBe(1); // tile contents
  });

  it("refuses an empty package and a repeated tile", () => {
    expect(() => writePmTiles([], opts)).toThrow(/at least one/);
    expect(() => writePmTiles([{ z: 1, x: 0, y: 0, bytes: png("a") }, { z: 1, x: 0, y: 0, bytes: png("b") }], opts)).toThrow(/twice/);
  });
});
