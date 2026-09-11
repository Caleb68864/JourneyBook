import {
  LETTER_PORTRAIT,
  PRINT_DPI_TARGET,
  SCALE_PRESETS,
  buildLocationPage,
  effectiveDpi,
  mapBoxInches,
  panelWidthPxFor,
  panelWidthPxForDpi,
  type PageSpec,
  type ScalePreset,
} from "@journeybook/atlas-core";
import { planMapPanel } from "./tilemath.js";
import { USGS_TOPO, type RasterBasemap } from "./panel.js";

/**
 * What each scale preset actually prints at, measured through the engine — the
 * single source for every statement of it the product makes.
 *
 * WHY THIS EXISTS. Print resolution is not a property of this product.
 * `renderMapPanel` crops at native tile resolution and never resamples, so a
 * preset's requested panel width is a FLOOR: the delivered panel is 1x-2x it,
 * depending on where the page falls relative to a Web-Mercator zoom boundary —
 * and that moves with latitude, because Mercator's ground resolution scales with
 * cos(lat). Before this table the figure existed as hand-typed prose in three
 * places over two latitude ranges, none checked, and three resolution figures had
 * already reached the owner wrong.
 *
 * So the table is GENERATED (`scripts/generate-print-resolution.mjs`) into a
 * checked-in JSON file the web app's scale picker reads, and `--check` fails CI
 * when the engine and the file disagree. Nothing in this module is a number
 * anybody typed: every figure comes from `planMapPanel`, the function
 * `renderMapPanel` renders from.
 */

/**
 * The latitudes USGS Topo covers in the United States, in whole degrees north:
 * Puerto Rico (18N) to Alaska's north coast (71.4N, so 72 as the last whole
 * degree that bounds it). A page outside this band has no basemap to print.
 */
export const USGS_TOPO_LATITUDE_BAND = { from: 18, to: 72, step: 1 } as const;

/** Longitude every sample is centred on. Pixel width does not depend on it. */
const SAMPLE_LNG = -98;

/** One page, at one latitude, as the renderer would deliver it. */
export interface PrintResolutionSample {
  /** Latitude of the page centre, degrees north. */
  lat: number;
  /** Tile zoom the panel is rendered at. */
  zoom: number;
  /** The page wanted a deeper zoom than the basemap has, and got its deepest. */
  clamped: boolean;
  /** Delivered print resolution across the map box, as a whole number (see `wholeDpi`). */
  dpi: number;
}

/** A preset's resolution across the band at one requested panel width. */
interface Band {
  minDpi: number;
  minDpiLat: number;
  maxDpi: number;
  maxDpiLat: number;
  /** Latitudes whose page prints below the target. */
  belowTargetLats: number[];
  /** Latitudes whose page hit the basemap's zoom ceiling. */
  clampedLats: number[];
}

export interface PresetPrintResolution extends Band {
  id: string;
  label: string;
  ratio: number;
  /** The panel width the renderer asks for on this page. */
  panelWidthPx: number;
  /** What that width asks for, in whole DPI. An unclamped page delivers 1x-2x this. */
  requestedDpi: number;
  /**
   * The largest fall in resolution between two adjacent sampled latitudes — the
   * zoom-boundary cliff, stated with where it is.
   */
  steepestStep: { fromLat: number; fromDpi: number; toLat: number; toDpi: number };
  /**
   * The counterfactual: this preset's band if it asked for the full
   * {@link PRINT_DPI_TARGET} instead. Equal to the preset's own band for a preset
   * that already does; for one that does not, it says what a wider panel would and
   * would not buy.
   */
  atTargetRequest: Band & { panelWidthPx: number };
  samples: PrintResolutionSample[];
}

export interface PrintResolutionTable {
  /** Repo-relative path of the generated documentation of this table. */
  doc: string;
  targetDpi: number;
  page: { description: string; orientation: string; mapBoxWidthIn: number };
  basemap: { id: string; maxZoom: number };
  latitudes: { from: number; to: number; step: number };
  presets: PresetPrintResolution[];
}

/**
 * Every DPI in the table is a whole number, rounded ONCE from the engine's value.
 *
 * Measured, not assumed: stored to one decimal, 1000 px over the 5.7639 in map box
 * (173.49 DPI) became 173.5, which every reader then rounds to "174" — a request
 * for 173 DPI documented as 174, sitting right beside a delivered floor of 174.
 * Rounding twice is how a figure reaches a user wrong with every step looking
 * right. Whole numbers are what every surface shows, so the table stores what is
 * shown, and "below 300" is decided on the same number the reader sees.
 */
const wholeDpi = (n: number): number => Math.round(n);

/** Delivered resolution of a page centred at `lat`, through the renderer's own plan. */
export function deliveredPrintResolution(
  scale: ScalePreset,
  page: PageSpec,
  lat: number,
  targetWidthPx: number,
  basemap: RasterBasemap = USGS_TOPO,
): PrintResolutionSample {
  const bbox = buildLocationPage({ lng: SAMPLE_LNG, lat }, scale, page, "L1").bbox;
  const plan = planMapPanel(bbox, targetWidthPx, basemap.maxZoom);
  return {
    lat,
    zoom: plan.zoom,
    clamped: plan.zoomClamped,
    dpi: wholeDpi(effectiveDpi(plan.crop.width, mapBoxInches(page).widthIn)),
  };
}

