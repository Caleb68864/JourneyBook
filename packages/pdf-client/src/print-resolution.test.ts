import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  PAGE_FURNITURE_PT as FURNITURE,
  POINTS_PER_INCH as PT,
  SCALE_PRESETS,
  buildLocationPage,
  type AtlasContract,
  type AtlasPage,
  type MapTier,
  type PageOrientation,
  type UsngGridOverlay,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages, type MeasuredPage } from "./pdf-measure.js";

/**
 * The page says what it printed at.
 *
 * The scale picker says what a preset *would* deliver and the render history
 * says what a finished atlas *did* deliver, but the sheet someone actually
 * navigates from — months later, detached from the app that made it — said
 * nothing about its own print resolution. It now carries one line, measured per
 * page during the render.
 *
 * These tests read that line back OFF THE PRODUCED PDF, with its baseline, and
 * not out of the React tree. The footer is a FIXED 40 pt row (`footerRow`), and
 * a fixed-height row in @react-pdf does not fail when its content outgrows it —
 * the content is simply painted outside the row, or clipped, with nothing
 * anywhere going red. The only assertion that catches that is the one that reads
 * where the glyphs landed, which is why every case below checks the whole
 * footer, at more than one page geometry, and with an attribution long enough to
 * wrap.
 *
 * The map box must not move: page furniture is subtracted from the printable
 * area to size it, and delivery is quantised by tile zoom, so a few points of
 * extra furniture can HALVE the printed resolution at some latitudes. This line
 * therefore lives INSIDE the existing 40 pt budget — `scale-fidelity.test.ts`
 * measures the box itself, and `pnpm check:print-resolution` / `check:page-count`
 * hold the generated tables that depend on it.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

/** A 4x4 flat-colour PNG — enough for react-pdf to place a real image XObject. */
const PANEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4cWkLHDEQxwEAwGEk4Xek1H0AAAAASUVORK5CYII=";

/**
 * A credit line long enough to wrap the attribution onto a THIRD line.
 *
 * The tile proxy joins every source a render actually drew from with " · ", so a
 * multi-source render really does produce a credit this long, and the credit is
 * the one thing in the footer whose length a caller controls. Three lines is the
 * length that matters: at 6 pt over the 280 pt credit column, three wrapped
 * lines plus the scale bar all but fill the fixed 40 pt row, so anything stacked
 * on top of them is pushed out of it. That is measured, not assumed — stacking
 * the resolution line on this column and re-running this file fails the
 * geometry cases below, which is what makes them a control rather than decoration.
 */
const LONG_ATTRIBUTION =
  "© OpenStreetMap contributors · USGS The National Map · Esri World Imagery · " +
  "NOAA Office of Coast Survey nautical charts · State of Nebraska GIS · " +
  "Lancaster County Assessor parcels · USDA NAIP imagery";

/** A tier-3 overlay, so the footer also carries the USNG collar badge. */
const GRID: UsngGridOverlay = {
  lines: [{ x1: 0.25, y1: 0, x2: 0.25, y2: 1, axis: "easting" }],
  labels: [{ x: 0.25, y: 0, text: "0788000", edge: "top" }],
  collar: { zoneDesignator: "14T", hundredKmSquare: "MK" },
};

interface Options {
  tier?: MapTier;
  orientation?: PageOrientation;
  attribution?: string;
  /** Draw a basemap panel for the page. Default true. */
  withPanel?: boolean;
  /** Per-page delivered resolution, as `render-cli` measured it. */
  printDpi?: Record<string, number>;
  grid?: boolean;
}

/** The fixed footer row's vertical band on the sheet, in top-down page points. */
function footerBand(orientation: PageOrientation) {
  const sheetHeightIn = orientation === "landscape" ? LETTER_PORTRAIT.widthIn : LETTER_PORTRAIT.heightIn;
  const bottom =
    sheetHeightIn * PT -
    LETTER_PORTRAIT.margins.bottom * PT -
    FURNITURE.neatlineBorder -
    FURNITURE.neatlinePadding;
  return { top: bottom - FURNITURE.footerRow, bottom };
}

/**
 * The text lines painted on a page, in layout order.
 *
 * @react-pdf splits one `<Text>` into several show operations, so a line has to
 * be reassembled from the runs that share a baseline. Sharing a baseline is not
 * enough on its own: the footer is a row, so the credit line's last wrapped line
 * and the resolution caption in the next column are painted on the SAME
 * baseline. Runs are therefore also required to be horizontally adjacent, which
 * keeps the columns apart — and still joins a caption that wrapped onto a second
 * baseline into two separate lines, which is the failure this is for.
 */
