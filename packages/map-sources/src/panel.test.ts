import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveTileUrl, renderMapPanel, USGS_TOPO } from "./panel.js";

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

/**
 * Panel encoding. Every tile fetch is stubbed to fail, which renderMapPanel
 * degrades to the parchment background - enough to exercise the encode path
 * with no network. (The size win that motivates the JPEG default was measured
 * on real topo tiles; see docs/decisions.md.)
 */
describe("renderMapPanel encoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFailedTiles() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
  }

  const bbox = [-96.72, 40.79, -96.68, 40.82] as const;

  it("defaults to JPEG, which a PDF can embed directly", async () => {
    stubFailedTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.format).toBe("jpeg");
    expect(panel.mimeType).toBe("image/jpeg");
    // JPEG SOI marker.
    expect([...panel.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("emits PNG on request", async () => {
    stubFailedTiles();
    const panel = await renderMapPanel([...bbox], 256, undefined, { format: "png" });
    expect(panel.format).toBe("png");
    expect(panel.mimeType).toBe("image/png");
    expect([...panel.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("reports the cropped panel size and the zoom it chose", async () => {
    stubFailedTiles();
    const panel = await renderMapPanel([...bbox], 256);
    expect(panel.widthPx).toBeGreaterThan(0);
    expect(panel.heightPx).toBeGreaterThan(0);
    expect(panel.zoom).toBeGreaterThan(0);
    expect(panel.attribution).toBe(USGS_TOPO.attribution);
  });
});
