import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARGINS,
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildLocationPage,
  type AtlasContract,
  type AtlasOverview,
} from "@journeybook/atlas-core";
import { overviewPageLabels } from "./AtlasDocument.js";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages, type MeasuredPage } from "./pdf-measure.js";

/**
 * The overview page, measured off the PDF like every other page.
 *
 * `OverlaySvg` — whose viewBox IS the map box, precisely because react-pdf
 * defaults to `preserveAspectRatio="meet"` and a square viewBox on a
 * taller-than-wide panel letterboxes everything drawn into it — was used at four
 * of this renderer's five overlay call sites. The overview kept a hand-rolled
 * `viewBox="0 0 1000 1000"` over a 487 x 625 pt panel, plus the
 * `objectFit: "cover"` on the basemap image that the atlas pages had already
 * dropped for the same reason. So the page rectangles, the route and the stops
 * were uniformly scaled to the panel's smaller side and centred, 69 pt down from
 * where they belonged, over a basemap cropped the other way: an index map whose
 * squares do not sit on the ground they name. The emphatic comments about
 * exactly this failure read as global, and nothing tested this page at all.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

/** A 4x4 flat-colour PNG — enough for react-pdf to place a real image XObject. */
const PANEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4cWkLHDEQxwEAwGEk4Xek1H0AAAAASUVORK5CYII=";

/**
 * The overview's map box, in points, written out rather than imported: the
 * Letter sheet (612 x 792) less 54 pt of page padding, 1.5 pt of neatline
 * border and 6 pt of neatline padding per side, less 1 pt of panel border per
 * side, less the 30 pt header row and the 12 pt caption row. The test states the
 * numbers it expects instead of asking the renderer what it drew.
 */
const BOX = { x: 62.5, y: 92.5, width: 487, height: 625 };

async function renderOverview(overview: AtlasOverview): Promise<MeasuredPage> {
  const page = buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, "L1", 2);
  const contract: AtlasContract = {
    version: 1,
    scale: usgs,
    margins: DEFAULT_MARGINS,
    pages: [page],
  };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: "Journey Book",
    overview,
    overviewPanel: PANEL_PNG,
    tableOfContents: false,
    notes: false,
  });
  const measured = measurePdfPages(pdf);
  // The overview is front matter: the first page of the document.
  expect(measured.length).toBeGreaterThanOrEqual(2);
  return measured[0]!;
}

/** Assert some rectangle on the page sits at exactly this place and size. */
function expectRect(
  measured: MeasuredPage,
  want: { x: number; y: number; width: number; height: number },
  what: string,
) {
  const tol = 0.75;
  const near = (a: number, b: number) => Math.abs(a - b) < tol;
  const found = measured.rects.some(
    (r) =>
      near(r.x, want.x) && near(r.y, want.y) && near(r.width, want.width) && near(r.height, want.height),
  );
  const nearestBySize = measured.rects
    .filter((r) => near(r.width, want.width))
    .map((r) => `${r.width.toFixed(1)}x${r.height.toFixed(1)}@(${r.x.toFixed(1)},${r.y.toFixed(1)})`);
  expect(
    found,
    `${what}: no rect at ${want.width}x${want.height}@(${want.x},${want.y}). Same-width rects: ${nearestBySize.join(", ") || "none"}`,
  ).toBe(true);
}

