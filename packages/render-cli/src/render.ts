import { stderr } from "node:process";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
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
  type PlacedLandmark,
  type AtlasOverview,
  type PinStyle,
  type ScalePreset,
  type UsngGridOverlay,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToFile, type RouteOverlay } from "@journeybook/pdf-client";
import {
  renderMapPanel,
  buildUsngGrid,
  buildAtlasOverview,
  type PanelFormat,
} from "@journeybook/map-sources";

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
  title?: string;
  basemap?: boolean;
  tileBaseUrl?: string;
  tileSourceId?: string;
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
   * meet it, so this sets the print resolution. Default 1000 (~176 DPI across a
   * 7.5in printable width, since the panel is cropped at the tiles' native
   * resolution rather than resampled down).
   */
  panelWidthPx?: number;
  /** Panel encoding: "jpeg" (default, ~6x smaller) or "png" (lossless). */
  panelFormat?: PanelFormat;
  /** JPEG quality 1–100 (ignored for PNG). Default 90. */
  panelQuality?: number;
}

export interface RenderAtlasResult {
  outputPath: string;
  pageCount: number;
  attribution: string;
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
  if (input.tileBaseUrl !== undefined && !/^https?:\/\//i.test(input.tileBaseUrl)) {
    // Defense-in-depth against SSRF: only http(s) tile proxies, never file://,
    // gopher://, etc. (the worker accepts tileBaseUrl from its request body).
    throw new Error("Invalid tileBaseUrl: must be an http(s) URL.");
  }
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
      page: LETTER_PORTRAIT,
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
      page: LETTER_PORTRAIT,
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
            LETTER_PORTRAIT,
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
    pages.push(buildLocationPage(loc.center, locScale, LETTER_PORTRAIT, baseId, input.tier, loc.label, loc.pin, loc.notes));
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
      page: LETTER_PORTRAIT,
      tier: input.tier,
    });
    pages.push(...routeResult.pages);
    routePolyline = routeResult.polyline;
  }

  const contract: AtlasContract = {
    version: 1,
    scale,
    margins: LETTER_PORTRAIT.margins,
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

  const panelOptions = {
    ...(input.tileBaseUrl ? { tileBaseUrl: input.tileBaseUrl } : {}),
    ...(input.tileSourceId ? { sourceId: input.tileSourceId } : {}),
    ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
    ...(input.panelFormat ? { format: input.panelFormat } : {}),
    ...(input.panelQuality !== undefined ? { quality: input.panelQuality } : {}),
  };
  const panelWidthPx = input.panelWidthPx ?? 1000;

  let panels: Record<string, string> | undefined;
  // Credit lines for the tiles actually fetched, in first-seen order. Collected
  // rather than assumed: with a tile proxy the panels can come from a registered
  // source that is neither the default basemap nor known to this process until a
  // tile comes back with its attribution header. Deduped because every page of an
  // atlas normally shares one source and the footer has room for one line.
  const attributions: string[] = [];
  if (input.basemap) {
    panels = {};
    for (const page of contract.pages) {
      try {
        const panel = await renderMapPanel(page.bbox, panelWidthPx, undefined, panelOptions);
        panels[page.id] = `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`;
        if (panel.attribution && !attributions.includes(panel.attribution)) {
          attributions.push(panel.attribution);
        }
        stderr.write(`  panel ${page.id} (z${panel.zoom})\n`);
        // A hole under renderMapPanel's threshold is accepted (it is usually a
        // real coverage edge) but never silent: it is still blank paper on a map
        // someone will navigate from, so it is called out per page.
        if (panel.tilesMissing > 0) {
          stderr.write(
            `  WARNING: page ${page.id} is missing ${panel.tilesMissing} of ${panel.tilesRequested} tiles — those areas print blank\n`,
          );
        }
      } catch (err) {
        // Surface a clear, source-aware message so the worker can map a tile
        // failure to 502 (its classifier matches "tile"/"fetch") rather than 500.
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch basemap tile panel for page ${page.id}: ${detail}`);
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
      try {
        const panel = await renderMapPanel(overview.bbox, panelWidthPx, undefined, panelOptions);
        overviewPanel = `data:${panel.mimeType};base64,${panel.bytes.toString("base64")}`;
        stderr.write(`  overview panel (z${panel.zoom})\n`);
      } catch (err) {
        // Non-fatal: the overview still renders with page rectangles over a blank panel.
        stderr.write(`  overview panel skipped: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // One credit line for the PDF footer. Undefined when no basemap was rendered:
  // a page with no map data on it must not claim a map source.
  const attribution = attributions.length > 0 ? attributions.join(" · ") : undefined;

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

  return {
    outputPath: input.outputPath,
    pageCount: contract.pages.length,
    // The credit the PDF actually printed, not a guess from the input flags: the
    // old string claimed USGS for every basemap render even when the tiles came
    // from a proxied source that had told us its own attribution.
    attribution: attribution ?? "JourneyBook atlas",
    contract,
    grids: grids ?? {},
    landmarks,
    polyline: routePolyline,
  };
}
