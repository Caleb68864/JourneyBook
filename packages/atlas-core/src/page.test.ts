import { describe, it, expect } from "vitest";
import { SCALE_PRESETS } from "./index.js";
import {
  LETTER_PORTRAIT,
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
    // 2x54pt edge-label columns and 2x1pt panel border = 415pt.
    expect(box.widthIn * 72).toBeCloseTo(415, 9);
    // 720pt printable height less the same neatline, the 30pt header, two 9pt
    // continuation rows, the 66pt notes block, the 40pt footer and the border.
    expect(box.heightIn * 72).toBeCloseTo(549, 9);

    expect(box.widthIn).toBeLessThan(printable.widthIn);
    expect(box.heightIn).toBeLessThan(printable.heightIn);
  });

  it("landscape takes the same furniture off the swapped sheet", () => {
    const landscape: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };
    const box = mapBoxInches(landscape);
    expect(box.widthIn * 72).toBeCloseTo(720 - 125, 9);
    expect(box.heightIn * 72).toBeCloseTo(540 - 171, 9);
  });
});

describe("groundFootprintMeters", () => {
  it("measures the printed map box, not the whole printable area", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    const box = mapBoxInches(LETTER_PORTRAIT);

    // 5.7639in x 7.625in of map at 1:24,000.
    expect(fp.widthMeters).toBeCloseTo(3513.667, 3);
    expect(fp.heightMeters).toBeCloseTo(4648.2, 3);

    // The relation that makes the scale bar true: ground metres per printed inch
    // is exactly the scale ratio, measured against the box the map is drawn in.
    expect(fp.widthMeters / box.widthIn / 0.0254).toBeCloseTo(usgs.ratio, 6);
    expect(fp.heightMeters / box.heightIn / 0.0254).toBeCloseTo(usgs.ratio, 6);
  });

  it("is smaller than the printable area would imply — the ~30% print-scale defect", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    const printable = printableAreaInches(LETTER_PORTRAIT);
    const wrong = printable.widthIn * usgs.ratio * 0.0254;
    expect(fp.widthMeters).toBeLessThan(wrong);
    expect(wrong / fp.widthMeters).toBeCloseTo(1.301, 2);
  });
});
