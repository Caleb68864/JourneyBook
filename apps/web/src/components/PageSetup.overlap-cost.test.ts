import { describe, it, expect } from "vitest";
import { LETTER_PORTRAIT, SCALE_PRESETS, createProjector, pageGridSize, type BBox } from "@journeybook/atlas-core";
import { OVERLAP_STEP_COST, OVERLAP_STEPS } from "./PageSetup";

/**
 * `OVERLAP_STEP_COST` is what the overlap select tells a user each step costs.
 * Three hand-quoted overlap figures have already drifted in this project
 * (+10.3%, +10.5%, +11.1% for one sweep), so the table is re-measured here, by
 * the engine, the way the roadmap's sweep is defined: `pageGridSize` at
 * 1:24,000 on Letter portrait, square extents (in the page-centred projection)
 * about 41°N / 98°W, every size from 5 to 60 km at 0.1 km, each counted at 0%
 * and at the step. A change to the engine's geometry that moves any figure fails
 * here instead of leaving the control quoting a number nobody measured.
 */
describe("the overlap cost the control quotes is what the engine measures", () => {
  const scale = SCALE_PRESETS.find((s) => s.ratio === 24000)!;
  const projector = createProjector({ lng: -98, lat: 41 });
  const square = (km: number): BBox => {
    const h = (km * 1000) / 2;
    const c = [[-h, -h], [-h, h], [h, -h], [h, h]].map(([x, y]) => projector.inverse([x!, y!]));
    return [
      Math.min(...c.map((p) => p.lng)),
      Math.min(...c.map((p) => p.lat)),
      Math.max(...c.map((p) => p.lng)),
      Math.max(...c.map((p) => p.lat)),
    ];
  };
  const sizes: number[] = [];
  for (let tenths = 50; tenths <= 600; tenths++) sizes.push(tenths / 10);
  const boxes = sizes.map(square);
  const pages = (bbox: BBox, overlap: number) =>
    pageGridSize({ bbox, scale, page: LETTER_PORTRAIT, overlap }).pages;
  const base = boxes.map((b) => pages(b, 0));

  for (const step of OVERLAP_STEPS.filter((s) => s > 0)) {
    it(`${Math.round(step * 100)}% overlap`, () => {
      const withStep = boxes.map((b) => pages(b, step));
      const total0 = base.reduce((a, b) => a + b, 0);
      const total1 = withStep.reduce((a, b) => a + b, 0);
      const worst = Math.max(...withStep.map((p, i) => (p - base[i]!) / base[i]!));
      const free = withStep.filter((p, i) => p === base[i]).length / boxes.length;

      expect({
        average: Math.round((total1 / total0 - 1) * 100),
        worst: Math.round(worst * 100),
        free: Math.round(free * 100),
      }).toEqual(OVERLAP_STEP_COST[step]);
    });
  }
});
