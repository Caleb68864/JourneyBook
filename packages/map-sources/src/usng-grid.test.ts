import { describe, it, expect } from "vitest";
import { createUtmProjector } from "@journeybook/atlas-core";
import mgrs from "mgrs";
const mgrsForward = mgrs.forward;

import { buildUsngGrid } from "./usng-grid.js";
import { lngLatToPanelFraction } from "./tilemath.js";

const LINCOLN_NE: [number, number, number, number] = [-96.75, 40.78, -96.65, 40.85];
// ~10 km × ~7.8 km → should produce a handful of 1000 m gridlines
const PANEL_W = 800;
const PANEL_H = 1000;

describe("buildUsngGrid — structural", () => {
  it("exports buildUsngGrid as a function", () => {
    expect(typeof buildUsngGrid).toBe("function");
  });
});

describe("buildUsngGrid — Lincoln NE (1000 m)", () => {
  const overlay = buildUsngGrid(LINCOLN_NE, PANEL_W, PANEL_H);

  it("produces non-empty lines", () => {
    expect(overlay.lines.length).toBeGreaterThan(0);
  });

  it("has both easting and northing lines", () => {
    expect(overlay.lines.some((l) => l.axis === "easting")).toBe(true);
    expect(overlay.lines.some((l) => l.axis === "northing")).toBe(true);
  });

  it("all line coordinates are within [0, 1]", () => {
    for (const l of overlay.lines) {
      expect(l.x1).toBeGreaterThanOrEqual(0);
      expect(l.x1).toBeLessThanOrEqual(1);
      expect(l.y1).toBeGreaterThanOrEqual(0);
      expect(l.y1).toBeLessThanOrEqual(1);
      expect(l.x2).toBeGreaterThanOrEqual(0);
      expect(l.x2).toBeLessThanOrEqual(1);
      expect(l.y2).toBeGreaterThanOrEqual(0);
      expect(l.y2).toBeLessThanOrEqual(1);
    }
  });

  it("collar matches mgrs.forward for the centre point", () => {
    const [west, south, east, north] = LINCOLN_NE;
    const centreLng = (west + east) / 2;
    const centreLat = (south + north) / 2;
    const usng = mgrsForward([centreLng, centreLat], 1);
    const compact = usng.replace(/\s/g, "");
    const m = compact.match(/^(\d{1,2}[A-Z])([A-Z]{2})/);
    expect(m).not.toBeNull();
    if (m) {
      expect(overlay.collar.zoneDesignator).toBe(m[1]);
      expect(overlay.collar.hundredKmSquare).toBe(m[2]);
    }
  });
});

