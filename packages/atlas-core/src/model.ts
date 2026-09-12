/**
 * Core atlas types and constants — the leaf module every engine module imports
 * from. (index.ts is a barrel that re-exports this plus the engine modules;
 * importing from the leaf avoids an init cycle.)
 */

// ---------------------------------------------------------------------------
// Letter page geometry (see roadmap: Exact Letter Page Sizing)
// ---------------------------------------------------------------------------

/** PDF user-space points per inch. */
export const POINTS_PER_INCH = 72;

/** US Letter dimensions in PDF points (8.5in x 11in). */
export const LETTER_PORTRAIT_PT = { width: 612, height: 792 } as const;

export type PageOrientation = "portrait" | "landscape";

export interface PageMargins {
  /** inches */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** optional binder gutter in inches, added to the binding edge */
  gutter?: number;
}

/** Conservative default safe margins for home printers (inches). */
export const DEFAULT_MARGINS: PageMargins = {
  top: 0.5,
  right: 0.5,
  bottom: 0.5,
  left: 0.5,
};

// ---------------------------------------------------------------------------
// Standard scale presets (roadmap: first-class "same ground footprint" feature)
// ---------------------------------------------------------------------------

export interface ScalePreset {
  /** stable id used in persistence and the API */
  id: string;
  /** human label shown in the UI */
  label: string;
  /** map scale denominator: 1 : ratio (e.g. 24000) */
  ratio: number;
  /**
   * Basemap panel width this preset asks for, in pixels, measured across the
   * **Letter-portrait** map box (5.7639 in). `panelWidthPxFor` rescales it to
   * whatever map box a page actually has, so the request survives landscape and
   * a binder gutter instead of being a portrait-only number.
   *
   * Why per preset. `renderMapPanel` crops at native tile resolution and never
   * resamples, so the requested width is a **floor**: it selects a Web-Mercator
   * zoom, and the delivered panel is 1x-2x the request. Delivered DPI is
   * therefore an accident of where a preset's page falls relative to a zoom
   * boundary, and at the old flat default of 1000 px it swung by a factor of two
   * across the menu. Every preset here is given the width that reaches
   * {@link PRINT_DPI_TARGET} for its own page rather than one global number.
   *
   * Read {@link DEFAULT_PANEL_WIDTH_PX} on `usgs-7-5-min` as a deliberate
   * exception, not an oversight — see the constant.
   *
   * NOT persisted. The database's `ScalePresets` table carries `id`, `label` and
   * `ratio` only; this is an engine concern the API never sends and never reads,
   * which is why `ScalePresetParityTests` compares those three columns and not
   * this one.
   */
  panelWidthPx: number;
}

/**
 * The historic flat panel width, and still what `usgs-7-5-min` asks for.
 *
 * 1000 px over the 5.7639 in Letter-portrait map box is a request for **173
 * DPI**. It stays on the headline preset by an explicit owner decision: at
 * 41 degrees N a 1:24,000 page lands 1.95x past a zoom boundary and delivers
 * 338 DPI for free, so raising it there would cost tiles and bytes for nothing.
 *
 * That is a statement about 41 degrees N and nowhere else. An unclamped page
 * delivers anywhere from 1x to 2x what it asks for, and where it lands moves with
 * latitude — the 338 figure is one point on that band, not a property.
 *
 * The band itself is deliberately NOT written here. It is measured by the engine
 * into `apps/web/src/generated/print-resolution.json` (what the scale picker
 * shows) and `docs/print-resolution.md`, by `scripts/generate-print-resolution.mjs`,
 * and CI fails when either is stale. This comment used to carry "174-346 DPI
 * across 18-72N" while the owner had been told "174-343 across 20-70N" — two
 * hand-typed statements of one measurement, over different ranges, checked by
 * nothing. Read the table; do not copy a figure out of it into prose.
 */
export const DEFAULT_PANEL_WIDTH_PX = 1078;

/**
 * Panel width asking for {@link PRINT_DPI_TARGET} across the Letter-portrait map
 * box: `panelWidthPxForDpi(mapBoxInches(LETTER_PORTRAIT).widthIn, 300)`.
 *
 * Pinned as a literal here, and asserted equal to that call in
 * `packages/atlas-core/src/scale-presets.test.ts`, because `model.ts` is the leaf
 * every engine module imports from and cannot import the module that computes it
 * without an init cycle.
 */
export const PRINT_TARGET_PANEL_WIDTH_PX = 1863;

/**
 * Named presets. Choosing a scale fixes the ground footprint of every page,
 * so all saved-location pages cover the same amount of surrounding terrain.
 *
 * `id`/`label`/`ratio` are duplicated in the database seed
 * (`ScalePresetConfiguration.HasData`), because the API validates project and
 * location writes against the table rather than against this list. The two are
 * held together by `ScalePresetParityTests` in the .NET suite, which reads THIS
 * file; adding a preset in one place without the other now fails the build
 * instead of producing a project the API accepts and the engine rejects.
 */
