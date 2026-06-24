import { describe, it, expect } from "vitest";
import {
  utmZoneForLongitude,
  createProjector,
  geodesicDistanceMeters,
} from "./projection.js";
import type { LngLat } from "./index.js";

describe("utmZoneForLongitude", () => {
  it("picks the right UTM zone", () => {
    expect(utmZoneForLongitude(-98)).toBe(14); // central Nebraska
    expect(utmZoneForLongitude(2.35)).toBe(31); // Paris
    expect(utmZoneForLongitude(-123.1)).toBe(10); // Vancouver
  });
});

describe("createProjector", () => {
  it("round-trips lng/lat through the projected plane", () => {
    const center: LngLat = { lng: -98, lat: 41 };
    const projector = createProjector(center);
    const p: LngLat = { lng: -98.01, lat: 41.01 };

    const back = projector.inverse(projector.forward(p));

    expect(back.lng).toBeCloseTo(p.lng, 7);
    expect(back.lat).toBeCloseTo(p.lat, 7);
  });

  // The headline risk: a fixed projected displacement must equal a fixed
  // GROUND distance at any latitude (true scale) — unlike Web Mercator.
  it("preserves ground distance independent of latitude", () => {
    function eastStepMeters(center: LngLat): number {
      const projector = createProjector(center);
      const [x, y] = projector.forward(center);
      const moved = projector.inverse([x + 1000, y]);
      return geodesicDistanceMeters(center, moved);
    }

    const low = eastStepMeters({ lng: -98, lat: 25 });
    const high = eastStepMeters({ lng: -98, lat: 60 });

    // True scale at the page: 1000 plane metres ≈ 1000 ground metres,
    // at both latitudes. (Web Mercator would be off by ~sec(lat): ~2x at 60°.)
    expect(low).toBeGreaterThan(999.5);
    expect(low).toBeLessThan(1000.5);
    expect(high).toBeGreaterThan(999.5);
    expect(high).toBeLessThan(1000.5);
    expect(Math.abs(low - high)).toBeLessThan(0.2);
  });
});

describe("geodesicDistanceMeters", () => {
  it("one degree of latitude at the equator is ~110.57 km (WGS84)", () => {
    const d = geodesicDistanceMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
    expect(d).toBeGreaterThan(110_400);
    expect(d).toBeLessThan(110_700);
  });
});
