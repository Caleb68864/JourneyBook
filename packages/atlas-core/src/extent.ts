import type { BBox, LngLat } from "./model.js";

export interface EnclosingBBoxOptions {
  /** Padding on each side as a fraction of the point-cloud span. Default 0.05 (5%). */
  padFraction?: number;
  /**
   * Minimum padding in degrees, so a single point (zero span) or a tight cluster
   * still yields a usable box instead of a degenerate one. Default 0.02°.
   */
  minPadDegrees?: number;
}

/**
 * The smallest padded WGS84 box enclosing every point — the "cover all my
 * locations" extent. Shared by the CLI (`--cover`) and the web editor's
 * "Enclose N Locations" so both produce the same grid for the same stops.
 * Padding is clamped to the valid lng/lat range.
 */
export function enclosingBBox(points: readonly LngLat[], options: EnclosingBBoxOptions = {}): BBox {
  if (points.length === 0) {
    throw new Error("enclosingBBox requires at least one point.");
  }
  const padFraction = options.padFraction ?? 0.05;
  const minPad = options.minPadDegrees ?? 0.02;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  const padX = Math.max((e - w) * padFraction, minPad);
  const padY = Math.max((n - s) * padFraction, minPad);
  return [
    Math.max(-180, w - padX),
    Math.max(-90, s - padY),
    Math.min(180, e + padX),
    Math.min(90, n + padY),
  ];
}
