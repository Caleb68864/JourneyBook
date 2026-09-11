import { stderr } from "node:process";
import {
  SCALE_PRESETS,
  DEFAULT_PANEL_WIDTH_PX,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
  PRINT_DPI_TARGET,
  effectiveDpi,
  panelWidthPxFor,
  buildPageGrid,
  buildLocationPage,
  buildRouteAtlas,
  enclosingBBox,
  selectPageLandmarks,
  type AtlasContract,
  type AtlasPage,
  type BBox,
  type LandmarkMarker,
  type LngLat,
  type MapTier,
  type PageMargins,
  type PageOrientation,
  type PageSpec,
  type PlacedLandmark,
  type AtlasOverview,
  type PinStyle,
  type ScalePreset,
  type UsngGridOverlay,
  mapBoxInches,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToFile, type RouteOverlay } from "@journeybook/pdf-client";
import {
  renderMapPanel,
  buildUsngGrid,
  buildAtlasOverview,
  type PanelFormat,
} from "@journeybook/map-sources";
import { tileBaseUrlError } from "./tile-url.js";

/** A saved location to render as its own fixed-scale page (L1, L2, …). */
export interface RenderLocation {
  center: LngLat;
  /** Optional human label, carried for logging/future furniture. */
  label?: string;
  /**
   * Optional per-location scale preset id, overriding the project scale so this
   * location's page can zoom in (e.g. a small town at 1:24,000). Falls back to
   * the project `scalePresetId` when omitted.
   */
  scalePresetId?: string;
  /** Custom map pin (shape id + hex color) for this location. */
  pin?: PinStyle;
  /** Saved notes, printed in the location page's notes area. */
  notes?: string;
  /**
   * Zoom ladder: scale preset ids rendered as one page each for this location
   * (e.g. `["1-100000", "1-50000", "usgs-7-5-min"]` → regional → local → detail),
   * in the order given. Pages are ids `L#a`, `L#b`, … Overrides `scalePresetId`
   * and the atlas-level `zoomLevels` when set.
   */
  zoomLevels?: string[];
}

export interface RenderAtlasInput {
  mode: "bbox" | "location";
  bbox?: BBox;
  center?: LngLat;
  /**
   * Saved important locations. Each renders as a fixed-scale `L#` page appended
   * after any bbox grid, so a project with an extent AND locations yields the
   * grid pages PLUS one page per location (instead of dropping the locations).
   * In `location` mode with no `locations`, `center` is rendered as the lone page.
   */
  locations?: RenderLocation[];
  scalePresetId: string;
  tier: MapTier;
  overlap?: number;
  /**
   * Safe margins in inches, plus an optional binder gutter taken off the binding
   * edge. Defaults to `DEFAULT_MARGINS` (0.5in all round, no gutter).
   *
   * These are not cosmetic. The printed map box is the printable area less
   * {@link PAGE_FURNITURE_PT}, and a page's ground footprint is measured against
   * that box — so a margin change **moves the printed footprint**, and with it how
   * many pages the atlas is and what ground each one covers. This is the one
   * page-setup value that changes the geometry, which is exactly why it has to
   * reach the renderer rather than stop at the API.
   */
  margins?: PageMargins;
  /**
   * Sheet orientation. Defaults to `"portrait"`. Landscape swaps the sheet's
   * 8.5 x 11, giving a wider, shorter map box (and a different page count).
   */
  orientation?: PageOrientation;
  title?: string;
  basemap?: boolean;
  tileBaseUrl?: string;
  tileSourceId?: string;
  /**
   * Deepest zoom the tile source has, overriding the basemap's own ceiling.
   * Needed when tiles come through the proxy from a registered `TileSource`
   * whose `MaxZoom` this process cannot see.
   */
  tileMaxZoom?: number;
  cacheDir?: string;
  outputPath: string;
  /**
   * When true, corridor pages (R1…Rn) are tiled along the polyline connecting
   * `locations` centres and appended after the L# pages. Requires ≥2 locations.
   */
  route?: boolean;
  /**
   * Optional landmark markers (e.g. from Overpass) placed as per-page furniture.
   * Each page runs {@link selectPageLandmarks} to pick/declutter the markers that
   * fall inside its bbox; the result is threaded into the PDF like grids/routes.
   */
  landmarks?: LandmarkMarker[];
  /**
   * Prepend a locations table-of-contents page when location pages exist.
   * Default true; set false to suppress the TOC.
   */
  tableOfContents?: boolean;
  /**
   * Prepend a whole-atlas index/overview page (page footprints + route + stops over
   * a small-scale basemap) for multi-page atlases. Default true.
   */
  overview?: boolean;
  /** Draw the alphanumeric reference-grid border on each map page. Default true. */
  referenceGrid?: boolean;
  /** Show the foot-of-page notes area on each map page. Default true. */
  notes?: boolean;
  /**
   * Default zoom ladder applied to every location that has no `zoomLevels` of
   * its own: one page per scale preset id, ids `L#a`, `L#b`, …. A location's own
   * `scalePresetId` is ignored when a ladder applies (the ladder is explicit).
   */
  zoomLevels?: string[];
  /**
   * Cover all locations: tile a grid at the project scale over the padded box
   * enclosing every location (see `enclosingBBox`), prepended before the L#
   * pages — "an atlas that covers all my stops". Ignored when an explicit `bbox`
   * is given (mode "bbox"), which already defines the grid.
   */
  cover?: boolean;
  /** Padding around the cover extent as a fraction of the span. Default 0.05. */
  coverPadFraction?: number;
  /**
   * Target width in pixels for each basemap panel; the tile zoom is chosen to
   * meet it, so this sets the print resolution. It is a **floor**: the panel is
   * cropped at the tiles' native resolution rather than resampled down, so the
   * delivered panel is 1x-2x this.
   *
   * Optional, and an override. With it unset, each page asks for the width its
   * own scale preset declares ({@link ScalePreset.panelWidthPx}, rescaled to the
   * page's map box) — so a mixed-scale atlas renders each page at the resolution
   * that scale needs. Set it and every page uses this instead, which is what
   * `--panel-px` is for.
   */
  panelWidthPx?: number;
  /** Panel encoding: "jpeg" (default, ~6x smaller) or "png" (lossless). */
  panelFormat?: PanelFormat;
  /** JPEG quality 1–100 (ignored for PNG). Default 90. */
  panelQuality?: number;

