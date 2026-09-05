import { describe, it, expect } from "vitest";
import { LETTER_PORTRAIT, groundFootprintMeters } from "./page.js";
import { buildPageGrid, buildLocationPage } from "./grid.js";
import { buildRouteAtlas } from "./route.js";
import { validateAtlas } from "./validation.js";
import { geodesicDistanceMeters } from "./projection.js";
import { SCALE_PRESETS, type AtlasPage, type ScalePreset } from "./model.js";

/**
 * Every page must cover exactly the ground its scale bar claims, wherever it
 * sits in the atlas. Projecting a whole extent through one shared projector
 * fails this: meridian convergence rotates pages away from the central meridian,
 * so their axis-aligned bboxes inflate (~0.7% at 40 km, ~1.1% at 60 km at
 * 1:100,000). Each page is built about its own centre instead — these tests pin
 * that, since the symptom only appears on extents wide enough to matter.
 */
const scaleOf = (id: string): ScalePreset => SCALE_PRESETS.find((p) => p.id === id)!;

/** Worst relative footprint error over every page, as a fraction. */
function worstFootprintError(pages: AtlasPage[], contractScale: ScalePreset): number {
  let worst = 0;
  for (const page of pages) {
    const expected = groundFootprintMeters(page.scale ?? contractScale, {
      widthIn: 8.5,
      heightIn: 11,
      orientation: page.orientation,
      margins: LETTER_PORTRAIT.margins,
    });
    const [west, south, east, north] = page.bbox;
    const midLat = (south + north) / 2;
    const midLng = (west + east) / 2;
    const width = geodesicDistanceMeters({ lng: west, lat: midLat }, { lng: east, lat: midLat });
    const height = geodesicDistanceMeters({ lng: midLng, lat: south }, { lng: midLng, lat: north });
    worst = Math.max(
      worst,
      Math.abs(width - expected.widthMeters) / expected.widthMeters,
      Math.abs(height - expected.heightMeters) / expected.heightMeters,
    );
  }
  return worst;
}

describe("scale fidelity across a wide extent", () => {
  it("validates a ~100 km cover grid at 1:100,000 (the road-trip case)", () => {
    // Lincoln -> Omaha, the extent the CLI's --cover produces for that trip.
    const contract = buildPageGrid({
      bbox: [-96.9, 40.76, -95.89, 41.28],
      scale: scaleOf("1-100000"),
      page: LETTER_PORTRAIT,
      tier: 1,
    });
    expect(contract.pages.length).toBeGreaterThan(10);
    const report = validateAtlas(contract);
    expect(report.checks.find((c) => c.name === "scale-consistency")?.pass).toBe(true);
    expect(report.pass).toBe(true);
  });

  it("holds footprint error flat regardless of a page's distance from the extent centre", () => {
    const scale = scaleOf("1-100000");
    const narrow = buildPageGrid({
      bbox: [-96.5, 41.0, -96.3, 41.1],
      scale,
      page: LETTER_PORTRAIT,
      tier: 1,
    });
    const wide = buildPageGrid({
      // ~250 km across: outer pages sit far from the shared central meridian.
      bbox: [-98.0, 40.5, -95.0, 41.6],
      scale,
      page: LETTER_PORTRAIT,
      tier: 1,
    });
    const narrowWorst = worstFootprintError(narrow.pages, scale);
    const wideWorst = worstFootprintError(wide.pages, scale);

    // The wide atlas is no worse than the narrow one - the error does not grow
    // with extent width, which is precisely what a shared projector got wrong.
    expect(wideWorst).toBeLessThan(0.005);
    expect(wideWorst - narrowWorst).toBeLessThan(0.0005);
    expect(validateAtlas(wide).pass).toBe(true);
  });

  it("keeps corridor pages true to scale along a long route", () => {
    const scale = scaleOf("1-100000");
    const result = buildRouteAtlas({
      // Lincoln -> Omaha -> Sioux City: a route that runs well off any one meridian.
      stops: [
        { lng: -96.7026, lat: 40.8136 },
        { lng: -95.9345, lat: 41.2565 },
        { lng: -96.4003, lat: 42.4999 },
      ],
      scale,
      page: LETTER_PORTRAIT,
      tier: 2,
    });
    expect(result.pages.length).toBeGreaterThan(3);
    expect(worstFootprintError(result.pages, scale)).toBeLessThan(0.005);
  });

  it("keeps a location page true to scale far from the prime meridian and at high latitude", () => {
    const scale = scaleOf("usgs-7-5-min");
    const pages = [
      buildLocationPage({ lng: 174.776, lat: -41.286 }, scale, LETTER_PORTRAIT, "L1", 2),
      buildLocationPage({ lng: -149.9, lat: 61.2 }, scale, LETTER_PORTRAIT, "L2", 2),
      buildLocationPage({ lng: 0.1276, lat: 51.5072 }, scale, LETTER_PORTRAIT, "L3", 2),
    ];
    expect(worstFootprintError(pages, scale)).toBeLessThan(0.005);
  });
});
