import { describe, it, expect } from "vitest";
import { LETTER_PORTRAIT, SCALE_PRESETS, buildLocationPage, type WorksheetLeg } from "@journeybook/atlas-core";
import { THREE_NORTHS_LESSON, WORKSHEET_INSTRUCTIONS, formatAzimuth, formatDistance, renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages } from "./pdf-measure.js";

/** The azimuth worksheet and answer key pages, read back off the PDF. */
const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;
const contract = {
  version: 1 as const,
  scale: usgs,
  margins: LETTER_PORTRAIT.margins,
  pages: [buildLocationPage({ lng: -96.7, lat: 40.8 }, usgs, LETTER_PORTRAIT, "L1", 4)],
};
const LEGS: WorksheetLeg[] = [
  { from: "L1 Capitol", to: "L2 Haymarket", gridAzimuth: 36.87, backAzimuth: 216.87, magneticAzimuth: 35.9, gmAngle: 0.97, distanceMeters: 5000, utmZone: 14 },
  { from: "L2 Haymarket", to: "L3 Pioneers", gridAzimuth: 270.4, backAzimuth: 90.4, magneticAzimuth: null, gmAngle: null, distanceMeters: 850, utmZone: 14 },
];

/** Strings on a page with the font's kerning splits joined back up. */
const pageText = (texts: string[]) => texts.join("");

describe("azimuth worksheet pages", () => {
  it("[BEHAVIORAL] a worksheet page with blanks, then an answer key page with the answers", async () => {
    const pages = measurePdfPages(await renderAtlasPdfToBuffer({ contract, tableOfContents: false, worksheet: { legs: LEGS, model: "WMM2025" } }));
    expect(pages).toHaveLength(3);
    const sheet = pageText(pages[1]!.texts);
    const key = pageText(pages[2]!.texts);

    expect(sheet).toContain("WORKSHEET");
    expect(sheet).toContain("Azimuth worksheet");
    // Words, not an arrow: "→" is not in the WinAnsi set the standard fonts print, and vanished.
    expect(pages[1]!.texts).toContain("L1 Capitol to L2 Haymarket");
    // No answers on the worksheet.
    expect(sheet).not.toContain(formatAzimuth(36.87));
    expect(sheet).not.toContain(formatDistance(5000));

    expect(key).toContain("ANSWER KEY");
    expect(key).toContain("magnetic = grid - G-M (WMM2025)");
    for (const value of ["36.9° (back 216.9°)", "35.9°", "5.00 km", "270.4° (back 90.4°)", "850 m", "not available"]) {
      expect(key, value).toContain(value);
    }
  });

  it("[CONTROL] no worksheet, no extra pages; an empty leg list adds none either", async () => {
    expect(measurePdfPages(await renderAtlasPdfToBuffer({ contract, tableOfContents: false }))).toHaveLength(1);
    expect(measurePdfPages(await renderAtlasPdfToBuffer({ contract, tableOfContents: false, worksheet: { legs: [] } }))).toHaveLength(1);
  });

  it("says magnetic = grid − G-M the right way round for east and west", () => {
    const text = WORKSHEET_INSTRUCTIONS.join(" ");
    expect(text).toMatch(/Subtract it if it is east; add it if it is west/);
  });

  /**
   * The three-norths lesson (owner decision 2026-11-22): own words, each paragraph citing
   * FM 3-25.26 (2001), the edition marked "Approved for public release; distribution is
   * unlimited". The current TC 3-25.26 is distribution-restricted and must not be cited.
   */
  it("[BEHAVIORAL] prints the three-norths lesson on the worksheet page, every paragraph cited to FM 3-25.26 (2001)", async () => {
    const pages = measurePdfPages(await renderAtlasPdfToBuffer({ contract, tableOfContents: false, worksheet: { legs: LEGS } }));
    // A citation may wrap across lines; join and collapse the spacing.
    const sheet = pages[1]!.texts.join(" ").replace(/\s+/g, " ");
    expect(sheet).toContain("Three norths");
    expect(THREE_NORTHS_LESSON).toHaveLength(4);
    for (const p of THREE_NORTHS_LESSON) {
      expect(p.cite).toMatch(/^FM 3-25\.26 \(2001\), paras?\. \d-\d/);
      expect(sheet).toContain(p.cite);
    }
    expect(JSON.stringify(THREE_NORTHS_LESSON)).not.toMatch(/TC 3-25\.26/);
    // The answer key does not repeat the lesson.
    expect(pages[2]!.texts.join(" ")).not.toContain("Three norths");
  });
});
