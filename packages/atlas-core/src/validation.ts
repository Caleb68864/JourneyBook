import { POINTS_PER_INCH, type AtlasContract, type AtlasPage, type ScalePreset } from "./model.js";
import { LETTER_PORTRAIT, groundFootprintMeters, mapBoxInches, type PageSpec } from "./page.js";
import { geodesicDistanceMeters } from "./projection.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidationReport {
  pass: boolean;
  checks: CheckResult[];
  /**
   * Checks that did not run because the input they need was not supplied.
   *
   * Reported rather than silently omitted, and never counted as a pass: a
   * validator that quietly skips its only independent check and still prints
   * VALID is how three documents came to claim this function catches a false
   * scale bar while it could not.
   */
  unmeasured: string[];
}

/** A page's map box as measured off the rendered PDF, in PDF points. */
export interface PrintedMapBox {
  widthPt: number;
  heightPt: number;
}

export interface ValidateOptions {
  /** Allowed footprint error as a fraction of the expected size. Default 0.5%. */
  footprintTolerance?: number;
  /**
   * Map page id → the map box actually measured off the rendered PDF.
   *
   * This is the only input to `validateAtlas` that does not come out of the
   * contract, and therefore the only one that can catch a false scale bar.
   * Everything else here compares the contract with itself: `scale-consistency`
   * puts `groundFootprintMeters(scale, spec)` on one side and the page bbox on
   * the other, and the page bbox was built by `groundFootprintMeters(scale,
   * spec)`. Change `PAGE_FURNITURE_PT.edgeLabelColumn` from 54 to 154 and both
   * sides move together — the atlas then prints at a different scale than it did
   * before and `validateAtlas` still says VALID, because it has never seen a
   * printed page.
   *
   * `render-cli`'s `validate` command renders the atlas and measures it with
   * `pdf-client`'s `measurePdfPages`, so the declared end-to-end validation
   * command supplies these. `atlas-core` takes the measurements as data rather
   * than reaching for the renderer, which would invert the dependency.
   */
  printedMapBoxes?: Record<string, PrintedMapBox>;
}

/** Metres per inch — the definition, for turning printed inches into ground. */
const METERS_PER_INCH = 0.0254;

const CARDINALS = ["north", "south", "east", "west"] as const;
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" } as const;

/** Measured ground width/height of a page's bbox, in metres. */
function pageGroundSize(page: AtlasPage): { width: number; height: number } {
  const [west, south, east, north] = page.bbox;
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return {
    width: geodesicDistanceMeters({ lng: west, lat: midLat }, { lng: east, lat: midLat }),
    height: geodesicDistanceMeters({ lng: midLng, lat: south }, { lng: midLng, lat: north }),
  };
}

/**
 * Validate an atlas contract's geometry: that every page covers the ground
 * footprint its scale implies, that neighbour references are reciprocal and
 * resolvable, and — when {@link ValidateOptions.printedMapBoxes} is supplied —
 * that the ground each page covers over the paper it is printed on is the scale
 * it advertises.
 *
 * That last check is the only one that can catch a false scale bar, and it is
 * the only one whose two sides do not both come out of the contract. This
 * comment used to claim "a false scale bar … fails here" of the whole function;
 * it did not. Without measurements, `printed-scale-fidelity` is reported in
 * {@link ValidationReport.unmeasured} rather than passing by default.
 */
export function validateAtlas(
  contract: AtlasContract,
  options: ValidateOptions = {},
): ValidationReport {
  const tolerance = options.footprintTolerance ?? 0.005;
  const checks: CheckResult[] = [];
  const unmeasured: string[] = [];

  checks.push({
    name: "has-pages",
    pass: contract.pages.length > 0,
    detail: `${contract.pages.length} page(s)`,
  });

  // Scale consistency: measured footprint ≈ scale-implied footprint.
  let scalePass = true;
  let worstRel = 0;
  for (const page of contract.pages) {
    const spec: PageSpec = {
      widthIn: 8.5,
      heightIn: 11,
      orientation: page.orientation,
      margins: contract.margins,
    };
    // Validate each page against its own scale when set (mixed-scale atlases),
    // falling back to the contract scale.
    const expected = groundFootprintMeters(page.scale ?? contract.scale, spec);
    const actual = pageGroundSize(page);
    const relW = Math.abs(actual.width - expected.widthMeters) / expected.widthMeters;
    const relH = Math.abs(actual.height - expected.heightMeters) / expected.heightMeters;
    worstRel = Math.max(worstRel, relW, relH);
    if (relW > tolerance || relH > tolerance) scalePass = false;
  }
  checks.push({
    name: "scale-consistency",
    pass: scalePass,
    detail: `worst footprint error ${(worstRel * 100).toFixed(3)}% (tol ${(tolerance * 100).toFixed(2)}%)`,
  });

  // Printed scale fidelity: the ground a page's bbox covers, measured
  // geodesically, over the paper that page's map is actually printed on,
  // measured off the PDF. That quotient IS the scale, and it is the one relation
  // here whose two sides do not come from the same function — so it is the only
  // check in this report that can fail on a truthfully-built contract rendered
  // to a page of the wrong size, which is what a false scale bar is.
  const printed = options.printedMapBoxes;
  if (printed === undefined) {
    unmeasured.push("printed-scale-fidelity");
  } else {
    let printedPass = true;
    let worstPrinted = 0;
    const missing: string[] = [];
    for (const page of contract.pages) {
      const box = printed[page.id];
      if (box === undefined) {
        missing.push(page.id);
        printedPass = false;
        continue;
      }
      const ratio = (page.scale ?? contract.scale).ratio;
      const actual = pageGroundSize(page);
      const printedWidthMeters = (box.widthPt / POINTS_PER_INCH) * METERS_PER_INCH;
      const printedHeightMeters = (box.heightPt / POINTS_PER_INCH) * METERS_PER_INCH;
      const relW = Math.abs(actual.width / printedWidthMeters - ratio) / ratio;
      const relH = Math.abs(actual.height / printedHeightMeters - ratio) / ratio;
      worstPrinted = Math.max(worstPrinted, relW, relH);
      if (relW > tolerance || relH > tolerance) printedPass = false;
    }
    checks.push({
      name: "printed-scale-fidelity",
      pass: printedPass,
      detail: missing.length
        ? `no printed map box measured for ${missing.join(", ")}`
        : `worst printed-scale error ${(worstPrinted * 100).toFixed(3)}% (tol ${(tolerance * 100).toFixed(2)}%)`,
    });
  }

  // Neighbour reciprocity: every reference resolves and points back.
  const ids = new Set(contract.pages.map((p) => p.id));
  const byId = new Map(contract.pages.map((p) => [p.id, p]));
  let neighborPass = true;
  let neighborDetail = "all neighbour references reciprocal";
  outer: for (const page of contract.pages) {
    for (const dir of CARDINALS) {
      const neighbor = page.neighbors[dir];
      if (neighbor === undefined) continue;
      if (!ids.has(neighbor)) {
        neighborPass = false;
        neighborDetail = `${page.id}.${dir} → "${neighbor}" does not exist`;
        break outer;
      }
      if (byId.get(neighbor)!.neighbors[OPPOSITE[dir]] !== page.id) {
        neighborPass = false;
        neighborDetail = `${page.id}.${dir}="${neighbor}" is not reciprocal`;
        break outer;
      }
    }
  }
  checks.push({ name: "neighbor-reciprocity", pass: neighborPass, detail: neighborDetail });

  return { pass: checks.every((c) => c.pass), checks, unmeasured };
}

