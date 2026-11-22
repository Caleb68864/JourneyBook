import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measurePdfPages } from "@journeybook/pdf-client";
import {
  USGS_TOPO,
  readPmTilesHeader,
  readPmTilesTile,
  writePmTiles,
  type PackageTile,
} from "@journeybook/map-sources";
import { buildRasterPackage, estimatePackageSize, planPackage, sniffRasterType, spreadIndices } from "./package.js";
import { assembleContract, planAtlasRender, renderAtlas, type RenderAtlasInput } from "./render.js";
import { runCli } from "./cli.js";

const realFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());

const TILE_URL = /\/tile\/(\d+)\/(\d+)\/(\d+)$|\/(\d+)\/(\d+)\/(\d+)$/;

/** z/x/y from a USGS template URL ({z}/{y}/{x}) or a proxy URL ({z}/{x}/{y}). */
function zxyOf(url: string): [number, number, number] {
  const m = TILE_URL.exec(url)!;
  if (m[1] !== undefined) return [Number(m[1]), Number(m[3]), Number(m[2])];
  return [Number(m[4]), Number(m[5]), Number(m[6])];
}

/** A real 256 px PNG (the one `render.test.ts` serves), so the render test composites real pixels. */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACAElEQVR42u3TMQ0AAAgEsVfMjAhEM6OBJlVwyaWn4K1IgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAADKACBgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABVMAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMANcCwUIVr6HMf/cAAAAASUVORK5CYII=",
  "base64",
);
async function tilePng(_z: number): Promise<Buffer> {
  return TILE_PNG;
}

/**
 * The fake upstream: answers tile URLs with a PNG and counts them; anything else goes to the real fetch.
 * A registry lookup (`/api/tile-sources/by-key/{key}`) gets a row whose `cache.offlineAllowed` is
 * `offlineAllowed`, and is recorded in `registry`, not `calls`.
 */
function fakeUpstream(offlineAllowed = true) {
  const calls: string[] = [];
  const registry: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/^https?:/i.test(url)) return realFetch(input, init);
    if (url.includes("/tile-sources/by-key/")) {
      registry.push(url);
      return Response.json({ key: url.split("/").pop(), cache: { maxAgeSeconds: 86400, offlineAllowed } });
    }
    calls.push(url);
    const [z] = zxyOf(url);
    return new Response(new Uint8Array(await tilePng(z)), { status: 200, headers: { "content-type": "image/png" } });
  });
  return { fn, calls, registry };
}

describe("planPackage", () => {
  it("counts tiles per zoom from the engine's tile range", () => {
    const plan = planPackage([-96.71, 40.81, -96.69, 40.82], 10, 12);
    expect(plan.zooms.map((z) => z.z)).toEqual([10, 11, 12]);
    expect(plan.tiles).toBe(plan.zooms.reduce((a, z) => a + z.tiles, 0));
    expect(plan.zooms[0]!.tiles).toBe(1);
  });

  it("refuses a zoom deeper than the source has and a bad bbox", () => {
    expect(() => planPackage([-96.71, 40.81, -96.69, 40.82], 15, 17, 16)).toThrow(/deeper than the source/);
    expect(() => planPackage([-96.69, 40.81, -96.71, 40.82], 10, 12)).toThrow(/W < E/);
    expect(() => planPackage([-96.71, 40.81, -96.69, 40.82], 12, 10)).toThrow(/min <= max/);
  });
});

