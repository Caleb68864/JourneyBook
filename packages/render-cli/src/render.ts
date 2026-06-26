import { stderr } from "node:process";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
  buildPageGrid,
  buildLocationPage,
  buildRouteAtlas,
  selectPageLandmarks,
  type AtlasContract,
  type AtlasPage,
  type BBox,
  type LandmarkMarker,
  type LngLat,
  type MapTier,
  type PlacedLandmark,
  type AtlasOverview,
  type UsngGridOverlay,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToFile, type RouteOverlay } from "@journeybook/pdf-client";
import { renderMapPanel, buildUsngGrid, buildAtlasOverview } from "@journeybook/map-sources";

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

export async function renderAtlas(input: RenderAtlasInput): Promise<RenderAtlasResult> {
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
  }
  locationList.forEach((loc, i) => {
    // Each location may carry its own scale (zoom in for a small town/house);
    // fall back to the project scale. buildLocationPage stamps page.scale, so the
    // page renders a truthful scale bar even in a mixed-scale atlas.
    const locScale =
      loc.scalePresetId !== undefined
        ? SCALE_PRESETS.find((p) => p.id === loc.scalePresetId)
        : scale;
    if (!locScale) {
      throw new Error(
        `Unknown scalePresetId "${loc.scalePresetId}" for location ${loc.label ?? `L${i + 1}`}. Available: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
      );
    }
    pages.push(buildLocationPage(loc.center, locScale, LETTER_PORTRAIT, `L${i + 1}`, input.tier, loc.label));
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

  const panelOptions =
    input.tileBaseUrl || input.tileSourceId || input.cacheDir
      ? {
          ...(input.tileBaseUrl ? { tileBaseUrl: input.tileBaseUrl } : {}),
          ...(input.tileSourceId ? { sourceId: input.tileSourceId } : {}),
          ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
        }
      : undefined;

  let panels: Record<string, string> | undefined;
  if (input.basemap) {
    panels = {};
    for (const page of contract.pages) {
      try {
        const panel = await renderMapPanel(page.bbox, 1000, undefined, panelOptions);
        panels[page.id] = `data:image/png;base64,${panel.png.toString("base64")}`;
        stderr.write(`  panel ${page.id} (z${panel.zoom})\n`);
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
      stops: locationList.map((loc, i) => ({ center: loc.center, label: loc.label ?? `L${i + 1}` })),
    });
    if (input.basemap) {
      try {
        const panel = await renderMapPanel(overview.bbox, 1000, undefined, panelOptions);
        overviewPanel = `data:image/png;base64,${panel.png.toString("base64")}`;
        stderr.write(`  overview panel (z${panel.zoom})\n`);
      } catch (err) {
        // Non-fatal: the overview still renders with page rectangles over a blank panel.
        stderr.write(`  overview panel skipped: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  await renderAtlasPdfToFile({
    contract,
    outputPath: input.outputPath,
    panels,
    grids,
    routes,
    landmarks,
    tableOfContents: input.tableOfContents ?? true,
    overview,
    overviewPanel,
  });

  return {
    outputPath: input.outputPath,
    pageCount: contract.pages.length,
    attribution: input.basemap
      ? "Map data: USGS National Map (public domain)"
      : "JourneyBook atlas",
    contract,
    grids: grids ?? {},
    landmarks,
    polyline: routePolyline,
  };
}
