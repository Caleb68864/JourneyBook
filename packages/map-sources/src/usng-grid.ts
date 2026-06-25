import type { BBox, LngLat, UsngGridOverlay } from "@journeybook/atlas-core";
import { utmZoneForLongitude, createUtmProjector } from "@journeybook/atlas-core";
import { lngLatToPanelFraction } from "./tilemath.js";
// `mgrs` is a CommonJS module — a named ESM import (`{ forward }`) typechecks and
// works under vitest but throws "Named export 'forward' not found" at runtime under
// Node's ESM loader (the render-worker container). Default-import the package object.
import mgrs from "mgrs";
const mgrsForward = mgrs.forward;

// UTM is only defined for latitudes in [-80, 84]; createUtmProjector is
// northern-hemisphere only (CONUS), so the southern band is out of scope too.
const UTM_LAT_MIN = 0;
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
    return emptyOverlay();
  }

  // The whole grid build is wrapped: a bad coordinate that makes proj4 or mgrs
  // throw must never abort the render. Degrade to an empty overlay (the page still
  // renders, grid absent) and log the page bbox so a missing grid is diagnosable.
  try {
    const zone = utmZoneForLongitude(centreLng);
    const proj = createUtmProjector(zone);

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

    // Easting (vertical) lines — constant UTM easting, spans full northing range.
    for (let e = firstE; e <= lastE + 0.5; e += interval) {
      const [x1, y1] = panelFraction(proj.inverse([e, utmNMin]), bbox);
      const [x2, y2] = panelFraction(proj.inverse([e, utmNMax]), bbox);

      lines.push({ x1, y1, x2, y2, axis: "easting" });

      const text = kmLabel(e);
      // y2 is near top (northing max → north edge), y1 is near bottom.
      labels.push({ x: x2, y: 0, text, edge: "top" });
      labels.push({ x: x1, y: 1, text, edge: "bottom" });
    }

    // Northing (horizontal) lines — constant UTM northing, spans full easting range.
    for (let n = firstN; n <= lastN + 0.5; n += interval) {
      const [x1, y1] = panelFraction(proj.inverse([utmEMin, n]), bbox);
      const [x2, y2] = panelFraction(proj.inverse([utmEMax, n]), bbox);

      lines.push({ x1, y1, x2, y2, axis: "northing" });

      const text = kmLabel(n);
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

    return { lines, labels, collar };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`buildUsngGrid: empty overlay for bbox [${bbox.join(", ")}]: ${detail}`);
    return emptyOverlay();
  }
}