describe("sniffRasterType", () => {
  it("reads png, jpeg and webp magic, and nothing else", () => {
    expect(sniffRasterType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("png");
    expect(sniffRasterType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffRasterType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffRasterType(new Uint8Array([0x1a, 0x45]))).toBeNull();
  });
});

describe("buildRasterPackage", () => {
  const bbox: [number, number, number, number] = [-96.71, 40.81, -96.69, 40.82];

  it("packages every planned tile from the source and reads each one back", async () => {
    const up = fakeUpstream();
    vi.stubGlobal("fetch", up.fn);
    const { archive, plan, tileType } = await buildRasterPackage({ bbox, minZoom: 10, maxZoom: 13 });
    expect(tileType).toBe("png");
    expect(up.calls).toHaveLength(plan.tiles);
    const header = readPmTilesHeader(archive);
    expect(header).toMatchObject({ tileType: 2, minZoom: 10, maxZoom: 13, addressedTiles: plan.tiles });
    expect(header.metadata.attribution).toBe("USGS The National Map");
    for (const zr of plan.zooms) {
      const back = readPmTilesTile(archive, zr.z, zr.minX, zr.minY);
      expect(back?.equals(await tilePng(zr.z))).toBe(true);
    }
    // Outside the bbox: absent.
    expect(readPmTilesTile(archive, 13, plan.zooms[3]!.maxX + 1, plan.zooms[3]!.minY)).toBeNull();
  });

  it("goes through the shared tile cache: a second package needs no fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-package-cache-"));
    try {
      vi.stubGlobal("fetch", fakeUpstream().fn);
      const first = await buildRasterPackage({ bbox, minZoom: 10, maxZoom: 12, cacheDir: dir });
      const down = vi.fn(async () => new Response(null, { status: 503 }));
      vi.stubGlobal("fetch", down);
      const second = await buildRasterPackage({ bbox, minZoom: 10, maxZoom: 12, cacheDir: dir, tileAttempts: 1 });
      expect(down).not.toHaveBeenCalled();
      expect(second.archive.equals(first.archive)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("routes through the C# proxy URL when given one", async () => {
    const up = fakeUpstream();
    vi.stubGlobal("fetch", up.fn);
    await buildRasterPackage({
      bbox,
      minZoom: 10,
      maxZoom: 10,
      tileBaseUrl: "http://localhost:5180/api/tiles",
      sourceId: "usgs-topo",
    });
    expect(up.calls[0]).toMatch(/^http:\/\/localhost:5180\/api\/tiles\/usgs-topo\/10\/\d+\/\d+$/);
    // The registry row is the authority on offline terms, and USGS's says yes.
    expect(up.registry).toEqual(["http://localhost:5180/api/tile-sources/by-key/usgs-topo"]);
  });

  it("allows USGS: public domain, the only package source", () => {
    expect(USGS_TOPO.offlineAllowed).toBe(true);
  });

  it("refuses a basemap that does not allow offline use, before fetching a tile", async () => {
    const up = fakeUpstream();
    vi.stubGlobal("fetch", up.fn);
    const closed = { id: "closed-topo", urlTemplate: "https://example.test/{z}/{x}/{y}", attribution: "Closed", maxZoom: 16 };
    await expect(buildRasterPackage({ bbox, minZoom: 10, maxZoom: 10, basemap: closed })).rejects.toThrow(
      /closed-topo does not allow offline use, so it cannot be packaged/,
    );
    await expect(
      buildRasterPackage({ bbox, minZoom: 10, maxZoom: 10, basemap: { ...closed, offlineAllowed: false } }),
    ).rejects.toThrow(/does not allow offline use/);
    expect(up.calls).toHaveLength(0);
  });

  it("refuses when the proxy's registry row says OfflineAllowed false, before fetching a tile", async () => {
    const up = fakeUpstream(false);
    vi.stubGlobal("fetch", up.fn);
    await expect(
      buildRasterPackage({ bbox, minZoom: 10, maxZoom: 10, tileBaseUrl: "http://localhost:5180/api/tiles", sourceId: "usgs-topo" }),
    ).rejects.toThrow(/Tile source usgs-topo does not allow offline use .*OfflineAllowed false/);
    expect(up.calls).toHaveLength(0);
  });

  it("refuses when the registry row cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(
      buildRasterPackage({ bbox, minZoom: 10, maxZoom: 10, tileBaseUrl: "http://localhost:5180/api/tiles", sourceId: "nope" }),
    ).rejects.toThrow(/Could not read tile source nope .*HTTP 404.*no package was made/);
  });

  it("writes nothing when a tile fails, and refuses an oversized package", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(buildRasterPackage({ bbox, minZoom: 10, maxZoom: 11 })).rejects.toThrow(/tiles failed .*HTTP 404/);
    await expect(buildRasterPackage({ bbox, minZoom: 10, maxZoom: 16, maxTiles: 10 })).rejects.toThrow(/over the limit of 10/);
  });

  it("refuses a source that mixes raster types", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(n++ === 0 ? [0xff, 0xd8, 0xff, 0xe0] : await tilePng(1)), { status: 200 })),
    );
    await expect(buildRasterPackage({ bbox, minZoom: 10, maxZoom: 12 })).rejects.toThrow(/one raster type/);
  });

  it("renders an atlas page with every tile served from the package", async () => {
    const input: RenderAtlasInput = {
      mode: "location",
      center: { lng: -96.7026, lat: 40.8136 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      basemap: true,
      panelWidthPx: 512,
      overview: false,
      tableOfContents: false,
      outputPath: "",
    };
    const page = assembleContract(input).contract.pages[0]!;
    const zoom = planAtlasRender(input).pages[0]!.panel!.zoom;

    vi.stubGlobal("fetch", fakeUpstream().fn);
    const { archive } = await buildRasterPackage({ bbox: page.bbox, minZoom: zoom - 1, maxZoom: zoom });

    // The renderer's only tile source is now the archive.
    const misses: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (req: string | URL | Request, init?: RequestInit) => {
        const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
        if (!/^https?:/i.test(url)) return realFetch(req, init);
        const [z, x, y] = zxyOf(url);
        const bytes = readPmTilesTile(archive, z, x, y);
        if (!bytes) {
          misses.push(url);
          return new Response(null, { status: 404 });
        }
        return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), "jb-package-render-"));
    try {
      const out = join(dir, "from-package.pdf");
      const res = await renderAtlas({ ...input, outputPath: out, panelFormat: "png" });
      expect(misses).toEqual([]);
      expect(res.pageCount).toBe(1);
      expect(measurePdfPages(readFileSync(out))[0]!.images).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * The cross-language fixture. `PmTilesReader` (C#) reads this file in
 * `RasterPackageFixtureTests`; this test holds the TS writer to it byte for byte,
 * so the C# side is reading what the current writer makes. The tiles are short
 * PNG-signed payloads, not images, so no encoder version can change them; leaves
 * are forced so the C# reader's leaf-directory path is exercised too.
 * Regenerate with UPDATE_FIXTURES=1.
 */
describe("raster-package fixture", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../data/fixtures/raster-package");
  const manifestPath = join(root, "manifest.json");
  const archivePath = join(root, "package.pmtiles");

  function fixtureTiles(): PackageTile[] {
    const tiles: PackageTile[] = [];
    // z10..12 over a 2x2 / 3x3 / 4x4 patch, plus a run of identical tiles at z12.
    for (const [z, x0, y0, side] of [
      [10, 236, 387, 2],
      [11, 472, 774, 3],
      [12, 944, 1548, 4],
    ] as const) {
      for (let x = x0; x < x0 + side; x++) {
        for (let y = y0; y < y0 + side; y++) {
          const same = z === 12 && x === x0; // one column of identical bytes: dedupe + run lengths
          const tail = same ? "same" : `${z}/${x}/${y}`;
          tiles.push({ z, x, y, bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tail)]) });
        }
      }
    }
    return tiles;
  }

  it("is what the writer makes", () => {
    const tiles = fixtureTiles();
    const archive = writePmTiles(tiles, {
      tileType: "png",
      bounds: [-97.0, 40.5, -96.5, 41.0],
      minZoom: 10,
      maxZoom: 12,
      metadata: { name: "fixture", attribution: "USGS The National Map", source: "usgs-topo", format: "png" },
      leafSize: 5,
    });
    const manifest = {
      note: "Written by packages/render-cli/src/package.test.ts; read by dotnet/JourneyBook.Tests/RasterPackageFixtureTests.cs.",
      tileType: 2,
      minZoom: 10,
      maxZoom: 12,
      tiles: tiles.map((t) => ({ z: t.z, x: t.x, y: t.y, sha256: createHash("sha256").update(t.bytes).digest("hex") })),
      absent: [{ z: 12, x: 943, y: 1548 }, { z: 9, x: 0, y: 0 }],
    };
    if (process.env.UPDATE_FIXTURES === "1") {
      mkdirSync(root, { recursive: true });
      writeFileSync(archivePath, archive);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    expect(readFileSync(archivePath).equals(archive)).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
    for (const t of tiles) expect(readPmTilesTile(archive, t.z, t.x, t.y)?.equals(Buffer.from(t.bytes))).toBe(true);
    for (const a of manifest.absent) expect(readPmTilesTile(archive, a.z, a.x, a.y)).toBeNull();
  });
});