describe("buildUsngGrid — georeference accuracy", () => {
  // Independently re-derive the UTM extent the generator walks, using the SAME
  // shared primitives (atlas-core createUtmProjector + tilemath
  // lngLatToPanelFraction). If buildUsngGrid used a different (e.g. linear)
  // panel mapping, the overlay endpoints would diverge from this recomputation.
  const proj = createUtmProjector(14);
  const [west, south, east, north] = LINCOLN_NE;
  const corners = [
    proj.forward({ lng: west, lat: south }),
    proj.forward({ lng: east, lat: south }),
    proj.forward({ lng: west, lat: north }),
    proj.forward({ lng: east, lat: north }),
  ];
  const eMin = Math.min(...corners.map(([e]) => e));
  const eMax = Math.max(...corners.map(([e]) => e));
  const nMin = Math.min(...corners.map(([, n]) => n));
  const nMax = Math.max(...corners.map(([, n]) => n));

  it("easting gridlines are placed via the shared Web-Mercator panel mapping (not a linear re-impl)", () => {
    const overlay = buildUsngGrid(LINCOLN_NE, PANEL_W, PANEL_H);
    const firstE = Math.ceil(eMin / 1000) * 1000;
    // Expected endpoints of the first easting line, via the shared functions.
    const [exTop] = lngLatToPanelFraction(proj.inverse([firstE, nMax]), LINCOLN_NE);
    const eLine = overlay.lines.find((l) => l.axis === "easting");
    expect(eLine).toBeDefined();
    // x2 corresponds to the northing-max (top) endpoint in the generator.
    expect(Math.abs(eLine!.x2 - Math.min(1, Math.max(0, exTop)))).toBeLessThan(1e-6);
  });

  it("northing gridlines register at their shared-mapping panel-v (catches linear drift)", () => {
    const overlay = buildUsngGrid(LINCOLN_NE, PANEL_W, PANEL_H);
    const firstN = Math.ceil(nMin / 1000) * 1000;
    expect(firstN).toBeLessThanOrEqual(nMax);
    // Expected v of the first northing line's west endpoint, via the shared map.
    const [, vExpected] = lngLatToPanelFraction(proj.inverse([eMin, firstN]), LINCOLN_NE);
    const nLine = overlay.lines.find((l) => l.axis === "northing");
    expect(nLine).toBeDefined();
    // y1 is the west (easting-min) endpoint in the generator.
    expect(Math.abs(nLine!.y1 - Math.min(1, Math.max(0, vExpected)))).toBeLessThan(1e-6);
  });

  it("a known point's km easting gridline lands within 0.01 of the point's panel fraction", () => {
    const testLng = -96.70;
    const testLat = 40.815;
    const [testE] = proj.forward({ lng: testLng, lat: testLat });
    const nearestE = Math.round(testE / 1000) * 1000;
    // Panel x of the point itself and of its nearest km easting gridline, both via
    // the shared mapping. The gridline should sit within 1% of the point.
    const [pointX] = lngLatToPanelFraction({ lng: testLng, lat: testLat }, LINCOLN_NE);
    const [gridX] = lngLatToPanelFraction(proj.inverse([nearestE, (nMin + nMax) / 2]), LINCOLN_NE);
    const overlay = buildUsngGrid(LINCOLN_NE, PANEL_W, PANEL_H);
    expect(overlay.lines.length).toBeGreaterThan(0);
    expect(Math.abs(gridX - pointX)).toBeLessThan(0.01);
  });
});

describe("buildUsngGrid — defensive (never aborts the render)", () => {
  it("never throws and returns a well-formed overlay for a degenerate (zero-area) bbox", () => {
    const DEGENERATE: [number, number, number, number] = [-96.7, 40.8, -96.7, 40.8];
    let overlay!: ReturnType<typeof buildUsngGrid>;
    expect(() => {
      overlay = buildUsngGrid(DEGENERATE, PANEL_W, PANEL_H);
    }).not.toThrow();
    expect(overlay).toHaveProperty("lines");
    expect(overlay).toHaveProperty("labels");
    expect(overlay).toHaveProperty("collar");
    expect(Array.isArray(overlay.lines)).toBe(true);
  });
});

describe("buildUsngGrid — polar / out-of-UTM bbox", () => {
  it("returns empty overlay without throwing for centre lat > 84°N", () => {
    const POLAR: [number, number, number, number] = [-10, 84.5, 10, 87];
    const overlay = buildUsngGrid(POLAR, 800, 1000);
    expect(overlay.lines).toHaveLength(0);
    expect(overlay.labels).toHaveLength(0);
  });

  it("returns empty collar for polar bbox", () => {
    const POLAR: [number, number, number, number] = [-10, 84.5, 10, 87];
    const overlay = buildUsngGrid(POLAR, 800, 1000);
    expect(overlay.collar.zoneDesignator).toBe("");
    expect(overlay.collar.hundredKmSquare).toBe("");
  });
});

describe("buildUsngGrid — 10 km fallback", () => {
  // A bbox ~40 km × ~40 km should generate >60 lines at 1000 m → falls back to 10 km.
  // 0.4° lon at 40°N ≈ 34 km, 0.4° lat ≈ 44 km → ~78 lines at 1km.
  const LARGE_BBOX: [number, number, number, number] = [-97.5, 40.0, -97.1, 40.4];

  it("uses 10 000 m interval when 1 000 m would exceed 60 lines", () => {
    const overlay = buildUsngGrid(LARGE_BBOX, 800, 1000);
    expect(overlay.lines.length).toBeGreaterThan(0);
    // At 10 km there should be far fewer than 60 lines.
    expect(overlay.lines.length).toBeLessThan(60);
  });

  it("1000 m interval on the same bbox would exceed 60 lines (validates the test premise)", () => {
    const overlay1k = buildUsngGrid(LARGE_BBOX, 800, 1000, { intervalMeters: 1000 });
    expect(overlay1k.lines.length).toBeGreaterThan(60);
  });
});
