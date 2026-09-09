import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import sharp from "sharp";
import { resolveTileUrl, renderMapPanel, USGS_TOPO, TILE_USER_AGENT } from "./panel.js";
import { TILE_SIZE, lngLatToGlobalPixel, tileRangeForBBox } from "./tilemath.js";

describe("resolveTileUrl", () => {
  it("uses the source's URL template when no proxy base is given", () => {
    expect(resolveTileUrl(USGS_TOPO, 5, 9, 9)).toBe(
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/5/9/9",
    );
  });

  it("builds a proxy URL {base}/{source}/{z}/{x}/{y} when tileBaseUrl is set", () => {
    const url = resolveTileUrl(USGS_TOPO, 5, 9, 8, {
      tileBaseUrl: "http://localhost:5180/api/tiles",
    });
    expect(url).toBe("http://localhost:5180/api/tiles/usgs-topo/5/9/8");
  });

  it("honors an explicit sourceId and trims a trailing slash on the base", () => {
    const url = resolveTileUrl(USGS_TOPO, 3, 1, 2, {
      tileBaseUrl: "http://localhost:5180/api/tiles/",
      sourceId: "protomaps",
    });
    expect(url).toBe("http://localhost:5180/api/tiles/protomaps/3/1/2");
  });
});

const bbox = [-96.72, 40.79, -96.68, 40.82] as const;

/**
 * A real 256x256 PNG tile. The encoding tests used to stub every fetch to 404 and
 * assert success, which meant they exercised the encode path over a panel with
 * no map in it — and, worse, encoded the very failure mode this suite now has to
 * detect. Serving actual tile bytes tests the composite/crop path too.
 */
let TILE_PNG: Buffer;
beforeAll(async () => {
  TILE_PNG = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 120, g: 140, b: 110 } },
  })
    .png()
    .toBuffer();
});

/** Stub fetch so the first `failCount` tile requests fail with `status`. */
function stubTiles(options: { failCount?: number; status?: number } = {}) {
  const failCount = options.failCount ?? 0;
  const status = options.status ?? 404;
  let served = 0;
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const n = served++;
    if (n < failCount) return new Response(null, { status });
    return new Response(new Uint8Array(TILE_PNG), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("renderMapPanel encoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to JPEG, which a PDF can embed directly", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.format).toBe("jpeg");
    expect(panel.mimeType).toBe("image/jpeg");
    // JPEG SOI marker.
    expect([...panel.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("emits PNG on request", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256, undefined, { format: "png" });
    expect(panel.format).toBe("png");
    expect(panel.mimeType).toBe("image/png");
    expect([...panel.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("reports the cropped panel size and the zoom it chose", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.widthPx).toBeGreaterThan(0);
    expect(panel.heightPx).toBeGreaterThan(0);
    expect(panel.zoom).toBeGreaterThan(0);
    expect(panel.attribution).toBe(USGS_TOPO.attribution);
    expect(panel.tilesMissing).toBe(0);
    expect(panel.tilesRequested).toBeGreaterThan(0);
  });
});

/**
 * A failed tile used to become parchment and the render still reported success,
 * so a total upstream outage produced HTTP 200 and an empty printed atlas.
 */
describe("renderMapPanel tile-failure threshold", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws rather than returning a blank panel when every tile fails", async () => {
    stubTiles({ failCount: Infinity });
    await expect(renderMapPanel([...bbox], 256)).rejects.toThrow(/Tile fetch failed for \d+ of \d+/);
  });

  it("throws once the missing share passes the threshold", async () => {
    // 1 of 4 tiles missing = 25%, over the 10% default.
    stubTiles({ failCount: 1 });
    await expect(
      renderMapPanel([...bbox], 256, undefined, { tileConcurrency: 1 }),
    ).rejects.toThrow(/Tile fetch failed/);
  });

  it("tolerates a hole inside the threshold and reports it", async () => {
    stubTiles({ failCount: 1 });
    const panel = await renderMapPanel([...bbox], 256, undefined, {
      tileConcurrency: 1,
      maxFailedTileFraction: 0.5,
    });
    expect(panel.tilesMissing).toBe(1);
    expect(panel.tilesRequested).toBeGreaterThan(1);
  });
});

