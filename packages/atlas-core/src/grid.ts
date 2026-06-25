import {
  DEFAULT_MAP_TIER,
  type AtlasContract,
  type AtlasPage,
  type BBox,
  type LngLat,
  type MapTier,
  type ScalePreset,
} from "./model.js";
import { groundFootprintMeters, type PageSpec } from "./page.js";
import { createProjector, type Projector } from "./projection.js";

/** Bijective base-26 column letters: 0->A, 25->Z, 26->AA. */
function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Page id from grid position: row letter + column number (e.g. "B3"). */
export function pageLabel(row: number, column: number): string {
  return `${columnLetters(row)}${column + 1}`;
}

/** Unproject a planar rectangle (metres) into a WGS84 BBox via its corners. */
function planeRectToBBox(
  projector: Projector,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): BBox {
  const corners: LngLat[] = [
    projector.inverse([cx - halfW, cy - halfH]),
    projector.inverse([cx - halfW, cy + halfH]),
    projector.inverse([cx + halfW, cy - halfH]),
    projector.inverse([cx + halfW, cy + halfH]),
  ];
  const lngs = corners.map((c) => c.lng);
  const lats = corners.map((c) => c.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** A single fixed-scale page centred on a location (scale-driven mode). */
export function buildLocationPage(
  center: LngLat,
  scale: ScalePreset,
  page: PageSpec,
  id = "L1",
  tier: MapTier = DEFAULT_MAP_TIER,
  title?: string,
): AtlasPage {
  const projector = createProjector(center);
  const [cx, cy] = projector.forward(center);
  const fp = groundFootprintMeters(scale, page);
  return {
    id,
    bbox: planeRectToBBox(projector, cx, cy, fp.widthMeters / 2, fp.heightMeters / 2),
    orientation: page.orientation,
    ...(title ? { title } : {}),
    tier,
    // Self-describing scale so a location page rendered at its own zoom carries a
    // truthful scale bar even inside a mixed-scale atlas.
    scale,
    neighbors: {},
  };
}

export interface PageGridOptions {
  bbox: BBox;
  scale: ScalePreset;
  page: PageSpec;
  /** Fractional page overlap, 0..1 (e.g. 0.05 = 5%). Default 0. */
  overlap?: number;
  /** Map tier applied to every page. Default Level 1 (road-atlas). */
  tier?: MapTier;
}

/**
 * Tile a geographic extent into a fixed-scale page grid (extent-driven mode).
 * Pages are laid out in a single page-centred projection so every page shares
 * the same ground footprint; row letters run north→south, columns west→east.
 */
export function buildPageGrid(options: PageGridOptions): AtlasContract {
  const { bbox, scale, page } = options;
  const overlap = options.overlap ?? 0;
  const tier = options.tier ?? DEFAULT_MAP_TIER;

  const [west, south, east, north] = bbox;
  const center: LngLat = { lng: (west + east) / 2, lat: (south + north) / 2 };
  const projector = createProjector(center);

  // Planar bounds of the extent (min/max over the four projected corners).
  const corners = [
    projector.forward({ lng: west, lat: south }),
    projector.forward({ lng: west, lat: north }),
    projector.forward({ lng: east, lat: south }),
    projector.forward({ lng: east, lat: north }),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const extentWidth = maxX - minX;
  const extentHeight = maxY - minY;

  const fp = groundFootprintMeters(scale, page);
  const stepX = fp.widthMeters * (1 - overlap);
  const stepY = fp.heightMeters * (1 - overlap);

  const columns = Math.max(1, Math.ceil(extentWidth / stepX));
  const rows = Math.max(1, Math.ceil(extentHeight / stepY));

  // Centre the grid over the extent (distribute any overhang evenly).
  const coveredWidth = fp.widthMeters + (columns - 1) * stepX;
  const coveredHeight = fp.heightMeters + (rows - 1) * stepY;
  const firstColX = minX - (coveredWidth - extentWidth) / 2 + fp.widthMeters / 2;
  const firstRowY = maxY + (coveredHeight - extentHeight) / 2 - fp.heightMeters / 2;

  const pages: AtlasPage[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const cx = firstColX + col * stepX;
      const cy = firstRowY - row * stepY; // rows run north -> south
      pages.push({
        id: pageLabel(row, col),
        bbox: planeRectToBBox(projector, cx, cy, fp.widthMeters / 2, fp.heightMeters / 2),
        orientation: page.orientation,
        tier,
        neighbors: {
          north: row > 0 ? pageLabel(row - 1, col) : undefined,
          south: row < rows - 1 ? pageLabel(row + 1, col) : undefined,
          west: col > 0 ? pageLabel(row, col - 1) : undefined,
          east: col < columns - 1 ? pageLabel(row, col + 1) : undefined,
        },
      });
    }
  }

  return { version: 1, scale, margins: page.margins, pages };
}
