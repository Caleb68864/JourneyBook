import { describe, it, expect } from "vitest";
import { SCALE_PRESETS, type BBox, type LngLat } from "./index.js";
import { LETTER_PORTRAIT, groundFootprintMeters } from "./page.js";
import { createProjector } from "./projection.js";
import { buildPageGrid } from "./grid.js";
import { validateAtlas, effectiveDpi } from "./validation.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

function bboxAround(center: LngLat, widthMul: number, heightMul: number): BBox {
  const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
  const p = createProjector(center);
  const [cx, cy] = p.forward(center);
  const sw = p.inverse([cx - (fp.widthMeters * widthMul) / 2, cy - (fp.heightMeters * heightMul) / 2]);
  const ne = p.inverse([cx + (fp.widthMeters * widthMul) / 2, cy + (fp.heightMeters * heightMul) / 2]);
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

const center: LngLat = { lng: -98, lat: 41 };

describe("validateAtlas", () => {
  it("passes a well-formed page grid", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid);
    expect(report.pass).toBe(true);
    expect(report.checks.find((c) => c.name === "scale-consistency")!.pass).toBe(true);
    expect(report.checks.find((c) => c.name === "neighbor-reciprocity")!.pass).toBe(true);
  });

  it("flags a page whose footprint does not match the scale (false scale bar)", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const tampered = structuredClone(grid);
    // Stretch one page's east edge by ~0.1° → wrong ground footprint.
    tampered.pages[0]!.bbox[2] += 0.1;

    const report = validateAtlas(tampered);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name === "scale-consistency")!.pass).toBe(false);
  });

  it("flags a non-reciprocal / dangling neighbor reference", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const tampered = structuredClone(grid);
    tampered.pages[0]!.neighbors.east = "Z9"; // does not exist

    const report = validateAtlas(tampered);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name === "neighbor-reciprocity")!.pass).toBe(false);
  });
});

describe("effectiveDpi", () => {
  it("is panel pixels divided by printable inches", () => {
    expect(effectiveDpi(1125, 7.5)).toBeCloseTo(150, 6);
  });
});