  // ── Not wire fields ──────────────────────────────────────────────────────
  //
  // The two below are in-process callbacks/objects, not JSON. They are listed in
  // NON_WIRE_INPUT_FIELDS and deliberately absent from the render-worker's
  // `POST /render` JSON schema; `render-worker/src/wire-contract.test.ts` asserts
  // that correspondence in both directions, so adding a field here without
  // deciding which side of the wire it is on fails a test rather than silently
  // becoming a field the worker refuses.

  /**
   * Called as the render advances, so a caller that owns the job (the
   * render-worker) can report "page 12 of 60" instead of "in progress".
   *
   * Emitted once per basemap panel, which is where the time actually goes: a
   * 60-page atlas is 60 sequential tile fetches. With `basemap` off there are no
   * panels and the render jumps from `contract` to `pdf`, which is honest — the
   * work is the fetching.
   */
  onProgress?: (progress: RenderProgress) => void;

  /**
   * Cooperative cancellation, checked **between pages**.
   *
   * `renderMapPanel` is not interruptible, so the finest grain available is one
   * page's tile mosaic; a cancel lands within one page's fetch rather than
   * instantly. That is the whole reason the signal is honoured here and not only
   * at the HTTP layer: aborting a request the worker has already dispatched
   * leaves the worker rendering, which is a cancel button that does not cancel.
   */
  signal?: AbortSignal;
}

/**
 * The fields of {@link RenderAtlasInput} that are **not** part of the worker's
 * JSON wire contract, because they cannot be expressed in JSON.
 *
 * Named here rather than in the worker so there is one statement of it, next to
 * the interface it qualifies. The parity test reads this list.
 */
export const NON_WIRE_INPUT_FIELDS: readonly string[] = ["onProgress", "signal", "cacheDir"];

/** Where a render has got to. `page` is 0-based-exclusive: pages finished so far. */
export interface RenderProgress {
  /**
   * `contract` — pages derived, nothing drawn yet.
   * `panel` — one page's basemap panel finished.
   * `overview` — the front-matter overview panel finished.
   * `pdf` — all panels done, writing the PDF.
   * `done` — the file is on disk.
   */
  phase: "contract" | "panel" | "overview" | "pdf" | "done";
  /** Pages whose basemap panel is finished. */
  page: number;
  /** Total pages in the assembled contract. */
  pageCount: number;
  /** The page just finished, for `phase: "panel"`. */
  pageId?: string;
}

/**
 * A render stopped because its {@link RenderAtlasInput.signal} was aborted.
 *
 * A distinct type because the alternative is what this codebase has produced
 * three times: one broken invariant reported as another's failure. The basemap
 * loop wraps every throw as "Failed to fetch basemap tile panel for page X",
 * which would have made a deliberate cancel indistinguishable from a tile
 * source being down — and the worker's classifier maps that to 502, so a user
 * pressing Cancel would have been told the map server was unreachable.
 */
export class RenderCancelledError extends Error {
  /** Pages finished before the cancel was observed. */
  readonly page: number;
  readonly pageCount: number;

  constructor(page: number, pageCount: number) {
    super(`Render was cancelled after ${page} of ${pageCount} pages.`);
    this.name = "RenderCancelledError";
    this.page = page;
    this.pageCount = pageCount;
  }
}

