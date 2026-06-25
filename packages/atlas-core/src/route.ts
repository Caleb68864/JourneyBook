import {
  DEFAULT_MAP_TIER,
  MAX_ATLAS_PAGES,
  type AtlasPage,
  type BBox,
  type LngLat,
  type MapTier,
  type ScalePreset,
} from "./model.js";
import { groundFootprintMeters, type PageSpec } from "./page.js";
import { createProjector, geodesicDistanceMeters, type Projector } from "./projection.js";

function planeRectToBBox(
  projector: Projector,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): BBox {
  const corners: LngLat[] = [
    projector.inverse([cx - halfW, cy - halfH]),
    projector.inverse([cx - halfW, cy + halfH]),
    projector.inverse([cx + halfW, cy - halfH]),
    projector.inverse([cx + halfW, cy + halfH]),
  ];
  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => c.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

interface CorridorCandidate {
  center: LngLat;
  px: number;
  py: number;
}

/** Tile candidate corridor page centres along a single planar segment. */
function tileSegment(
  projector: Projector,
  p0: [number, number],
  p1: [number, number],
  stepMeters: number,
): CorridorCandidate[] {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [];

  const count = Math.max(1, Math.ceil(len / stepMeters));
  const actualStep = len / count;
  const ux = dx / len;
  const uy = dy / len;

  const results: CorridorCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) * actualStep;
    const px = p0[0] + t * ux;
    const py = p0[1] + t * uy;
    results.push({ center: projector.inverse([px, py]), px, py });
  }
  return results;
}

export interface BuildRouteAtlasOptions {
  /** Ordered stop centres — define legs and location-page centres for dedup. */
  stops: LngLat[];
  /**
   * Ordered polyline the corridor pages follow. Defaults to straight-line
   * segments between consecutive stops when omitted. This is the path-source
   * seam: swap in a denser routing polyline here without touching corridor-tiling
   * or dedup logic.
   */
  orderedCenters?: LngLat[];
  scale: ScalePreset;
  page: PageSpec;
  tier?: MapTier;
}

export interface RouteAtlasResult {
  /** Corridor pages with ids R1…Rn and route-following neighbors. */
  pages: AtlasPage[];
  /** Route polyline in global LngLat, independent of projector frame. */
  polyline: LngLat[];
}

/**
 * Tile fixed-scale Letter corridor pages (R1…Rn) along the polyline connecting
 * ordered stops, then de-duplicate near-coincident pages against each other and
 * against stops' location-page centres.
 */
export function buildRouteAtlas(options: BuildRouteAtlasOptions): RouteAtlasResult {
  const { stops, scale, page } = options;
  const tier = options.tier ?? DEFAULT_MAP_TIER;

  // Path-source seam: caller-supplied polyline or straight-line between stops.
  const polyline: LngLat[] = options.orderedCenters ?? stops;

  if (stops.length < 2 || polyline.length < 2) {
    return { pages: [], polyline };
  }

  // stops.length >= 2 is guaranteed by the early-return above.
  const projector = createProjector(stops[0]!);
  const fp = groundFootprintMeters(scale, page);
  const halfW = fp.widthMeters / 2;
  const halfH = fp.heightMeters / 2;
  // Dedup radius: half the smaller page dimension.
  const dedupRadius = Math.min(halfW, halfH);

  // Tile candidates along every consecutive polyline segment.
  const candidates: CorridorCandidate[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const p0 = projector.forward(a);
    const p1 = projector.forward(b);
    candidates.push(...tileSegment(projector, p0, p1, fp.widthMeters));
  }

  // Fail fast before the O(n²) dedup: a route that tiles more corridor pages than
  // the whole-atlas cap can never fit (dedup only ever reduces the count, never
  // below the limit for a non-self-overlapping route). Throwing here keeps a
  // cross-country route from spending seconds in dedup only to be rejected by the
  // render-side page cap. Message references the cap so the render guard and this
  // one read the same.
  if (candidates.length > MAX_ATLAS_PAGES) {
    throw new Error(
      `Invalid request: this route produces ${candidates.length} corridor pages at ${scale.id}, ` +
        `exceeding the ${MAX_ATLAS_PAGES}-page limit. Use fewer or closer stops, or a coarser scale.`,
    );
  }

  // Dedup pass: greedy keep-first, drop if within dedupRadius of any stop or
  // already-kept corridor page centre (tested via geodesic distance).
  const keptCenters: LngLat[] = [];
  const kept: CorridorCandidate[] = [];

  for (const candidate of candidates) {
    let tooClose = false;

    for (const stop of stops) {
      if (geodesicDistanceMeters(candidate.center, stop) <= dedupRadius) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    for (const keptCenter of keptCenters) {
      if (geodesicDistanceMeters(candidate.center, keptCenter) <= dedupRadius) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    keptCenters.push(candidate.center);
    kept.push(candidate);
  }

  const pages: AtlasPage[] = kept.map(({ px, py }, i) => ({
    id: `R${i + 1}`,
    bbox: planeRectToBBox(projector, px, py, halfW, halfH),
    orientation: page.orientation,
    tier,
    scale,
    neighbors: {
      west: i > 0 ? `R${i}` : undefined,
      east: i < kept.length - 1 ? `R${i + 2}` : undefined,
    },
  }));

  return { pages, polyline };
}
