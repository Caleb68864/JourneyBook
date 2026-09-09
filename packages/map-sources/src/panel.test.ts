import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import sharp from "sharp";
import { resolveTileUrl, renderMapPanel, USGS_TOPO, TILE_USER_AGENT } from "./panel.js";

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
  const fetchMock = vi.fn(async () => {
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
      const init = (call as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>)["User-Agent"]).toBe(TILE_USER_AGENT);
    }
  });

  it("aborts a hung request instead of waiting forever", async () => {
    const fetchMock = stubTiles();
    await renderMapPanel([...bbox], 256);
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("caps concurrency so a page does not open ~35 sockets at once", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
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
      vi.fn(async () => {
        // Fail the very first request only; the retry must recover it.
        if (served++ === 0) return new Response(null, { status: 503 });
        return new Response(new Uint8Array(TILE_PNG), { status: 200 });
      }),
    );
    const panel = await renderMapPanel([...bbox], 256, undefined, { tileConcurrency: 1 });
    expect(panel.tilesMissing).toBe(0);
  });

  it("does not retry a 404 — an absent tile is an answer, not a failure", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
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