/** Effective print DPI of a map panel: panel pixels per printable inch. */
export function effectiveDpi(panelWidthPx: number, printableWidthInches: number): number {
  return panelWidthPx / printableWidthInches;
}

/**
 * The print resolution this product aims at, in DPI.
 *
 * 300 DPI is the figure the roadmap has always named for a printed navigation
 * sheet — below it, contour lines and 6-point label text on a USGS topo panel
 * visibly soften.
 */
export const PRINT_DPI_TARGET = 300;

/**
 * Panel width in pixels that asks for `dpi` across a printed map box of
 * `mapBoxWidthInches`. The inverse of {@link effectiveDpi}.
 *
 * This exists because the default was a bare `1000`, and 1000 px over the
 * 5.7639 in Letter-portrait map box is a request for **173 DPI** — nothing
 * anywhere asked for 300. What the delivered panel then measured was an
 * accident of where each scale preset's page happened to fall relative to a
 * Web-Mercator zoom boundary, because `renderMapPanel` crops at native tile
 * resolution and never resamples: the target is a floor, and the delivered
 * width is 1x-2x it. So 1:24,000 landed 1.95x past a boundary and printed at
 * 338 DPI, while 1:25,000 — a 4% change in scale — dropped to 176.
 *
 * Ask for a number instead of guessing one. `ceil` because a fractional pixel
 * is not a pixel, and the target is a floor.
 */
export function panelWidthPxForDpi(mapBoxWidthInches: number, dpi: number = PRINT_DPI_TARGET): number {
  return Math.ceil(dpi * mapBoxWidthInches);
}

/**
 * The basemap panel width a page should be rendered at: the page's scale preset
 * asks for a resolution, and this converts that request to the page's own map
 * box.
 *
 * {@link ScalePreset.panelWidthPx} is stated across the Letter-**portrait** map
 * box, which is the only geometry anything in this repo had ever measured. A
 * landscape sheet has a 8.2639 in map box rather than 5.7639 in, and a binder
 * gutter takes more off the binding edge, so a flat pixel count is a different
 * DPI request on every page setup. Measured across the USGS Topo latitude band,
 * a flat 1730 px in landscape delivers **209-419 DPI** and clears 300 at no
 * preset at all, while the same request rescaled to the landscape box clears it
 * at exactly the presets it clears in portrait. Scaling by the box is what makes
 * the preset's number mean "this many dots per inch" instead of "this many
 * pixels on the one sheet somebody measured".
 *
 * The ratio is exactly 1 for Letter portrait with default margins, so the common
 * case is unchanged by construction.
 */
export function panelWidthPxFor(scale: ScalePreset, page: PageSpec): number {
  const reference = mapBoxInches(LETTER_PORTRAIT).widthIn;
  const actual = mapBoxInches(page).widthIn;
  if (!(actual > 0) || !(reference > 0)) return scale.panelWidthPx;
  // `round`, not `ceil`. The stored number is already a ceil of a DPI request
  // (1730 = ceil(300 x 5.7639) asks for 300.14 DPI, not 300), so re-ceiling it
  // compounds that rounding and lands a pixel above `panelWidthPxForDpi` for the
  // same box — which makes "this is the same DPI ask on a different sheet" false
  // by one pixel. A pixel cannot change which zoom `zoomForBBox` picks; zoom
  // boundaries are a factor of two apart.
  return Math.round(scale.panelWidthPx * (actual / reference));
}
