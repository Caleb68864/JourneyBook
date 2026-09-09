import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  POINTS_PER_INCH as PT,
  SCALE_PRESETS,
  buildLocationPage,
  geodesicDistanceMeters,
  mapBoxInches,
  niceScaleBar,
  type AtlasContract,
  type AtlasPage,
  type MapTier,
  type PageOrientation,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages, mapBoxOf, type MeasuredBox, type MeasuredPage } from "./pdf-measure.js";

/**
 * The one check nothing in this repo could make: open the PDF the renderer
 * actually produced and measure it.
 *
 * `validateAtlas` compares a page's bbox against its scale using the same
 * `groundFootprintMeters` on both sides, so it agrees with itself no matter how
 * small the map is painted. These tests instead read the printed page back —
 * the map box and the scale bar, in points on paper — and assert the only
 * relation that makes a scale bar true:
 *
 *     bar length on paper / map width on paper
 *       == ground metres the bar claims / ground metres the page covers
 *
 * Before the map box became the source of truth for the ground footprint, this
 * failed by ~30%: a 1:24,000 atlas printed near 1:31,200.
 */

/** A 4x4 flat-colour PNG — enough for react-pdf to place a real image XObject. */
const PANEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4cWkLHDEQxwEAwGEk4Xek1H0AAAAASUVORK5CYII=";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000
const hundredK = SCALE_PRESETS.find((p) => p.id === "1-100000")!;

interface PageOptions {
  scale?: typeof usgs;
  tier?: MapTier;
  title?: string;
  bookTitle?: string;
  notes?: boolean;
  orientation?: PageOrientation;
  withPanel?: boolean;
}

async function renderPage(options: PageOptions = {}) {
  const scale = options.scale ?? usgs;
  const orientation = options.orientation ?? "portrait";
  const spec = { ...LETTER_PORTRAIT, orientation };
  const page: AtlasPage = buildLocationPage(
    { lng: -96.7026, lat: 40.8136 },
    scale,
    spec,
    "L1",
    options.tier ?? 2,
    options.title,
  );
  const contract: AtlasContract = {
    version: 1,
    scale,
    margins: LETTER_PORTRAIT.margins,
    pages: [page],
  };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: options.bookTitle ?? "Journey Book",
    ...(options.withPanel === false ? {} : { panels: { L1: PANEL_PNG } }),
    tableOfContents: false,
    referenceGrid: true,
    notes: options.notes ?? true,
  });
  const measured = measurePdfPages(pdf);
  expect(measured).toHaveLength(1);
  return { page, scale, spec, measured: measured[0]! };
}

/**
 * The map panel's border box is the largest rectangle on an atlas page; the map
 * itself is painted inside that border.
 */
function panelMapBox(measured: MeasuredPage, borderPt = 1): MeasuredBox {
  const box = mapBoxOf(measured, borderPt);
  expect(box, "no map panel found on the rendered page").toBeDefined();
  return box!;
}

/**
 * The scale bar is the only figure on the page drawn as a 6 pt-tall bar inside a
 * 7 pt-tall SVG box at the same origin and width — the compass, calibration tick
 * and grid labels all have different signatures.
 */
function scaleBarBox(measured: MeasuredPage): MeasuredBox {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const bars = measured.rects.filter((r) => near(r.height, 6));
  const found = bars.find((bar) =>
    measured.rects.some(
      (svg) => near(svg.height, 7) && near(svg.x, bar.x) && near(svg.y, bar.y) && near(svg.width, bar.width),
    ),
  );
  expect(found, "no scale bar found on the rendered page").toBeDefined();
  return found!;
}

/** Ground width/height of a page's bbox, measured geodesically. */
function pageGroundSize(page: AtlasPage) {
  const [west, south, east, north] = page.bbox;
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return {
    width: geodesicDistanceMeters({ lng: west, lat: midLat }, { lng: east, lat: midLat }),
    height: geodesicDistanceMeters({ lng: midLng, lat: south }, { lng: midLng, lat: north }),
  };
}

