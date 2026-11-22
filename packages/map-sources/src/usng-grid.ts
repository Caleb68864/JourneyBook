import type { BBox, LngLat, UsngGridOverlay } from "@journeybook/atlas-core";
import { createUtmProjector, utmZoneFor, utmZoneRange } from "@journeybook/atlas-core";
import { lngLatToPanelFraction } from "./tilemath.js";
// `mgrs` is a CommonJS module — a named ESM import (`{ forward }`) typechecks and
// works under vitest but throws "Named export 'forward' not found" at runtime under
// Node's ESM loader (the render-worker container). Default-import the package object.
import mgrs from "mgrs";
const mgrsForward = mgrs.forward;

// UTM (and so MGRS's UTM part) is defined for latitudes 80°S to 84°N; beyond them MGRS uses
// the polar UPS grid, which this does not draw. South of the equator the projector takes the
// southern false northing (`createUtmProjector(zone, true)`).
const UTM_LAT_MIN = -80;
const UTM_LAT_MAX = 84;

const MAX_GRID_LINES = 60;
const DEFAULT_INTERVAL_M = 1000;
const COARSE_INTERVAL_M = 10_000;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** The degrade result: no grid, empty collar (polar/out-of-UTM or a projection throw). */
function emptyOverlay(): UsngGridOverlay {
  return { lines: [], labels: [], collar: { zoneDesignator: "", hundredKmSquare: "" } };
}

/**
 * Project a WGS84 point to clamped [0,1] panel fractions using THE shared
 * panel↔grid mapping (`lngLatToPanelFraction`, the same Web-Mercator transform
 * `renderMapPanel` uses) — never a second, divergent mapping. Clamped so the
 * overlay coordinates stay within the panel box.
 */
function panelFraction(point: LngLat, bbox: BBox): [number, number] {
  const [u, v] = lngLatToPanelFraction(point, bbox);
  return [clamp01(u), clamp01(v)];
}

/** A full UTM value as a grid line is labelled at the map edge: 678000mE, 4517000mN. */
function fullValue(utmValue: number, axis: "E" | "N"): string {
  return `${Math.round(utmValue)}m${axis}`;
}

/**
 * The 100 km squares the page touches, each with a label anchor inside its own part of the
 * page: just inside the south-west corner of the square's intersection with the page, so it
 * reads like the square identifier printed in each square on a military map.
 */
function hundredKmSquares(
  proj: ReturnType<typeof createUtmProjector>,
  bbox: BBox,
  eMin: number,
  eMax: number,
  nMin: number,
  nMax: number,
): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  const HUNDRED_KM = 100_000;
  for (let e0 = Math.floor(eMin / HUNDRED_KM) * HUNDRED_KM; e0 < eMax; e0 += HUNDRED_KM) {
    for (let n0 = Math.floor(nMin / HUNDRED_KM) * HUNDRED_KM; n0 < nMax; n0 += HUNDRED_KM) {
      const left = Math.max(e0, eMin);
      const right = Math.min(e0 + HUNDRED_KM, eMax);
      const bottom = Math.max(n0, nMin);
      const top = Math.min(n0 + HUNDRED_KM, nMax);
      const w = right - left;
      const h = top - bottom;
      if (w <= 0 || h <= 0) continue;
      // Anchor 4% in from the region's south-west corner; the square is named from its middle
      // so a boundary rounding error cannot name the neighbour.
      const anchor = proj.inverse([left + 0.04 * w, bottom + 0.04 * h]);
      const middle = proj.inverse([left + w / 2, bottom + h / 2]);
      const [x, y] = panelFraction(anchor, bbox);
      // Skip a sliver too thin to hold a label (part of a square only just touching the page).
      if (w < 0.04 * (eMax - eMin) || h < 0.04 * (nMax - nMin)) continue;
      const m = parseUsngCollar(mgrsForward([middle.lng, middle.lat], 1));
      if (!m.zoneDesignator) continue;
      out.push({ id: `${m.zoneDesignator} ${m.hundredKmSquare}`, x, y });
    }
  }
  return out;
}

/** Two-digit USNG km label for a UTM easting or northing value. */
function kmLabel(utmValue: number): string {
  return Math.floor(((utmValue % 100_000) + 100_000) % 100_000 / 1000)
    .toString()
    .padStart(2, "0");
}

