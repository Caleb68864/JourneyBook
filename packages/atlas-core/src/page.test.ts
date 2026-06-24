import { describe, it, expect } from "vitest";
import { SCALE_PRESETS } from "./index.js";
import {
  LETTER_PORTRAIT,
  printableAreaInches,
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

describe("groundFootprintMeters", () => {
  it("Letter portrait at 1:24,000 -> 4572 x 6096 m", () => {
    const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
    expect(fp.widthMeters).toBeCloseTo(4572, 3);
    expect(fp.heightMeters).toBeCloseTo(6096, 3);
  });
});
