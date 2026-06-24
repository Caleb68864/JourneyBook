import { describe, it, expect } from "vitest";
import { SCALE_PRESETS } from "./index.js";
import { METERS_PER_INCH, metersPerInch, scaleBarGroundMeters, niceScaleBar } from "./scale.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000

describe("scale primitives", () => {
  it("uses the exact inch definition (0.0254 m)", () => {
    expect(METERS_PER_INCH).toBe(0.0254);
  });

  it("metersPerInch = ratio * 0.0254 (1:24,000 -> 609.6 m/in)", () => {
    expect(metersPerInch(usgs)).toBeCloseTo(609.6, 6);
  });

  it("scaleBarGroundMeters scales linearly (2 in at 1:24,000 -> 1219.2 m)", () => {
    expect(scaleBarGroundMeters(usgs, 2)).toBeCloseTo(1219.2, 6);
  });
});

describe("niceScaleBar", () => {
  it("picks the largest round distance fitting the max width (1:24,000)", () => {
    const bar = niceScaleBar(usgs, 3); // max 3in -> 1828.8 m
    expect(bar.groundMeters).toBe(1000);
    expect(bar.label).toBe("1 km");
    expect(bar.inches).toBeCloseTo(1.6404, 3);
  });

  it("labels sub-kilometre bars in metres", () => {
    const bar = niceScaleBar(usgs, 0.9); // max ~548 m -> 500 m
    expect(bar.groundMeters).toBe(500);
    expect(bar.label).toBe("500 m");
  });
});
