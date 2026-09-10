import { describe, it, expect } from "vitest";
import { SCALE_PRESETS, type BBox, type LngLat } from "./index.js";
import { LETTER_PORTRAIT, groundFootprintMeters } from "./page.js";
import { createProjector, geodesicDistanceMeters } from "./projection.js";
import { pageLabel, buildLocationPage, buildPageGrid, pageGridSize } from "./grid.js";

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

/**
 * Signed ground separation across a page seam, in metres.
 *
 * `geodesicDistanceMeters` is a chord length and is therefore **always >= 0**: a
 * 176 m strip of ground that two pages share and a 176 m strip that belongs to
 * neither page are the same number to it. That is not a detail — it is the whole
 * distinction `overlap` exists to make, and an unsigned assertion cannot make it.
 * (Inverting `(1 - overlap)` to `(1 + overlap)` in grid.ts turns every shared
 * strip into a hole of identical width; against an unsigned measure the suite
 * stays green.)
 *
 * The sign has to come from the coordinates, so it does:
 *
 *   negative = the two pages overlap by that many metres (shared ground)
 *   positive = that many metres belong to no page at all (a hole)
 *
 * `near` is this page's trailing edge and `far` the neighbour's leading edge, in
 * the direction of travel: for an east seam this page's east edge and the
 * neighbour's west edge; for a south seam this page's south edge and the
 * neighbour's north edge. A leading edge that sits *behind* the trailing one —
 * west of it going east, north of it going south — is shared ground, and reads
 * as negative.
 */
