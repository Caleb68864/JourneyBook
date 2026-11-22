import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildPageGrid,
  type AtlasContract,
} from "@journeybook/atlas-core";
import { CROP_MARK, LOCATOR_INSET_MAX, locatorInsetLayout, renderAtlasPdfToBuffer } from "./index.js";
import { mapBoxOf, measurePdfPages, type MeasuredBox, type MeasuredPage } from "./pdf-measure.js";

/**
 * Stage 1D's last two furniture items, measured off the rendered PDF: crop marks at the map box
 * corners and a grid-locator inset. Both are off by default, and neither may move the map box
 * (the printed scale depends on it), so every test also compares the box with the feature off.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

/** A 2x2 grid (the golden fixture's extent), so the locator has pages to show. */
const contract: AtlasContract = buildPageGrid({
  bbox: [-98.03, 40.97, -97.97, 41.03],
  scale: usgs,
  page: LETTER_PORTRAIT,
  tier: 2,
});

async function render(options: { cropMarks?: boolean; locatorInset?: boolean }): Promise<MeasuredPage[]> {
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: "Journey Book",
    tableOfContents: false,
    referenceGrid: false,
    notes: false,
    ...options,
  });
  return measurePdfPages(pdf);
}

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;

/** The eight tick bars expected round `box`, as boxes (filled, `CROP_MARK.stroke` thick, centred on the edge line). */
function expectedTicks(box: MeasuredBox): MeasuredBox[] {
  const { length, gap, stroke } = CROP_MARK;
  const h = stroke / 2;
  const l = box.x;
  const t = box.y;
  const r = box.x + box.width;
  const b = box.y + box.height;
  return [
    { x: l - gap - length, y: t - h, width: length, height: stroke }, { x: l - h, y: t - gap - length, width: stroke, height: length },
    { x: r + gap, y: t - h, width: length, height: stroke }, { x: r - h, y: t - gap - length, width: stroke, height: length },
    { x: l - gap - length, y: b - h, width: length, height: stroke }, { x: l - h, y: b + gap, width: stroke, height: length },
    { x: r + gap, y: b - h, width: length, height: stroke }, { x: r - h, y: b + gap, width: stroke, height: length },
  ];
}

function hasTick(page: MeasuredPage, tick: MeasuredBox): boolean {
  return page.rects.some((r) => near(r.x, tick.x) && near(r.y, tick.y) && near(r.width, tick.width) && near(r.height, tick.height));
}

describe("crop marks", () => {
  it("[BEHAVIORAL] draws two ticks at each map-box corner, on its edge lines, outside the box", async () => {
    const [on] = await render({ cropMarks: true });
    const box = mapBoxOf(on!, 1)!;
    for (const tick of expectedTicks(box)) {
      expect(hasTick(on!, tick), `missing crop tick at ${tick.x.toFixed(1)},${tick.y.toFixed(1)}`).toBe(true);
    }
    // None of them reaches into the map.
    // None of them reaches into the map: each bar's far side is at most half a stroke inside.
    for (const tick of expectedTicks(box)) {
      const overlapX = Math.min(tick.x + tick.width, box.x + box.width) - Math.max(tick.x, box.x);
      const overlapY = Math.min(tick.y + tick.height, box.y + box.height) - Math.max(tick.y, box.y);
      expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(CROP_MARK.stroke / 2 + 0.01);
    }
  });

  it("[CONTROL] draws none by default, and does not move the map box", async () => {
    const [off] = await render({});
    const [on] = await render({ cropMarks: true });
    const boxOff = mapBoxOf(off!, 1)!;
    const boxOn = mapBoxOf(on!, 1)!;
    expect(boxOn).toEqual(boxOff);
    expect(expectedTicks(boxOff).some((t) => hasTick(off!, t))).toBe(false);
  });
});

describe("grid-locator inset", () => {
  it("lays every page out at the atlas's own proportions, this page marked", () => {
    const layout = locatorInsetLayout(contract.pages, contract.pages[0]!.id, 72, 72)!;
    expect(layout.cells).toHaveLength(contract.pages.length);
    expect(layout.cells.filter((c) => c.current).map((c) => c.id)).toEqual([contract.pages[0]!.id]);
    expect(Math.max(layout.width, layout.height)).toBeCloseTo(72, 6);
    // Cells tile the inset: together they reach its far edges.
    expect(Math.max(...layout.cells.map((c) => c.x + c.width))).toBeCloseTo(layout.width, 6);
    expect(Math.max(...layout.cells.map((c) => c.y + c.height))).toBeCloseTo(layout.height, 6);
    // One page has nothing to locate.
    expect(locatorInsetLayout(contract.pages.slice(0, 1), contract.pages[0]!.id, 72, 72)).toBeNull();
  });

  it("[BEHAVIORAL] draws the atlas in the map's lower-right corner, a rectangle per page, without moving the map box", async () => {
    const off = await render({});
    const on = await render({ locatorInset: true });
    expect(on).toHaveLength(contract.pages.length);
    on.forEach((page, i) => {
      const box = mapBoxOf(page, 1)!;
      expect(box).toEqual(mapBoxOf(off[i]!, 1));
      const layout = locatorInsetLayout(contract.pages, contract.pages[i]!.id, LOCATOR_INSET_MAX.width, LOCATOR_INSET_MAX.height)!;
      // Inset rectangles lie inside the map, within an inch of its lower-right corner.
      const inCorner = page.rects.filter(
        (r) =>
          r.x >= box.x + box.width - 72 - LOCATOR_INSET_MAX.inset - 5 &&
          r.y >= box.y + box.height - 72 - LOCATOR_INSET_MAX.inset - 5 &&
          r.x + r.width <= box.x + box.width + 0.01 &&
          r.y + r.height <= box.y + box.height + 0.01 &&
          r.width < box.width / 2,
      );
      const cells = layout.cells.map((c) => inCorner.find((r) => near(r.width, c.width, 0.1) && near(r.height, c.height, 0.1)));
      expect(cells.every(Boolean), `page ${contract.pages[i]!.id}: a page rectangle is missing from the inset`).toBe(true);
    });
    // Off by default: the corner is clear.
    const box0 = mapBoxOf(off[0]!, 1)!;
    const cell = locatorInsetLayout(contract.pages, contract.pages[0]!.id, 72, 72)!.cells[0]!;
    expect(off[0]!.rects.some((r) => near(r.width, cell.width, 0.1) && near(r.height, cell.height, 0.1) && r.x > box0.x + box0.width / 2)).toBe(false);
  });
});