function parseUsngCollar(usng: string): { zoneDesignator: string; hundredKmSquare: string } {
  const compact = usng.replace(/\s/g, "");
  // e.g. "14TNF12345" → zone="14T", square="NF"
  const m = compact.match(/^(\d{1,2}[A-Z])([A-Z]{2})/);
  if (!m) return { zoneDesignator: "", hundredKmSquare: "" };
  return { zoneDesignator: m[1] ?? "", hundredKmSquare: m[2] ?? "" };
}

/**
 * Build the USNG grid overlay for a page panel as normalized vector geometry.
 *
 * All x/y coordinates are in [0,1] with (0,0) at top-left.
 * Returns an empty overlay for polar/out-of-UTM bboxes rather than throwing.
 */
/**
 * The easting at which UTM northing `n` meets meridian `lng` in `proj`'s zone, by bisection
 * between `eLo` and `eHi` (a meridian is not a straight line on the UTM grid).
 */
function eastingAtLongitude(proj: ReturnType<typeof createUtmProjector>, lng: number, n: number, eLo: number, eHi: number): number {
  let lo = eLo;
  let hi = eHi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (proj.inverse([mid, n]).lng < lng) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One zone's part of a page that spans a zone boundary: its lines and labels, clipped at the
 * boundary meridian. `side` says which side of the boundary this zone is on.
 */
function zonePart(
  zone: number,
  south: boolean,
  bbox: BBox,
  boundaryLng: number,
  side: "west" | "east",
  interval: number,
  full: boolean,
): { lines: UsngGridOverlay["lines"]; labels: UsngGridOverlay["labels"]; squares: { id: string; x: number; y: number }[] } {
  const [west, southLat, east, north] = bbox;
  const proj = createUtmProjector(zone, south);
  const lngMin = side === "west" ? west : boundaryLng;
  const lngMax = side === "west" ? boundaryLng : east;
  const corners = [
    proj.forward({ lng: lngMin, lat: southLat }),
    proj.forward({ lng: lngMax, lat: southLat }),
    proj.forward({ lng: lngMin, lat: north }),
    proj.forward({ lng: lngMax, lat: north }),
  ];
  const eMin = Math.min(...corners.map(([e]) => e));
  const eMax = Math.max(...corners.map(([e]) => e));
  const nMin = Math.min(...corners.map(([, n]) => n));
  const nMax = Math.max(...corners.map(([, n]) => n));
  const inside = (lng: number) => lng >= lngMin - 1e-9 && lng <= lngMax + 1e-9;
  const lines: UsngGridOverlay["lines"] = [];
  const labels: UsngGridOverlay["labels"] = [];

  const firstE = Math.ceil(eMin / interval) * interval;
  for (let e = firstE; e <= eMax + 0.5; e += interval) {
    // Keep the part of this easting line on the zone's own side of the boundary.
    const a = proj.inverse([e, nMin]);
    const b = proj.inverse([e, nMax]);
    if (!inside(a.lng) && !inside(b.lng)) continue;
    let nFrom = nMin;
    let nTo = nMax;
    if (!inside(a.lng) || !inside(b.lng)) {
      // Bisect for the northing where this line crosses the boundary meridian.
      let lo = nMin;
      let hi = nMax;
      const loInside = inside(a.lng);
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (inside(proj.inverse([e, mid]).lng) === loInside) lo = mid;
        else hi = mid;
      }
      if (loInside) nTo = lo;
      else nFrom = hi;
    }
    const [x1, y1] = panelFraction(proj.inverse([e, nFrom]), bbox);
    const [x2, y2] = panelFraction(proj.inverse([e, nTo]), bbox);
    lines.push({ x1, y1, x2, y2, axis: "easting" });
    // Each zone labels its own first line in full: the numbers change zone at the boundary.
    const text = full && e === firstE ? fullValue(e, "E") : kmLabel(e);
    if (nTo >= nMax - 1) labels.push({ x: x2, y: 0, text, edge: "top" });
    if (nFrom <= nMin + 1) labels.push({ x: x1, y: 1, text, edge: "bottom" });
  }

  const firstN = Math.ceil(nMin / interval) * interval;
  for (let n = firstN; n <= nMax + 0.5; n += interval) {
    const eBoundary = eastingAtLongitude(proj, boundaryLng, n, eMin - 50_000, eMax + 50_000);
    const eOuter = side === "west" ? eastingAtLongitude(proj, west, n, eMin - 50_000, eMax + 50_000) : eastingAtLongitude(proj, east, n, eMin - 50_000, eMax + 50_000);
    const [eFrom, eTo] = side === "west" ? [eOuter, eBoundary] : [eBoundary, eOuter];
    if (eTo <= eFrom) continue;
    const [x1, y1] = panelFraction(proj.inverse([eFrom, n]), bbox);
    const [x2, y2] = panelFraction(proj.inverse([eTo, n]), bbox);
    if (y1 <= 0 || y1 >= 1) continue;
    lines.push({ x1, y1, x2, y2, axis: "northing" });
    const text = full && n === firstN ? fullValue(n, "N") : kmLabel(n);
    // Northing labels go on the zone's outer edge, the one edge it owns.
    labels.push(side === "west" ? { x: 0, y: y1, text, edge: "left" } : { x: 1, y: y2, text, edge: "right" });
  }

  // The boundary is curved on this zone's grid, so an anchor near it can land on the wrong
  // side; move it just onto this side rather than lose the square. x is linear in longitude.
  const boundaryX = (boundaryLng - west) / (east - west);
  const squares = full
    ? hundredKmSquares(proj, bbox, eMin, eMax, nMin, nMax).map((sq) => {
        const lng = west + sq.x * (east - west);
        if (inside(lng)) return sq;
        return { ...sq, x: side === "west" ? Math.max(0, boundaryX - 0.12) : Math.min(1, boundaryX + 0.02) };
      })
    : [];
  return { lines, labels, squares };
}