describe("cli package", () => {
  it("--dry-run prints the tile count and writes nothing", async () => {
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    try {
      const code = await runCli(["package", "--bbox", "-96.71,40.81,-96.69,40.82", "--min-zoom", "10", "--max-zoom", "12", "--dry-run"]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(out.join("")).toMatch(/z10: 1 tile/);
    expect(out.join("")).toMatch(/total \d+ tiles/);
  });

  it("writes a .pmtiles file", async () => {
    vi.stubGlobal("fetch", fakeUpstream().fn);
    const dir = mkdtempSync(join(tmpdir(), "jb-package-cli-"));
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const file = join(dir, "lincoln.pmtiles");
      const code = await runCli(["package", "--bbox", "-96.71,40.81,-96.69,40.82", "--min-zoom", "10", "--max-zoom", "11", "--out", file]);
      expect(code).toBe(0);
      expect(readPmTilesHeader(readFileSync(file))).toMatchObject({ tileType: 2, minZoom: 10, maxZoom: 11 });
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses, with the reason and no file, a source whose registry row forbids offline use", async () => {
    vi.stubGlobal("fetch", fakeUpstream(false).fn);
    const dir = mkdtempSync(join(tmpdir(), "jb-package-cli-"));
    const err: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s) => (err.push(String(s)), true));
    try {
      const file = join(dir, "closed.pmtiles");
      const code = await runCli([
        "package", "--bbox", "-96.71,40.81,-96.69,40.82", "--min-zoom", "10", "--max-zoom", "10", "--out", file,
        "--tile-base-url", "http://localhost:5180/api/tiles", "--tile-source", "closed-topo",
      ]);
      expect(code).toBe(2);
      expect(err.join("")).toMatch(/Tile source closed-topo does not allow offline use/);
      expect(existsSync(file)).toBe(false);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("needs --bbox, zooms and --out", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await runCli(["package", "--min-zoom", "10", "--max-zoom", "11", "--out", "x.pmtiles"])).toBe(2);
      expect(await runCli(["package", "--bbox", "-96.71,40.81,-96.69,40.82", "--max-zoom", "11", "--out", "x.pmtiles"])).toBe(2);
      expect(await runCli(["package", "--bbox", "-96.71,40.81,-96.69,40.82", "--min-zoom", "10", "--max-zoom", "11"])).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("estimatePackageSize", () => {
  /** A source whose tile size depends on z and x, so the estimate has something to measure. */
  function sizedUpstream(fail?: (z: number, x: number) => boolean) {
    const calls: string[] = [];
    const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/^https?:/i.test(url)) return realFetch(input, init);
      calls.push(url);
      const [z, x] = zxyOf(url);
      if (fail?.(z, x)) return new Response(null, { status: 404 });
      // z10: 1000 B; z11: 2000 or 3000 B by x parity. A PNG header first, so it looks like a tile.
      const size = z === 10 ? 1000 : x % 2 === 0 ? 2000 : 3000;
      const bytes = Buffer.alloc(size);
      TILE_PNG.copy(bytes, 0, 0, 8);
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
    });
    return { fn, calls };
  }

  const BBOX: [number, number, number, number] = [-96.9, 40.7, -96.5, 41.0];

  it("multiplies each zoom's tile count by the mean of a few measured tiles", async () => {
    const up = sizedUpstream();
    vi.stubGlobal("fetch", up.fn);
    const plan = planPackage(BBOX, 10, 11);
    const est = await estimatePackageSize({ bbox: BBOX, minZoom: 10, maxZoom: 11, samplesPerZoom: 4 });

    // Only the samples were fetched, not the package.
    expect(up.calls.length).toBe(est.sampled);
    expect(est.sampled).toBeLessThanOrEqual(8);
    expect(plan.tiles).toBeGreaterThan(est.sampled);

    const z10 = est.zooms.find((z) => z.z === 10)!;
    expect(z10.meanBytes).toBe(1000);
    expect(z10.estimatedBytes).toBe(z10.tiles * 1000);
    const z11 = est.zooms.find((z) => z.z === 11)!;
    expect(z11.meanBytes).toBeGreaterThanOrEqual(2000);
    expect(z11.meanBytes).toBeLessThanOrEqual(3000);
    expect(est.estimatedBytes).toBe(z10.estimatedBytes + z11.estimatedBytes);
    // The spread is the samples' own, zoom by zoom.
    expect(est.lowBytes).toBe(z10.tiles * 1000 + z11.tiles * 2000);
    expect(est.highBytes).toBe(z10.tiles * 1000 + z11.tiles * 3000);
  });

  it("leaves failed samples out of the mean and says how many, and refuses a zoom with none", async () => {
    vi.stubGlobal("fetch", sizedUpstream((z, x) => z === 11 && x % 2 === 1).fn);
    const est = await estimatePackageSize({ bbox: BBOX, minZoom: 10, maxZoom: 11, samplesPerZoom: 4 });
    const z11 = est.zooms.find((z) => z.z === 11)!;
    expect(z11.failed).toBeGreaterThan(0);
    expect(z11.meanBytes).toBe(2000);

    vi.stubGlobal("fetch", sizedUpstream((z) => z === 11).fn);
    await expect(estimatePackageSize({ bbox: BBOX, minZoom: 10, maxZoom: 11, samplesPerZoom: 4 })).rejects.toThrow(
      /Every sample at z11 failed.*HTTP 404/,
    );
  });

  it("spreads samples evenly over the range, ends included, without repeats", () => {
    expect(spreadIndices(10, 3)).toEqual([0, 5, 9]);
    expect(spreadIndices(3, 8)).toEqual([0, 1, 2]);
    expect(spreadIndices(9, 1)).toEqual([4]);
    expect(spreadIndices(0, 4)).toEqual([]);
  });

  it("the CLI prints a measured estimate with --estimate", async () => {
    vi.stubGlobal("fetch", sizedUpstream().fn);
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => (out.push(String(s)), true));
    try {
      const code = await runCli(["package", "--bbox", BBOX.join(","), "--min-zoom", "10", "--max-zoom", "10", "--estimate", "--sample", "2"]);
      expect(code).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(out.join("")).toMatch(/z10: \d+ tiles × 1000 B mean of 2 sampled/);
    expect(out.join("")).toMatch(/total \d+ tiles ≈ [\d.]+ MB/);
  });
});