function latitudes(): number[] {
  const out: number[] = [];
  const { from, to, step } = USGS_TOPO_LATITUDE_BAND;
  for (let lat = from; lat <= to; lat += step) out.push(lat);
  return out;
}

function bandOf(samples: PrintResolutionSample[], targetDpi: number): Band {
  let min = samples[0]!;
  let max = samples[0]!;
  for (const s of samples) {
    if (s.dpi < min.dpi) min = s;
    if (s.dpi > max.dpi) max = s;
  }
  return {
    minDpi: min.dpi,
    minDpiLat: min.lat,
    maxDpi: max.dpi,
    maxDpiLat: max.lat,
    belowTargetLats: samples.filter((s) => s.dpi < targetDpi).map((s) => s.lat),
    clampedLats: samples.filter((s) => s.clamped).map((s) => s.lat),
  };
}

function steepestStepOf(samples: PrintResolutionSample[]): PresetPrintResolution["steepestStep"] {
  let best = { fromLat: samples[0]!.lat, fromDpi: samples[0]!.dpi, toLat: samples[0]!.lat, toDpi: samples[0]!.dpi };
  let bestRatio = 1;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const [hi, lo] = a.dpi >= b.dpi ? [a, b] : [b, a];
    const ratio = hi.dpi / lo.dpi;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { fromLat: hi.lat, fromDpi: hi.dpi, toLat: lo.lat, toDpi: lo.dpi };
    }
  }
  return best;
}

/**
 * The table, for Letter portrait with default margins — the page every preset's
 * panel width is defined against — across {@link USGS_TOPO_LATITUDE_BAND}.
 */
export function buildPrintResolutionTable(
  presets: readonly ScalePreset[] = SCALE_PRESETS,
  basemap: RasterBasemap = USGS_TOPO,
): PrintResolutionTable {
  if (basemap.maxZoom === undefined) {
    throw new Error(`basemap ${basemap.id} declares no maxZoom; the table would describe a ceiling it cannot see`);
  }
  const page = LETTER_PORTRAIT;
  const boxIn = mapBoxInches(page).widthIn;
  const targetRequestPx = panelWidthPxForDpi(boxIn, PRINT_DPI_TARGET);
  const lats = latitudes();

  return {
    doc: "docs/print-resolution.md",
    targetDpi: PRINT_DPI_TARGET,
    page: {
      description: "US Letter, portrait, default 0.5 in margins",
      orientation: page.orientation,
      mapBoxWidthIn: Math.round(boxIn * 1e4) / 1e4,
    },
    basemap: { id: basemap.id, maxZoom: basemap.maxZoom },
    latitudes: { ...USGS_TOPO_LATITUDE_BAND },
    presets: presets.map((scale) => {
      const panelWidthPx = panelWidthPxFor(scale, page);
      const samples = lats.map((lat) => deliveredPrintResolution(scale, page, lat, panelWidthPx, basemap));
      const atTarget = lats.map((lat) => deliveredPrintResolution(scale, page, lat, targetRequestPx, basemap));
      return {
        id: scale.id,
        label: scale.label,
        ratio: scale.ratio,
        panelWidthPx,
        requestedDpi: wholeDpi(effectiveDpi(panelWidthPx, boxIn)),
        ...bandOf(samples, PRINT_DPI_TARGET),
        steepestStep: steepestStepOf(samples),
        atTargetRequest: { panelWidthPx: targetRequestPx, ...bandOf(atTarget, PRINT_DPI_TARGET) },
        samples,
      };
    }),
  };
}

/**
 * Serialize the table the way it is committed: two-space indentation, with any
 * object or array holding only scalars kept on one line, so a sample is one row
 * and a diff of the file reads as a diff of the table. Deterministic, with a
 * trailing newline — `--check` compares bytes.
 */
export function formatPrintResolutionJson(table: PrintResolutionTable): string {
  const isScalar = (v: unknown): boolean => v === null || typeof v !== "object";
  const flat = (v: unknown): boolean =>
    Array.isArray(v) ? v.every(isScalar) : Object.values(v as object).every(isScalar);

  const write = (v: unknown, indent: string): string => {
    if (isScalar(v)) return JSON.stringify(v);
    if (flat(v)) {
      return Array.isArray(v)
        ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]`
        : `{ ${Object.entries(v as object).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(", ")} }`;
    }
    const inner = `${indent}  `;
    if (Array.isArray(v)) {
      return `[\n${v.map((x) => `${inner}${write(x, inner)}`).join(",\n")}\n${indent}]`;
    }
    return `{\n${Object.entries(v as object)
      .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${write(x, inner)}`)
      .join(",\n")}\n${indent}}`;
  };

  return `${write(table, "")}\n`;
}
