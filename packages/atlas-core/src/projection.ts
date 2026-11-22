import proj4 from "proj4";
import type { BBox, LngLat } from "./model.js";

const WGS84 = "EPSG:4326";

/** Geocentric (ECEF) CRS on the WGS84 ellipsoid, metres. */
const ECEF = "+proj=geocent +datum=WGS84 +units=m +no_defs";

/** UTM zone number (1–60) for a longitude in degrees. Kept for MGRS/UTM grids. */
export function utmZoneForLongitude(lng: number): number {
  const normalized = ((lng + 180) % 360 + 360) % 360; // wrap to [0, 360)
  return Math.floor(normalized / 6) + 1;
}

/**
 * The UTM zone of a point, with the two standard exceptions MGRS defines: zone 32 widened to
 * 3°E–12°E between 56°N and 64°N (south-west Norway), and zones 31, 33, 35 and 37 widened to
 * 0–9°, 9–21°, 21–33° and 33–42°E between 72°N and 84°N (Svalbard), where 32, 34 and 36 do not
 * exist. Everywhere else it is {@link utmZoneForLongitude}.
 */
export function utmZoneFor(lng: number, lat: number): number {
  return utmZoneRange(lng, lat).zone;
}

/** The zone of a point and the longitudes its zone spans at that latitude, west inclusive. */
export function utmZoneRange(lng: number, lat: number): { zone: number; west: number; east: number } {
  if (lat >= 56 && lat < 64) {
    if (lng >= 3 && lng < 12) return { zone: 32, west: 3, east: 12 };
    if (lng >= 0 && lng < 3) return { zone: 31, west: 0, east: 3 };
  }
  if (lat >= 72 && lat < 84 && lng >= 0 && lng < 42) {
    if (lng < 9) return { zone: 31, west: 0, east: 9 };
    if (lng < 21) return { zone: 33, west: 9, east: 21 };
    if (lng < 33) return { zone: 35, west: 21, east: 33 };
    return { zone: 37, west: 33, east: 42 };
  }
  const zone = utmZoneForLongitude(lng);
  const west = (zone - 1) * 6 - 180;
  return { zone, west, east: west + 6 };
}

/** A page-local projector: WGS84 <-> a metric plane (UTM zone of the centre). */
export interface Projector {
  /** proj4 definition string for the metric CRS. */
  definition: string;
  forward(point: LngLat): [x: number, y: number];
  inverse(point: [x: number, y: number]): LngLat;
}

/**
 * Build a page-centred transverse-Mercator projector (central meridian and
 * origin latitude at <paramref name="center"/>, k0 = 1). Conformal and metric,
 * with the scale-true line running through the page centre — so a printed scale
 * bar is true at the page rather than drifting like a fixed UTM zone or Web
 * Mercator. (See <see cref="utmZoneForLongitude"/> for later MGRS/UTM grids.)
 */
export function createProjector(center: LngLat): Projector {
  const definition =
    `+proj=tmerc +lat_0=${center.lat} +lon_0=${center.lng} ` +
    `+k_0=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs`;

  return {
    definition,
    forward(point) {
      const [x, y] = proj4(WGS84, definition, [point.lng, point.lat]);
      return [x, y];
    },
    inverse([x, y]) {
      const [lng, lat] = proj4(definition, WGS84, [x, y]);
      return { lng, lat };
    },
  };
}

/**
 * Build a fixed UTM-zone projector for the given zone (k0 = 0.9996). Unlike
 * <see cref="createProjector"/>, this is a standard UTM grid — the correct metric plane for
 * USNG/MGRS grid lines, which are defined in UTM zones rather than a page-centred tmerc.
 * `south` adds the southern hemisphere's 10,000,000 m false northing, so northings there are
 * the positive values a southern map prints. Directions (grid north, azimuths) are the same
 * either way; only the northing numbers differ.
 */
export function createUtmProjector(zone: number, south = false): Projector {
  const definition =
    `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;

  return {
    definition,
    forward(point) {
      const [x, y] = proj4(WGS84, definition, [point.lng, point.lat]);
      return [x, y];
    },
    inverse([x, y]) {
      const [lng, lat] = proj4(definition, WGS84, [x, y]);
      return { lng, lat };
    },
  };
}

/**
 * The WGS84 axis-aligned bounding box of one page's printable area, centred on
 * `center` and covering `2 * halfWidthMeters` by `2 * halfHeightMeters` of ground.
 *
 * The projector is built **about this page's own centre**, which is what keeps a
 * page true to its scale. Projecting a whole multi-page extent through one shared
 * projector looks equivalent but is not: away from that projector's central
 * meridian, meridian convergence rotates the page rectangle relative to the
 * lat/lng axes (by roughly `Δλ · sin φ`), so the axis-aligned box that contains it
 * inflates. The error grows with distance from the central meridian — at 1:100,000
 * on Letter it reaches ~0.7% at 40 km and ~1.1% at 60 km, enough to fail the
 * {@link validateAtlas} footprint check and to print a scale bar that lies.
 * Re-centring per page holds the error flat at ~0.17% (the residual is the
 * unavoidable box-around-a-curved-quad term) wherever the page sits.
 *
 * Adjacent pages therefore no longer share exactly coincident bbox edges; they
 * overlap or gap by that same fraction of a page. That is the better trade: page
 * ids carry neighbour continuity, while the scale bar is a promise about ground
 * truth on the sheet in your hand.
 */
export function pageBBoxAround(
  center: LngLat,
  halfWidthMeters: number,
  halfHeightMeters: number,
): BBox {
  const projector = createProjector(center);
  const [cx, cy] = projector.forward(center);
  const corners: LngLat[] = [
    projector.inverse([cx - halfWidthMeters, cy - halfHeightMeters]),
    projector.inverse([cx - halfWidthMeters, cy + halfHeightMeters]),
    projector.inverse([cx + halfWidthMeters, cy - halfHeightMeters]),
    projector.inverse([cx + halfWidthMeters, cy + halfHeightMeters]),
  ];
  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => c.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Straight-line ground distance between two WGS84 points, in metres, computed
 * on the WGS84 ellipsoid via ECEF. This is the chord, which is within ~0.2 m of
 * the geodesic for spans up to a few hundred km — accurate enough for atlas
 * pages and ellipsoid-consistent with the projector.
 */
export function geodesicDistanceMeters(a: LngLat, b: LngLat): number {
  const [ax, ay, az] = proj4(WGS84, ECEF, [a.lng, a.lat, 0]);
  const [bx, by, bz] = proj4(WGS84, ECEF, [b.lng, b.lat, 0]);
  return Math.hypot(bx - ax, by - ay, bz - az);
}