/**
 * The panel's `attribution` is what the PDF footer prints, so it has to describe
 * the source the bytes actually came from — not the default basemap.
 */
describe("renderMapPanel attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the basemap's own credit when fetching its URL template", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.attribution).toBe(USGS_TOPO.attribution);
  });

  it("prefers the tile proxy's X-Tile-Attribution over the default basemap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(TILE_PNG), {
            status: 200,
            headers: { "X-Tile-Attribution": "© OpenStreetMap contributors" },
          }),
      ),
    );
    const panel = await renderMapPanel([...bbox], 256, undefined, {
      tileBaseUrl: "http://api/api/tiles",
      sourceId: "protomaps",
    });
    expect(panel.attribution).toBe("© OpenStreetMap contributors");
  });

  it("does not claim the default basemap for a proxied source that sent no header", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256, undefined, {
      tileBaseUrl: "http://api/api/tiles",
      sourceId: "protomaps",
    });
    // Silently crediting USGS for tiles served by another source is the licensing
    // failure this whole item is about, in the other direction.
    expect(panel.attribution).not.toBe(USGS_TOPO.attribution);
    expect(panel.attribution).toContain("protomaps");
  });

  it("honours an explicit caller-supplied credit", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256, undefined, {
      attribution: "Natural Earth (public domain)",
    });
    expect(panel.attribution).toBe("Natural Earth (public domain)");
  });
});

describe("tile fetch hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a descriptive User-Agent (Overpass 406'd every request without one)", async () => {
    const fetchMock = stubTiles();
    await renderMapPanel([...bbox], 256);
    expect(fetchMock).toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      expect(init?.headers as Record<string, string> | undefined).toMatchObject({
        "User-Agent": TILE_USER_AGENT,
      });
    }
  });

  it("aborts a hung request instead of waiting forever", async () => {
    const fetchMock = stubTiles();
    await renderMapPanel([...bbox], 256);
    for (const call of fetchMock.mock.calls) {
      const init = call[1];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("caps concurrency so a page does not open ~35 sockets at once", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return new Response(new Uint8Array(TILE_PNG), { status: 200 });
      }),
    );
    // Wide bbox so the panel needs many more tiles than the concurrency limit.
    await renderMapPanel([-97.2, 40.6, -96.2, 41.2], 1400, undefined, { tileConcurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("retries a transient 503, and the retry's success counts", async () => {
    let served = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => {
        // Fail the very first request only; the retry must recover it.
        if (served++ === 0) return new Response(null, { status: 503 });
        return new Response(new Uint8Array(TILE_PNG), { status: 200 });
      }),
    );
    const panel = await renderMapPanel([...bbox], 256, undefined, { tileConcurrency: 1 });
    expect(panel.tilesMissing).toBe(0);
  });

  it("does not retry a 404 — an absent tile is an answer, not a failure", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      renderMapPanel([...bbox], 256, undefined, { tileConcurrency: 1 }),
    ).rejects.toThrow(/Tile fetch failed/);
    // One request per tile, not three.
    const tiles = fetchMock.mock.calls.length;
    expect(tiles).toBeGreaterThan(0);
    expect(new Set(fetchMock.mock.calls.map((c) => String(c[0]))).size).toBe(tiles);
  });
});

/**
 * Zoom headroom over the source's ceiling.
 *
 * At 1:24,000 — the default scale — the 5.76 in printed map box at the default
 * 1000 px panel selects z16, and USGS Topo's deepest zoom is z16 (the seeded
 * `TileSource.MaxZoom` in `TileSourceConfiguration.cs`, which the C# proxy
 * enforces with `ZoomOutOfRange`). Zero headroom: `--panel-px 2000` asked for
 * z17 and every tile 404'd, so the failed-tile threshold turned a request for a
 * sharper print into no print at all. That is the wrong failure — the source
 * has a perfectly good z16 map — so the zoom is clamped and the shortfall
 * reported.
 */