export const SCALE_PRESETS: readonly ScalePreset[] = [
  { id: "usgs-7-5-min", label: "7.5-minute (1:24,000)", ratio: 24000, panelWidthPx: DEFAULT_PANEL_WIDTH_PX },
  { id: "1-25000", label: "1:25,000", ratio: 25000, panelWidthPx: PRINT_TARGET_PANEL_WIDTH_PX },
  { id: "usgs-15-min", label: "15-minute (1:62,500)", ratio: 62500, panelWidthPx: PRINT_TARGET_PANEL_WIDTH_PX },
  { id: "1-50000", label: "1:50,000", ratio: 50000, panelWidthPx: PRINT_TARGET_PANEL_WIDTH_PX },
  { id: "1-100000", label: "1:100,000", ratio: 100000, panelWidthPx: PRINT_TARGET_PANEL_WIDTH_PX },
] as const;

export const DEFAULT_SCALE_PRESET_ID = "usgs-7-5-min";

// ---------------------------------------------------------------------------
// Core geographic + page-grid contract types
// ---------------------------------------------------------------------------

/** WGS84 bounding box [west, south, east, north] in degrees. */
export type BBox = [west: number, south: number, east: number, north: number];

/** WGS84 point. */
export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * Map tier (learning-curve level) selecting which navigation furniture is drawn:
 * 1 road-atlas grid, 2 + scale bar & compass, 3 + UTM/USNG grid, 4 + full MGRS
 * & azimuth/declination. Additive — a Level 4 page is a Level 1 page with more.
 *
 * Level 4 is **not implemented by any renderer**: `AtlasDocument` gates its extra
 * furniture on `tier >= 3`, so a Level 4 page prints exactly like a Level 3 one.
 * The value stays in the type because the contract and the roadmap keep it; the
 * web tier picker deliberately does not offer it (see `TIER_OPTIONS`).
 */
export type MapTier = 1 | 2 | 3 | 4;

/** Default tier: road-atlas grid (friendly, zero learning curve). */
export const DEFAULT_MAP_TIER: MapTier = 1;

/**
 * Upper bound on pages a single atlas render may produce — a guard against a huge
 * bbox exhausting memory/time. The render engine enforces it; the UI uses it to
 * warn before a too-large extent is confirmed.
 */
export const MAX_ATLAS_PAGES = 200;

/** A location's custom map-pin style (shape id + hex color); both optional → defaults. */
export interface PinStyle {
  shape?: string;
  color?: string;
}

/** A single page in the atlas grid. */
export interface AtlasPage {
  /** grid id such as "A1", "B2", or a location id such as "L1" */
  id: string;
  /** projected extent of this page's printable map area */
  bbox: BBox;
  orientation: PageOrientation;
  /**
   * Optional human title for the page — the location's name on a location (`L#`)
   * page. Drives the locations table of contents in the rendered PDF. Grid and
   * corridor pages leave it undefined.
   */
  title?: string;
  /** map tier (learning-curve level) driving page furniture */
  tier: MapTier;
  /**
   * Custom map pin for a location (`L#`) page — drawn at the page centre marking
   * the exact spot. Undefined on grid/corridor pages.
   */
  pin?: PinStyle;
  /** Optional saved notes for a location page, printed in the page's notes area. */
  notes?: string;
  /**
   * Optional per-page scale, overriding the contract scale for this page. Lets a
   * single atlas mix scales — e.g. a small-town/country-house location page zoomed
   * in at 1:24,000 while a regional page stays coarse. Falls back to
   * {@link AtlasContract.scale} when undefined (the common case; grid pages omit it).
   */
  scale?: ScalePreset;
  /** neighbor page ids by cardinal direction, when present */
  neighbors: Partial<Record<"north" | "south" | "east" | "west", string>>;
}

/** The page-grid + page-furniture contract shared by all renderers. */
export interface AtlasContract {
  version: 1;
  scale: ScalePreset;
  margins: PageMargins;
  pages: AtlasPage[];
}

/**
 * USNG/MGRS grid overlay for a page panel — generated by buildUsngGrid in map-sources.
 * All x/y coordinates are normalized [0,1] with top-left origin.
 */
export interface UsngGridOverlay {
  lines: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    axis: "easting" | "northing";
  }[];
  labels: {
    x: number;
    y: number;
    text: string;
    edge: "top" | "bottom" | "left" | "right";
  }[];
  collar: { zoneDesignator: string; hundredKmSquare: string };
}

/**
 * Whole-atlas index/overview — generated by buildAtlasOverview in map-sources.
 * Shows where each content page sits across the trip. All x/y are normalized
 * [0,1] (top-left origin) within {@link bbox}; the renderer fetches a basemap
 * panel for `bbox` and draws the page rectangles, route, and stops on top.
 */
export interface AtlasOverview {
  /** Overall WGS84 bbox covering all pages (padded); the overview panel's extent. */
  bbox: BBox;
  /** Each content page's rectangle in normalized overview coordinates. */
  pages: { id: string; x: number; y: number; w: number; h: number }[];
  /** Optional route polyline (corridor/route mode) in normalized coordinates. */
  route?: { x: number; y: number }[];
  /** Optional stop markers (saved locations) in normalized coordinates. */
  stops?: { x: number; y: number; label: string; pin?: PinStyle }[];
}

/** Library version marker. */
export const ATLAS_CORE_VERSION = "0.0.0";
