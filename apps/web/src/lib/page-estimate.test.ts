import { describe, it, expect } from "vitest";
import { LETTER_PORTRAIT, MAX_ATLAS_PAGES, SCALE_PRESETS, type BBox } from "@journeybook/atlas-core";
import { estimatePages, toPageSpec } from "./page-estimate";

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

  /**
   * The page setup is a lever on the page count too, and until there was a
   * control for it this function ignored it outright — Letter portrait,
   * hardcoded, with a TODO saying so.
   *
   * Now that orientation, margins and the gutter are reachable in the app, an
   * estimate that still assumed portrait would report the page count of a layout
   * the user is not asking for — and that number gates Confirm Box and Generate.
   * A control whose consequence the app cannot see is the half-wired kind.
   */
  describe("the project's page setup, not Letter portrait", () => {
    const BOX: BBox = [-98.1, 40.9, -97.9, 41.1];

    it("[BEHAVIORAL] landscape tiles a box differently from portrait", () => {
      const portrait = estimatePages(BOX, usgs, 0, toPageSpec({ orientation: "Portrait" }));
      const landscape = estimatePages(BOX, usgs, 0, toPageSpec({ orientation: "Landscape" }));

      expect(portrait.pages).not.toBeNull();
      expect(landscape.pages).not.toBeNull();
      // Same ground, rotated sheet: the grid shape must change. If these are
      // equal the spec never reached `pageGridSize`.
      expect([landscape.columns, landscape.rows]).not.toEqual([portrait.columns, portrait.rows]);
    });

    it("[BEHAVIORAL] wider margins cost pages, because the map box shrinks", () => {
      const tight = estimatePages(
        BOX, usgs, 0,
        toPageSpec({ margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25, gutter: 0 } }),
      );
      const wide = estimatePages(
        BOX, usgs, 0,
        toPageSpec({ margins: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5, gutter: 0 } }),
      );

      expect(wide.pages!).toBeGreaterThan(tight.pages!);
    });

    it("[BEHAVIORAL] a binder gutter costs pages on its own", () => {
      const none = estimatePages(BOX, usgs, 0, toPageSpec({ margins: { gutter: 0 } }));
      const bound = estimatePages(BOX, usgs, 0, toPageSpec({ margins: { gutter: 1 } }));

      expect(bound.pages!).toBeGreaterThan(none.pages!);
    });

    /**
     * [CONTROL] The default must not have moved. Every caller that passes no
     * spec, and every existing assertion above, depends on this still being
     * Letter portrait with the engine's default margins.
     */
    it("[CONTROL] defaults to Letter portrait when no setup is given", () => {
      // `gutter` is spelled out here and left implicit in the engine's own
      // constant; 0 is what `printableAreaInches` reads either way, and the
      // estimate below is the assertion that actually matters.
      expect(toPageSpec(null)).toEqual({ ...LETTER_PORTRAIT, margins: { ...LETTER_PORTRAIT.margins, gutter: 0 } });
      expect(toPageSpec({})).toEqual(toPageSpec(null));
      expect(estimatePages(BOX, usgs, 0)).toEqual(
        estimatePages(BOX, usgs, 0, LETTER_PORTRAIT),
      );
      expect(estimatePages(BOX, usgs, 0)).toEqual(
        estimatePages(BOX, usgs, 0, toPageSpec(null)),
      );
    });

    /**
     * [CONTROL] The API serialises its `PageOrientation` enum as
     * "Portrait"/"Landscape"; the engine's union is lower-case. A comparison that
     * forgot that is the bug that used to print every landscape project portrait.
     */
    it("[CONTROL] reads the API's capitalised orientation", () => {
      expect(toPageSpec({ orientation: "Landscape" }).orientation).toBe("landscape");
      expect(toPageSpec({ orientation: "landscape" }).orientation).toBe("landscape");
      expect(toPageSpec({ orientation: "Portrait" }).orientation).toBe("portrait");
      expect(toPageSpec({ orientation: null }).orientation).toBe("portrait");
    });
  });
});