describe("printed scale fidelity — measured off the rendered PDF", () => {
  it("prints a scale bar whose length on paper matches the ground it claims", async () => {
    const { page, measured } = await renderPage();

    const map = panelMapBox(measured);
    const bar = scaleBarBox(measured);
    const ground = pageGroundSize(page);

    // What the bar says it is: niceScaleBar picks the ground distance; the page
    // bbox says how much ground the printed map covers.
    const claimed = niceScaleBar(page.scale ?? usgs, (map.width / PT) * 0.45);

    const printedFraction = bar.width / map.width;
    const groundFraction = claimed.groundMeters / ground.width;

    // Tolerance matches validateAtlas's footprint tolerance (0.5%): the residual
    // is the geodesic-vs-planar difference in the page bbox, not a scale error.
    expect(Math.abs(printedFraction / groundFraction - 1)).toBeLessThan(0.005);
    // And therefore the page prints at the ratio it advertises.
    const printedRatio = ground.width / ((map.width / PT) * 0.0254);
    expect(Math.abs(printedRatio / (page.scale ?? usgs).ratio - 1)).toBeLessThan(0.005);

    // The same relation on the OTHER axis. Everything above measures width, and
    // the height was previously only ever compared against `mapBoxInches()` —
    // the very function the renderer laid the page out from, so that comparison
    // agrees with itself no matter how much ground the bbox claims. This is the
    // independent one: metres measured geodesically off the page's own bbox,
    // divided by millimetres measured off the printed PDF. A page whose bbox
    // height was sized from anything but the printed map box (the exact shape of
    // the ~30% bug, on the axis it was never checked on) fails here.
    const printedRatioHeight = ground.height / ((map.height / PT) * 0.0254);
    expect(Math.abs(printedRatioHeight / (page.scale ?? usgs).ratio - 1)).toBeLessThan(0.005);
  });

  it("paints the map into exactly the box its ground footprint was sized from", async () => {
    const { spec, measured } = await renderPage();

    const box = mapBoxInches(spec);
    const map = panelMapBox(measured);

    expect(map.width).toBeCloseTo(box.widthIn * PT, 3);
    expect(map.height).toBeCloseTo(box.heightIn * PT, 3);

    // The panel image fills that box exactly — no object-fit crop, no letterbox.
    expect(measured.images).toHaveLength(1);
    expect(measured.images[0]!.width).toBeCloseTo(map.width, 3);
    expect(measured.images[0]!.height).toBeCloseTo(map.height, 3);
  });

  it("keeps one map box across titles, tiers, notes and orientation", async () => {
    const portrait = mapBoxInches(LETTER_PORTRAIT);
    const variants: PageOptions[] = [
      {},
      { title: "Pioneers Park Nature Center" },
      { bookTitle: "A Considerably Longer Journey Book Title That Wraps" },
      { tier: 1, notes: false },
      { tier: 3, title: "Wilderness Park", scale: hundredK },
    ];
    for (const variant of variants) {
      const { measured } = await renderPage(variant);
      const map = panelMapBox(measured);
      expect(map.width, `width for ${JSON.stringify(variant)}`).toBeCloseTo(portrait.widthIn * PT, 3);
      expect(map.height, `height for ${JSON.stringify(variant)}`).toBeCloseTo(portrait.heightIn * PT, 3);
    }
  });

  it("prints a landscape page at the same true scale as a portrait one", async () => {
    const { page, spec, measured } = await renderPage({ orientation: "landscape" });

    const box = mapBoxInches(spec);
    const map = panelMapBox(measured);
    expect(map.width).toBeCloseTo(box.widthIn * PT, 3);

    const ground = pageGroundSize(page);
    const printedRatio = ground.width / ((map.width / PT) * 0.0254);
    expect(Math.abs(printedRatio / usgs.ratio - 1)).toBeLessThan(0.005);
  });

  it("prints the 1-inch calibration tick at exactly one inch", async () => {
    const { measured } = await renderPage();
    const tick = measured.rects.find((r) => Math.abs(r.width - PT) < 0.01 && Math.abs(r.height - 6) < 0.05);
    expect(tick, "calibration tick not found").toBeDefined();
    expect(tick!.width).toBeCloseTo(72, 6);
  });
});
