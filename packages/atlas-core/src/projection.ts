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
 * Build a fixed UTM-zone projector for the given zone (northern hemisphere,
 * k0 = 0.9996). Unlike <see cref="createProjector"/>, this is a standard UTM
 * grid — the correct metric plane for USNG/MGRS grid lines, which are defined
 * in UTM zones rather than a page-centred tmerc. Northern hemisphere only (no
 * `+south` false-northing offset); correct for CONUS, and the polar/southern
 * cases are out of scope.
 */
export function createUtmProjector(zone: number): Projector {
  const definition =
    `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;

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
