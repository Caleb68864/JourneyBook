/**
 * Minimal PMTiles v3 writer (and a reader to check it) for RASTER packages.
 *
 * Owner decision (b), 2026-11-16: offline packages are raster PMTiles of USGS
 * topo only. No vector tiles, no MBTiles. So this writes one tile type per
 * archive (png, jpeg or webp), tile compression "none" (the image formats are
 * already compressed), and internal compression "none".
 *
 * Internal compression is "none" on purpose: gzip output carries an OS byte
 * that differs between platforms, and `data/fixtures/raster-package/` is
 * compared byte for byte by both suites. The C# `PmTilesReader` reads either.
 *
 * Layout: header (127 B) | root directory | metadata JSON | leaf directories |
 * tile data. Tile data is written in tile-id order with identical tiles stored
 * once (so `clustered` = 1), and runs of consecutive ids with identical bytes
 * share one directory entry. When the root directory would not fit in the first
 * 16,384 bytes (the spec's limit), entries move to leaf directories.
 *
 * The tile id is an archive-format detail (zoom base offset + Hilbert index),
 * not map projection; it mirrors `PmTilesReader.ZxyToTileId` in C#.
 */

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const PMTILES_HEADER_LENGTH = 127;
/** The spec: header plus root directory must fit in the first 16 KiB. */
export const PMTILES_ROOT_LIMIT = 16_384;

/** Header `tile_type` byte for the raster formats a package may hold. */
export const PMTILES_TILE_TYPE = { png: 2, jpeg: 3, webp: 4 } as const;
export type RasterTileType = keyof typeof PMTILES_TILE_TYPE;

export interface PackageTile {
  z: number;
  x: number;
  y: number;
  bytes: Uint8Array;
}

export interface WritePmTilesOptions {
  tileType: RasterTileType;
  /** [W, S, E, N] in degrees, written to the header bounds. */
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  /** JSON metadata (attribution, source, …). Written as-is. */
  metadata: Record<string, unknown>;
  /** Entries per leaf directory. Only needed to force leaves (tests); default 4096. */
  leafSize?: number;
}

/** PMTiles tile id: sum of 4^i for i < z, plus the Hilbert index of (x, y) in the 2^z grid. */
export function pmtilesTileId(z: number, x: number, y: number): bigint {
  let acc = 0n;
  for (let t = 0; t < z; t++) acc += 1n << BigInt(2 * t);
  let d = 0n;
  const n = 1 << z;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += BigInt(s) * BigInt(s) * BigInt((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return acc + d;
}

interface Entry {
  tileId: bigint;
  offset: bigint;
  length: number;
  runLength: number;
}

function writeVarint(out: number[], value: bigint): void {
  while (value >= 0x80n) {
    out.push(Number(value & 0x7fn) | 0x80);
    value >>= 7n;
  }
  out.push(Number(value));
}

function serializeDirectory(entries: readonly Entry[]): Buffer {
  const out: number[] = [];
  writeVarint(out, BigInt(entries.length));
  let last = 0n;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, BigInt(e.runLength));
  for (const e of entries) writeVarint(out, BigInt(e.length));
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (prev && e.offset === prev.offset + BigInt(prev.length)) writeVarint(out, 0n);
    else writeVarint(out, e.offset + 1n);
  });
  return Buffer.from(out);
}

