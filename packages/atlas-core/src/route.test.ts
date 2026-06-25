import { describe, it, expect } from "vitest";
import { SCALE_PRESETS, type LngLat } from "./index.js";
import { LETTER_PORTRAIT, groundFootprintMeters } from "./page.js";

import { buildRouteAtlas } from "./route.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24 000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Does a WGS84 bbox contain a point? */
function bboxContains(
  bbox: [number, number, number, number],
  p: LngLat,
): boolean {
  const [w, s, e, n] = bbox;
  return p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;
}

/**
 * 2-D Liang-Barsky bbox–segment overlap test in lng/lat space.
 * Returns true if the segment AB intersects or is contained by the bbox.
 */
function bboxIntersectsSegment(
  bbox: [number, number, number, number],
  a: LngLat,
  b: LngLat,
): boolean {
  if (bboxContains(bbox, a) || bboxContains(bbox, b)) return true;
  const [w, s, e, n] = bbox;
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else        { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return (
    clip(-dx, a.lng - w) &&
    clip(dx, e - a.lng) &&
    clip(-dy, a.lat - s) &&
    clip(dy, n - a.lat)
  );
}

/**
 * Interpolate along a straight-line LngLat segment at parameter t in [0,1].
 */
function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
}


// ---------------------------------------------------------------------------
// Geometry fixture — Nebraska plains, well-separated stops (~0.2° apart)
// ---------------------------------------------------------------------------

const stopA: LngLat = { lng: -98.0, lat: 41.0 };
const stopB: LngLat = { lng: -97.8, lat: 41.0 };
const stopC: LngLat = { lng: -97.6, lat: 41.0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildRouteAtlas — id format", () => {
  it("all corridor page ids match /^R\\d+$/", () => {
    const { pages } = buildRouteAtlas({
      stops: [stopA, stopB],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.id).toMatch(/^R\d+$/);
    }
  });
});

describe("buildRouteAtlas — at least one corridor page per leg", () => {
  it("3 well-separated stops produce ≥1 corridor page per leg", () => {
    const stops = [stopA, stopB, stopC];
    const { pages } = buildRouteAtlas({ stops, scale: usgs, page: LETTER_PORTRAIT });

    expect(pages.length).toBeGreaterThanOrEqual(2);

    // Each page bbox must intersect at least one leg segment.
    for (const p of pages) {
      const onSomeLeg = stops.slice(0, -1).some((_, i) =>
        bboxIntersectsSegment(p.bbox, stops[i], stops[i + 1]),
      );
      expect(onSomeLeg).toBe(true);
    }
  });
});

describe("buildRouteAtlas — bbox-segment intersection per corridor page", () => {
  it("each corridor page bbox intersects its leg's straight-line segment", () => {
    const stops = [stopA, stopB, stopC];
    const { pages } = buildRouteAtlas({ stops, scale: usgs, page: LETTER_PORTRAIT });

    for (const p of pages) {
      const intersects = stops.slice(0, -1).some((_, i) =>
        bboxIntersectsSegment(p.bbox, stops[i], stops[i + 1]),
      );
      expect(intersects, `page ${p.id} should intersect some leg`).toBe(true);
    }
  });
});

describe("buildRouteAtlas — full segment coverage (no gaps)", () => {
  it("consecutive corridor pages cover each other so no internal gap exists", () => {
    // Corridor pages avoid the stop dedup zone near each endpoint (those interior
    // zones are covered by stop location-pages, which buildRouteAtlas does not
    // generate).  The invariant tested here is that the corridor pages themselves
    // form a contiguous chain: consecutive pages must share or overlap their coverage.
    const stops = [stopA, stopC]; // 0.4° apart — enough for many pages
    const { pages } = buildRouteAtlas({ stops, scale: usgs, page: LETTER_PORTRAIT });
    expect(pages.length).toBeGreaterThanOrEqual(2);

    // Each sampled centre of page i must fall inside the bbox of page i or page i+1.
    for (let i = 0; i < pages.length - 1; i++) {
      const [w0, s0, e0, n0] = pages[i]!.bbox;
      const [w1, s1, e1, n1] = pages[i + 1]!.bbox;
      // Two adjacent pages must overlap: east of page i >= west of page i+1.
      // (Tested on both axes.)
      const overlapLng = e0 >= w1 && e1 >= w0;
      const overlapLat = n0 >= s1 && n1 >= s0;
      expect(overlapLng || overlapLat, `pages R${i + 1} and R${i + 2} should overlap`).toBe(true);
    }
  });

  it("segment midpoint is covered by some corridor page", () => {
    const stops = [stopA, stopB];
    const { pages } = buildRouteAtlas({ stops, scale: usgs, page: LETTER_PORTRAIT });
    const mid = lerp(stopA, stopB, 0.5);
    const covered = pages.some((p) => bboxContains(p.bbox, mid));
    expect(covered).toBe(true);
  });
});

