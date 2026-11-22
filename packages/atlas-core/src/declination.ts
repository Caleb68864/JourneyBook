import { WMM2025_COEFFICIENTS, WMM2025_EPOCH, WMM2025_VALID_UNTIL } from "./wmm2025.js";

/**
 * Magnetic declination from the World Magnetic Model 2025 (NOAA/NCEI, public domain), for
 * Stage 6B Level 4: the declination diagram and grid-magnetic conversion on a land-nav page.
 *
 * The algorithm is the WMM's own (the WMM2025 technical report, section 1.2): geodetic to
 * geocentric spherical coordinates on WGS 84, the degree-12 spherical-harmonic expansion with
 * Schmidt semi-normalized associated Legendre functions and time-adjusted Gauss coefficients,
 * then the field rotated back to the geodetic frame. Held to every row of NOAA's published test
 * values (`data/wmm/WMM2025_TestValues.txt`) by `declination.test.ts`.
 */

/** The field at a point and time, in the WMM's own units and sign conventions. */
export interface MagneticField {
  /** Declination, degrees, east positive: the angle from true north to magnetic north. */
  declination: number;
  /** Inclination (dip), degrees, down positive. */
  inclination: number;
  /** North, east and down components, and the horizontal and total intensities, nT. */
  x: number;
  y: number;
  z: number;
  h: number;
  f: number;
  /** Annual change of declination, degrees/year. */
  declinationPerYear: number;
  /** The model and epoch the figures come from, for printing beside them. */
  model: "WMM2025";
}

const WGS84_A = 6378.137; // km
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const REFERENCE_RADIUS = 6371.2; // km
const DEGREE = 12;
const RAD = Math.PI / 180;

const G: number[][] = [];
const H: number[][] = [];
const GDOT: number[][] = [];
const HDOT: number[][] = [];
for (let n = 0; n <= DEGREE; n++) {
  G.push(new Array(n + 1).fill(0));
  H.push(new Array(n + 1).fill(0));
  GDOT.push(new Array(n + 1).fill(0));
  HDOT.push(new Array(n + 1).fill(0));
}
for (const [n, m, g, h, gd, hd] of WMM2025_COEFFICIENTS) {
  G[n]![m] = g;
  H[n]![m] = h;
  GDOT[n]![m] = gd;
  HDOT[n]![m] = hd;
}

/** Schmidt semi-normalization factors S[n][m]. */
const SCHMIDT: number[][] = [];
for (let n = 0; n <= DEGREE; n++) {
  SCHMIDT.push(new Array(n + 1).fill(0));
  SCHMIDT[n]![0] = n === 0 ? 1 : (SCHMIDT[n - 1]![0]! * (2 * n - 1)) / n;
  for (let m = 1; m <= n; m++) {
    SCHMIDT[n]![m] = SCHMIDT[n]![m - 1]! * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
  }
}

/**
 * Associated Legendre functions P[n][m](sin φ') and their derivatives with respect to
 * geocentric latitude φ', Schmidt semi-normalized (Gauss recursion, then the factors above).
 */
function legendre(sinPhi: number, cosPhi: number): { p: number[][]; dp: number[][] } {
  const p: number[][] = [];
  const dp: number[][] = [];
  for (let n = 0; n <= DEGREE; n++) {
    p.push(new Array(n + 1).fill(0));
    dp.push(new Array(n + 1).fill(0));
  }
  p[0]![0] = 1;
  dp[0]![0] = 0;
  for (let n = 1; n <= DEGREE; n++) {
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        p[n]![m] = cosPhi * p[n - 1]![m - 1]!;
        dp[n]![m] = cosPhi * dp[n - 1]![m - 1]! - sinPhi * p[n - 1]![m - 1]!;
      } else {
        const k = n - 2 >= m ? ((n - 1) ** 2 - m ** 2) / ((2 * n - 1) * (2 * n - 3)) : 0;
        const p2 = n - 2 >= m ? p[n - 2]![m]! : 0;
        const dp2 = n - 2 >= m ? dp[n - 2]![m]! : 0;
        p[n]![m] = sinPhi * p[n - 1]![m]! - k * p2;
        dp[n]![m] = sinPhi * dp[n - 1]![m]! + cosPhi * p[n - 1]![m]! - k * dp2;
      }
    }
  }
  for (let n = 0; n <= DEGREE; n++) {
    for (let m = 0; m <= n; m++) {
      p[n]![m]! *= SCHMIDT[n]![m]!;
      dp[n]![m]! *= SCHMIDT[n]![m]!;
    }
  }
  return { p, dp };
}

