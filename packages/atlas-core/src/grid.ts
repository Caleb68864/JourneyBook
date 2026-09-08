import {
  DEFAULT_MAP_TIER,
  MAX_ATLAS_PAGES,
  type AtlasContract,
  type AtlasPage,
  type BBox,
  type LngLat,
  type MapTier,
  type PinStyle,
  type ScalePreset,
} from "./model.js";
import { groundFootprintMeters, type PageSpec } from "./page.js";
import { createProjector, pageBBoxAround } from "./projection.js";

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

/** A single fixed-scale page centred on a location (scale-driven mode). */
export function buildLocationPage(
  center: LngLat,
  scale: ScalePreset,
  page: PageSpec,
  id = "L1",
  tier: MapTier = DEFAULT_MAP_TIER,
  title?: string,
  pin?: PinStyle,
  notes?: string,
): AtlasPage {
  const fp = groundFootprintMeters(scale, page);
  return {
    id,
    bbox: pageBBoxAround(center, fp.widthMeters / 2, fp.heightMeters / 2),
    orientation: page.orientation,
    ...(title ? { title } : {}),
    ...(pin ? { pin } : {}),
    ...(notes ? { notes } : {}),
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

  // Fail fast, before materialising a single page. The grid's size is known from
  // the extent and the footprint alone, so an extent that cannot fit is rejected
  // here rather than after millions of projections have been run only for the
  // render-side page cap to throw them away. Mirrors the corridor guard in
  // buildRouteAtlas, and references the same cap so both messages read alike.
  if (rows * columns > MAX_ATLAS_PAGES) {
    throw new Error(
      `Invalid request: this extent produces ${rows * columns} pages (${columns} x ${rows}) at ${scale.id}, ` +
        `exceeding the ${MAX_ATLAS_PAGES}-page limit. Use a smaller area or a coarser scale.`,
    );
  }

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
      // The shared projector lays the page centres out on one uniform lattice, so
      // spacing and overlap stay exact; each page's own bbox is then built about
      // that centre (see pageBBoxAround) so a page far from the extent's central
      // meridian still covers exactly the ground its scale bar claims.
      const pageCenter = projector.inverse([cx, cy]);
      pages.push({
        id: pageLabel(row, col),
        bbox: pageBBoxAround(pageCenter, fp.widthMeters / 2, fp.heightMeters / 2),
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