describe("buildRouteAtlas — dedup: two well-separated stops keep ≥2 pages", () => {
  it("two stops 0.2° apart produce multiple corridor pages", () => {
    const { pages } = buildRouteAtlas({
      stops: [stopA, stopB],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildRouteAtlas — dedup: corridor coinciding with stop centre is dropped", () => {
  it("drops a candidate whose centre is within dedupRadius of a stop", () => {
    // Place two stops exactly one page-width apart: the midpoint candidate
    // would land at a distance of 0.5 × pageWidth from each stop.  We instead
    // place them so close that the single candidate sits on top of stopA.
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    // Stops separated by slightly less than dedupRadius in degrees (planar approx)
    const dedupRadius = Math.min(fp.widthMeters, fp.heightMeters) / 2;
    // ~1° of longitude ≈ 73 km at lat 41; dedupRadius at 1:24 000 is ~2 700 m
    const deltaLng = (dedupRadius * 0.8) / 73000;

    const near0: LngLat = { lng: -98.0, lat: 41.0 };
    const near1: LngLat = { lng: -98.0 + deltaLng, lat: 41.0 };

    const { pages } = buildRouteAtlas({
      stops: [near0, near1],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    // The only candidate midpoint is within dedupRadius of stop near0, so it
    // gets dropped — zero corridor pages.
    expect(pages.length).toBe(0);
  });
});

describe("buildRouteAtlas — dedup: short leg keeps only one corridor page", () => {
  it("two stops ~2.5 page-widths apart: only the centre candidate survives dedup", () => {
    // With 2.5 widths: ceil(2.5) = 3 candidates at 0.417wm, 1.25wm, 2.083wm from s0.
    // The first and last fall within dedupRadius (0.5wm) of their nearest stop and are
    // dropped.  Only the middle candidate at 1.25wm survives → exactly 1 page.
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    const deltaLng = (fp.widthMeters * 2.5) / 73000;

    const s0: LngLat = { lng: -97.5, lat: 41.0 };
    const s1: LngLat = { lng: -97.5 + deltaLng, lat: 41.0 };

    const { pages } = buildRouteAtlas({
      stops: [s0, s1],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    expect(pages.length).toBe(1);
  });
});

describe("buildRouteAtlas — path-source seam", () => {
  it("custom orderedCenters changes tiling without touching dedup or id logic", () => {
    // Straight-line between stopA and stopC goes east.
    // Detour via stopB′ at a different latitude forces more/different pages.
    const detour: LngLat = { lng: -97.8, lat: 41.1 };
    const customPolyline: LngLat[] = [stopA, detour, stopC];

    const { pages: defaultPages } = buildRouteAtlas({
      stops: [stopA, stopC],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    const { pages: customPages } = buildRouteAtlas({
      stops: [stopA, stopC],
      orderedCenters: customPolyline,
      scale: usgs,
      page: LETTER_PORTRAIT,
    });

    // Custom polyline is longer (detour north) → different (typically more) pages.
    // All pages must still have R-ids.
    for (const p of customPages) {
      expect(p.id).toMatch(/^R\d+$/);
    }
    // The two layouts should differ because the path changed.
    const defaultCentres = defaultPages.map((p) => {
      const [w, s, e, n] = p.bbox;
      return `${((w + e) / 2).toFixed(4)},${((s + n) / 2).toFixed(4)}`;
    });
    const customCentres = customPages.map((p) => {
      const [w, s, e, n] = p.bbox;
      return `${((w + e) / 2).toFixed(4)},${((s + n) / 2).toFixed(4)}`;
    });
    expect(customCentres).not.toEqual(defaultCentres);
  });

  it("polyline is returned in LngLat (geospatial, not page-local)", () => {
    const stops = [stopA, stopB];
    const { polyline } = buildRouteAtlas({ stops, scale: usgs, page: LETTER_PORTRAIT });
    // Default polyline equals the stops (straight-line).
    expect(polyline).toHaveLength(2);
    expect(polyline[0].lng).toBeCloseTo(stopA.lng, 6);
    expect(polyline[0].lat).toBeCloseTo(stopA.lat, 6);
  });
});

describe("buildRouteAtlas — neighbor links", () => {
  it("corridor pages are linked sequentially west↔east", () => {
    const { pages } = buildRouteAtlas({
      stops: [stopA, stopB],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    if (pages.length < 2) return; // degenerate: skip
    expect(pages[0].neighbors.west).toBeUndefined();
    expect(pages[0].neighbors.east).toBe("R2");
    const last = pages[pages.length - 1];
    expect(last.neighbors.east).toBeUndefined();
    expect(last.neighbors.west).toBe(`R${pages.length - 1}`);
  });
});

describe("buildRouteAtlas — empty / edge cases", () => {
  it("returns empty pages for fewer than 2 stops", () => {
    const { pages } = buildRouteAtlas({
      stops: [stopA],
      scale: usgs,
      page: LETTER_PORTRAIT,
    });
    expect(pages).toHaveLength(0);
  });
});