/**
 * The field's components at a point. With `secular`, the coefficients are the annual changes
 * (dg/dt, dh/dt) instead, which gives dX/dt, dY/dt, dZ/dt: the expansion is linear in them.
 */
function fieldAt(lat: number, lng: number, heightKm: number, year: number, secular = false) {
  const phi = lat * RAD;
  const lambda = lng * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  // Geodetic → geocentric spherical (WGS 84).
  const rc = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const xp = (rc + heightKm) * cosPhi;
  const zp = (rc * (1 - WGS84_E2) + heightKm) * sinPhi;
  const r = Math.sqrt(xp * xp + zp * zp);
  const phiC = Math.asin(zp / r);
  const sinC = Math.sin(phiC);
  const cosC = Math.cos(phiC);

  const dt = year - WMM2025_EPOCH;
  const { p, dp } = legendre(sinC, cosC);

  let xs = 0;
  let ys = 0;
  let zs = 0;
  for (let n = 1; n <= DEGREE; n++) {
    const ratio = (REFERENCE_RADIUS / r) ** (n + 2);
    for (let m = 0; m <= n; m++) {
      const g = secular ? GDOT[n]![m]! : G[n]![m]! + dt * GDOT[n]![m]!;
      const h = secular ? HDOT[n]![m]! : H[n]![m]! + dt * HDOT[n]![m]!;
      const cosM = Math.cos(m * lambda);
      const sinM = Math.sin(m * lambda);
      // X' = (1/r) ∂V/∂θ = -(1/r) ∂V/∂φ': dP here is with respect to latitude.
      xs -= ratio * (g * cosM + h * sinM) * dp[n]![m]!;
      ys += ratio * m * (g * sinM - h * cosM) * p[n]![m]!;
      zs -= ratio * (n + 1) * (g * cosM + h * sinM) * p[n]![m]!;
    }
  }
  // A pole (cos φ' = 0) is excluded by the caller.
  ys /= cosC;

  // Rotate from geocentric to geodetic.
  const psi = phiC - phi;
  const x = xs * Math.cos(psi) - zs * Math.sin(psi);
  const z = xs * Math.sin(psi) + zs * Math.cos(psi);
  return { x, y: ys, z };
}

/**
 * The magnetic field at geodetic `lat`/`lng` (degrees), `heightKm` above the WGS 84 ellipsoid,
 * at decimal `year`. Throws outside the model's validity (2025.0 to 2030.0) and within 1 km of
 * a geographic pole, where declination is not defined: a stale or invented value printed on a
 * navigation sheet is worse than none.
 */
export function magneticField(lat: number, lng: number, year: number, heightKm = 0): MagneticField {
  if (!(year >= WMM2025_EPOCH && year <= WMM2025_VALID_UNTIL)) {
    throw new Error(`WMM2025 is valid for 2025.0 to 2030.0; ${year} is outside it, so no declination is given.`);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) {
    throw new Error(`Invalid position for declination: ${lat}, ${lng}`);
  }
  if (90 - Math.abs(lat) < 1e-2) {
    throw new Error("Declination is undefined at a geographic pole.");
  }
  const now = fieldAt(lat, lng, heightKm, year);
  const rate = fieldAt(lat, lng, heightKm, year, true);
  const h = Math.hypot(now.x, now.y);
  // dD/dt = (X dY/dt - Y dX/dt) / H², the WMM report's secular-variation formula.
  const dPerYear = ((now.x * rate.y - now.y * rate.x) / (h * h)) / RAD;
  return {
    declination: Math.atan2(now.y, now.x) / RAD,
    inclination: Math.atan2(now.z, h) / RAD,
    x: now.x,
    y: now.y,
    z: now.z,
    h,
    f: Math.hypot(h, now.z),
    declinationPerYear: dPerYear,
    model: "WMM2025",
  };
}

/** A calendar date as a decimal year (2026-07-02 → about 2026.5), the WMM's time argument. */
export function decimalYear(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}