/** A page spanning the boundary between `westZone` and `eastZone`. */
function zoneJunction(
  bbox: BBox,
  westZone: number,
  eastZone: number,
  south: boolean,
  opts: { intervalMeters?: number; mgrs?: boolean } | undefined,
  boundaryLng: number,
): UsngGridOverlay {
  const interval = opts?.intervalMeters ?? DEFAULT_INTERVAL_M;
  const full = opts?.mgrs === true;
  const w = zonePart(westZone, south, bbox, boundaryLng, "west", interval, full);
  const e = zonePart(eastZone, south, bbox, boundaryLng, "east", interval, full);
  const [, s, , n] = bbox;
  const [bx1, by1] = panelFraction({ lng: boundaryLng, lat: n }, bbox);
  const [bx2, by2] = panelFraction({ lng: boundaryLng, lat: s }, bbox);
  const centre = { lng: (bbox[0] + bbox[2]) / 2, lat: (s + n) / 2 };
  let collar: UsngGridOverlay["collar"] = { zoneDesignator: "", hundredKmSquare: "" };
  try {
    collar = parseUsngCollar(mgrsForward([centre.lng, centre.lat], 1));
  } catch {
    // collar stays empty
  }
  const squares = [...w.squares, ...e.squares];
  const overlay: UsngGridOverlay = {
    lines: [...w.lines, ...e.lines],
    labels: [...w.labels, ...e.labels],
    collar: full ? { ...collar, squares: [...new Set(squares.map((q) => q.id))] } : collar,
    zoneBoundary: { x1: bx1, y1: by1, x2: bx2, y2: by2, westZone, eastZone },
  };
  if (full) overlay.mgrs = { squares };
  return overlay;
}

