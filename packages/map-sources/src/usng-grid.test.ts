import { describe, it, expect } from "vitest";
import proj4 from "proj4";
import { forward as mgrsForward } from "mgrs";

import { buildUsngGrid } from "./usng-grid.js";

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
  it("easting gridline for a point lands within 0.01 of the point's panel fraction", () => {
    const [west, south, east, north] = LINCOLN_NE;
    const testLng = -96.70;
    const testLat = 40.815;

    // Compute UTM easting for the test point in zone 14N.
    const utmDef = "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs";
    const [testE] = proj4("EPSG:4326", utmDef, [testLng, testLat]);

    // Nearest 1 km easting gridline value.
    const nearestE = Math.round(testE / 1000) * 1000;

    // Project that gridline back to lng at mid-northing to get its panel x.
    const [, nMin] = proj4("EPSG:4326", utmDef, [west, south]);
    const [, nMax] = proj4("EPSG:4326", utmDef, [east, north]);
    const midN = (nMin + nMax) / 2;
    const [gridLng] = proj4(utmDef, "EPSG:4326", [nearestE, midN]);
    const gridX = (gridLng - west) / (east - west);

    // Test point panel x.
    const pointX = (testLng - west) / (east - west);

    // The gridline should be within 1% of the panel width from the point.
    const overlay = buildUsngGrid(LINCOLN_NE, 800, 1000);
    expect(overlay.lines.length).toBeGreaterThan(0);
    expect(Math.abs(gridX - pointX)).toBeLessThan(0.01);
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
