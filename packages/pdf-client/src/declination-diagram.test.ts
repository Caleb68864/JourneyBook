import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildLocationPage,
  threeNorths,
  type MapTier,
  type PageOrientation,
} from "@journeybook/atlas-core";
import { diagramAngles, northsCaption, renderAtlasPdfToBuffer, type PageNorths } from "./index.js";
import { measurePdfPages, type MeasuredText } from "./pdf-measure.js";

/**
 * Stage 6B Level 4's declination diagram in the tier-4 footer, measured off the PDF: what it
 * says, that only tier 4 draws it, that it says so when there are no figures, and that it fits
 * the footer without running into its neighbours.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;
const LINCOLN = { lng: -96.7, lat: 40.8 };
const MID_2026 = new Date(Date.UTC(2026, 6, 2));
const NORTHS = threeNorths(LINCOLN, MID_2026);

async function footer(tier: MapTier, norths?: PageNorths, orientation: PageOrientation = "portrait"): Promise<MeasuredText[]> {
  const page = buildLocationPage(LINCOLN, usgs, { ...LETTER_PORTRAIT, orientation }, "L1", tier);
  const pdf = await renderAtlasPdfToBuffer({
    contract: { version: 1, scale: usgs, margins: LETTER_PORTRAIT.margins, pages: [page] },
    attribution: "USGS The National Map",
    tableOfContents: false,
    ...(norths ? { norths: { L1: norths } } : {}),
  });
  const pageHeight = orientation === "portrait" ? 792 : 612;
  return measurePdfPages(pdf)[0]!.textItems.filter((t) => t.y > pageHeight - 36 - 40 - 6);
}

/** Helvetica averages about 0.55 em per character; enough to tell neighbours apart. */
const right = (t: MeasuredText) => t.x + t.text.length * t.size * 0.55;

describe("declination diagram", () => {
  it("[BEHAVIORAL] a tier-4 page prints the three norths, the G-M angle and the model", async () => {
    const texts = (await footer(4, NORTHS)).map((t) => t.text);
    const [line1, line2] = northsCaption(NORTHS);
    expect(texts).toContain(line1);
    expect(texts).toContain(line2);
    expect(texts).toContain("Declination diagram not to scale");
    expect(line1).toMatch(/^MN \d+\.\d° [EW] · GN \d+\.\d° [EW] \(UTM 14\) of true N$/);
    expect(line2).toMatch(/^G-M \d+\.\d° [EW] · WMM2025 2026\.5 · /);
  });

  it("[CONTROL] tier 3 draws no diagram even when the figures are there, and keeps its compass", async () => {
    const texts = (await footer(3, NORTHS)).map((t) => t.text);
    expect(texts.some((t) => t.startsWith("MN "))).toBe(false);
    expect(texts).toContain("N");
  });

  it("says why when the model does not cover the date, and draws no diagram", async () => {
    const texts = (await footer(4, { unavailable: "Declination not shown: WMM2025 covers 2025.0 to 2030.0" })).map((t) => t.text);
    expect(texts).toContain("Declination not shown: WMM2025 covers 2025.0 to 2030.0");
    expect(texts.some((t) => t.startsWith("G-M "))).toBe(false);
  });

  for (const orientation of ["portrait", "landscape"] as const) {
    it(`fits the ${orientation} footer: inside the right margin, clear of the print check and the page number`, async () => {
      const items = await footer(4, NORTHS, orientation);
      const caption = items.filter((t) => t.text.startsWith("MN ") || t.text.startsWith("G-M ") || t.text.startsWith("Declination"));
      expect(caption).toHaveLength(3);
      const pageWidth = orientation === "portrait" ? 612 : 792;
      const printCheck = items.find((t) => t.text.startsWith("print resolution"))!;
      const pageNumber = items.find((t) => t.text === "1" && t.size === 11)!;
      for (const t of caption) {
        expect(right(t)).toBeLessThanOrEqual(pageWidth - 36);
        expect(t.x).toBeGreaterThan(right(printCheck));
        expect(right(t)).toBeLessThan(pageNumber.x);
      }
    });
  }
});

describe("diagramAngles", () => {
  it("keeps each north on its true side, the nearer one nearer true north", () => {
    expect(diagramAngles(1.5, 2.5)).toEqual({ grid: 10, magnetic: 24 });
    expect(diagramAngles(1.5, 0.5)).toEqual({ grid: 24, magnetic: 10 });
    expect(diagramAngles(1.5, -8)).toEqual({ grid: 14, magnetic: -14 });
    expect(diagramAngles(-2, -12)).toEqual({ grid: -10, magnetic: -24 });
  });
});

describe("northsCaption on a zone junction", () => {
  it("names both zones' grid north and G-M, west zone first", () => {
    const n = threeNorths({ lng: -102.0001, lat: 40.8 }, MID_2026, 14);
    const [line1, line2] = northsCaption(n);
    expect(line1).toMatch(/^MN \d\.\d° E · GN \d\.\d° E \(13\) \/ \d\.\d° W \(14\) of true N$/);
    expect(line2).toMatch(/^G-M \d\.\d° [EW] \(13\) \/ \d\.\d° [EW] \(14\) · WMM2025 2026\.5$/);
  });
});

describe("review fixes to the footer and worksheet text", () => {
  it("[BEHAVIORAL] the junction caption puts the west zone first in the south too", () => {
    const n = threeNorths({ lng: 6.01, lat: -30 }, MID_2026, 31);
    expect(n.utmZone).toBe(32);
    const [line1, line2] = northsCaption(n);
    expect(line1).toMatch(/GN \d\.\d° [EW] \(31\) \/ \d\.\d° [EW] \(32\)/);
    expect(line2).toMatch(/\(31\) \/ .* \(32\)/);
    // And across the date line: zone 60 is west of zone 1.
    const dateLine = threeNorths({ lng: -179.99, lat: 40 }, MID_2026, 60);
    expect(northsCaption(dateLine)[0]).toMatch(/\(60\) \/ .* \(1\)/);
  });
});
