import { describe, it, expect } from "vitest";
import type { BBox } from "@journeybook/atlas-core";
import {
  TILE_SIZE,
  lngLatToGlobalPixel,
  groundResolutionMetersPerPixel,
  zoomForBBox,
  tileRangeForBBox,
  lngLatToPanelFraction,
} from "./tilemath.js";

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
      const MAP_BOX_WIDTH_IN = 5.763888888888889; // mapBoxInches(LETTER_PORTRAIT)

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
