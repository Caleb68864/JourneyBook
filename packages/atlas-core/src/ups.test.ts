import { describe, it, expect } from "vitest";
import { createUpsProjector, isUpsLatitude, upsZoneLetter } from "./projection.js";
import { gridConvergence, gridName } from "./north.js";

/**
 * UPS (EPSG:32661/32761) against Snyder's ellipsoidal polar stereographic formulas ("Map
 * Projections: A Working Manual", USGS PP 1395, eqs. 15-9, 21-33, 21-34), written out here so
 * proj4 is checked by something other than itself: k0 = 0.994, false easting/northing 2,000 km.
 */
const A = 6378137;
const E = Math.sqrt(0.00669437999014);

function snyder(lng: number, lat: number, north: boolean): [number, number] {
  const phi = ((north ? lat : -lat) * Math.PI) / 180;
  const lam = ((north ? lng : -lng) * Math.PI) / 180;
  const t = Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
  const rho = (2 * A * 0.994 * t) / Math.sqrt((1 + E) ** (1 + E) * (1 - E) ** (1 - E));
  // North: x = FE + ρ sinλ, y = FN − ρ cosλ. South mirrors φ and λ, so y = FN + ρ cos(−λ).
  return north ? [2e6 + rho * Math.sin(lam), 2e6 - rho * Math.cos(lam)] : [2e6 - rho * Math.sin(lam), 2e6 + rho * Math.cos(lam)];
}

describe("UPS", () => {
  it("[BEHAVIORAL] proj4's UPS matches Snyder's formulas to the millimetre, both poles", () => {
    for (const [lng, lat] of [[10, 84.5], [-120, 85], [179, 84.1], [0, 88], [45, -82], [-170, -85], [100, -80.5]] as [number, number][]) {
      const north = lat > 0;
      const [x, y] = createUpsProjector(north).forward({ lng, lat });
      const [sx, sy] = snyder(lng, lat, north);
      expect(Math.abs(x - sx), `${lng},${lat} x`).toBeLessThan(0.001);
      expect(Math.abs(y - sy), `${lng},${lat} y`).toBeLessThan(0.001);
    }
    const [px, py] = createUpsProjector(true).forward({ lng: 0, lat: 90 });
    expect(px).toBeCloseTo(2e6, 3);
    expect(py).toBeCloseTo(2e6, 3);
  });

  it("zone letters and the UPS latitudes", () => {
    expect([upsZoneLetter(10, 85), upsZoneLetter(-10, 85), upsZoneLetter(10, -85), upsZoneLetter(-10, -85)]).toEqual(["Z", "Y", "B", "A"]);
    expect([isUpsLatitude(84), isUpsLatitude(83.9), isUpsLatitude(-80.1), isUpsLatitude(-80)]).toEqual([true, false, true, false]);
  });

  it("[BEHAVIORAL] grid north on the UPS grid: the longitude in the north, its negative in the south", () => {
    // UPS grid north is the 0°→180° line; at longitude λ true north turns from it by λ.
    const n = gridConvergence({ lng: 30, lat: 84.5 });
    expect(n.utmZone).toBe(0);
    expect(n.degrees).toBeCloseTo(30, 4);
    expect(gridConvergence({ lng: 30, lat: -82 }).degrees).toBeCloseTo(-30, 4);
    expect(gridName(0)).toBe("UPS");
    expect(gridName(14)).toBe("UTM 14");
  });
});