describe("renderMapPanel zoom ceiling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders at the source's deepest zoom instead of 404ing past it", async () => {
    stubTiles();
    // Far more resolution than USGS Topo has for this extent.
    const panel = await renderMapPanel([...bbox], 8000);
    expect(panel.zoom).toBe(USGS_TOPO.maxZoom);
    expect(panel.zoomClamped).toBe(true);
    expect(panel.tilesMissing).toBe(0);
  });

  it("never asks a tile URL for a zoom past the ceiling", async () => {
    const fetchMock = stubTiles();
    await renderMapPanel([...bbox], 8000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      const z = Number(/\/(\d+)\/\d+\/\d+$/.exec(String(call[0]))![1]);
      expect(z).toBeLessThanOrEqual(USGS_TOPO.maxZoom!);
    }
  });

  it("leaves a request within the ceiling exactly where it was", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.zoom).toBeLessThan(USGS_TOPO.maxZoom!);
    expect(panel.zoomClamped).toBe(false);
  });

  it("takes an explicit ceiling for a proxied source whose MaxZoom it cannot see", async () => {
    stubTiles();
    const panel = await renderMapPanel([...bbox], 8000, undefined, {
      tileBaseUrl: "http://api/api/tiles",
      sourceId: "protomaps",
      maxZoom: 14,
    });
    expect(panel.zoom).toBe(14);
    expect(panel.zoomClamped).toBe(true);
  });

  it("does not clamp a basemap that declares no ceiling", async () => {
    stubTiles();
    const uncapped = { ...USGS_TOPO, maxZoom: undefined };
    // A tiny extent, so a deep zoom is only a handful of tiles.
    const panel = await renderMapPanel([-96.7, 40.8, -96.699, 40.8009], 700, uncapped);
    expect(panel.zoom).toBeGreaterThan(USGS_TOPO.maxZoom!);
    expect(panel.zoomClamped).toBe(false);
  });
});

/**
 * Georeferenced crop — the last unmeasured link in the true-scale chain.
 *
 * Every other test in this file serves the SAME flat-colour tile for every
 * z/x/y, so the composite is one uniform block of pixels and any crop window
 * anywhere inside it is byte-identical. The only crop assertions were
 * `widthPx > 0` / `heightPx > 0`: multiply the extract width and height by 1.3,
 * or slide `left`/`top` by half a tile, and the whole suite still passed. The
 * PDF tests downstream would then confirm, correctly and uselessly, that the
 * *wrong* image had been painted into an exactly-right box — the 30% scale bug's
 * failure mode, one layer upstream.
 *
 * These tiles are self-locating instead. Every pixel carries its own global
 * Web-Mercator address: red = global x mod 256, green = global y mod 256, blue =
 * a hash of the tile indices. So a painted panel pixel can be decoded back to
 * the ground it shows and compared with the coordinate the bbox says belongs
 * there — a check that shares no arithmetic with the crop it is checking.
 */
const TILE_HASH = (x: number, y: number) => (x * 37 + y * 17) & 255;