/**
 * The print resolution a render actually DELIVERED, across the basemap panels it
 * drew.
 *
 * This product's load-bearing promise is true scale, and this is the number that
 * says whether the promise was kept on a given render. It is not derivable from
 * the request: nothing resamples, so `panelWidthPx` is a FLOOR and the delivered
 * crop is 1x-2x it depending on where the page falls relative to a Web-Mercator
 * zoom boundary. Two presets 4% apart in scale can print 1.9x apart in DPI.
 *
 * A range rather than a single figure because an atlas can mix scales — a zoom
 * ladder puts 1:100,000 and 1:24,000 in the same book — and the honest answer for
 * such a render is the spread, not an average nobody's page prints at.
 */
export interface DeliveredDpi {
  /** The softest page in the atlas. The one that decides whether the target was met. */
  min: number;
  /** The sharpest. */
  max: number;
  /** How many basemap panels these figures are measured over. Never 0. */
  panels: number;
}

export interface RenderAtlasResult {
  outputPath: string;
  pageCount: number;
  attribution: string;
  /**
   * What this render will print at, or undefined when no basemap was drawn (a
   * render with no panels has no resolution to report, and inventing one would be
   * the fabrication this field exists to replace).
   *
   * It is on the result, and not only in the renderer's log, because the log is
   * reachable from the CLI and from nowhere else. The commit that first computed
   * this paired it with the attribution fix: the credit went to
   * `RenderAtlasResult.attribution`, on to the worker's job record, and into the
   * `GeneratedPdf` provenance snapshot, where it is answerable afterwards for a
   * file already on disk — and the measurement was written to `stderr`, imported
   * directly from `node:process` and not injectable, so on the API path it reached
   * nothing at all. Same journey, done the same way.
   */
  deliveredDpi?: DeliveredDpi;
  /** The assembled contract (pages, per-page scale, margins) that was rendered. */
  contract: AtlasContract;
  /** USNG grid overlays built for tier-3+ pages (empty for tier 1–2). */
  grids: Record<string, UsngGridOverlay>;
  /** Per-page selected landmark furniture, keyed by page id (empty when no landmarks). */
  landmarks: Record<string, PlacedLandmark[]>;
  /** Route polyline (global LngLat) when route mode was used, undefined otherwise. */
  polyline?: LngLat[];
}

/**
 * Validate render input up front so a bad request fails fast with a clear,
 * caller-facing message (the render-worker maps these to HTTP 400) instead of a
 * cryptic error deep inside projection/grid math. Messages start with "Invalid"
 * or "Unknown" so the worker's input-error classifier catches them.
 */
function isValidLngLat(c: LngLat | undefined): c is LngLat {
  return (
    !!c && Number.isFinite(c.lng) && Number.isFinite(c.lat) &&
    c.lng >= -180 && c.lng <= 180 && c.lat >= -90 && c.lat <= 90
  );
}