interface PaintedLine {
  text: string;
  /** Left edge, in points from the left of the sheet. */
  x: number;
  /** Baseline, measured down from the top of the sheet. */
  y: number;
  /** Font size in points — with the baseline, the line's vertical extent. */
  size: number;
}

/** Generous lower bound on a run's printed width, for spotting a column gap. */
function runWidth(text: string, size: number): number {
  return text.length * size * 0.45;
}

function paintedLines(measured: MeasuredPage): PaintedLine[] {
  const byBaseline = new Map<string, { x: number; y: number; size: number; text: string }[]>();
  for (const item of measured.textItems) {
    const key = item.y.toFixed(3);
    const runs = byBaseline.get(key) ?? [];
    runs.push({ x: item.x, y: item.y, size: item.size, text: item.text });
    byBaseline.set(key, runs);
  }

  const lines: PaintedLine[] = [];
  for (const runs of byBaseline.values()) {
    runs.sort((a, b) => a.x - b.x);
    let current: PaintedLine | null = null;
    let end = 0;
    for (const run of runs) {
      if (current && run.x - end < 10) {
        current.text += run.text;
        current.size = Math.max(current.size, run.size);
      } else {
        current = { text: run.text, x: run.x, y: run.y, size: run.size };
        lines.push(current);
      }
      end = run.x + runWidth(run.text, run.size);
    }
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

async function renderOne(options: Options = {}) {
  const orientation = options.orientation ?? "portrait";
  const spec = { ...LETTER_PORTRAIT, orientation };
  const tier = options.tier ?? 2;
  const page: AtlasPage = buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, spec, "L1", tier);
  const contract: AtlasContract = {
    version: 1,
    scale: usgs,
    margins: LETTER_PORTRAIT.margins,
    pages: [page],
  };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: "Journey Book",
    ...(options.withPanel === false ? {} : { panels: { L1: PANEL_PNG } }),
    ...(options.attribution ? { attribution: options.attribution } : {}),
    ...(options.printDpi ? { printDpi: options.printDpi } : {}),
    ...(options.grid ? { grids: { L1: GRID } } : {}),
    tableOfContents: false,
    referenceGrid: false,
    notes: true,
  });
  const measured = measurePdfPages(pdf);
  expect(measured).toHaveLength(1);
  return { measured: measured[0]!, lines: paintedLines(measured[0]!), band: footerBand(orientation) };
}

/** The one line the page carries about its own resolution. */
function resolutionLine(lines: PaintedLine[]): PaintedLine {
  const found = lines.filter((l) => l.text.includes("print resolution"));
  expect(found, "no print-resolution line on the page").toHaveLength(1);
  return found[0]!;
}

/**
 * Assert a painted line sits wholly inside the fixed footer row.
 *
 * The extent checked is [baseline - size, baseline]: the em box of the line. A
 * line pushed out of the top of the row by something above it, or dropped below
 * the neatline, fails here — which is the whole point, because @react-pdf will
 * paint it either way without complaint.
 */
function expectInsideFooter(line: PaintedLine, band: { top: number; bottom: number }, what: string) {
  expect(line.y, `${what}: baseline below the footer row`).toBeLessThanOrEqual(band.bottom + 0.01);
  expect(line.y - line.size, `${what}: pushed above the footer row`).toBeGreaterThanOrEqual(band.top - 0.01);
}

/**
 * The scale bar's own drawn box: a 6 pt-tall bar inside a 7 pt-tall SVG box at
 * the same origin and width. The same signature `scale-fidelity.test.ts` uses —
 * the compass, the calibration tick and the grid labels all differ.
 */
function scaleBarBox(measured: MeasuredPage) {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const bar = measured.rects.filter((r) => near(r.height, 6));
  const found = bar.find((b) =>
    measured.rects.some(
      (svg) => near(svg.height, 7) && near(svg.x, b.x) && near(svg.y, b.y) && near(svg.width, b.width),
    ),
  );
  expect(found, "no scale bar found on the rendered page").toBeDefined();
  return found!;
}

/** The 1-inch calibration rule: the horizontal 72 pt segment in the footer. */
function calibrationRule(measured: MeasuredPage) {
  const found = measured.lines.find(
    (l) => Math.abs(l.y1 - l.y2) < 0.01 && Math.abs(Math.abs(l.x2 - l.x1) - PT) < 0.01,
  );
  expect(found, "no 1-inch calibration rule found on the rendered page").toBeDefined();
  return found!;
}

