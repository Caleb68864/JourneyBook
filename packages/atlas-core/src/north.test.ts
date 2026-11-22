import { describe, it, expect } from "vitest";
import { formatEastWest, gridConvergence, threeNorths } from "./north.js";
import { magneticField } from "./declination.js";

/**
 * Grid convergence is checked against the transverse Mercator series (Snyder, "Map Projections:
 * A Working Manual", USGS PP 1395, transverse Mercator), computed here independently of proj4:
 *   γ = Δλ·sinφ·[1 + (Δλ²cos²φ/3)(1 + 3η² + 2η⁴) + (Δλ⁴cos⁴φ/15)(2 − tan²φ)],  η² = e'²cos²φ.
 */
function seriesConvergence(lat: number, lng: number): number {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const lambda0 = zone * 6 - 183;
  const phi = (lat * Math.PI) / 180;
  const dl = ((lng - lambda0) * Math.PI) / 180;
  const ep2 = 0.00669437999014 / (1 - 0.00669437999014);
  const eta2 = ep2 * Math.cos(phi) ** 2;
  const c2 = (dl * Math.cos(phi)) ** 2;
  const gamma =
    dl * Math.sin(phi) * (1 + (c2 / 3) * (1 + 3 * eta2 + 2 * eta2 * eta2) + ((c2 * c2) / 15) * (2 - Math.tan(phi) ** 2));
  return (gamma * 180) / Math.PI;
}

describe("grid convergence", () => {
  it("[BEHAVIORAL] matches the transverse Mercator series across a zone and both hemispheres", () => {
    for (const [lat, lng] of [
      [40.8, -96.7], // Lincoln: zone 14, 2.3° east of the CM
      [40.8, -101.9], // near zone 14's west edge
      [47.6, -122.3], // Seattle
      [-33.9, 151.2], // Sydney
      [0.5, 10.0],
      [64.8, -147.7], // Fairbanks
    ]) {
      expect(gridConvergence({ lat: lat!, lng: lng! }).degrees, `${lat},${lng}`).toBeCloseTo(seriesConvergence(lat!, lng!), 4);
    }
  });

  it("is zero on a central meridian and east of true north east of it, in the north", () => {
    expect(gridConvergence({ lat: 40, lng: -99 }).degrees).toBeCloseTo(0, 6);
    expect(gridConvergence({ lat: 40, lng: -97 }).degrees).toBeGreaterThan(0);
    expect(gridConvergence({ lat: 40, lng: -101 }).degrees).toBeLessThan(0);
  });
});

describe("threeNorths", () => {
  it("[BEHAVIORAL] the G-M angle is declination minus grid convergence, for the page's own zone", () => {
    const center = { lat: 40.8, lng: -96.7 };
    const date = new Date(Date.UTC(2026, 6, 2));
    const n = threeNorths(center, date);
    expect(n.utmZone).toBe(14);
    expect(n.declination).toBeCloseTo(magneticField(40.8, -96.7, n.year).declination, 10);
    expect(n.gridConvergence).toBeCloseTo(seriesConvergence(40.8, -96.7), 4);
    expect(n.gmAngle).toBeCloseTo(n.declination - n.gridConvergence, 10);
    expect(n.model).toBe("WMM2025");
  });

  it("refuses a date the model does not cover", () => {
    expect(() => threeNorths({ lat: 40.8, lng: -96.7 }, new Date(Date.UTC(2031, 0, 1)))).toThrow(/2025\.0 to 2030\.0/);
  });

  it("formats an angle the way a navigator writes it", () => {
    expect(formatEastWest(2.149)).toBe("2.1° E");
    expect(formatEastWest(-0.36)).toBe("0.4° W");
    expect(formatEastWest(0.04)).toBe("0.0°");
  });
});

describe("grid north in the zone exceptions", () => {
  it("[BEHAVIORAL] takes grid north from the point's own zone: zone 32 at 4°E 60°N, not 31", () => {
    // In zone 32 (CM 9°E) the point is 5° west of the meridian: convergence about -4.3°.
    // In zone 31 (CM 3°E) it would be +0.9°.
    const g = gridConvergence({ lng: 4, lat: 60 });
    expect(g.utmZone).toBe(32);
    expect(g.degrees).toBeCloseTo(seriesConvergence32(60, 4), 3);
    expect(g.degrees).toBeLessThan(-4);
  });
});

/** The TM series about zone 32's central meridian (9°E), for the exception test. */
function seriesConvergence32(lat: number, lng: number): number {
  const phi = (lat * Math.PI) / 180;
  const dl = ((lng - 9) * Math.PI) / 180;
  const ep2 = 0.00669437999014 / (1 - 0.00669437999014);
  const eta2 = ep2 * Math.cos(phi) ** 2;
  const c2 = (dl * Math.cos(phi)) ** 2;
  return ((dl * Math.sin(phi) * (1 + (c2 / 3) * (1 + 3 * eta2 + 2 * eta2 * eta2) + ((c2 * c2) / 15) * (2 - Math.tan(phi) ** 2))) * 180) / Math.PI;
}

describe("grid north on both sides of a zone junction", () => {
  it("[BEHAVIORAL] gives the other zone's grid north and G-M at the same point", () => {
    // 102°W is the 13/14 boundary: 3° east of zone 13's meridian, 3° west of zone 14's.
    const p = { lng: -102.0001, lat: 40.8 };
    const n = threeNorths(p, new Date(Date.UTC(2026, 6, 2)), 14);
    expect(n.utmZone).toBe(13);
    expect(n.otherZone!.utmZone).toBe(14);
    expect(n.gridConvergence).toBeCloseTo(seriesConvergence(40.8, -102.0001), 4);
    // Zone 14's convergence there, by the series about its meridian (99°W).
    const phi = (40.8 * Math.PI) / 180;
    const dl = ((-102.0001 + 99) * Math.PI) / 180;
    const ep2 = 0.00669437999014 / (1 - 0.00669437999014);
    const eta2 = ep2 * Math.cos(phi) ** 2;
    const c2 = (dl * Math.cos(phi)) ** 2;
    const z14 = ((dl * Math.sin(phi) * (1 + (c2 / 3) * (1 + 3 * eta2 + 2 * eta2 * eta2) + ((c2 * c2) / 15) * (2 - Math.tan(phi) ** 2))) * 180) / Math.PI;
    expect(n.otherZone!.gridConvergence).toBeCloseTo(z14, 4);
    expect(n.otherZone!.gmAngle).toBeCloseTo(n.declination - z14, 4);
    // About 4° apart: the reason a junction page needs both.
    expect(n.gridConvergence - n.otherZone!.gridConvergence).toBeGreaterThan(3.5);
  });

  it("[CONTROL] no other zone unless asked, or when it is the same zone", () => {
    const d = new Date(Date.UTC(2026, 6, 2));
    expect(threeNorths({ lng: -96.7, lat: 40.8 }, d).otherZone).toBeUndefined();
    expect(threeNorths({ lng: -96.7, lat: 40.8 }, d, 14).otherZone).toBeUndefined();
  });
});
