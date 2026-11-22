import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CROP_MARK, mapBoxOf, measurePdfPages } from "@journeybook/pdf-client";
import { renderAtlas } from "./render.js";
import { inputFromArgs } from "./cli.js";

/**
 * Stage 1D's crop marks and locator inset reach the printed file through the engine, and the
 * CLI flags reach the engine. `pdf-client`'s own tests draw them; this is the hop before that,
 * the one a new renderer option is usually lost on.
 */

/** Whether a page carries a horizontal crop tick off the map box's top-left corner. */
function hasTopLeftTick(pdf: Buffer): boolean {
  const page = measurePdfPages(pdf)[0]!;
  const box = mapBoxOf(page, 1)!;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  return page.rects.some(
    (r) => near(r.x, box.x - CROP_MARK.gap - CROP_MARK.length) && near(r.y, box.y - CROP_MARK.stroke / 2) && near(r.width, CROP_MARK.length),
  );
}

async function renderTo(extra: Record<string, unknown>): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "jb-furniture-"));
  try {
    const out = join(dir, "a.pdf");
    await renderAtlas({
      mode: "location",
      center: { lng: -96.7, lat: 40.8 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      outputPath: out,
      ...extra,
    });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Stage 1D furniture through renderAtlas", () => {
  it("[BEHAVIORAL] cropMarks: true prints the crop ticks; the default prints none", async () => {
    expect(hasTopLeftTick(await renderTo({ cropMarks: true }))).toBe(true);
    expect(hasTopLeftTick(await renderTo({}))).toBe(false);
  });

  it("the CLI flags set the engine options, and leave them off without the flags", () => {
    const base = ["--location", "-96.7,40.8", "--scale", "usgs-7-5-min"];
    expect(inputFromArgs([...base, "--crop-marks", "--locator-inset"])).toMatchObject({ cropMarks: true, locatorInset: true });
    const plain = inputFromArgs(base) as Record<string, unknown>;
    expect(plain["cropMarks"]).toBeUndefined();
    expect(plain["locatorInset"]).toBeUndefined();
  });
});