/**
 * Assert a DRAWN box sits wholly inside the fixed footer row.
 *
 * Text alone is not enough of a control. Stacking the resolution line on top of
 * the credit column and rendering a three-line credit pushes the scale bar's
 * *rectangle* 2.1 pt above the top of the row while every label in the column is
 * still inside it — so a control that only reads strings passes a footer whose
 * navigational instrument has left the furniture budget.
 */
function expectBoxInsideFooter(
  box: { y: number; height: number },
  band: { top: number; bottom: number },
  what: string,
) {
  expect(box.y, `${what}: pushed above the footer row`).toBeGreaterThanOrEqual(band.top - 0.01);
  expect(box.y + box.height, `${what}: hangs below the footer row`).toBeLessThanOrEqual(band.bottom + 0.01);
}

/**
 * Every other thing the footer already carried. This is the control that catches
 * the new line having shoved something else out of the fixed row: a scale bar's
 * end labels, the credit line, the calibration tick's caption, the USNG collar
 * and the page number all have to still be painted, and still be inside.
 */
function expectFooterFurnitureIntact(
  lines: PaintedLine[],
  band: { top: number; bottom: number },
  expectations: { attribution: string; collar?: boolean },
) {
  const inFooter = lines.filter((l) => l.y > band.top - 20 && l.y <= band.bottom + 0.01);
  const find = (what: string, match: (l: PaintedLine) => boolean) => {
    const hit = inFooter.filter(match);
    expect(hit.length, `${what} missing from the footer`).toBeGreaterThan(0);
    for (const line of hit) expectInsideFooter(line, band, what);
    return hit;
  };

  // The scale bar's two end labels, painted on one baseline at either end of the bar.
  find("scale bar zero label", (l) => l.text === "0" && l.size < 9);
  find("scale bar distance label", (l) => /^[\d.]+\s*(km|mi|ft|m)$/.test(l.text));
  // The calibration tick's caption.
  find("calibration tick caption", (l) => l.text.includes("in · print check"));
  // The credit for the tiles actually used — every wrapped line of it.
  const creditWords = expectations.attribution.split(" ").filter((w) => w.length > 4);
  for (const word of creditWords.slice(0, 3)) {
    find(`credit word "${word}"`, (l) => l.text.includes(word));
  }
  find("product name", (l) => l.text.includes("Journey Book"));
  // The physical page number.
  find("page number", (l) => l.text.trim() === "1" && l.size >= 10);
  if (expectations.collar) find("USNG collar", (l) => l.text.includes("USNG"));
}

describe("the printed page states its own print resolution", () => {
  it("prints the resolution this page was measured at during the render", async () => {
    const { lines, band } = await renderOne({ printDpi: { L1: 338.4 }, attribution: "USGS The National Map" });
    const line = resolutionLine(lines);
    expect(line.text).toBe("print resolution · 338 dpi");
    expectInsideFooter(line, band, "print-resolution line");
  });

  it("states each page's own figure, not the atlas's", async () => {
    // A zoom ladder puts two scales in one book, and the pages print at very
    // different resolutions. Each sheet has to carry the one it was drawn at.
    const spec = LETTER_PORTRAIT;
    const pages: AtlasPage[] = [
      buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, spec, "L1a", 2),
      buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, spec, "L1b", 2),
    ];
    const pdf = await renderAtlasPdfToBuffer({
      contract: { version: 1, scale: usgs, margins: spec.margins, pages },
      title: "Journey Book",
      panels: { L1a: PANEL_PNG, L1b: PANEL_PNG },
      printDpi: { L1a: 169.2, L1b: 338.4 },
      attribution: "USGS The National Map",
      tableOfContents: false,
      referenceGrid: false,
      notes: true,
    });
    const measured = measurePdfPages(pdf);
    expect(measured).toHaveLength(2);

    // Each sheet is identified by the page id IT prints in its own header
    // (`styles.pageId`, the only 16 pt text on an atlas page), not by its
    // position in the returned array. The claim is "this page states its own
    // figure", and pairing the two off the same sheet says exactly that — where
    // an index would only say the two figures came back in some order. These
    // two pages are identical apart from the id and the DPI, which is what made
    // an index-based version of this test pass on one CI run and fail the next
    // before `measurePdfPages` returned document order.
    const byPageId = new Map(
      measured.map((page) => {
        const id = page.textItems.find((t) => t.size >= 15)?.text;
        expect(id, "no page id in the header of a measured page").toBeDefined();
        return [id!, resolutionLine(paintedLines(page)).text];
      }),
    );
    expect(byPageId.get("L1a")).toBe("print resolution · 169 dpi");
    expect(byPageId.get("L1b")).toBe("print resolution · 338 dpi");
  });

  it("says no basemap was drawn rather than printing a number", async () => {
    const { lines, band } = await renderOne({ withPanel: false });
    const line = resolutionLine(lines);
    expect(line.text).toBe("print resolution · no basemap drawn");
    // Not a figure, and not silence: the two are different facts.
    expect(line.text).not.toMatch(/\d/);
    expectInsideFooter(line, band, "print-resolution line");
  });

  it("says the figure was not recorded when a basemap was drawn but not measured", async () => {
    // Distinct from "no basemap drawn": there IS a map on this sheet, and what is
    // missing is the measurement. The render history keeps these apart
    // (`no-basemap` vs `not-recorded`); so does the page.
    const { lines, band } = await renderOne({ attribution: "USGS The National Map" });
    const line = resolutionLine(lines);
    expect(line.text).toBe("print resolution · not recorded");
    expect(line.text).not.toMatch(/\d/);
    expectInsideFooter(line, band, "print-resolution line");
  });

  it("rounds to whole DPI, the way the render history does", async () => {
    const { lines } = await renderOne({ printDpi: { L1: 299.5 } });
    expect(resolutionLine(lines).text).toBe("print resolution · 300 dpi");
  });

  it("refuses to print a figure that is not a positive number", async () => {
    for (const bad of [0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { lines } = await renderOne({ printDpi: { L1: bad } });
      expect(resolutionLine(lines).text, `for ${String(bad)}`).toBe("print resolution · not recorded");
    }
  });
});

