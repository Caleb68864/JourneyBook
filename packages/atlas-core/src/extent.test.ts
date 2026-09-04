import { describe, it, expect } from "vitest";
import { enclosingBBox } from "./extent.js";

describe("enclosingBBox", () => {
  it("pads the min/max of the points by 5% of the span (default)", () => {
    const bbox = enclosingBBox([
      { lng: -96.7, lat: 40.8 },
      { lng: -95.9, lat: 41.3 },
    ]);
    // span 0.8 × 0.5 → pad 0.04 × 0.025
    expect(bbox[0]).toBeCloseTo(-96.74, 6);
    expect(bbox[1]).toBeCloseTo(40.775, 6);
    expect(bbox[2]).toBeCloseTo(-95.86, 6);
    expect(bbox[3]).toBeCloseTo(41.325, 6);
  });

  it("gives a single point a usable minimum-sized box", () => {
    const [w, s, e, n] = enclosingBBox([{ lng: -96.7, lat: 40.8 }]);
    expect(e - w).toBeCloseTo(0.04, 6);
    expect(n - s).toBeCloseTo(0.04, 6);
    expect(w).toBeLessThan(e);
    expect(s).toBeLessThan(n);
  });

  it("honours custom padding options", () => {
    const [w, , e] = enclosingBBox([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }], { padFraction: 0.5, minPadDegrees: 0 });
    expect(w).toBeCloseTo(-0.5, 6);
    expect(e).toBeCloseTo(1.5, 6);
  });

  it("clamps padding to the valid lng/lat range", () => {
    const [w, s, e, n] = enclosingBBox([{ lng: -179.99, lat: 89.99 }]);
    expect(w).toBe(-180);
    expect(n).toBe(90);
    expect(e).toBeGreaterThan(w);
    expect(s).toBeLessThan(n);
  });

  it("throws on an empty point list", () => {
    expect(() => enclosingBBox([])).toThrow(/at least one point/);
  });
});
