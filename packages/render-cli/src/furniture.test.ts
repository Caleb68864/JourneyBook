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

describe("Stage 6B Level 4 declination through renderAtlas", () => {
  const texts = async (extra: Record<string, unknown>) => {
    const pdf = await renderTo(extra);
    return measurePdfPages(pdf)[0]!.texts;
  };

  it("[BEHAVIORAL] a tier-4 render prints its page's three norths for the declination date", async () => {
    const printed = await texts({ tier: 4, declinationDate: "2026-07-02" });
    expect(printed.some((t) => /^MN \d+\.\d° [EW] · GN \d+\.\d° [EW] \(UTM 14\) of true N$/.test(t))).toBe(true);
    expect(printed.some((t) => /^G-M \d+\.\d° [EW] · WMM2025 2026\.5 · /.test(t))).toBe(true);
  });

  it("[CONTROL] tier 3 prints no declination", async () => {
    const printed = await texts({ tier: 3, declinationDate: "2026-07-02" });
    expect(printed.some((t) => t.startsWith("MN ") || t.startsWith("G-M "))).toBe(false);
  });

  it("a date the model does not cover is printed as such, not extrapolated", async () => {
    const printed = await texts({ tier: 4, declinationDate: "2031-01-01" });
    expect(printed.some((t) => t.startsWith("Declination not shown: WMM2025 is valid for 2025.0 to 2030.0"))).toBe(true);
    expect(printed.some((t) => t.startsWith("G-M "))).toBe(false);
  });

  it("refuses a malformed date, and the CLI flag reaches the engine", async () => {
    await expect(renderTo({ tier: 4, declinationDate: "2026-7-2" })).rejects.toThrow(/must be YYYY-MM-DD/);
    expect(
      inputFromArgs(["--location", "-96.7,40.8", "--scale", "usgs-7-5-min", "--declination-date", "2026-07-02"]),
    ).toMatchObject({ declinationDate: "2026-07-02" });
  });
});
