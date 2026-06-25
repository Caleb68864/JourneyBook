import proj4 from "proj4";
import type { BBox, UsngGridOverlay } from "@journeybook/atlas-core";
import { utmZoneForLongitude } from "@journeybook/atlas-core";
import { forward as mgrsForward } from "mgrs";

// UTM is only defined for latitudes in [-80, 84].
const UTM_LAT_MIN = -80;
const UTM_LAT_MAX = 84;

const MAX_GRID_LINES = 60;
const DEFAULT_INTERVAL_M = 1000;
const COARSE_INTERVAL_M = 10_000;

const WGS84 = "EPSG:4326";

function utmProjDef(zone: number, south: boolean): string {
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs${south ? " +south" : ""}`;
}

interface UtmProjector {
  forward(lng: number, lat: number): [easting: number, northing: number];
  inverse(easting: number, northing: number): [lng: number, lat: number];
}

function createUtmProjector(zone: number, south: boolean): UtmProjector {
  const def = utmProjDef(zone, south);
  return {
    forward(lng, lat) {
      const [e, n] = proj4(WGS84, def, [lng, lat]);
      return [e, n];
    },
    inverse(e, n) {
      const [lng, lat] = proj4(def, WGS84, [e, n]);
      return [lng, lat];
    },
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Normalize a lng/lat to [0,1] panel fractions (top-left origin), clamped to [0,1]. */
function lngLatToPanelFraction(
  lng: number,
  lat: number,
  west: number,
  east: number,
  south: number,
  north: number,
): [x: number, y: number] {
  return [
    clamp01((lng - west) / (east - west)),
    clamp01((north - lat) / (north - south)),
  ];
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
export function buildUsngGrid(
  bbox: BBox,
  _panelWidthPx: number,
  _panelHeightPx: number,
  opts?: { intervalMeters?: number },
): UsngGridOverlay {
  const [west, south, east, north] = bbox;
  const centreLng = (west + east) / 2;
  const centreLat = (south + north) / 2;

  if (centreLat < UTM_LAT_MIN || centreLat > UTM_LAT_MAX) {
    return { lines: [], labels: [], collar: { zoneDesignator: "", hundredKmSquare: "" } };
  }

  const zone = utmZoneForLongitude(centreLng);
  const isSouth = centreLat < 0;
  const proj = createUtmProjector(zone, isSouth);

  // Project all four corners to find the full UTM extent of the bbox.
  const corners = [
    proj.forward(west, south),
    proj.forward(east, south),
    proj.forward(west, north),
    proj.forward(east, north),
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

  // Easting (vertical) lines — constant UTM easting, spans full northing range.
  for (let e = firstE; e <= lastE + 0.5; e += interval) {
    const [lng1, lat1] = proj.inverse(e, utmNMin);
    const [lng2, lat2] = proj.inverse(e, utmNMax);
    const [x1, y1] = lngLatToPanelFraction(lng1, lat1, west, east, south, north);
    const [x2, y2] = lngLatToPanelFraction(lng2, lat2, west, east, south, north);

    lines.push({ x1, y1, x2, y2, axis: "easting" });

    const text = kmLabel(e);
    // y2 is near top (northing max → north edge), y1 is near bottom.
    labels.push({ x: x2, y: 0, text, edge: "top" });
    labels.push({ x: x1, y: 1, text, edge: "bottom" });
  }

  // Northing (horizontal) lines — constant UTM northing, spans full easting range.
  for (let n = firstN; n <= lastN + 0.5; n += interval) {
    const [lng1, lat1] = proj.inverse(utmEMin, n);
    const [lng2, lat2] = proj.inverse(utmEMax, n);
    const [x1, y1] = lngLatToPanelFraction(lng1, lat1, west, east, south, north);
    const [x2, y2] = lngLatToPanelFraction(lng2, lat2, west, east, south, north);

    lines.push({ x1, y1, x2, y2, axis: "northing" });

    const text = kmLabel(n);
    // x1 is near left (easting min → west edge), x2 is near right.
    labels.push({ x: 0, y: y1, text, edge: "left" });
    labels.push({ x: 1, y: y2, text, edge: "right" });
  }

  // Collar from MGRS/USNG.
  let collar: UsngGridOverlay["collar"] = { zoneDesignator: "", hundredKmSquare: "" };
  try {
    const usng = mgrsForward([centreLng, centreLat], 1);
    collar = parseUsngCollar(usng);
  } catch {
    // degrade gracefully — collar stays empty
  }

  return { lines, labels, collar };
}
