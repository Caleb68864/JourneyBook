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
    expect(pageLabel(26, 0)).toBe("AA1");
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

    expect(width).toBeCloseTo(4572, -1); // ~7.5in * 1:24,000
    expect(height).toBeCloseTo(6096, -1); // ~10in * 1:24,000
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
      expect(width).toBeCloseTo(4572, -1);
    }
  });

  it("adds more pages when overlap is increased", () => {
    const bbox = bboxAround(center, 2, 1);
    const none = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0 });
    const heavy = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0.5 });
    expect(heavy.pages.length).toBeGreaterThan(none.pages.length);
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
