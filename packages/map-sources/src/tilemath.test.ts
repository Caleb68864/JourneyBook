import { describe, it, expect } from "vitest";
import type { BBox, LngLat } from "@journeybook/atlas-core";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  mapBoxInches,
  buildLocationPage,
  effectiveDpi,
  panelWidthPxForDpi,
  panelWidthPxFor,
  PRINT_DPI_TARGET,
  type PageSpec,
  type ScalePreset,
} from "@journeybook/atlas-core";
import {
  TILE_SIZE,
  lngLatToGlobalPixel,
  groundResolutionMetersPerPixel,
  zoomForBBox,
  tileRangeForBBox,
  lngLatToPanelFraction,
} from "./tilemath.js";

/**
 * The printed map box, from the engine that computes it. The previous version of
 * this file hardcoded `5.763888888888889 // mapBoxInches(LETTER_PORTRAIT)` two
 * lines below an import of the package that computes it — a fresh copy of a
 * constant, in a file written to stop constants being copied.
 */
const MAP_BOX_WIDTH_IN = mapBoxInches(LETTER_PORTRAIT).widthIn;

/** The render pipeline's default `--panel-px` (`render.ts`). */
const DEFAULT_PANEL_WIDTH_PX = 1000;

describe("web mercator tile math", () => {
  it("centres (0,0) at z0", () => {
    const p = lngLatToGlobalPixel(0, 0, 0);
    expect(p.x).toBeCloseTo(128, 6);
    expect(p.y).toBeCloseTo(128, 6);
  });

  it("maps -180 lng to x=0 and 180 to the world width", () => {
    expect(lngLatToGlobalPixel(-180, 0, 0).x).toBeCloseTo(0, 6);
    expect(lngLatToGlobalPixel(180, 0, 1).x).toBeCloseTo(TILE_SIZE * 2, 6);
  });

  it("ground resolution at the equator/z0 is ~156543 m/px", () => {
    expect(groundResolutionMetersPerPixel(0, 0)).toBeCloseTo(156543.03, 0);
  });

  it("ground resolution halves each zoom level", () => {
    expect(groundResolutionMetersPerPixel(0, 1)).toBeCloseTo(156543.03 / 2, 1);
  });

  it("zoomForBBox increases with the target pixel width", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    expect(zoomForBBox(bbox, 2048)).toBeGreaterThan(zoomForBBox(bbox, 256));
  });

  /**
   * The assertion above was, for a long time, the ONLY thing said about the
   * function that decides the printed map's resolution: a relative comparison
   * that any monotone function satisfies. Returning one zoom coarser — half the
   * linear resolution, a quarter of the pixels — left 239 of 239 TS tests green.
   * `panel.test.ts`'s "leaves a request within the ceiling exactly where it was"
   * asserts `zoom < maxZoom` and `zoomClamped === false`, both still true one
   * level down.
   *
   * Pin what the function is defined to be, and then pin the number the print
   * actually depends on.
   */
  describe("zoomForBBox is the SMALLEST zoom that meets the target", () => {
    const widthPxAt = (bbox: BBox, zoom: number): number => {
      const midLat = (bbox[1] + bbox[3]) / 2;
      return (
        lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
      );
    };

    const cases: BBox[] = [
      [-98.05, 40.95, -97.95, 41.05], // 0.1° near 41°N
      [-98.020888, 40.97907, -97.979112, 41.020926], // one 1:24,000 Letter page
      [-0.01, 51.5, 0.01, 51.52], // small, near the prime meridian
      [-125, 24, -66, 49], // continental
      [-0.5, 60.0, 0.5, 61.0], // high latitude
    ];

    it("[BEHAVIORAL] meets the target and would miss it one level coarser", () => {
      for (const bbox of cases) {
        for (const target of [256, 512, 1000, 2048, 4096]) {
          const zoom = zoomForBBox(bbox, target);

          expect(widthPxAt(bbox, zoom), `bbox ${bbox} target ${target}: z${zoom} too coarse`)
            .toBeGreaterThanOrEqual(target);

          // The half that a monotone-only test cannot see: one level coarser must
          // NOT have met the target, or the function is handing back a softer map
          // than was asked for.
          if (zoom > 0) {
            expect(
              widthPxAt(bbox, zoom - 1),
              `bbox ${bbox} target ${target}: z${zoom - 1} would have done`,
            ).toBeLessThan(target);
          }
        }
      }
    });

    /**
     * The print-resolution number itself. `renderMapPanel` crops at native tile
     * resolution — it does not resample to `targetWidthPx` — so the delivered
     * panel is `widthPxAt(zoom)`, and the effective DPI is that over the printed
     * map box (5.7639 in at Letter portrait). One zoom coarser halves it.
     */
    it("[BEHAVIORAL] a 1:24,000 Letter page at the default panel width lands on z16", () => {
      const page: BBox = [-98.020888, 40.97907, -97.979112, 41.020926];

      const zoom = zoomForBBox(page, 1000);
      // Also the ceiling USGS Topo actually has tiles for (USGS_TOPO.maxZoom),
      // which is why the render has zero headroom here.
      expect(zoom).toBe(16);

      const dpi = widthPxAt(page, zoom) / MAP_BOX_WIDTH_IN;
      expect(dpi).toBeGreaterThan(330);
      expect(dpi).toBeLessThan(345);

      // What "one zoom coarser" costs a printed page.
      expect(widthPxAt(page, zoom - 1) / MAP_BOX_WIDTH_IN).toBeLessThan(175);
    });
  });

  /**
   * Print resolution, per scale preset, as a property rather than an accident.
   *
   * The first version of this guard covered **1:24,000 only** — the single preset
   * that clears 300 DPI — and nothing pinned the other four or asserted a minimum
   * anywhere. Measured against the real engine, the delivered resolution swings by
   * nearly 2x across the scale menu at the default panel width:
   *
   *   usgs-7-5-min (1:24,000)  z16  1947 px  338 DPI
   *   1-25000                  z15  1014 px  176 DPI
   *   usgs-15-min (1:62,500)   z14  1268 px  220 DPI
   *   1-50000                  z14  1014 px  176 DPI
   *   1-100000                 z13  1015 px  176 DPI
   *
   * None of that is a property of the product. `renderMapPanel` crops at native
   * tile resolution and never resamples, so `targetWidthPx` is a **floor** and the
   * delivered panel is 1x-2x it — the DPI is decided by where each preset's page
   * happens to land relative to a Web-Mercator zoom boundary. 1:24,000 passes only
   * because its page falls 1.95x past one; 1:25,000, a 4% change in scale, drops
   * off a 1.92x cliff to 176.
   *
   * The default of 1000 px over a 5.7639 in map box is a request for **173 DPI**.
   * Nothing anywhere asked for 300.
   */
  describe("print resolution per scale preset", () => {
    const widthPxAt = (bbox: BBox, zoom: number): number => {
      const midLat = (bbox[1] + bbox[3]) / 2;
      return (
        lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
      );
    };

    const CENTER: LngLat = { lng: -98.0, lat: 41.0 };
    /** USGS Topo's deepest zoom — the ceiling this render has to live inside. */
    const USGS_TOPO_MAX_ZOOM = 16;

    /** Delivered DPI for one preset at one target width, through the real engine. */
    function delivered(scale: (typeof SCALE_PRESETS)[number], targetPx: number) {
      const page = buildLocationPage(CENTER, scale, LETTER_PORTRAIT, "L1");
      const wanted = zoomForBBox(page.bbox, targetPx);
      const zoom = Math.min(wanted, USGS_TOPO_MAX_ZOOM);
      return {
        zoom,
        clamped: wanted > USGS_TOPO_MAX_ZOOM,
        widthPx: widthPxAt(page.bbox, zoom),
        dpi: effectiveDpi(widthPxAt(page.bbox, zoom), MAP_BOX_WIDTH_IN),
      };
    }

    it("guards all five presets, not just the one that passes", () => {
      // If SCALE_PRESETS grows, this test must be extended rather than silently
      // continue to describe five of six.
      expect(SCALE_PRESETS.map((s) => s.id)).toEqual([
        "usgs-7-5-min",
        "1-25000",
        "usgs-15-min",
        "1-50000",
        "1-100000",
      ]);
    });

    /**
     * The current state of the product, pinned by value so the swing is visible in
     * the suite instead of being discovered by measurement every few months. These
     * are NOT approvals of 176 DPI — see the case below for the target.
     */
    it("[BEHAVIORAL] pins today's delivered DPI at the default panel width", () => {
      const expected: Record<string, { zoom: number; dpi: number }> = {
        "usgs-7-5-min": { zoom: 16, dpi: 338 },
        "1-25000": { zoom: 15, dpi: 176 },
        "usgs-15-min": { zoom: 14, dpi: 220 },
        "1-50000": { zoom: 14, dpi: 176 },
        "1-100000": { zoom: 13, dpi: 176 },
      };

      for (const scale of SCALE_PRESETS) {
        const got = delivered(scale, DEFAULT_PANEL_WIDTH_PX);
        const want = expected[scale.id]!;
        expect(got.zoom, `${scale.id} zoom`).toBe(want.zoom);
        expect(Math.round(got.dpi), `${scale.id} DPI`).toBe(want.dpi);
      }
    });

    /**
     * The finding the roadmap had backwards. It said the 300 DPI target "needs a
     * deeper basemap, not a bigger number", scheduled against Stage 7. It needs a
     * bigger number and no deeper basemap: `panelWidthPxForDpi(mapBox, 300)` = 1730
     * clears 300 DPI at **every** preset, and every one of them still lands inside
     * USGS Topo's z16 ceiling — nothing is clamped, so no preset renders softer
     * than it asked for.
     *
     * Measured cost of raising the default, through the real `renderMapPanel`
     * against a local tile server: at 1:24,000 — the default scale — it is **free**
     * (same z16, same 99 tiles, same bytes). At the other four it is ~3.1-3.3x the
     * tiles, ~3.8-4.7x the render time and ~4x the panel bytes. That trade is the
     * owner's to make; this test only fixes what is true.
     */
    it("[BEHAVIORAL] a 300 DPI target is reachable at every preset inside the z16 ceiling", () => {
      const target = panelWidthPxForDpi(MAP_BOX_WIDTH_IN, PRINT_DPI_TARGET);
      expect(target).toBe(1730);

      for (const scale of SCALE_PRESETS) {
        const got = delivered(scale, target);
        expect(got.dpi, `${scale.id} at ${target}px: ${got.dpi.toFixed(0)} DPI`)
          .toBeGreaterThanOrEqual(PRINT_DPI_TARGET);
        expect(got.clamped, `${scale.id} needs a zoom USGS Topo does not have`).toBe(false);
        expect(got.zoom, `${scale.id} exceeds the USGS Topo ceiling`).toBeLessThanOrEqual(
          USGS_TOPO_MAX_ZOOM,
        );
      }
    });

    /**
     * And the mechanism behind the swing, stated once: the target is a floor, the
     * delivered width is 1x-2x it, and that ratio is what the DPI actually is.
     */
    it("[BEHAVIORAL] the target width is a floor, and the delivered panel is 1x-2x it", () => {
      for (const target of [DEFAULT_PANEL_WIDTH_PX, panelWidthPxForDpi(MAP_BOX_WIDTH_IN)]) {
        for (const scale of SCALE_PRESETS) {
          const got = delivered(scale, target);
          if (got.clamped) continue; // a clamped panel is allowed to be softer
          const ratio = got.widthPx / target;
          expect(ratio, `${scale.id} at ${target}px delivered ${got.widthPx}px`).toBeGreaterThanOrEqual(1);
          expect(ratio, `${scale.id} at ${target}px delivered ${got.widthPx}px`).toBeLessThan(2);
        }
      }
    });
  });

  it("tileRangeForBBox returns a well-ordered tile range", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    const r = tileRangeForBBox(bbox, 14);
    expect(r.maxX).toBeGreaterThanOrEqual(r.minX);
    expect(r.maxY).toBeGreaterThanOrEqual(r.minY);
  });

  it("lngLatToPanelFraction maps the bbox corners and centre (top-left origin, v down)", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    const [west, south, east, north] = bbox;

    // SW corner -> ≈[0, 1]
    const sw = lngLatToPanelFraction({ lng: west, lat: south }, bbox);
    expect(sw[0]).toBeCloseTo(0, 2);
    expect(sw[1]).toBeCloseTo(1, 2);

    // NE corner -> ≈[1, 0]
    const ne = lngLatToPanelFraction({ lng: east, lat: north }, bbox);
    expect(ne[0]).toBeCloseTo(1, 2);
    expect(ne[1]).toBeCloseTo(0, 2);

    // Centre -> ≈[0.5, 0.5]
    const centre = lngLatToPanelFraction(
      { lng: (west + east) / 2, lat: (south + north) / 2 },
      bbox,
    );
    expect(centre[0]).toBeCloseTo(0.5, 2);
    expect(centre[1]).toBeCloseTo(0.5, 2);
  });
});

