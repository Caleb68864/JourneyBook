import type { LngLat } from "./model.js";
import { createUtmProjector, utmZoneForLongitude } from "./projection.js";
import { decimalYear, magneticField } from "./declination.js";

/**
 * The three norths at a point (Stage 6B Level 4): true north, grid north of the point's UTM zone
 * (the grid USNG/MGRS lines are drawn in), and magnetic north from WMM2025. All angles are
 * degrees measured from true north, east positive, like the WMM's declination.
 */
export interface ThreeNorths {
  /** Grid north's direction from true north (meridian convergence of the UTM zone). */
  gridConvergence: number;
  /** Magnetic north's direction from true north (declination). */
  declination: number;
  /** Magnetic north's direction from grid north: declination − convergence. The G-M angle. */
  gmAngle: number;
  /** Annual change of declination (and so of the G-M angle), degrees/year. */
  declinationPerYear: number;
  /** UTM zone whose grid north is meant. */
  utmZone: number;
  /** The decimal year the magnetic figures are for, and their model. */
  year: number;
  model: "WMM2025";
}

/**
 * Grid north's direction from true north at `p`, degrees, east positive. Measured, not
 * approximated: the points 5 m grid-south and grid-north of `p` in its UTM zone are projected
 * back, and the bearing between them taken (a central difference, so the grid line's curvature
 * cancels; a one-sided kilometre step was 0.0003° off). Grid north lies east of true north east of the central
 * meridian in the northern hemisphere.
 */
export function gridConvergence(p: LngLat): { degrees: number; utmZone: number } {
  const zone = utmZoneForLongitude(p.lng);
  const utm = createUtmProjector(zone);
  const [e, n] = utm.forward(p);
  const a = utm.inverse([e, n - 5]);
  const q = utm.inverse([e, n + 5]);
  // Bearing on the ellipsoid: a degree of longitude is N·cosφ long and a degree of latitude M
  // long (WGS 84 radii of curvature). Taking both as equal is a 0.4% error in the angle.
  const phi = (p.lat * Math.PI) / 180;
  const e2 = 0.00669437999014;
  const w = 1 - e2 * Math.sin(phi) ** 2;
  const nRadius = 1 / Math.sqrt(w);
  const mRadius = (1 - e2) / w ** 1.5;
  const degrees = (Math.atan2((q.lng - a.lng) * nRadius * Math.cos(phi), (q.lat - a.lat) * mRadius) * 180) / Math.PI;
  return { degrees, utmZone: zone };
}

/**
 * True, grid and magnetic north at `center` on `date`. Throws when WMM2025 does not cover the
 * date (outside 2025.0 to 2030.0) or at a pole, so a caller prints nothing rather than a stale
 * declination.
 */
export function threeNorths(center: LngLat, date: Date): ThreeNorths {
  const year = decimalYear(date);
  const field = magneticField(center.lat, center.lng, year);
  const grid = gridConvergence(center);
  return {
    gridConvergence: grid.degrees,
    declination: field.declination,
    gmAngle: field.declination - grid.degrees,
    declinationPerYear: field.declinationPerYear,
    utmZone: grid.utmZone,
    year,
    model: field.model,
  };
}

/** "2.1° E", "0.4° W", "0.0°": an angle from north as a navigator writes it. */
export function formatEastWest(degrees: number, digits = 1): string {
  const rounded = Number(degrees.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}°`;
  return `${Math.abs(rounded).toFixed(digits)}° ${rounded > 0 ? "E" : "W"}`;
}
