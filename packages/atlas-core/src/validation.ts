import { POINTS_PER_INCH, type AtlasContract, type AtlasPage } from "./model.js";
import { groundFootprintMeters, type PageSpec } from "./page.js";
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
