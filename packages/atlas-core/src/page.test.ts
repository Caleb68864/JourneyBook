import { describe, it, expect } from "vitest";
import { SCALE_PRESETS } from "./index.js";
import {
  LETTER_PORTRAIT,
  PAGE_FURNITURE_PT,
  printableAreaInches,
  mapBoxInches,
  groundFootprintMeters,
  type PageSpec,
} from "./page.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000

describe("printableAreaInches", () => {
  it("Letter portrait with 0.5in margins -> 7.5 x 10 in", () => {
    const area = printableAreaInches(LETTER_PORTRAIT);
    expect(area.widthIn).toBeCloseTo(7.5, 9);
    expect(area.heightIn).toBeCloseTo(10, 9);
  });

  it("landscape swaps the sheet dimensions", () => {
    const landscape: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };
    const area = printableAreaInches(landscape);
    expect(area.widthIn).toBeCloseTo(10, 9);
    expect(area.heightIn).toBeCloseTo(7.5, 9);
  });

  it("a binder gutter is removed from the printable width", () => {
    const guttered: PageSpec = {
      ...LETTER_PORTRAIT,
      margins: { ...LETTER_PORTRAIT.margins, gutter: 0.5 },
    };
    const area = printableAreaInches(guttered);
    expect(area.widthIn).toBeCloseTo(7.0, 9);
    expect(area.heightIn).toBeCloseTo(10, 9);
  });
});

describe("mapBoxInches", () => {
  it("takes the page furniture off the printable area", () => {
    const printable = printableAreaInches(LETTER_PORTRAIT);
    const box = mapBoxInches(LETTER_PORTRAIT);

    // 540pt printable width less 2x(1.5 border + 6 padding) neatline,
    // 2x38pt edge-label columns and 2x1pt panel border = 447pt.
    expect(box.widthIn * 72).toBeCloseTo(447, 9);
    // 720pt printable height less the same neatline, the 30pt header, two 9pt
    // continuation rows, the 66pt notes block, the 40pt footer and the border.
    expect(box.heightIn * 72).toBeCloseTo(549, 9);

    expect(box.widthIn).toBeLessThan(printable.widthIn);
    expect(box.heightIn).toBeLessThan(printable.heightIn);
  });

  it("landscape takes the same furniture off the swapped sheet", () => {
    const landscape: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };
    const box = mapBoxInches(landscape);
    expect(box.widthIn * 72).toBeCloseTo(720 - 93, 9);
    expect(box.heightIn * 72).toBeCloseTo(540 - 171, 9);
  });

  // The furniture override exists so a what-if ("how many pages with no notes
  // block?") is measured through this function instead of a copy of it. These
  // two tests are the pair that keeps it honest: passing the real constants
  // must be indistinguishable from passing nothing, and passing something else
  // must actually move the box. Without the first, the override could quietly
  // change every real render; without the second, it could be ignored entirely
  // and the what-if table would report the baseline for every lever.
  it("passing the renderer's own furniture is the same as passing none", () => {
    const implicit = mapBoxInches(LETTER_PORTRAIT);
    const explicit = mapBoxInches(LETTER_PORTRAIT, { ...PAGE_FURNITURE_PT });
    expect(explicit).toEqual(implicit);
  });

  it("an overridden measurement changes the box by exactly that measurement", () => {
    const base = mapBoxInches(LETTER_PORTRAIT);
    const noNotes = mapBoxInches(LETTER_PORTRAIT, {
      ...PAGE_FURNITURE_PT,
      notesBlock: 0,
    });
    // The notes block is height only, so the width must not move at all.
    expect(noNotes.widthIn).toBeCloseTo(base.widthIn, 9);
    expect((noNotes.heightIn - base.heightIn) * 72).toBeCloseTo(PAGE_FURNITURE_PT.notesBlock, 9);
  });
});

describe("groundFootprintMeters", () => {
  it("measures the printed map box, not the whole printable area", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    const box = mapBoxInches(LETTER_PORTRAIT);

    // 6.2083in x 7.625in of map at 1:24,000.
    expect(fp.widthMeters).toBeCloseTo(3784.6, 3);
    expect(fp.heightMeters).toBeCloseTo(4648.2, 3);

    // The relation that makes the scale bar true: ground metres per printed inch
    // is exactly the scale ratio, measured against the box the map is drawn in.
    expect(fp.widthMeters / box.widthIn / 0.0254).toBeCloseTo(usgs.ratio, 6);
    expect(fp.heightMeters / box.heightIn / 0.0254).toBeCloseTo(usgs.ratio, 6);
  });

  it("is smaller than the printable area would imply — the ~21% print-scale defect", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    const printable = printableAreaInches(LETTER_PORTRAIT);
    const wrong = printable.widthIn * usgs.ratio * 0.0254;
    expect(fp.widthMeters).toBeLessThan(wrong);
    expect(wrong / fp.widthMeters).toBeCloseTo(1.208, 2);
  });
});
