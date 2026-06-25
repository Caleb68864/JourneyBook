/**
 * @journeybook/map-sources
 *
 * Tile-source registry, PMTiles reader/proxy helpers, and attribution
 * resolution. Stage 0 skeleton: types + attribution stub. Readers land in
 * Stage 1C / Stage 3.
 */

export type TileFormat = "mvt" | "pbf" | "png" | "webp";

/** Cache policy captured per source so attribution + terms travel with cache. */
export interface TileCachePolicy {
  /** seconds the browser/device may cache a tile response */
  maxAgeSeconds: number;
  /** whether the source permits building offline/extracted packages */
  offlineAllowed: boolean;
}

export interface TileSource {
  id: string;
  provider: string;
  /** URL template or PMTiles archive URL */
  url: string;
  format: TileFormat;
  maxZoom: number;
  /** required attribution string, e.g. "© OpenStreetMap contributors" */
  attribution: string;
  version?: string;
  cache: TileCachePolicy;
}

/** Compose a single attribution footer line from one or more sources. */
export function composeAttribution(sources: readonly TileSource[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of sources) {
    if (s.attribution && !seen.has(s.attribution)) {
      seen.add(s.attribution);
      parts.push(s.attribution);
    }
  }
  return parts.join(" · ");
}

export * from "./tilemath.js";
export * from "./panel.js";
export * from "./tilecache.js";
export * from "./usng-grid.js";

export const MAP_SOURCES_VERSION = "0.0.0";