function validateInput(input: RenderAtlasInput): void {
  if (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > 4) {
    throw new Error(`Invalid tier ${String(input.tier)}: must be an integer 1–4.`);
  }
  if (input.overlap !== undefined) {
    if (!Number.isFinite(input.overlap) || input.overlap < 0 || input.overlap >= 1) {
      throw new Error(`Invalid overlap ${String(input.overlap)}: must be in [0, 1).`);
    }
  }
  if (input.orientation !== undefined && input.orientation !== "portrait" && input.orientation !== "landscape") {
    throw new Error(
      `Invalid orientation "${String(input.orientation)}": must be "portrait" or "landscape".`,
    );
  }
  if (input.margins !== undefined) {
    const m = input.margins;
    for (const side of ["top", "right", "bottom", "left", "gutter"] as const) {
      const v = m[side];
      if (v === undefined && side === "gutter") continue;
      if (!Number.isFinite(v) || (v as number) < 0) {
        throw new Error(`Invalid margins.${side} ${String(v)}: must be a finite number ≥ 0.`);
      }
    }
    // Margins move the printed map box, so margins large enough to consume it
    // would produce a contract whose pages cover zero or negative ground — an
    // atlas of blank sheets, or a division by a negative footprint. Reject at the
    // boundary rather than emit one.
    const box = mapBoxInches(pageSpecOf(input));
    if (box.widthIn <= 0 || box.heightIn <= 0) {
      throw new Error(
        `Invalid margins: they leave a printed map box of ${(box.widthIn * 72).toFixed(1)} x ` +
          `${(box.heightIn * 72).toFixed(1)} pt. Page furniture alone takes 125 x 171 pt, so the ` +
          `margins plus the gutter must leave more than that on a Letter sheet.`,
      );
    }
  }
  if (input.locations !== undefined) {
    if (!Array.isArray(input.locations)) {
      throw new Error("Invalid locations: must be an array of { center } entries.");
    }
    input.locations.forEach((loc, i) => {
      if (!isValidLngLat(loc?.center)) {
        throw new Error(
          `Invalid location[${i}].center: requires finite lng in [-180,180] and lat in [-90,90].`,
        );
      }
    });
  }
  if (input.mode === "location") {
    // `center` is required unless an explicit `locations` list is supplied
    // (a no-extent project still passes its first location as `center`).
    if ((input.locations === undefined || input.locations.length === 0) && !isValidLngLat(input.center)) {
      throw new Error('Invalid center: requires finite lng in [-180,180] and lat in [-90,90].');
    }
    if (input.center !== undefined && !isValidLngLat(input.center)) {
      throw new Error('Invalid center: requires finite lng in [-180,180] and lat in [-90,90].');
    }
  } else if (input.mode === "bbox") {
    const b = input.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => Number.isFinite(n))) {
      throw new Error("Invalid bbox: requires [west, south, east, north] of four finite numbers.");
    }
    const [w, s, e, n] = b;
    if (w >= e || s >= n) {
      throw new Error(`Invalid bbox: requires west<east and south<north (got [${b.join(", ")}]).`);
    }
    if (w < -180 || e > 180 || s < -90 || n > 90) {
      throw new Error("Invalid bbox: coordinates out of range (lng ±180, lat ±90).");
    }
  } else {
    throw new Error(`Invalid mode "${String((input as RenderAtlasInput).mode)}": must be "bbox" or "location".`);
  }
  if (input.panelWidthPx !== undefined) {
    if (!Number.isInteger(input.panelWidthPx) || input.panelWidthPx < 256 || input.panelWidthPx > 8000) {
      throw new Error(`Invalid panelWidthPx ${String(input.panelWidthPx)}: must be an integer 256–8000.`);
    }
  }
  if (input.panelFormat !== undefined && input.panelFormat !== "png" && input.panelFormat !== "jpeg") {
    throw new Error(`Invalid panelFormat "${String(input.panelFormat)}": must be "png" or "jpeg".`);
  }
  if (input.panelQuality !== undefined) {
    if (!Number.isInteger(input.panelQuality) || input.panelQuality < 1 || input.panelQuality > 100) {
      throw new Error(`Invalid panelQuality ${String(input.panelQuality)}: must be an integer 1–100.`);
    }
  }
  // Structural checks only — scheme, embedded credentials, base-path shape. The
  // destination rules (non-routable hosts, operator allowlist) live at the
  // WORKER's boundary, where the caller is untrusted; this engine's caller is
  // whoever typed the command, and `--tile-base-url http://localhost:5180/api/tiles`
  // is a documented local workflow. See `tile-url.ts`.
  const tileUrlError = tileBaseUrlError(input.tileBaseUrl);
  if (tileUrlError !== null) throw new Error(tileUrlError);
}


/**
 * Liang-Barsky parametric clip of a single line segment [a, b] against an
 * axis-aligned bbox. Returns the clipped endpoints or null when no intersection.
 */
function clipSegmentToBbox(
  a: LngLat, b: LngLat,
  west: number, south: number, east: number, north: number,
): [LngLat, LngLat] | null {
  let t0 = 0, t1 = 1;
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  function liang(p: number, q: number): boolean {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  }
  if (!liang(-dx, a.lng - west)) return null;
  if (!liang(dx, east - a.lng)) return null;
  if (!liang(-dy, a.lat - south)) return null;
  if (!liang(dy, north - a.lat)) return null;
  return [
    { lng: a.lng + t0 * dx, lat: a.lat + t0 * dy },
    { lng: a.lng + t1 * dx, lat: a.lat + t1 * dy },
  ];
}