/** Write a raster PMTiles v3 archive. Tiles may come in any order; duplicates of a z/x/y are an error. */
export function writePmTiles(tiles: readonly PackageTile[], options: WritePmTilesOptions): Buffer {
  if (tiles.length === 0) throw new Error("A package needs at least one tile.");
  const sorted = tiles
    .map((t) => ({ ...t, id: pmtilesTileId(t.z, t.x, t.y) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const chunks: Buffer[] = [];
  const byHash = new Map<string, { offset: bigint; length: number }>();
  let dataLength = 0n;
  const entries: Entry[] = [];
  let contents = 0;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    if (i > 0 && sorted[i - 1]!.id === t.id) throw new Error(`Tile ${t.z}/${t.x}/${t.y} given twice.`);
    const hash = createHash("sha256").update(t.bytes).digest("hex");
    let stored = byHash.get(hash);
    if (!stored) {
      stored = { offset: dataLength, length: t.bytes.length };
      byHash.set(hash, stored);
      chunks.push(Buffer.from(t.bytes));
      dataLength += BigInt(t.bytes.length);
      contents++;
    }
    const prev = entries[entries.length - 1];
    if (prev && prev.offset === stored.offset && prev.tileId + BigInt(prev.runLength) === t.id) {
      prev.runLength++;
    } else {
      entries.push({ tileId: t.id, offset: stored.offset, length: stored.length, runLength: 1 });
    }
  }
  const tileData = Buffer.concat(chunks);

  // Root directory, with leaves if the root would not fit.
  let root = serializeDirectory(entries);
  let leaves = Buffer.alloc(0);
  if (options.leafSize !== undefined || PMTILES_HEADER_LENGTH + root.length > PMTILES_ROOT_LIMIT) {
    let leafSize = options.leafSize ?? 4096;
    for (;;) {
      const leafChunks: Buffer[] = [];
      const rootEntries: Entry[] = [];
      let leafOffset = 0n;
      for (let i = 0; i < entries.length; i += leafSize) {
        const part = entries.slice(i, i + leafSize);
        const bytes = serializeDirectory(part);
        rootEntries.push({ tileId: part[0]!.tileId, offset: leafOffset, length: bytes.length, runLength: 0 });
        leafChunks.push(bytes);
        leafOffset += BigInt(bytes.length);
      }
      root = serializeDirectory(rootEntries);
      leaves = Buffer.concat(leafChunks);
      if (PMTILES_HEADER_LENGTH + root.length <= PMTILES_ROOT_LIMIT) break;
      leafSize *= 2;
    }
  }

  const metadata = Buffer.from(JSON.stringify(options.metadata), "utf8");
  const rootOffset = PMTILES_HEADER_LENGTH;
  const metadataOffset = rootOffset + root.length;
  const leafOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafOffset + leaves.length;

  const header = Buffer.alloc(PMTILES_HEADER_LENGTH);
  header.write("PMTiles", 0, "ascii");
  header[7] = 3;
  header.writeBigUInt64LE(BigInt(rootOffset), 8);
  header.writeBigUInt64LE(BigInt(root.length), 16);
  header.writeBigUInt64LE(BigInt(metadataOffset), 24);
  header.writeBigUInt64LE(BigInt(metadata.length), 32);
  header.writeBigUInt64LE(BigInt(leafOffset), 40);
  header.writeBigUInt64LE(BigInt(leaves.length), 48);
  header.writeBigUInt64LE(BigInt(tileDataOffset), 56);
  header.writeBigUInt64LE(BigInt(tileData.length), 64);
  header.writeBigUInt64LE(BigInt(sorted.length), 72); // addressed tiles
  header.writeBigUInt64LE(BigInt(entries.length), 80); // tile entries
  header.writeBigUInt64LE(BigInt(contents), 88); // tile contents
  header[96] = 1; // clustered
  header[97] = 1; // internal compression: none
  header[98] = 1; // tile compression: none
  header[99] = PMTILES_TILE_TYPE[options.tileType];
  header[100] = options.minZoom;
  header[101] = options.maxZoom;
  const [w, s, e, n] = options.bounds;
  const e7 = (v: number) => Math.round(v * 1e7);
  header.writeInt32LE(e7(w), 102);
  header.writeInt32LE(e7(s), 106);
  header.writeInt32LE(e7(e), 110);
  header.writeInt32LE(e7(n), 114);
  header[118] = options.minZoom; // center zoom
  header.writeInt32LE(e7((w + e) / 2), 119);
  header.writeInt32LE(e7((s + n) / 2), 123);

  return Buffer.concat([header, root, metadata, leaves, tileData]);
}

/** The header fields a package check needs. */
export interface PmTilesHeader {
  tileType: number;
  minZoom: number;
  maxZoom: number;
  addressedTiles: number;
  metadata: Record<string, unknown>;
}

function readVarint(buf: Buffer, pos: { i: number }): bigint {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    const b = buf[pos.i++]!;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return result;
    shift += 7n;
  }
}

function parseDirectory(buf: Buffer): Entry[] {
  const pos = { i: 0 };
  const count = Number(readVarint(buf, pos));
  const entries: Entry[] = [];
  let last = 0n;
  for (let i = 0; i < count; i++) {
    last += readVarint(buf, pos);
    entries.push({ tileId: last, offset: 0n, length: 0, runLength: 0 });
  }
  for (const e of entries) e.runLength = Number(readVarint(buf, pos));
  for (const e of entries) e.length = Number(readVarint(buf, pos));
  entries.forEach((e, i) => {
    const raw = readVarint(buf, pos);
    const prev = entries[i - 1];
    e.offset = raw === 0n && prev ? prev.offset + BigInt(prev.length) : raw - 1n;
  });
  return entries;
}

function checkMagic(archive: Buffer): void {
  if (archive.length < PMTILES_HEADER_LENGTH || archive.toString("ascii", 0, 7) !== "PMTiles" || archive[7] !== 3) {
    throw new Error("Not a PMTiles v3 archive.");
  }
}

function decompress(bytes: Buffer, compression: number): Buffer {
  return compression === 2 ? gunzipSync(bytes) : bytes;
}

export function readPmTilesHeader(archive: Buffer): PmTilesHeader {
  checkMagic(archive);
  const mOff = Number(archive.readBigUInt64LE(24));
  const mLen = Number(archive.readBigUInt64LE(32));
  const raw = decompress(archive.subarray(mOff, mOff + mLen), archive[97]!);
  return {
    tileType: archive[99]!,
    minZoom: archive[100]!,
    maxZoom: archive[101]!,
    addressedTiles: Number(archive.readBigUInt64LE(72)),
    metadata: mLen > 0 ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {},
  };
}

/** One tile's bytes from an in-memory archive, or null when the archive does not hold it. */
export function readPmTilesTile(archive: Buffer, z: number, x: number, y: number): Buffer | null {
  checkMagic(archive);
  const rootOff = Number(archive.readBigUInt64LE(8));
  const rootLen = Number(archive.readBigUInt64LE(16));
  const leafOff = Number(archive.readBigUInt64LE(40));
  const dataOff = Number(archive.readBigUInt64LE(56));
  const internal = archive[97]!;
  const id = pmtilesTileId(z, x, y);
  let entries = parseDirectory(decompress(archive.subarray(rootOff, rootOff + rootLen), internal));
  for (let depth = 0; depth < 4; depth++) {
    let found: Entry | undefined;
    for (const e of entries) {
      if (e.tileId <= id) found = e;
      else break;
    }
    if (!found) return null;
    if (found.runLength === 0) {
      const start = leafOff + Number(found.offset);
      entries = parseDirectory(decompress(archive.subarray(start, start + found.length), internal));
      continue;
    }
    if (id - found.tileId >= BigInt(found.runLength)) return null;
    const start = dataOff + Number(found.offset);
    return decompress(archive.subarray(start, start + found.length), archive[98]!);
  }
  return null;
}
