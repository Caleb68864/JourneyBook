/**
 * Per-page landmark selection and label placement.
 *
 * Landmarks are *additive furniture* layered onto a page panel, exactly like the
 * {@link UsngGridOverlay} grid: a renderer draws them on top of the basemap and
 * a page without them is still complete. This module is pure — given the same
 * input landmarks, page extent and options it always produces the same output —
 * so it is safe to call from the engine, the validator and tests alike.
 *
 * Import types from the leaf `./model.js`, never the barrel `./index.js`, to
 * avoid an initialization cycle (see model.ts header).
 */

import type { AtlasPage, BBox } from "./model.js";

/**
 * A candidate landmark in WGS84, scored for selection. The contract type that
 * flows from a data source (e.g. the Overpass importer) into page placement.
 * Additive furniture, like {@link UsngGridOverlay}.
 */
export interface LandmarkMarker {
  lng: number;
  lat: number;
  name: string;
  category: string;
  /** selection priority; higher wins ties and bucket contests */
  score: number;
}

/**
 * A landmark placed onto a single page panel. `x`/`y` are normalized to the page
 * printable area in [0,1] with a top-left origin (matching
 * {@link UsngGridOverlay}). `labelPlaced` is false when the greedy collision
 * pass dropped the text label (the marker glyph may still be drawn).
 */
export interface PlacedLandmark {
  /** normalized [0,1], left = 0 */
  x: number;
  /** normalized [0,1], top = 0 */
  y: number;
  name: string;
  category: string;
  score: number;
  /** whether the text label survived greedy collision avoidance */
  labelPlaced: boolean;
}

/** A normalized rectangle on the page panel ([0,1], top-left origin). */
export interface FurnitureZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectPageLandmarksOptions {
  /** maximum markers to select; clamped to the hard cap of 6. Default 6. */
  cap?: number;
  /** coarse bucket columns for spatial distribution. Default 3. */
  bucketCols?: number;
  /** coarse bucket rows for spatial distribution. Default 3. */
  bucketRows?: number;
  /** normalized label box width used for collision tests. Default 0.18. */
  labelWidth?: number;
  /** normalized label box height used for collision tests. Default 0.05. */
  labelHeight?: number;
  /** declared zones (scale bar, compass, collar) labels must avoid. */
  furnitureZones?: FurnitureZone[];
}

/** Hard upper bound on selected markers per page, regardless of opts.cap. */
export const MAX_PAGE_LANDMARKS = 6;

const DEFAULT_BUCKET_COLS = 3;
const DEFAULT_BUCKET_ROWS = 3;
const DEFAULT_LABEL_WIDTH = 0.18;
const DEFAULT_LABEL_HEIGHT = 0.05;

/**
 * Deterministic ordering: highest score first, then by name, then by position.
 * Used everywhere a stable order matters so identical input yields identical
 * output across runs.
 */
function compareForSelection(a: LandmarkMarker, b: LandmarkMarker): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.lng !== b.lng) return a.lng - b.lng;
  return a.lat - b.lat;
}

/** Normalize a WGS84 point to the page bbox, top-left origin. */
function normalize(
  lng: number,
  lat: number,
  [west, south, east, north]: BBox,
): { x: number; y: number } {
  const w = east - west;
  const h = north - south;
  const x = w === 0 ? 0 : (lng - west) / w;
  const y = h === 0 ? 0 : (north - lat) / h;
  return { x, y };
}

/** Whether a WGS84 point falls inside the page bbox (inclusive). */
function withinBBox(lng: number, lat: number, [west, south, east, north]: BBox): boolean {
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/** Axis-aligned rectangle overlap test (touching edges do not count). */
function rectsOverlap(a: FurnitureZone, b: FurnitureZone): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** The normalized label box for a placed marker, centred over its point. */
function labelRect(p: PlacedLandmark, labelWidth: number, labelHeight: number): FurnitureZone {
  return {
    x: p.x - labelWidth / 2,
    y: p.y - labelHeight / 2,
    width: labelWidth,
    height: labelHeight,
  };
}

/**
 * Greedy label collision avoidance. Walks markers in selection order (so by
 * descending score) and keeps a label only when its box overlaps neither an
 * already-kept label nor any declared furniture zone; otherwise the lower-score
 * label is dropped (`labelPlaced = false`). Mutates and returns `placed`.
 */
export function resolveLabelCollisions(
  placed: PlacedLandmark[],
  opts: SelectPageLandmarksOptions = {},
): PlacedLandmark[] {
  const labelWidth = opts.labelWidth ?? DEFAULT_LABEL_WIDTH;
  const labelHeight = opts.labelHeight ?? DEFAULT_LABEL_HEIGHT;
  const furnitureZones = opts.furnitureZones ?? [];

  const keptRects: FurnitureZone[] = [];
  for (const p of placed) {
    const rect = labelRect(p, labelWidth, labelHeight);
    const hitsFurniture = furnitureZones.some((z) => rectsOverlap(rect, z));
    const hitsLabel = keptRects.some((r) => rectsOverlap(rect, r));
    if (hitsFurniture || hitsLabel) {
      p.labelPlaced = false;
    } else {
      p.labelPlaced = true;
      keptRects.push(rect);
    }
  }
  return placed;
}

/**
 * Select a spatially distributed, capped set of landmarks for a single page.
 *
 * 1. Keep only landmarks inside the page bbox.
 * 2. Bucket them onto a coarse grid (default 3×3) and keep the single
 *    highest-score marker per bucket — distributing selections across the page
 *    instead of clustering them.
 * 3. Take the top `cap` bucket winners by score (capped at {@link MAX_PAGE_LANDMARKS}).
 * 4. Run greedy label collision avoidance over the result.
 *
 * Deterministic: identical input yields identical output ordering across runs.
 */
export function selectPageLandmarks(
  landmarks: LandmarkMarker[],
  page: AtlasPage,
  opts: SelectPageLandmarksOptions = {},
): PlacedLandmark[] {
  const cap = Math.min(opts.cap ?? MAX_PAGE_LANDMARKS, MAX_PAGE_LANDMARKS);
  const bucketCols = Math.max(1, opts.bucketCols ?? DEFAULT_BUCKET_COLS);
  const bucketRows = Math.max(1, opts.bucketRows ?? DEFAULT_BUCKET_ROWS);
  const bbox = page.bbox;

  if (cap <= 0) return [];

  // Stable input order first, so bucket contests and final ordering are
  // independent of the caller's array order.
  const sorted = [...landmarks]
    .filter((m) => withinBBox(m.lng, m.lat, bbox))
    .sort(compareForSelection);

  // Bucket the markers; the first marker to claim a bucket (highest score, by
  // the sort above) wins it — guaranteeing no two winners share a bucket.
  const winners = new Map<string, LandmarkMarker>();
  for (const m of sorted) {
    const { x, y } = normalize(m.lng, m.lat, bbox);
    const col = Math.min(bucketCols - 1, Math.floor(x * bucketCols));
    const row = Math.min(bucketRows - 1, Math.floor(y * bucketRows));
    const key = `${col},${row}`;
    if (!winners.has(key)) winners.set(key, m);
  }

  const selected = [...winners.values()].sort(compareForSelection).slice(0, cap);

  const placed: PlacedLandmark[] = selected.map((m) => {
    const { x, y } = normalize(m.lng, m.lat, bbox);
    return {
      x,
      y,
      name: m.name,
      category: m.category,
      score: m.score,
      labelPlaced: true,
    };
  });

  return resolveLabelCollisions(placed, opts);
}