function signedSeamMeters(near: LngLat, far: LngLat, along: "east" | "south"): number {
  const magnitude = geodesicDistanceMeters(near, far);
  const delta = along === "east" ? far.lng - near.lng : near.lat - far.lat;
  return Math.sign(delta) * magnitude;
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

  /**
   * The invariant an atlas exists for: walk east across a row, or south down a
   * column, and the ground never stops. Until this test the ONLY abutment
   * assertions in the repo were on the frozen 2x2 fixture, so a grid step 2% too
   * large — a 70 m strip of Nebraska on no page at all, between every adjacent
   * pair — cost the suite one incidental page-count assertion and nothing else.
   *
   * Seams are measured in metres of ground, not degrees: neighbouring pages are
   * each built about their own centre, so a shared edge carries a small
   * geodesic-vs-planar residual. A few metres is that residual; anything larger
   * is a hole (or a duplicated strip), and the sign says which.
   */
  it("[BEHAVIORAL] leaves no ground uncovered between adjacent pages at overlap 0", () => {
    const grid = buildPageGrid({
      bbox: bboxAround(center, 3.4, 2.6),
      scale: usgs,
      page: LETTER_PORTRAIT,
      overlap: 0,
    });
    expect(grid.pages.length).toBeGreaterThan(6); // enough interior seams to matter

    const by = new Map(grid.pages.map((p) => [p.id, p]));
    const SEAM_TOLERANCE_M = 5;
    let eastSeams = 0;
    let southSeams = 0;

    for (const page of grid.pages) {
      const [west, south, east, north] = page.bbox;
      const midLat = (south + north) / 2;
      const midLng = (west + east) / 2;

      const eastNeighbor = page.neighbors.east ? by.get(page.neighbors.east) : undefined;
      if (eastNeighbor) {
        // Signed: positive = this page's east edge sits west of its neighbour's
        // west edge, i.e. a strip of ground belonging to neither.
        const gap = signedSeamMeters(
          { lng: east, lat: midLat },
          { lng: eastNeighbor.bbox[0], lat: midLat },
          "east",
        );
        expect(gap, `${page.id} -> ${eastNeighbor.id} east seam`).toBeLessThan(SEAM_TOLERANCE_M);
        eastSeams++;
      }

      const southNeighbor = page.neighbors.south ? by.get(page.neighbors.south) : undefined;
      if (southNeighbor) {
        const gap = signedSeamMeters(
          { lng: midLng, lat: south },
          { lng: midLng, lat: southNeighbor.bbox[3] },
          "south",
        );
        expect(gap, `${page.id} -> ${southNeighbor.id} south seam`).toBeLessThan(SEAM_TOLERANCE_M);
        southSeams++;
      }
    }

    // A grid whose neighbour links were all undefined would satisfy every
    // assertion above by checking nothing.
    expect(eastSeams).toBeGreaterThan(0);
    expect(southSeams).toBeGreaterThan(0);
  });

  it("adds more pages when overlap is increased", () => {
    const bbox = bboxAround(center, 2, 1);
    const none = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0 });
    const heavy = buildPageGrid({ bbox, scale: usgs, page: LETTER_PORTRAIT, overlap: 0.5 });
    expect(heavy.pages.length).toBeGreaterThan(none.pages.length);
  });

  /**
   * The test above is satisfied by ANY monotone function of overlap, and for a
   * long time it was the only thing in either language that looked at the
   * parameter: honouring overlap at half its stated value left 239 of 239 TS
   * tests green, and hardcoding it to 0 on the worker wire left 95 of 95 .NET
   * tests green. That is the shape of the margins bug, on the next field of the
   * same payload.
   *
   * Overlap is not a page-count knob; it is the width of the strip of ground two
   * adjacent pages both carry, so that a feature at a seam is readable on at
   * least one of them and there is no pinhole where four pages meet. Measure that
   * strip, on the ground, against the fraction that was asked for.
   *
   * And measure it **signed**. This test's first version compared an unsigned
   * geodesic distance, which cannot tell a 176 m strip on both pages from a 176 m
   * strip on neither: `(1 - overlap)` inverted to `(1 + overlap)` in grid.ts put a
   * hole at every seam in the atlas and left all 80 atlas-core tests green.
   */
  it("[BEHAVIORAL] carries the exact overlap fraction as shared ground, not just 'more pages'", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    // The geodesic-vs-planar residual on a shared edge is a few metres; the
    // difference this test exists to catch is a whole fraction of a page —
    // 176 m of shared ground at overlap 0.05, against 88 m if it is honoured at
    // half its stated value.
    const TOLERANCE_M = 5;

    for (const overlap of [0, 0.05, 0.15, 0.3]) {
      const grid = buildPageGrid({
        bbox: bboxAround(center, 2.6, 2.2),
        scale: usgs,
        page: LETTER_PORTRAIT,
        overlap,
      });
      const by = new Map(grid.pages.map((p) => [p.id, p]));

      const wantEast = overlap * fp.widthMeters;
      const wantSouth = overlap * fp.heightMeters;
      let pairs = 0;

      for (const page of grid.pages) {
        const [west, south, east, north] = page.bbox;
        const midLat = (south + north) / 2;
        const midLng = (west + east) / 2;

        const eastNeighbor = page.neighbors.east ? by.get(page.neighbors.east) : undefined;
        if (eastNeighbor) {
          // Negated so a positive number means ground the two pages share. A
          // negative number is a hole of the same width — the opposite defect,
          // indistinguishable from the overlap by magnitude alone.
          const shared = -signedSeamMeters(
            { lng: east, lat: midLat },
            { lng: eastNeighbor.bbox[0], lat: midLat },
            "east",
          );
          expect(
            Math.abs(shared - wantEast),
            `${page.id}->${eastNeighbor.id}: ${shared.toFixed(1)}m shared (negative = ground on no page), wanted ${wantEast.toFixed(1)}m at overlap ${overlap}`,
          ).toBeLessThan(TOLERANCE_M);
          pairs++;
        }

        const southNeighbor = page.neighbors.south ? by.get(page.neighbors.south) : undefined;
        if (southNeighbor) {
          const shared = -signedSeamMeters(
            { lng: midLng, lat: south },
            { lng: midLng, lat: southNeighbor.bbox[3] },
            "south",
          );
          expect(
            Math.abs(shared - wantSouth),
            `${page.id}->${southNeighbor.id}: ${shared.toFixed(1)}m shared (negative = ground on no page), wanted ${wantSouth.toFixed(1)}m at overlap ${overlap}`,
          ).toBeLessThan(TOLERANCE_M);
          pairs++;
        }
      }

      expect(pairs, `overlap ${overlap} produced no adjacent pairs to measure`).toBeGreaterThan(4);
    }
  });

  /**
   * `buildPageGrid` throws exactly when the grid would exceed the cap, which is
   * right for a render and useless for a warning: a UI asking "how big is this
   * box?" gets an exception precisely when the answer matters. The web editor's
   * over-limit guard was built on `buildPageGrid(...).pages.length > cap` and was
   * therefore provably unreachable. `pageGridSize` is the answer-shaped half.
   */
  it("[BEHAVIORAL] pageGridSize answers for an extent buildPageGrid refuses to build", () => {
    const huge: BBox = [-125, 24, -66, 49]; // the continental US at 1:24,000
    const options = { bbox: huge, scale: usgs, page: LETTER_PORTRAIT };

    expect(() => buildPageGrid(options)).toThrow(/exceeding the 200-page limit/);

    const size = pageGridSize(options);
    expect(size.pages).toBe(1086537);
    expect(size.columns * size.rows).toBe(size.pages);
    expect(size.overLimit).toBe(true);
  });

  it("pageGridSize agrees with the grid it describes, whenever one can be built", () => {
    for (const [w, h, overlap] of [
      [1, 1, 0],
      [2.2, 1.2, 0],
      [3, 2, 0.05],
      [2, 1, 0.5],
    ] as const) {
      const options = { bbox: bboxAround(center, w, h), scale: usgs, page: LETTER_PORTRAIT, overlap };
      const size = pageGridSize(options);
      const grid = buildPageGrid(options);

      // Same number, from the same computation — the guard and the estimate
      // cannot drift into disagreeing about how many pages a box is.
      expect(size.pages, `${w}x${h} @ ${overlap}`).toBe(grid.pages.length);
      expect(size.overLimit).toBe(false);
    }
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
