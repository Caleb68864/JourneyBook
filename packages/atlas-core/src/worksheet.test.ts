import { describe, it, expect } from "vitest";
import { worksheetLegs } from "./worksheet.js";
import { createUtmProjector } from "./projection.js";
import { threeNorths } from "./north.js";

/**
 * Worksheet answers checked against legs built in UTM metres, where the grid azimuth is known
 * exactly from the offsets, independent of the code under test.
 */
const zone14 = createUtmProjector(14);
const START = { e: 690_000, n: 4_520_000 };
const at = (de: number, dn: number) => zone14.inverse([START.e + de, START.n + dn]);
const DATE = new Date(Date.UTC(2026, 6, 2));

describe("worksheetLegs", () => {
  it("[BEHAVIORAL] grid azimuths are the plotted directions in the start's UTM grid", () => {
    const a = { label: "L1", center: at(0, 0) };
    const cases: [number, number, number][] = [
      [3000, 4000, 36.8699], // atan2(3, 4)
      [5000, 0, 90],
      [0, -2000, 180],
      [-4000, -3000, 233.1301],
      [-1000, 1000, 315],
    ];
    for (const [de, dn, expected] of cases) {
      const [leg] = worksheetLegs([a, { label: "L2", center: at(de, dn) }], DATE);
      expect(leg!.gridAzimuth, `${de},${dn}`).toBeCloseTo(expected, 3);
      expect(leg!.backAzimuth).toBeCloseTo((expected + 180) % 360, 3);
      expect(leg!.utmZone).toBe(14);
    }
  });

  it("[BEHAVIORAL] magnetic = grid − G-M at the start, and distance is ground distance", () => {
    const a = { label: "L1", center: at(0, 0) };
    const [leg] = worksheetLegs([a, { label: "L2", center: at(3000, 4000) }], DATE);
    const gm = threeNorths(a.center, DATE).gmAngle;
    expect(leg!.gmAngle).toBeCloseTo(gm, 10);
    expect(leg!.magneticAzimuth).toBeCloseTo((36.8699 - gm + 360) % 360, 3);
    // 5,000 m on the grid; UTM's scale factor here is within 0.05% of 1.
    expect(Math.abs(leg!.distanceMeters / 5000 - 1)).toBeLessThan(0.0005);
  });

  it("chains consecutive stops and leaves magnetic blank outside the model", () => {
    const stops = [0, 1, 2].map((i) => ({ label: `L${i + 1}`, center: at(i * 2000, 0) }));
    const legs = worksheetLegs(stops, DATE);
    expect(legs.map((l) => `${l.from}→${l.to}`)).toEqual(["L1→L2", "L2→L3"]);
    const late = worksheetLegs(stops, new Date(Date.UTC(2031, 0, 1)));
    expect(late[0]!.magneticAzimuth).toBeNull();
    expect(late[0]!.gridAzimuth).toBeCloseTo(90, 3);
    expect(worksheetLegs(stops.slice(0, 1), DATE)).toEqual([]);
  });
});