/** Ladder suffix for the n-th zoom level of a location: 0→"a", 1→"b", … 26→"aa". */
function ladderSuffix(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function resolveScaleOrThrow(id: string, where: string): ScalePreset {
  const preset = SCALE_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(
      `Unknown scalePresetId "${id}" for ${where}. Available: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }
  return preset;
}

/**
 * The sheet the atlas is laid out on: Letter, with the caller's orientation,
 * margins and binder gutter applied over the defaults.
 *
 * A partial `margins` object is not accepted — `PageMargins` requires all four
 * sides, and merging a partial one against the defaults would let a caller who
 * meant "0.25 all round" silently print three sides at 0.5.
 */
function pageSpecOf(input: RenderAtlasInput): PageSpec {
  return {
    widthIn: LETTER_PORTRAIT.widthIn,
    heightIn: LETTER_PORTRAIT.heightIn,
    orientation: input.orientation ?? LETTER_PORTRAIT.orientation,
    margins: input.margins ?? LETTER_PORTRAIT.margins,
  };
}

/** The assembled page contract plus the inputs the renderer needs to draw furniture. */
export interface AssembledAtlas {
  contract: AtlasContract;
  /** Locations rendered as L# pages (also the overview stops and route stops). */
  locationList: RenderLocation[];
  /** Route polyline (global LngLat) when route mode was used. */
  routePolyline?: LngLat[];
  /** The cover extent that was tiled, when `cover` produced a grid. */
  coverBBox?: BBox;
}

/**
 * Build the page contract (cover/bbox grid → L# location pages, each possibly a
 * zoom ladder → R# corridor pages) without rendering anything. Shared by
 * `renderAtlas` and the CLI's `grid`/`validate` commands so every command sees
 * the same atlas for the same input.
 */
export function assembleContract(input: RenderAtlasInput): AssembledAtlas {
  validateInput(input);

  // One page spec, built once, used by every page-producing call below. Until
  // 2026-09-09 each of those calls passed LETTER_PORTRAIT directly, so a project's
  // saved margins, gutter and orientation — carried faithfully through EF,
  // validation, the duplicate endpoint and the web adapter — died at this line and
  // every atlas printed at the defaults.
  const page = pageSpecOf(input);

  const scale = SCALE_PRESETS.find((p) => p.id === input.scalePresetId);
  if (!scale) {
    throw new Error(
      `Unknown scalePresetId "${input.scalePresetId}". Available: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }

  // Resolve the locations to render as fixed-scale L# pages. In location mode
  // with no explicit list, fall back to the single `center` (legacy behaviour).
  const locationList: RenderLocation[] =
    input.locations && input.locations.length > 0
      ? input.locations
      : input.mode === "location" && input.center
        ? [{ center: input.center }]
        : [];

  // Base pages: a bbox grid (extent-driven) plus a page per saved location
  // (scale-driven). A project with both an extent AND locations renders the
  // grid pages followed by L1…Ln — the locations are no longer dropped.
  const pages: AtlasPage[] = [];
  let coverBBox: BBox | undefined;
  if (input.mode === "bbox") {
    if (!input.bbox) throw new Error('mode "bbox" requires bbox');
    const grid = buildPageGrid({
      bbox: input.bbox,
      scale,
      page,
      overlap: input.overlap ?? 0,
      tier: input.tier,
    });
    pages.push(...grid.pages);
  } else if (input.cover && locationList.length > 0) {
    // Cover every location: a grid at the project scale over the padded box
    // enclosing all stops (same helper the web's "Enclose N Locations" uses).
    coverBBox = enclosingBBox(
      locationList.map((loc) => loc.center),
      input.coverPadFraction !== undefined ? { padFraction: input.coverPadFraction } : {},
    );
    const grid = buildPageGrid({
      bbox: coverBBox,
      scale,
      page,
      overlap: input.overlap ?? 0,
      tier: input.tier,
    });
    pages.push(...grid.pages);
  }

  // Default zoom ladder (validated once; a per-location ladder wins).
  const defaultLadder =
    input.zoomLevels && input.zoomLevels.length > 0
      ? input.zoomLevels.map((id) => resolveScaleOrThrow(id, "zoomLevels"))
      : undefined;

  locationList.forEach((loc, i) => {
    const baseId = `L${i + 1}`;
    const where = loc.label ?? baseId;
    const ladder =
      loc.zoomLevels && loc.zoomLevels.length > 0
        ? loc.zoomLevels.map((id) => resolveScaleOrThrow(id, `location ${where}`))
        : defaultLadder;

    if (ladder && ladder.length > 1) {
      // One page per zoom level, ids L#a, L#b, … in the order given. Each page is
      // self-describing (buildLocationPage stamps page.scale) and titled with its
      // scale so the TOC distinguishes the levels.
      ladder.forEach((levelScale, k) => {
        pages.push(
          buildLocationPage(
            loc.center,
            levelScale,
            page,
            `${baseId}${ladderSuffix(k)}`,
            input.tier,
            loc.label ?? baseId,
            loc.pin,
            loc.notes,
          ),
        );
      });
      return;
    }

    // Each location may carry its own scale (zoom in for a small town/house);
    // fall back to the project scale. buildLocationPage stamps page.scale, so the
    // page renders a truthful scale bar even in a mixed-scale atlas.
    const locScale =
      ladder && ladder.length === 1
        ? ladder[0]!
        : loc.scalePresetId !== undefined
          ? resolveScaleOrThrow(loc.scalePresetId, `location ${where}`)
          : scale;
    pages.push(buildLocationPage(loc.center, locScale, page, baseId, input.tier, loc.label, loc.pin, loc.notes));
  });

  if (pages.length === 0) {
    throw new Error('Invalid request: nothing to render (no bbox and no locations).');
  }

  // Route corridor pages (R1…Rn): tiled along the polyline connecting location
  // centres. Appended AFTER L# pages so the MAX_ATLAS_PAGES guard sees the full
  // combined count (L# + R#).
  let routePolyline: LngLat[] | undefined;
  if (input.route && locationList.length >= 2) {
    const routeResult = buildRouteAtlas({
      stops: locationList.map((loc) => loc.center),
      scale,
      page,
      tier: input.tier,
    });
    pages.push(...routeResult.pages);
    routePolyline = routeResult.polyline;
  }

  const contract: AtlasContract = {
    version: 1,
    scale,
    margins: page.margins,
    pages,
  };

  if (contract.pages.length > MAX_ATLAS_PAGES) {
    throw new Error(
      `Invalid request: this atlas at ${scale.id} produces ${contract.pages.length} pages, exceeding the ${MAX_ATLAS_PAGES}-page limit. Use a smaller area, a coarser scale, or fewer locations.`,
    );
  }

  return {
    contract,
    locationList,
    ...(routePolyline ? { routePolyline } : {}),
    ...(coverBBox ? { coverBBox } : {}),
  };
}

export async function renderAtlas(input: RenderAtlasInput): Promise<RenderAtlasResult> {
  const { contract, locationList, routePolyline } = assembleContract(input);

  const totalPages = contract.pages.length;
  let pagesDone = 0;
  const report = (phase: RenderProgress["phase"], pageId?: string): void => {
    input.onProgress?.({
      phase,
      page: pagesDone,
      pageCount: totalPages,
      ...(pageId ? { pageId } : {}),
    });
  };
  /**
   * Throws {@link RenderCancelledError} if the caller has aborted.
   *
   * Called between pages, never inside one: `renderMapPanel` has no signal, so a
   * check inside it would be a lie about the grain.
   */
  const throwIfCancelled = (): void => {
    if (input.signal?.aborted) throw new RenderCancelledError(pagesDone, totalPages);
  };

  // Emitted before any drawing so a poller learns the page count as soon as the
  // engine knows it. Without this, "page 0 of 0" is the honest answer for the
  // whole of the contract phase and a progress bar has nothing to scale to.
  throwIfCancelled();
  report("contract");

  const panelOptions = {
    ...(input.tileBaseUrl ? { tileBaseUrl: input.tileBaseUrl } : {}),
    ...(input.tileSourceId ? { sourceId: input.tileSourceId } : {}),
    ...(input.tileMaxZoom !== undefined ? { maxZoom: input.tileMaxZoom } : {}),
    ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
    ...(input.panelFormat ? { format: input.panelFormat } : {}),
    ...(input.panelQuality !== undefined ? { quality: input.panelQuality } : {}),
  };
  // The panel width is now a property of the SCALE, not one global number, and
  // it is resolved per page because an atlas can mix scales (a zoom ladder puts
  // 1:100,000 and 1:24,000 in the same book). An explicit --panel-px still wins
  // for every page: the caller asked for a specific resolution.
  const pageSpec = pageSpecOf(input);
  const panelWidthFor = (page: AtlasPage): number =>
    input.panelWidthPx ?? panelWidthPxFor(page.scale ?? contract.scale, pageSpec);
  // The overview is an index, not a sheet anyone navigates from: it shows the
  // whole trip at a scale no preset describes, so it keeps the historic default
  // rather than paying a print-resolution bill for a thumbnail of the atlas.
  const overviewWidthPx = input.panelWidthPx ?? DEFAULT_PANEL_WIDTH_PX;

  let panels: Record<string, string> | undefined;
  // Credit lines for the tiles actually fetched, in first-seen order. Collected
  // rather than assumed: with a tile proxy the panels can come from a registered
  // source that is neither the default basemap nor known to this process until a
  // tile comes back with its attribution header. Deduped because every page of an
  // atlas normally shares one source and the footer has room for one line.
  const attributions: string[] = [];
  // The print resolution actually DELIVERED, per page, as a fraction of the
  // printed map box it lands on.
  //
  // This product's load-bearing promise is true scale, and `effectiveDpi` — the
  // exact inverse of the `panelWidthPxForDpi` that every scale preset's width is
  // derived from — was exported, tested and called by nothing but its own tests.
  // So the renderer knew the number, warned when a panel was *softer than asked
  // for* (`zoomClamped`), and never once said what it had achieved.
  //
  // It is worth reporting rather than merely computing because the delivered
  // width is NOT the requested one: `renderMapPanel` crops at native tile
  // resolution and never resamples, so the target is a floor and the delivered
  // panel is 1x-2x it depending on where the page falls relative to a
  // Web-Mercator zoom boundary. Two presets 4% apart in scale can print 1.9x
  // apart in DPI, and nothing in the output said so.
  const deliveredDpi: number[] = [];
  // The summary that leaves this function on the result. Undefined until a panel
  // has actually been measured, so "no basemap" and "0 dpi" cannot be confused.
  let delivered: DeliveredDpi | undefined;
  if (input.basemap) {
    panels = {};
    for (const page of contract.pages) {
      const pageWidthPx = panelWidthFor(page);
      try {
        // Between pages, before the fetch starts. A cancel arriving mid-mosaic is
        // observed here, one page later — the cost of renderMapPanel having no
        // signal of its own, and the reason the message says how far it got.
        //
        // INSIDE the try on purpose. Outside it, the catch below could never see
        // a RenderCancelledError, which makes its rethrow dead code and any test
        // of that rethrow vacuous — measured: with the check outside, deleting
        // the rethrow left the whole cancellation suite green. Here the wrapper
        // genuinely has to tell a cancel from a tile failure.
        throwIfCancelled();
        const panel = await renderMapPanel(page.bbox, pageWidthPx, undefined, panelOptions);
        panels[page.id] = `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`;
        if (panel.attribution && !attributions.includes(panel.attribution)) {
          attributions.push(panel.attribution);
        }
        // Measured against the same map box `panelWidthFor` sized the request
        // from, so the reported DPI is the one the request was expressed in.
        const dpi = effectiveDpi(panel.widthPx, mapBoxInches(pageSpec).widthIn);
        deliveredDpi.push(dpi);
        stderr.write(`  panel ${page.id} (z${panel.zoom}, ${Math.round(dpi)} dpi)\n`);
        // The source has no tiles below this zoom, so the panel is softer than
        // --panel-px asked for. Before the clamp this was not a warning: the
        // request went out at a zoom the source does not serve and every tile
        // 404'd, which the threshold check then turned into a failed render.
        if (panel.zoomClamped) {
          stderr.write(
            `  WARNING: page ${page.id} rendered at z${panel.zoom}, the source's deepest zoom — ` +
              `a ${pageWidthPx} px panel asked for more resolution than this basemap has\n`,
          );
        }
        // A hole under renderMapPanel's threshold is accepted (it is usually a
        // real coverage edge) but never silent: it is still blank paper on a map
        // someone will navigate from, so it is called out per page.
        if (panel.tilesMissing > 0) {
          stderr.write(
            `  WARNING: page ${page.id} is missing ${panel.tilesMissing} of ${panel.tilesRequested} tiles — those areas print blank\n`,
          );
        }
      } catch (err) {
        // A cancel is not a tile failure. Without this line the wrapper below
        // would restate "the user pressed Cancel" as "Failed to fetch basemap
        // tile panel for page A3", which the worker's classifier maps to 502 —
        // the user would be told the map server was unreachable. Rethrow
        // untouched so the one thing that actually happened is what is reported.
        if (err instanceof RenderCancelledError) throw err;
        // Surface a clear, source-aware message so the worker can map a tile
        // failure to 502 (its classifier matches "tile"/"fetch") rather than 500.
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch basemap tile panel for page ${page.id}: ${detail}`);
      }
      // After the page is genuinely on the pile, not before: a progress report
      // that counts pages it has only started is a progress bar that reaches
      // 100% with work outstanding.
      pagesDone += 1;
      report("panel", page.id);
    }

    // One line stating what the atlas will actually print at, once, at the end
    // of the phase that decided it.
    //
    // DISCLOSURE, not a policy change. Whether the default preset should ask for
    // a different width is the owner's open question (see `ROADMAP.md`); nothing
    // here changes a default, refuses a render or alters a single pixel. What it
    // changes is that a render which silently misses the stated target now says
    // so, in the renderer's own output, at the moment it is knowable.
    if (deliveredDpi.length > 0) {
      const min = Math.min(...deliveredDpi);
      const max = Math.max(...deliveredDpi);
      // On the RESULT as well as in the log. Everything below this line goes to
      // `stderr`, which is imported from `node:process` and is not injectable, so
      // for every caller that is not a terminal — the render worker, and through it
      // the API and the browser — it is a measurement delivered nowhere.
      delivered = { min, max, panels: deliveredDpi.length };
      const range = Math.round(min) === Math.round(max)
        ? `${Math.round(min)} dpi`
        : `${Math.round(min)}-${Math.round(max)} dpi`;
      stderr.write(`  print resolution: ${range} across ${deliveredDpi.length} panel(s)\n`);
      if (min < PRINT_DPI_TARGET) {
        stderr.write(
          `  WARNING: the lowest panel prints at ${Math.round(min)} dpi, below the ` +
            `${PRINT_DPI_TARGET} dpi target — contour lines and small labels will soften\n`,
        );
      }
    }
  }

  // Build USNG grid overlays for tier-3+ pages (vector furniture, independent of basemap).
  const PANEL_PX = 1000;
  let grids: Record<string, UsngGridOverlay> | undefined;
  for (const page of contract.pages) {
    if (page.tier >= 3) {
      try {
        const overlay = buildUsngGrid(page.bbox, PANEL_PX, PANEL_PX);
        if (!grids) grids = {};
        grids[page.id] = overlay;
      } catch (err) {
        // Non-fatal: bad coordinates produce an empty overlay rather than aborting.
        stderr.write(`  grid skipped for page ${page.id} (bbox ${page.bbox.join(",")}): ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // Build route overlays for corridor (R#) pages: clip the global polyline to
  // each page's bbox and normalize to (0..1) coordinates for RouteLayer.
  let routes: Record<string, RouteOverlay> | undefined;
  if (routePolyline && routePolyline.length >= 2) {
    const routesMap: Record<string, RouteOverlay> = {};
    for (const page of contract.pages) {
      if (!page.id.startsWith("R")) continue;
      const [west, south, east, north] = page.bbox;
      const bw = east - west;
      const bh = north - south;
      const clipped: { x: number; y: number }[] = [];
      for (let i = 0; i < routePolyline.length - 1; i++) {
        const a = routePolyline[i]!;
        const b = routePolyline[i + 1]!;
        const seg = clipSegmentToBbox(a, b, west, south, east, north);
        if (seg) {
          const [ca, cb] = seg;
          const pa = { x: (ca.lng - west) / bw, y: (north - ca.lat) / bh };
          const pb = { x: (cb.lng - west) / bw, y: (north - cb.lat) / bh };
          const last = clipped[clipped.length - 1];
          if (!last || last.x !== pa.x || last.y !== pa.y) clipped.push(pa);
          clipped.push(pb);
        }
      }
      if (clipped.length >= 2) {
        const stops = locationList
          .filter((loc) =>
            loc.center.lng >= west && loc.center.lng <= east &&
            loc.center.lat >= south && loc.center.lat <= north,
          )
          .map((loc) => ({
            x: (loc.center.lng - west) / bw,
            y: (north - loc.center.lat) / bh,
          }));
        routesMap[page.id] = { points: clipped, ...(stops.length > 0 ? { stops } : {}) };
      }
    }
    if (Object.keys(routesMap).length > 0) routes = routesMap;
  }

  // Select per-page landmark furniture: for each page, pick/declutter the markers
  // that fall inside its bbox (selectPageLandmarks). Runs after the MAX_ATLAS_PAGES
  // guard above, so landmark selection never bypasses the page-count limit. The
  // map mirrors grids/routes and is threaded into the PDF the same way.
  const landmarks: Record<string, PlacedLandmark[]> = {};
  if (input.landmarks && input.landmarks.length > 0) {
    for (const page of contract.pages) {
      const placed = selectPageLandmarks(input.landmarks, page);
      if (placed.length > 0) landmarks[page.id] = placed;
    }
  }

  // Whole-atlas index/overview front-matter page (default on for multi-page atlases):
  // every page's footprint, the route, and the stops over a small-scale basemap of
  // the whole trip. Built from the same Web-Mercator mapping as the panels.
  let overview: AtlasOverview | undefined;
  let overviewPanel: string | undefined;
  const wantOverview = (input.overview ?? true) && contract.pages.length >= 2;
  if (wantOverview) {
    overview = buildAtlasOverview(contract.pages, {
      route: routePolyline,
      stops: locationList.map((loc, i) => ({ center: loc.center, label: loc.label ?? `L${i + 1}`, pin: loc.pin })),
    });
    if (input.basemap) {
      throwIfCancelled();
      try {
        const panel = await renderMapPanel(overview.bbox, overviewWidthPx, undefined, panelOptions);
        overviewPanel = `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`;
        stderr.write(`  overview panel (z${panel.zoom})\n`);
        report("overview");
      } catch (err) {
        // Non-fatal: the overview still renders with page rectangles over a blank panel.
        stderr.write(`  overview panel skipped: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // One credit line for the PDF footer. Undefined when no basemap was rendered:
  // a page with no map data on it must not claim a map source.
  const attribution = attributions.length > 0 ? attributions.join(" · ") : undefined;

  // The last place a cancel can be honoured. `renderAtlasPdfToFile` is one
  // uninterruptible call, so past this point a cancel can only be reported after
  // the PDF exists — and a cancel that silently produced the artifact anyway
  // would be the third way of lying about what happened.
  throwIfCancelled();
  report("pdf");

  await renderAtlasPdfToFile({
    contract,
    outputPath: input.outputPath,
    ...(input.title ? { title: input.title } : {}),
    ...(attribution ? { attribution } : {}),
    panels,
    grids,
    routes,
    landmarks,
    tableOfContents: input.tableOfContents ?? true,
    overview,
    overviewPanel,
    referenceGrid: input.referenceGrid ?? true,
    notes: input.notes ?? true,
  });

  report("done");

  return {
    outputPath: input.outputPath,
    pageCount: contract.pages.length,
    // The credit the PDF actually printed, not a guess from the input flags: the
    // old string claimed USGS for every basemap render even when the tiles came
    // from a proxied source that had told us its own attribution.
    attribution: attribution ?? "JourneyBook atlas",
    // The resolution this atlas will actually print at. Omitted, not zeroed, when
    // no basemap was drawn.
    ...(delivered ? { deliveredDpi: delivered } : {}),
    contract,
    grids: grids ?? {},
    landmarks,
    polyline: routePolyline,
  };
}