/** A 256x256 tile whose every pixel encodes its own global-pixel address. */
async function locatingTile(x: number, y: number): Promise<Buffer> {
  const raw = Buffer.alloc(TILE_SIZE * TILE_SIZE * 3);
  const blue = TILE_HASH(x, y);
  for (let py = 0; py < TILE_SIZE; py++) {
    for (let px = 0; px < TILE_SIZE; px++) {
      const i = (py * TILE_SIZE + px) * 3;
      raw[i] = px;
      raw[i + 1] = py;
      raw[i + 2] = blue;
    }
  }
  return sharp(raw, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * Serve a self-locating tile per request. The USGS template is ArcGIS-ordered
 * ({z}/{y}/{x}), so the trailing path segments are read in that order.
 */
function stubLocatingTiles() {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const m = /\/(\d+)\/(\d+)\/(\d+)$/.exec(String(url));
    if (!m) return new Response(null, { status: 404 });
    const y = Number(m[2]);
    const x = Number(m[3]);
    return new Response(new Uint8Array(await locatingTile(x, y)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Decode one pixel of a raw RGBA/RGB buffer. */
function pixelAt(
  p: { data: Buffer; info: { width: number; channels: number } },
  px: number,
  py: number,
): [number, number, number] {
  const i = (py * p.info.width + px) * p.info.channels;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
}

describe("renderMapPanel crop registration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("crops the mosaic to exactly the bbox, at exactly the right offset", async () => {
    stubLocatingTiles();
    const panel = await renderMapPanel([...bbox], 600, undefined, { format: "png" });

    // The fixture only means anything across a multi-tile mosaic: adjacent tiles
    // must differ, or an offset of a whole tile would be invisible.
    const range = tileRangeForBBox([...bbox], panel.zoom);
    expect(range.maxX - range.minX).toBeGreaterThanOrEqual(1);
    expect(range.maxY - range.minY).toBeGreaterThanOrEqual(1);

    const [west, south, east, north] = bbox;
    const nw = lngLatToGlobalPixel(west, north, panel.zoom);
    const se = lngLatToGlobalPixel(east, south, panel.zoom);

    // The panel covers the bbox and nothing else: its pixel dimensions are the
    // bbox's own span in Web-Mercator pixels at the zoom it chose.
    expect(panel.widthPx).toBe(Math.round(se.x - nw.x));
    expect(panel.heightPx).toBe(Math.round(se.y - nw.y));

    const raw = await sharp(panel.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info.width).toBe(panel.widthPx);
    expect(raw.info.height).toBe(panel.heightPx);

    /** The ground address the bbox says belongs at that offset from the origin. */
    const expectedAt = (px: number, py: number): [number, number, number] => {
      const gx = Math.round(nw.x) + px;
      const gy = Math.round(nw.y) + py;
      return [gx & 255, gy & 255, TILE_HASH(Math.floor(gx / TILE_SIZE), Math.floor(gy / TILE_SIZE))];
    };

    // Both far corners plus the centre: one corner pins the origin, the opposite
    // corner pins the extent (a 1.3x crop lands it in a different tile), and the
    // centre catches a scale error that happened to keep the corners.
    for (const [px, py] of [
      [0, 0],
      [panel.widthPx - 1, 0],
      [0, panel.heightPx - 1],
      [panel.widthPx - 1, panel.heightPx - 1],
      [panel.widthPx >> 1, panel.heightPx >> 1],
    ] as const) {
      expect(pixelAt(raw, px, py), `panel pixel (${px}, ${py}) shows the wrong ground`).toEqual(
        expectedAt(px, py),
      );
    }
  });

  it("moves the crop when the bbox moves, by the distance the bbox moved", async () => {
    stubLocatingTiles();
    const a = await renderMapPanel([...bbox], 600, undefined, { format: "png" });
    // Shift east by a third of the bbox width; same size, so the same zoom.
    const width = bbox[2] - bbox[0];
    const shifted: [number, number, number, number] = [
      bbox[0] + width / 3,
      bbox[1],
      bbox[2] + width / 3,
      bbox[3],
    ];
    const b = await renderMapPanel(shifted, 600, undefined, { format: "png" });
    expect(b.zoom).toBe(a.zoom);
    expect(b.widthPx).toBe(a.widthPx);

    const originA = lngLatToGlobalPixel(bbox[0], bbox[3], a.zoom);
    const originB = lngLatToGlobalPixel(shifted[0], shifted[3], b.zoom);
    const dx = Math.round(originB.x) - Math.round(originA.x);
    expect(dx).toBeGreaterThan(0);

    const pa = await sharp(a.bytes).raw().toBuffer({ resolveWithObject: true });
    const pb = await sharp(b.bytes).raw().toBuffer({ resolveWithObject: true });
    // The shifted panel's left edge shows what sat `dx` pixels into the first.
    expect(pixelAt(pb, 0, 10)).toEqual(pixelAt(pa, dx, 10));
    // And that is genuinely different ground from the first panel's left edge.
    expect(pixelAt(pb, 0, 10)).not.toEqual(pixelAt(pa, 0, 10));
  });
});