export function buildUsngGrid(
  bbox: BBox,
  _panelWidthPx: number,
  _panelHeightPx: number,
  opts?: { intervalMeters?: number; mgrs?: boolean },
): UsngGridOverlay {
  const [west, south, east, north] = bbox;
  const centreLng = (west + east) / 2;
  const centreLat = (south + north) / 2;

  if (centreLat < UTM_LAT_MIN || centreLat > UTM_LAT_MAX) {
    return emptyOverlay();
  }

  // The whole grid build is wrapped: a bad coordinate that makes proj4 or mgrs
  // throw must never abort the render. Degrade to an empty overlay (the page still
  // renders, grid absent) and log the page bbox so a missing grid is diagnosable.
  try {
    // The centre's zone, with the Norway/Svalbard exceptions.
    const zone = utmZoneFor(centreLng, centreLat);
    // The page centre's hemisphere decides the northing numbers; a page astride the equator
    // gets its centre's (two-digit labels agree either way: the offset is 10,000 km).
    const proj = createUtmProjector(zone, centreLat < 0);

    // A page across a UTM zone boundary: each zone's grid on its own side (see zonePart).
    // Zones are taken at the centre's latitude, so the exceptions' boundaries (3°E in Norway,
    // 9/21/33°E on Svalbard) are where they really are, not every 6°.
    const westRange = utmZoneRange(west, centreLat);
    const eastRange = utmZoneRange(east - 1e-9, centreLat);
    if (westRange.zone !== eastRange.zone && westRange.east === eastRange.west) {
      return zoneJunction(bbox, westRange.zone, eastRange.zone, centreLat < 0, opts, eastRange.west);
    }

    // Project all four corners to find the full UTM extent of the bbox.
    const corners = [
      proj.forward({ lng: west, lat: south }),
      proj.forward({ lng: east, lat: south }),
      proj.forward({ lng: west, lat: north }),
      proj.forward({ lng: east, lat: north }),
    ];
    const utmEMin = Math.min(...corners.map(([e]) => e));
    const utmEMax = Math.max(...corners.map(([e]) => e));
    const utmNMin = Math.min(...corners.map(([, n]) => n));
    const utmNMax = Math.max(...corners.map(([, n]) => n));

    // Determine interval — fall back to 10 km only when no explicit override is given
    // and the 1 km grid would exceed MAX_GRID_LINES.
    let interval = opts?.intervalMeters ?? DEFAULT_INTERVAL_M;
    const explicitInterval = opts?.intervalMeters !== undefined;

    if (!explicitInterval) {
      const eCount =
        Math.floor(utmEMax / DEFAULT_INTERVAL_M) - Math.ceil(utmEMin / DEFAULT_INTERVAL_M) + 1;
      const nCount =
        Math.floor(utmNMax / DEFAULT_INTERVAL_M) - Math.ceil(utmNMin / DEFAULT_INTERVAL_M) + 1;
      if (eCount + nCount > MAX_GRID_LINES) {
        interval = COARSE_INTERVAL_M;
      }
    }

    const firstE = Math.ceil(utmEMin / interval) * interval;
    const lastE = Math.floor(utmEMax / interval) * interval;
    const firstN = Math.ceil(utmNMin / interval) * interval;
    const lastN = Math.floor(utmNMax / interval) * interval;

    const lines: UsngGridOverlay["lines"] = [];
    const labels: UsngGridOverlay["labels"] = [];
    const full = opts?.mgrs === true;

    // Easting (vertical) lines — constant UTM easting, spans full northing range.
    for (let e = firstE; e <= lastE + 0.5; e += interval) {
      const [x1, y1] = panelFraction(proj.inverse([e, utmNMin]), bbox);
      const [x2, y2] = panelFraction(proj.inverse([e, utmNMax]), bbox);

      lines.push({ x1, y1, x2, y2, axis: "easting" });

      // Level 4: the first (westmost) line carries the full value, as military maps print it.
      const text = full && e === firstE ? fullValue(e, "E") : kmLabel(e);
      // y2 is near top (northing max → north edge), y1 is near bottom.
      labels.push({ x: x2, y: 0, text, edge: "top" });
      labels.push({ x: x1, y: 1, text, edge: "bottom" });
    }

    // Northing (horizontal) lines — constant UTM northing, spans full easting range.
    for (let n = firstN; n <= lastN + 0.5; n += interval) {
      const [x1, y1] = panelFraction(proj.inverse([utmEMin, n]), bbox);
      const [x2, y2] = panelFraction(proj.inverse([utmEMax, n]), bbox);

      lines.push({ x1, y1, x2, y2, axis: "northing" });

      const text = full && n === firstN ? fullValue(n, "N") : kmLabel(n);
      // x1 is near left (easting min → west edge), x2 is near right.
      labels.push({ x: 0, y: y1, text, edge: "left" });
      labels.push({ x: 1, y: y2, text, edge: "right" });
    }

    // Collar from MGRS/USNG (its own guard — a collar failure still yields lines).
    let collar: UsngGridOverlay["collar"] = { zoneDesignator: "", hundredKmSquare: "" };
    try {
      const usng = mgrsForward([centreLng, centreLat], 1);
      collar = parseUsngCollar(usng);
    } catch {
      // degrade gracefully — collar stays empty
    }

    if (!full) return { lines, labels, collar };

    // Level 4: every 100 km square on the page, its identifier inside its own region.
    const squares = hundredKmSquares(proj, bbox, utmEMin, utmEMax, utmNMin, utmNMax);
    const centreId = collar.zoneDesignator ? `${collar.zoneDesignator} ${collar.hundredKmSquare}` : "";
    const ids = [...new Set(squares.map((s) => s.id))].sort((a, b) => (a === centreId ? -1 : b === centreId ? 1 : a < b ? -1 : 1));
    return { lines, labels, collar: { ...collar, squares: ids }, mgrs: { squares } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`buildUsngGrid: empty overlay for bbox [${bbox.join(", ")}]: ${detail}`);
    return emptyOverlay();
  }
}
