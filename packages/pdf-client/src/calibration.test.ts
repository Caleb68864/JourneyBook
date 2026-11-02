import { describe, it, expect } from "vitest";
import { renderCalibrationPdfToBuffer, measurePdfPages, type MeasuredLine, type MeasuredPage } from "./index.js";

/**
 * The target is only worth printing if its rulers are the length they claim, so the
 * lengths are written out here in points and read back off the rendered PDF.
 */

const EPSILON = 0.01;

function horizontalAt(page: MeasuredPage, y: number): MeasuredLine | undefined {
  return page.lines.find((l) => Math.abs(l.y1 - y) < EPSILON && Math.abs(l.y2 - y) < EPSILON && l.x2 - l.x1 > 50);
}

/** Tick x positions rising from a horizontal ruler at `y`, sorted. */
function ticksOn(page: MeasuredPage, y: number): number[] {
  return page.lines
    .filter((l) => Math.abs(l.x1 - l.x2) < EPSILON && Math.abs(Math.max(l.y1, l.y2) - y) < EPSILON)
    .map((l) => l.x1)
    .sort((a, b) => a - b);
}

describe("calibration page", () => {
  it("is one Letter page, with rulers of exactly the stated length", async () => {
    const pages = measurePdfPages(await renderCalibrationPdfToBuffer());
    expect(pages).toHaveLength(1);
    const page = pages[0]!;

    const inches = horizontalAt(page, 214)!;
    expect(inches.x2 - inches.x1).toBeCloseTo(6 * 72, 2);

    const cm = horizontalAt(page, 294)!;
    expect(cm.x2 - cm.x1).toBeCloseTo((15 / 2.54) * 72, 2);

    const vertical = page.lines.find((l) => Math.abs(l.x1 - 540) < EPSILON && Math.abs(l.x2 - 540) < EPSILON)!;
    expect(Math.abs(vertical.y2 - vertical.y1)).toBeCloseTo(8 * 72, 2);

    // The whole of the tall ruler is on the sheet.
    expect(Math.max(vertical.y1, vertical.y2)).toBeLessThan(792);
  });

  it("spaces its ticks evenly: quarter inches, half centimetres", async () => {
    const page = measurePdfPages(await renderCalibrationPdfToBuffer())[0]!;

    const inchTicks = ticksOn(page, 214);
    expect(inchTicks).toHaveLength(6 * 4 + 1);
    inchTicks.forEach((x, i) => expect(x).toBeCloseTo(54 + i * 18, 2));

    const cmTicks = ticksOn(page, 294);
    expect(cmTicks).toHaveLength(15 * 2 + 1);
    cmTicks.forEach((x, i) => expect(x).toBeCloseTo(54 + i * (36 / 2.54), 2));
  });

  it("draws the 2-inch square square", async () => {
    const page = measurePdfPages(await renderCalibrationPdfToBuffer())[0]!;
    const found = page.rects.find(
      (r) => Math.abs(r.width - 144) < EPSILON && Math.abs(r.height - 144) < EPSILON,
    );
    expect(found).toBeDefined();
  });

  it("tells the reader how to use it", async () => {
    const text = measurePdfPages(await renderCalibrationPdfToBuffer())[0]!.texts.join(" ");
    expect(text).toMatch(/Actual size/);
  });
});
