import { describe, it, expect } from "vitest";
import { SCALE_PRESETS, type BBox, type LngLat } from "./index.js";
import { LETTER_PORTRAIT, groundFootprintMeters } from "./page.js";
import { createProjector, geodesicDistanceMeters } from "./projection.js";
import { pageLabel, buildLocationPage, buildPageGrid } from "./grid.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000

/** Build a BBox of a given footprint-multiple, centred on a point. */
function bboxAround(center: LngLat, widthMul: number, heightMul: number): BBox {
  const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
  const projector = createProjector(center);
  const [cx, cy] = projector.forward(center);
  const sw = projector.inverse([cx - (fp.widthMeters * widthMul) / 2, cy - (fp.heightMeters * heightMul) / 2]);
  const ne = projector.inverse([cx + (fp.widthMeters * widthMul) / 2, cy + (fp.heightMeters * heightMul) / 2]);
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

describe("pageLabel", () => {
  it("is row-letter + column-number", () => {
    expect(pageLabel(0, 0)).toBe("A1");
    expect(pageLabel(0, 1)).toBe("A2");
    expect(pageLabel(1, 0)).toBe("B1");
    expect(pageLabel(2, 3)).toBe("C4");
  });

  it("rolls over to two letters past Z", () => {
    // 24 row letters (L and R are reserved), so Z is row 23 and AA is row 24.
    expect(pageLabel(23, 0)).toBe("Z1");
    expect(pageLabel(24, 0)).toBe("AA1");
  });

  /**
   * Grid, location (L#) and corridor (R#) pages share one flat id space inside an
   * AtlasContract, and both the render pipeline (Record keyed by page id) and
   * pdf-client (furniture dispatched off the id prefix) depend on that space being
   * unambiguous. Base-26 row letters violated it: row 11 produced "L1" and row 17
   * "R1", so a 12-row grid collided with the first location page.
   */
  it("never emits a label that could be read as a location (L#) or corridor (R#) page", () => {
    for (let row = 0; row < 2000; row++) {
      const id = pageLabel(row, 0);
      expect(id.startsWith("L"), `row ${row} produced ${id}`).toBe(false);
      expect(id.startsWith("R"), `row ${row} produced ${id}`).toBe(false);
    }
    // The reservation holds in every position, not just the first, so a label can
    // never be confused with the reserved namespaces however wide the grid grows.
    for (let row = 0; row < 2000; row++) {
      expect(/[LR]/.test(pageLabel(row, 0))).toBe(false);
    }
  });

  it("stays injective, so no two grid cells can share an id", () => {
    const seen = new Set<string>();
    for (let row = 0; row < 60; row++) {
      for (let col = 0; col < 12; col++) seen.add(pageLabel(row, col));
    }
    expect(seen.size).toBe(60 * 12);
  });
});

describe("buildLocationPage", () => {
  it("centres a single page covering the scale footprint", () => {
    const center: LngLat = { lng: -98, lat: 41 };
    const page = buildLocationPage(center, usgs, LETTER_PORTRAIT);

    const [w, s, e, n] = page.bbox;
    const midLat = (s + n) / 2;
    const midLng = (w + e) / 2;
    const width = geodesicDistanceMeters({ lng: w, lat: midLat }, { lng: e, lat: midLat });
    const height = geodesicDistanceMeters({ lng: midLng, lat: s }, { lng: midLng, lat: n });

    // The map box (printable area less page furniture), not the printable area:
    // 5.7639in x 7.625in at 1:24,000.
    expect(width).toBeCloseTo(3513.7, -1);
    expect(height).toBeCloseTo(4648.2, -1);
    expect(midLng).toBeCloseTo(center.lng, 4);
    expect(midLat).toBeCloseTo(center.lat, 4);
  });
});

describe("buildPageGrid", () => {
  const center: LngLat = { lng: -98, lat: 41 };

  it("tiles an extent into labelled pages with correct neighbours", () => {
    const bbox = bboxAround(center, 1.5, 0.5); // ~2 cols x 1 row
    const grid = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0 });

    expect(grid.pages).toHaveLength(2);
    const ids = grid.pages.map((p) => p.id).sort();
    expect(ids).toEqual(["A1", "A2"]);

    const a1 = grid.pages.find((p) => p.id === "A1")!;
    const a2 = grid.pages.find((p) => p.id === "A2")!;
    expect(a1.neighbors.east).toBe("A2");
    expect(a2.neighbors.west).toBe("A1");
    expect(a1.neighbors.north).toBeUndefined();
  });

  it("keeps every page at the same ground footprint (consistent scale)", () => {
    const bbox = bboxAround(center, 2.2, 1.2);
    const grid = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0 });

    for (const p of grid.pages) {
      const [w, s, e, n] = p.bbox;
      const width = geodesicDistanceMeters({ lng: w, lat: (s + n) / 2 }, { lng: e, lat: (s + n) / 2 });
      expect(width).toBeCloseTo(3513.7, -1);
    }
  });

  it("adds more pages when overlap is increased", () => {
    const bbox = bboxAround(center, 2, 1);
    const none = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0 });
    const heavy = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0.5 });
    expect(heavy.pages.length).toBeGreaterThan(none.pages.length);
  });

  it("[BEHAVIORAL] rejects an oversized extent before materialising any page", () => {
    // The continental US at 1:24,000 tiles into 1,086,537 pages. The grid used to
    // build every one of them — a proj4 round trip and a bbox each — before the
    // render-side MAX_ATLAS_PAGES guard threw the lot away. The row/column counts
    // are known from the extent and the footprint alone, so the rejection must be
    // immediate; the (generous) timing assertion is what pins that.
    const started = Date.now();
    expect(() =>
      buildPageGrid({ bbox: [-125, 24, -66, 49], scale: usgs, page: LETTER_PORTRAIT }),
    ).toThrow(/1086537 pages .*exceeding the 200-page limit/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("accepts an extent right at the page cap", () => {
    // 200 pages exactly: 10 columns x 20 rows.
    const bbox = bboxAround(center, 9.5, 19.5);
    const grid = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT });
    expect(grid.pages).toHaveLength(200);
  });

  it("defaults pages to Level 1 (road-atlas) and honours a requested tier", () => {
    const bbox = bboxAround(center, 1, 1);
    const dflt = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT });
    expect(dflt.pages.every((p) => p.tier === 1)).toBe(true);

    const advanced = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, tier: 3 });
    expect(advanced.pages.every((p) => p.tier === 3)).toBe(true);
  });
});

describe("buildLocationPage tier", () => {
  it("carries the requested tier", () => {
    const page = buildLocationPage({ lng: -98, lat: 41 }, usgs, LETTER_PORTRAIT, "L1", 2);
    expect(page.tier).toBe(2);
  });
});