describe("overview page registration", () => {
  it("draws a page footprint over the ground it names, on both axes", async () => {
    // The north half of the extent. Deliberately not square and not the whole
    // box, so the assertion pins width, height AND origin independently.
    const measured = await renderOverview({
      pages: [{ id: "L1", x: 0, y: 0, w: 1, h: 0.5 }],
    } as AtlasOverview);

    // Under the square 1000x1000 viewBox this came out 487 x 243.5 at y=161.5:
    // scaled to the panel's smaller side and pushed 69 pt down the page.
    expectRect(
      measured,
      { x: BOX.x, y: BOX.y, width: BOX.width, height: BOX.height / 2 },
      "north-half page footprint",
    );
  });

  it("paints the overview basemap into the whole box, uncropped", async () => {
    const measured = await renderOverview({
      pages: [{ id: "L1", x: 0.25, y: 0.25, w: 0.5, h: 0.5 }],
    } as AtlasOverview);

    // `objectFit: "cover"` scales the image to the box's LARGER side and crops
    // the rest away — a measurably different placement from the box it sits in.
    expect(measured.images).toHaveLength(1);
    const img = measured.images[0]!;
    expect(img.width).toBeCloseTo(BOX.width, 1);
    expect(img.height).toBeCloseTo(BOX.height, 1);
    expect(img.x).toBeCloseTo(BOX.x, 1);
    expect(img.y).toBeCloseTo(BOX.y, 1);
  });

  it("runs the route corner to corner across the full box", async () => {
    const measured = await renderOverview({
      pages: [{ id: "L1", x: 0, y: 0, w: 1, h: 1 }],
      route: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    } as AtlasOverview);

    const diagonal = measured.lines.find(
      (l) => Math.abs(l.x2 - l.x1) > 100 && Math.abs(l.y2 - l.y1) > 100,
    );
    expect(diagonal, "no route diagonal drawn on the overview").toBeDefined();
    // Its rise must be the box's height, not the box's width.
    expect(Math.abs(diagonal!.x2 - diagonal!.x1)).toBeCloseTo(BOX.width, 1);
    expect(Math.abs(diagonal!.y2 - diagonal!.y1)).toBeCloseTo(BOX.height, 1);
  });

  it("keeps the overview map box constant however many pages the caption counts", async () => {
    const few = await renderOverview({
      pages: [{ id: "L1", x: 0, y: 0, w: 1, h: 0.5 }],
    } as AtlasOverview);
    const many = await renderOverview({
      pages: [
        { id: "L1", x: 0, y: 0, w: 1, h: 0.5 },
        ...Array.from({ length: 40 }, (_, i) => ({
          id: `P${i}`,
          x: (i % 8) / 8,
          y: 0.5 + Math.floor(i / 8) / 16,
          w: 1 / 8,
          h: 1 / 16,
        })),
      ],
    } as AtlasOverview);

    const want = { x: BOX.x, y: BOX.y, width: BOX.width, height: BOX.height / 2 };
    expectRect(few, want, "footprint on a 1-page overview");
    expectRect(many, want, "footprint on a 41-page overview");
  });
});

describe("overview page labels", () => {
  /** A ladder: three nested footprints of one location, coarse to fine. */
  const ladder: AtlasOverview["pages"] = [
    { id: "L1a", x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
    { id: "L1b", x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
    { id: "L1c", x: 0.28, y: 0.28, w: 0.04, h: 0.04 },
  ];
  const numbers = { A1: 3, L1a: 4, L1b: 5, L1c: 6, L2: 7, R1: 8, L3a: 9, L3b: 10 };

  it("labels a ladder once, at its largest footprint, with its page range", () => {
    const labels = overviewPageLabels(ladder, numbers);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: "L1a", text: "4-6" });
    expect(labels[0]!.x).toBeCloseTo(0.3);
    // Inside the largest footprint's top edge, clear of the pin at its centre.
    expect(labels[0]!.y).toBeGreaterThan(0.1);
    expect(labels[0]!.y).toBeLessThan(0.15);
  });

  it("[CONTROL] keeps one label per page for grid, route and un-laddered location pages", () => {
    const pages: AtlasOverview["pages"] = [
      { id: "A1", x: 0, y: 0, w: 0.2, h: 0.2 },
      { id: "L2", x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
      { id: "R1", x: 0.8, y: 0.8, w: 0.2, h: 0.2 },
    ];
    expect(overviewPageLabels(pages, numbers).map((l) => l.text)).toEqual(["3", "7", "8"]);
  });

  it("keeps two locations' ladders apart, including L1 from L10", () => {
    const pages: AtlasOverview["pages"] = [
      ...ladder,
      { id: "L3a", x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
      { id: "L3b", x: 0.65, y: 0.65, w: 0.1, h: 0.1 },
      { id: "L10a", x: 0, y: 0.8, w: 0.1, h: 0.1 },
      { id: "L10b", x: 0, y: 0.8, w: 0.05, h: 0.05 },
    ];
    expect(
      overviewPageLabels(pages, { ...numbers, L10a: 11, L10b: 12 }).map((l) => l.text),
    ).toEqual(["4-6", "9-10", "11-12"]);
  });

  it("never prints a range across a page it does not cover", () => {
    expect(overviewPageLabels(ladder.slice(0, 2), { L1a: 4, L1b: 9 })[0]!.text).toBe("4, 9");
  });

  it("[BEHAVIORAL] prints the range and not the separate numbers on the rendered page", async () => {
    const usgsPage = (id: string) => ({
      ...buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, id, 2),
    });
    const contract: AtlasContract = {
      version: 1,
      scale: usgs,
      margins: DEFAULT_MARGINS,
      pages: [usgsPage("L1a"), usgsPage("L1b"), usgsPage("L1c")],
    };
    const pdf = await renderAtlasPdfToBuffer({
      contract,
      overview: { bbox: [-97, 40, -96, 41], pages: ladder },
      tableOfContents: false,
      notes: false,
    });
    const overviewTexts = measurePdfPages(pdf)[0]!.texts;

    expect(overviewTexts).toContain("2-4");
    // Not "3": the caption's own "3 pages" prints that as a separate text run.
    for (const single of ["2", "4"]) expect(overviewTexts).not.toContain(single);
  });
});
