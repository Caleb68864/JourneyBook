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
