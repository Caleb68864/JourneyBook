import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  POINTS_PER_INCH as PT,
  SCALE_PRESETS,
  buildLocationPage,
  mapBoxInches,
  type AtlasContract,
  type UsngGridOverlay,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages, largestRect, type MeasuredPage } from "./pdf-measure.js";

/**
 * Overlay register: every vector layer (USNG grid, route, landmarks, reference
 * grid) is drawn over the map panel from normalized 0..1 coordinates. Drawn in a
 * square viewBox on a non-square panel, react-pdf's default
 * `preserveAspectRatio="meet"` letterboxes the layer — the lines land somewhere
 * other than the feature they mark. These tests measure where the lines land.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

/** A synthetic tier-3 overlay with lines and labels at known fractions. */
const GRID: UsngGridOverlay = {
  lines: [
    // A vertical easting line a quarter of the way across.
    { x1: 0.25, y1: 0, x2: 0.25, y2: 1, axis: "easting" },
    // A horizontal northing line a quarter of the way down.
    { x1: 0, y1: 0.25, x2: 1, y2: 0.25, axis: "northing" },
  ],
  labels: [
    { x: 0.25, y: 0, text: "0788000", edge: "top" },
    { x: 0, y: 0.25, text: "4517000", edge: "left" },
  ],
  collar: { zoneDesignator: "14T", hundredKmSquare: "MK" },
};

async function renderTier3(): Promise<MeasuredPage> {
  const page = buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, "L1", 3);
  const contract: AtlasContract = {
    version: 1,
    scale: usgs,
    margins: LETTER_PORTRAIT.margins,
    pages: [page],
  };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: "Journey Book",
    grids: { L1: GRID },
    tableOfContents: false,
    referenceGrid: false,
    notes: true,
  });
  const measured = measurePdfPages(pdf);
  expect(measured).toHaveLength(1);
  return measured[0]!;
}

function mapBox(measured: MeasuredPage) {
  const border = largestRect(measured)!;
  return { x: border.x + 1, y: border.y + 1, width: border.width - 2, height: border.height - 2 };
}

type Box = ReturnType<typeof mapBox>;

/** Full-height overlay lines strictly inside the map box (not the page furniture). */
function verticalsInside(measured: MeasuredPage, box: Box) {
  return measured.lines
    .filter(
      (l) =>
        Math.abs(l.x1 - l.x2) < 0.01 &&
        Math.abs(l.y1 - l.y2) > box.height * 0.9 &&
        l.x1 > box.x + 0.5 &&
        l.x1 < box.x + box.width - 0.5,
    )
    .sort((a, b) => a.x1 - b.x1);
}

/** Full-width overlay lines strictly inside the map box. */
function horizontalsInside(measured: MeasuredPage, box: Box) {
  return measured.lines
    .filter(
      (l) =>
        Math.abs(l.y1 - l.y2) < 0.01 &&
        Math.abs(l.x1 - l.x2) > box.width * 0.9 &&
        l.y1 > box.y + 0.5 &&
        l.y1 < box.y + box.height - 0.5,
    )
    .sort((a, b) => a.y1 - b.y1);
}

describe("map overlays are in register with the panel", () => {
  it("draws a grid line a quarter across the map box, not a quarter across a square", async () => {
    const measured = await renderTier3();
    const box = mapBox(measured);

    // Sanity: the panel is not square, so a square viewBox cannot be right.
    expect(box.width).not.toBeCloseTo(box.height, 0);

    const vertical = verticalsInside(measured, box);
    const horizontal = horizontalsInside(measured, box);

    expect(vertical.length).toBeGreaterThan(0);
    expect(horizontal.length).toBeGreaterThan(0);

    expect(vertical[0]!.x1).toBeCloseTo(box.x + 0.25 * box.width, 1);
    expect(horizontal[0]!.y1).toBeCloseTo(box.y + 0.25 * box.height, 1);

    // A square viewBox scaled to "meet" would have put the horizontal line here
    // instead — assert we are nowhere near it.
    const letterboxed = box.y + (box.height - box.width) / 2 + 0.25 * box.width;
    expect(Math.abs(horizontal[0]!.y1 - letterboxed)).toBeGreaterThan(5);
  });

  it("spans the grid lines across the full map box", async () => {
    const measured = await renderTier3();
    const box = mapBox(measured);

    const vertical = verticalsInside(measured, box)[0]!;
    const horizontal = horizontalsInside(measured, box)[0]!;

    // A letterboxed square viewBox would stop the easting line short of the
    // panel's top and bottom edges.
    expect(Math.min(vertical.y1, vertical.y2)).toBeCloseTo(box.y, 1);
    expect(Math.max(vertical.y1, vertical.y2)).toBeCloseTo(box.y + box.height, 1);
    expect(Math.min(horizontal.x1, horizontal.x2)).toBeCloseTo(box.x, 1);
    expect(Math.max(horizontal.x1, horizontal.x2)).toBeCloseTo(box.x + box.width, 1);
  });

  it("prints the USNG grid labels, so a reader can take a grid reference", async () => {
    const measured = await renderTier3();
    // buildUsngGrid has always returned these; the renderer used to drop them,
    // leaving a Tier 3 grid you could not read a coordinate off.
    expect(measured.texts).toContain("0788000");
    expect(measured.texts).toContain("4517000");
  });

  it("keeps the reference-grid cell lines on the map box", async () => {
    const page = buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, "L1", 2);
    const contract: AtlasContract = {
      version: 1,
      scale: usgs,
      margins: LETTER_PORTRAIT.margins,
      pages: [page],
    };
    const pdf = await renderAtlasPdfToBuffer({
      contract,
      title: "Journey Book",
      tableOfContents: false,
      referenceGrid: true,
      notes: true,
    });
    const measured = measurePdfPages(pdf)[0]!;
    const box = mapBox(measured);
    const expected = mapBoxInches(LETTER_PORTRAIT);
    expect(box.width).toBeCloseTo(expected.widthIn * PT, 3);

    // 6 columns -> 5 interior verticals, evenly spaced across the map box.
    const verticals = verticalsInside(measured, box).map((l) => l.x1);
    expect(verticals).toHaveLength(5);
    verticals.forEach((x, i) => {
      expect(x).toBeCloseTo(box.x + ((i + 1) * box.width) / 6, 1);
    });
  });
});
