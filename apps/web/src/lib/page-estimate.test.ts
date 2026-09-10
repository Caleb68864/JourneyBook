import { describe, it, expect } from "vitest";
import { MAX_ATLAS_PAGES, SCALE_PRESETS, type BBox } from "@journeybook/atlas-core";
import { estimatePages } from "./page-estimate";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000

/** A small box near Grand Island, NE — well inside the cap. */
const SMALL: BBox = [-98.03, 40.97, -97.97, 41.03];
/** Three degrees square: the box the scan's user drew and got no warning for. */
const HUGE: BBox = [-99.5, 40.0, -96.5, 43.0];

describe("estimatePages", () => {
  it("has no answer until there is both a box and a scale", () => {
    expect(estimatePages(null, usgs)).toMatchObject({ pages: null, overLimit: false });
    expect(estimatePages(SMALL, null)).toMatchObject({ pages: null, overLimit: false });
  });

  it("counts a normal box, and does not call it over the limit", () => {
    const estimate = estimatePages(SMALL, usgs);
    expect(estimate.pages).toBe(4);
    expect(estimate.columns).toBe(2);
    expect(estimate.rows).toBe(2);
    expect(estimate.overLimit).toBe(false);
  });

  /**
   * The regression this module exists for. The editor asked `buildPageGrid` for
   * the count and caught the throw, but `buildPageGrid` throws EXACTLY when the
   * count would exceed the cap — so the catch swallowed the only case the flag
   * tested for, and `overLimit` was provably always false. Every consequence (the
   * estimate line, "Too Large", the disabled Generate button, the ⚠ banner) was
   * unreachable code that `docs/decisions.md` recorded as verified live.
   */
  it("[BEHAVIORAL] still reports a number for a box that is over the cap", () => {
    const estimate = estimatePages(HUGE, usgs);

    expect(estimate.pages).not.toBeNull();
    expect(estimate.pages!).toBeGreaterThan(MAX_ATLAS_PAGES);
    expect(estimate.overLimit).toBe(true);
    // A warning that can say "≈ 5,256 pages (73 x 72)" is worth more than one
    // that can only say "too big", so the shape has to survive too.
    expect(estimate.columns! * estimate.rows!).toBe(estimate.pages);
  });

  it("[BEHAVIORAL] a box can cross the limit purely by gaining overlap", () => {
    // Overlap shrinks the step, so it is a lever on the page count in its own
    // right — the estimate has to take the project's value, not assume 0.
    const box: BBox = [-98.15, 40.85, -97.85, 41.15]; // 0.3° square
    const without = estimatePages(box, usgs, 0);
    const heavy = estimatePages(box, usgs, 0.5);

    expect(without.pages).toBe(64);
    expect(without.overLimit).toBe(false);
    expect(heavy.pages).toBe(225);
    expect(heavy.overLimit).toBe(true);
  });
});