describe("the footer row still holds everything it held before", () => {
  const geometries: { name: string; options: Options }[] = [
    {
      name: "portrait, tier 2, short credit",
      options: { printDpi: { L1: 338.4 }, attribution: "USGS The National Map" },
    },
    {
      name: "landscape, tier 2, short credit",
      options: { orientation: "landscape", printDpi: { L1: 338.4 }, attribution: "USGS The National Map" },
    },
    {
      name: "portrait, tier 3 with a USNG collar, long wrapping credit",
      options: { tier: 3, grid: true, printDpi: { L1: 169.2 }, attribution: LONG_ATTRIBUTION },
    },
    {
      name: "landscape, tier 3 with a USNG collar, long wrapping credit",
      options: {
        orientation: "landscape",
        tier: 3,
        grid: true,
        printDpi: { L1: 169.2 },
        attribution: LONG_ATTRIBUTION,
      },
    },
    {
      name: "portrait, tier 1 (no scale bar, no compass), long wrapping credit",
      options: { tier: 1, printDpi: { L1: 338.4 }, attribution: LONG_ATTRIBUTION },
    },
  ];

  for (const { name, options } of geometries) {
    it(`keeps the whole footer inside the fixed 40 pt row — ${name}`, async () => {
      const { measured, lines, band } = await renderOne(options);

      // The new line first: present, one line (not wrapped), and inside.
      const line = resolutionLine(lines);
      expectInsideFooter(line, band, "print-resolution line");

      // The drawn furniture, which no text assertion can see leave the row.
      expectBoxInsideFooter({ y: calibrationRule(measured).y1, height: 0 }, band, "calibration rule");
      if (options.tier !== 1) {
        expectBoxInsideFooter(scaleBarBox(measured), band, "scale bar");
      }

      // Then everything that was there before it.
      const attribution = options.attribution!;
      if (options.tier !== 1) {
        expectFooterFurnitureIntact(lines, band, {
          attribution,
          ...(options.grid ? { collar: true } : {}),
        });
      } else {
        // Tier 1 draws no scale bar and no compass; the credit, the tick and the
        // page number are still the page's own furniture.
        for (const word of attribution.split(" ").filter((w) => w.length > 4).slice(0, 3)) {
          const hit = lines.filter((l) => l.text.includes(word));
          expect(hit.length, `credit word "${word}" missing`).toBeGreaterThan(0);
          for (const l of hit) expectInsideFooter(l, band, `credit word "${word}"`);
        }
        const tick = lines.filter((l) => l.text.includes("in · print check"));
        expect(tick).toHaveLength(1);
        expectInsideFooter(tick[0]!, band, "calibration tick caption");
      }

      // And nothing at all was painted below the neatline, which is where
      // overflow out of the bottom of a fixed row would land.
      for (const l of lines) {
        expect(l.y, `a line escaped below the neatline: ${JSON.stringify(l.text)}`)
          .toBeLessThanOrEqual(band.bottom + 0.01);
      }
    });
  }
});
