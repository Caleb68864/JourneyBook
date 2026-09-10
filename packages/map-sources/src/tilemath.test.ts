import { describe, it, expect } from "vitest";
import type { BBox, LngLat } from "@journeybook/atlas-core";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  mapBoxInches,
  buildLocationPage,
  effectiveDpi,
  panelWidthPxForDpi,
  PRINT_DPI_TARGET,
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
