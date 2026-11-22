import type { LngLat } from "./model.js";
import { createUtmProjector, geodesicDistanceMeters, utmZoneForLongitude } from "./projection.js";
import { threeNorths } from "./north.js";

/** One stop on a worksheet: where it is, and what the atlas calls it. */
export interface WorksheetStop {
  /** The page id or label the stop is printed under ("L1", "Capitol"). */
  label: string;
  center: LngLat;
}

/** One leg of an azimuth worksheet, with its answers. Angles in degrees, 0 ≤ a < 360. */
export interface WorksheetLeg {
  from: string;
  to: string;
  /** Grid azimuth from the start, measured from grid north of the start's UTM zone. */
  gridAzimuth: number;
  /** The reverse direction: grid azimuth ± 180. */
  backAzimuth: number;
  /**
   * The magnetic azimuth to walk on a compass: grid azimuth − G-M angle at the start (G-M is
   * magnetic north's direction from grid north, east positive). Null when the magnetic model
   * does not cover the date.
   */
  magneticAzimuth: number | null;
  /** G-M angle used, degrees east positive; null with `magneticAzimuth`. */
  gmAngle: number | null;
  /** Ground distance, metres (geodesic on WGS 84). */
  distanceMeters: number;
  utmZone: number;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/**
 * The legs between consecutive stops (Stage 6B Level 4's azimuth worksheet). Azimuths are grid
 * azimuths in the start's UTM zone, the way a navigator plots them with a protractor on a
 * gridded map, then converted to magnetic with the start's G-M angle on `date`.
 */
export function worksheetLegs(stops: readonly WorksheetStop[], date: Date): WorksheetLeg[] {
  const legs: WorksheetLeg[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    const zone = utmZoneForLongitude(a.center.lng);
    const utm = createUtmProjector(zone);
    const [ea, na] = utm.forward(a.center);
    const [eb, nb] = utm.forward(b.center);
    const grid = norm((Math.atan2(eb - ea, nb - na) * 180) / Math.PI);
    let gm: number | null = null;
    try {
      gm = threeNorths(a.center, date).gmAngle;
    } catch {
      gm = null; // outside WMM2025: the magnetic column is left for the reader to say so
    }
    legs.push({
      from: a.label,
      to: b.label,
      gridAzimuth: grid,
      backAzimuth: norm(grid + 180),
      magneticAzimuth: gm === null ? null : norm(grid - gm),
      gmAngle: gm,
      distanceMeters: geodesicDistanceMeters(a.center, b.center),
      utmZone: zone,
    });
  }
  return legs;
}
