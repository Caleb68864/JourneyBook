import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decimalYear, magneticField } from "./declination.js";
import { WMM2025_COEFFICIENTS } from "./wmm2025.js";

/**
 * WMM2025 against NOAA's own published test values (`data/wmm/WMM2025_TestValues.txt`, from the
 * official `WMM2025COF.zip`; see `data/wmm/SOURCE.md`). A wrong coefficient, sign or rotation
 * cannot reproduce 100 points spread over the globe, five years and up to 98 km of altitude.
 */

const DATA = (name: string) => fileURLToPath(new URL(`../../../data/wmm/${name}`, import.meta.url));

interface TestValue {
  year: number;
  heightKm: number;
  lat: number;
  lng: number;
  d: number;
  i: number;
  h: number;
  x: number;
  y: number;
  z: number;
  f: number;
  dDdt: number;
}

const values: TestValue[] = readFileSync(DATA("WMM2025_TestValues.txt"), "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => l.trim().split(/\s+/).map(Number))
  .map(([year, heightKm, lat, lng, d, i, h, x, y, z, f, dDdt]) => ({
    year: year!, heightKm: heightKm!, lat: lat!, lng: lng!, d: d!, i: i!, h: h!, x: x!, y: y!, z: z!, f: f!, dDdt: dDdt!,
  }));

describe("WMM2025", () => {
  it("[CONTROL] read all of NOAA's test values", () => {
    expect(values).toHaveLength(100);
  });

  it("[BEHAVIORAL] reproduces every published test value: D and I to 0.01°, X/Y/Z/H/F to 0.1 nT, dD/dt to 0.0001°/yr", () => {
    const misses: string[] = [];
    for (const v of values) {
      const m = magneticField(v.lat, v.lng, v.year, v.heightKm);
      const at = `${v.year} ${v.heightKm}km ${v.lat},${v.lng}`;
      // D and I are published to two decimals, so 0.005 + rounding.
      if (Math.abs(m.declination - v.d) > 0.0051) misses.push(`${at}: D ${m.declination} vs ${v.d}`);
      if (Math.abs(m.inclination - v.i) > 0.0051) misses.push(`${at}: I ${m.inclination} vs ${v.i}`);
      for (const k of ["x", "y", "z", "h", "f"] as const) {
        if (Math.abs(m[k] - v[k]) > 0.1) misses.push(`${at}: ${k} ${m[k]} vs ${v[k]}`);
      }
      if (Math.abs(m.declinationPerYear - v.dDdt) > 1e-4) misses.push(`${at}: dD/dt ${m.declinationPerYear} vs ${v.dDdt}`);
    }
    expect(misses, misses.slice(0, 5).join("\n")).toEqual([]);
  });

  it("the embedded coefficients are exactly the committed .COF", () => {
    const fromFile = readFileSync(DATA("WMM2025.COF"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 6 && /^\d+$/.test(p[0]!))
      .map((p) => p.map(Number));
    expect(fromFile).toHaveLength(90);
    expect(WMM2025_COEFFICIENTS.map((r) => [...r])).toEqual(fromFile);
  });

  it("refuses a date outside 2025.0–2030.0 and a pole, rather than print a stale or undefined value", () => {
    expect(() => magneticField(40.8, -96.7, 2024.99)).toThrow(/valid for 2025\.0 to 2030\.0/);
    expect(() => magneticField(40.8, -96.7, 2030.01)).toThrow(/valid for 2025\.0 to 2030\.0/);
    expect(() => magneticField(90, 0, 2026)).toThrow(/pole/);
  });

  it("decimalYear puts a date where the model expects it", () => {
    expect(decimalYear(new Date(Date.UTC(2026, 0, 1)))).toBe(2026);
    expect(decimalYear(new Date(Date.UTC(2026, 6, 2, 12)))).toBeCloseTo(2026.5, 2);
  });
});