/**
 * Delivered print resolution once each preset asks for its OWN panel width.
 *
 * The suite above pins what the flat 1000 px default delivered. This block pins
 * what the per-preset widths deliver, and — the part nothing in this repo had
 * ever measured — how much of that is a property of the product versus an
 * artefact of the one point everything was measured at.
 *
 * Two hidden variables were being held constant by the fixture:
 *
 *  - **Latitude.** Web Mercator ground resolution scales with cos(lat), so a page
 *    of fixed ground size spans a different number of tile pixels at a different
 *    latitude and `zoomForBBox` can pick a different zoom for the same preset at
 *    the same target width. Delivered DPI is only ever guaranteed to fall in
 *    `[target/box, 2 x target/box)`; WHERE in that band is an accident. Every
 *    "1:24,000 prints at 338 DPI" statement in this repo is a statement about
 *    41 degrees N. Its real band at 1000 px across the USGS Topo latitude range
 *    is **174-346 DPI**.
 *  - **Orientation.** Landscape has an 8.2639 in map box instead of 5.7639 in, so
 *    a flat pixel count is a weaker DPI request there. That is why the preset's
 *    number goes through `panelWidthPxFor` rather than being used raw.
 */
describe("delivered print resolution at each preset's own panel width", () => {
  const widthPxAt = (bbox: BBox, zoom: number): number => {
    const midLat = (bbox[1] + bbox[3]) / 2;
    return (
      lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
    );
  };

  /** USGS Topo's deepest zoom — the ceiling every one of these renders lives inside. */
  const USGS_TOPO_MAX_ZOOM = 16;
  const LETTER_LANDSCAPE: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };

  /**
   * The USGS Topo coverage band, in degrees north: Puerto Rico / Hawaii at the
   * low end, northern Alaska at the high end. Sampling outside it would pin
   * numbers for pages this basemap has no tiles for.
   */
  const US_LAT_MIN = 18;
  const US_LAT_MAX = 72;

  function deliveredAt(scale: ScalePreset, page: PageSpec, lat: number, targetOverride?: number) {
    const boxW = mapBoxInches(page).widthIn;
    const bbox = buildLocationPage({ lng: -98, lat }, scale, page, "L1").bbox;
    // Default: what the render pipeline actually asks for. An override lets a
    // case measure a width the product does NOT use — e.g. the flat-width
    // counterfactual below — without pretending the preset carries it.
    const target = targetOverride ?? panelWidthPxFor(scale, page);
    const wanted = zoomForBBox(bbox, target);
    const zoom = Math.min(wanted, USGS_TOPO_MAX_ZOOM);
    return {
      target,
      zoom,
      clamped: wanted > USGS_TOPO_MAX_ZOOM,
      dpi: effectiveDpi(widthPxAt(bbox, zoom), boxW),
    };
  }

  /** Min/max delivered DPI across the coverage band, and whether anything clamped. */
  function band(scale: ScalePreset, page: PageSpec, targetOverride?: number) {
    let min = Infinity;
    let max = -Infinity;
    let clampedAnywhere = false;
    let samples = 0;
    for (let lat = US_LAT_MIN; lat <= US_LAT_MAX; lat += 0.25) {
      const got = deliveredAt(scale, page, lat, targetOverride);
      min = Math.min(min, got.dpi);
      max = Math.max(max, got.dpi);
      clampedAnywhere ||= got.clamped;
      samples++;
    }
    return { min, max, clampedAnywhere, samples };
  }

  it("[CONTROL] the latitude sweep actually sweeps", () => {
    // Every band assertion below is vacuously true over an empty sweep, and an
    // empty sweep is one typo away (a `<` for a `<=`, a step of 0). 217 samples
    // at 0.25 deg over 18-72 deg.
    const swept = band(SCALE_PRESETS[0]!, LETTER_PORTRAIT);
    expect(swept.samples).toBe(217);
    expect(swept.max).toBeGreaterThan(swept.min);
  });

  /**
   * The decision, pinned by value at the point everything else in this repo is
   * measured at (41 deg N, Letter portrait): four presets raised, one left alone.
   */
  it("[BEHAVIORAL] pins each preset's width, zoom and delivered DPI at 41N portrait", () => {
    const expected: Record<string, { target: number; zoom: number; dpi: number }> = {
      "usgs-7-5-min": { target: 1000, zoom: 16, dpi: 338 },
      "1-25000": { target: 1730, zoom: 16, dpi: 352 },
      "usgs-15-min": { target: 1730, zoom: 15, dpi: 440 },
      "1-50000": { target: 1730, zoom: 15, dpi: 352 },
      "1-100000": { target: 1730, zoom: 14, dpi: 352 },
    };
    for (const scale of SCALE_PRESETS) {
      const got = deliveredAt(scale, LETTER_PORTRAIT, 41);
      const want = expected[scale.id]!;
      expect(got.target, `${scale.id} target width`).toBe(want.target);
      expect(got.zoom, `${scale.id} zoom`).toBe(want.zoom);
      expect(Math.round(got.dpi), `${scale.id} DPI`).toBe(want.dpi);
    }
  });

  it("1:24,000 still renders exactly as it did — same width, same zoom, same DPI", () => {
    // Half two of the owner's decision, asserted on its own so a regression that
    // quietly widens the headline preset names itself.
    const got = deliveredAt(SCALE_PRESETS[0]!, LETTER_PORTRAIT, 41);
    expect(SCALE_PRESETS[0]!.id).toBe("usgs-7-5-min");
    expect(got.target).toBe(1000);
    expect(got.zoom).toBe(16);
    expect(Math.round(got.dpi)).toBe(338);
  });

  /**
   * Half one, as a PROPERTY rather than a single point: the three coarse presets
   * clear 300 DPI at every latitude USGS Topo covers, in BOTH orientations.
   * 1:25,000 is excluded here and pinned separately below — it is one of the two
   * presets the z16 ceiling stops short.
   */
  it("the raised presets that can clear 300 DPI do so across the whole coverage band", () => {
    for (const page of [LETTER_PORTRAIT, LETTER_LANDSCAPE]) {
      for (const id of ["usgs-15-min", "1-50000", "1-100000"]) {
        const scale = SCALE_PRESETS.find((s) => s.id === id)!;
        const got = band(scale, page);
        expect(
          got.min,
          `${id} ${page.orientation}: worst delivered ${got.min.toFixed(0)} DPI`,
        ).toBeGreaterThanOrEqual(PRINT_DPI_TARGET);
      }
    }
  });

  /**
   * The limit, recorded rather than wished away.
   *
   * `1-25000` was raised to the full 300 DPI request and STILL cannot reach 300
   * DPI in the southern half of the USGS Topo coverage, because the source has no
   * z17: at 18 deg N the page needs one zoom deeper than exists and is clamped to
   * 279 DPI. That is a basemap limit, not a width choice — the previous pass's
   * "1730 clears 300 DPI at every preset, nothing is clamped" was true only at
   * 41 deg N.
   *
   * Pinned as a negative on purpose: if USGS ever ships z17, this fails and
   * someone re-reads the paragraph instead of inheriting the caveat forever.
   */
  it("[BEHAVIORAL] pins the preset the z16 ceiling stops short even after the raise", () => {
    const scale = SCALE_PRESETS.find((s) => s.id === "1-25000")!;
    const got = band(scale, LETTER_PORTRAIT);
    expect(Math.round(got.min), "1-25000 worst delivered DPI").toBe(279);
    expect(got.min, "1-25000 unexpectedly clears the target everywhere").toBeLessThan(
      PRINT_DPI_TARGET,
    );
    expect(got.clampedAnywhere, "1-25000 should be clamped by the z16 ceiling somewhere").toBe(true);
  });

  /**
   * What the `usgs-7-5-min` exception actually costs in reachable quality:
   * **nothing**. Raising it to the full 300 DPI request would still leave it
   * short across the southern half of the coverage — 268 DPI at 18 deg N,
   * clamped by the same missing z17 — so the decision to leave it at 1000 px is
   * not trading resolution the product could otherwise have had. It trades the
   * 41 deg N band (174-346 -> 268-597) for ~3x the tiles at latitudes where 1000
   * px currently lands a zoom shallower.
   *
   * This is measured through the same engine as everything else, not asserted
   * from the decision that produced it.
   */
  it("[BEHAVIORAL] raising 1:24,000 to the 300 DPI request would still not clear 300 DPI", () => {
    const scale = SCALE_PRESETS.find((s) => s.id === "usgs-7-5-min")!;
    const raisedWidth = panelWidthPxForDpi(mapBoxInches(LETTER_PORTRAIT).widthIn, PRINT_DPI_TARGET);
    const got = band(scale, LETTER_PORTRAIT, raisedWidth);
    expect(Math.round(got.min), "1:24,000 worst delivered DPI at 1730 px").toBe(268);
    expect(got.min).toBeLessThan(PRINT_DPI_TARGET);
    expect(got.clampedAnywhere).toBe(true);
  });

  /**
   * The correction to the headline number. "1:24,000 prints at 338 DPI" is one
   * latitude; the product's actual range at the default width is 174-346.
   */
  it("[BEHAVIORAL] pins 1:24,000's real DPI band at the default width, not its 41N value", () => {
    const got = band(SCALE_PRESETS[0]!, LETTER_PORTRAIT);
    expect(Math.round(got.min)).toBe(174);
    expect(Math.round(got.max)).toBe(346);
    // And 338 is inside that band rather than being it.
    expect(338).toBeGreaterThan(Math.round(got.min));
    expect(338).toBeLessThan(Math.round(got.max));
  });

  /**
   * Why the preset's number is rescaled instead of used raw. A flat 1730 px on a
   * landscape sheet is a 30% weaker DPI request, and clears 300 at no preset at
   * all — the exact silent-portrait-only pin this block exists to prevent.
   */
  it("a flat panel width would clear 300 DPI at no preset in landscape", () => {
    const flat = panelWidthPxForDpi(mapBoxInches(LETTER_PORTRAIT).widthIn, PRINT_DPI_TARGET);
    for (const scale of SCALE_PRESETS) {
      // Measured over the coverage band, not at one latitude: at 41 deg N a flat
      // 1730 px does clear 300 DPI for 1:24,000, which is precisely the kind of
      // single-point evidence this block exists to stop being mistaken for a
      // property.
      const got = band(scale, LETTER_LANDSCAPE, flat);
      expect(got.min, `${scale.id} at a flat ${flat}px landscape`).toBeLessThan(PRINT_DPI_TARGET);
    }
  });
});
