import type { BBox } from "@journeybook/atlas-core";

/** Web Mercator (EPSG:3857) tile/pixel math, 256 px tiles. */
export const TILE_SIZE = 256;

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6378137;

export interface Pixel {
  x: number;
  y: number;
}

export interface TileRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function worldSizePx(zoom: number): number {
  return TILE_SIZE * 2 ** zoom;
}

/** Global pixel coordinates of a lng/lat at a zoom level. */
export function lngLatToGlobalPixel(lng: number, lat: number, zoom: number): Pixel {
  const world = worldSizePx(zoom);
  const x = ((lng + 180) / 360) * world;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.min(Math.max(sinLat, -0.9999), 0.9999);
  const y = (0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI)) * world;
  return { x, y };
}

/** Ground metres per pixel at a latitude and zoom (Web Mercator). */
export function groundResolutionMetersPerPixel(lat: number, zoom: number): number {
  return (Math.cos((lat * Math.PI) / 180) * EARTH_CIRCUMFERENCE_M) / worldSizePx(zoom);
}

/** Smallest zoom whose bbox width (at the bbox's mid-latitude) ≥ targetWidthPx. */
export function zoomForBBox(bbox: BBox, targetWidthPx: number): number {
  const [west, south, east, north] = bbox;
  const midLat = (south + north) / 2;
  for (let zoom = 0; zoom <= 20; zoom++) {
    const widthPx =
      lngLatToGlobalPixel(east, midLat, zoom).x - lngLatToGlobalPixel(west, midLat, zoom).x;
    if (widthPx >= targetWidthPx) return zoom;
  }
  return 20;
}

/** Inclusive XYZ tile index range covering a bbox at a zoom. */
export function tileRangeForBBox(bbox: BBox, zoom: number): TileRange {
  const [west, south, east, north] = bbox;
  const topLeft = lngLatToGlobalPixel(west, north, zoom);
  const bottomRight = lngLatToGlobalPixel(east, south, zoom);
  return {
    minX: Math.floor(topLeft.x / TILE_SIZE),
    minY: Math.floor(topLeft.y / TILE_SIZE),
    maxX: Math.floor(bottomRight.x / TILE_SIZE),
    maxY: Math.floor(bottomRight.y / TILE_SIZE),
  };
}
