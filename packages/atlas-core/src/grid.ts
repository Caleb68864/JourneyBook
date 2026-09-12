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
import { groundFootprintMeters, type PageFurniturePt, type PageSpec } from "./page.js";
import { createProjector, pageBBoxAround } from "./projection.js";

/**
 * Letters a grid row label may use. `L` and `R` are deliberately absent: they
 * are reserved for the location (`L1`, `L2a`, …) and corridor (`R1`, `R2`, …)
 * page namespaces, which share one flat id space with the grid inside a single
 * AtlasContract.
 *
 * Without the reservation, plain base-26 gives row 11 the label `L` and row 17
 * the label `R`, so a 12-row grid emits a page literally called "L1". Two things
 * then break at once in a mixed atlas (grid pages + saved locations):
 *
 *  - ids stop being unique, and the renderer keys panels/grids/routes/landmarks
 *    by page id (`Record<string, …>`), so one page's map silently overwrites the
 *    other's;
 *  - `pdf-client` dispatches page furniture off the id prefix, so a plain grid
 *    page gets a location pin stamped through its centre and a corridor route
 *    drawn over it.
 *
 * Reserving the two letters keeps ids short and human ("M4" still reads as a
 * map-book reference) while making the three namespaces provably disjoint —
 * a generated row label can no longer contain `L` or `R` in ANY position, so a
 * `startsWith` test is sound at every grid size, not just small ones.
 */
const ROW_LETTERS = "ABCDEFGHIJKMNOPQSTUVWXYZ";

/** Bijective base-24 row letters over {@link ROW_LETTERS}: 0->A, 23->Z, 24->AA. */
function columnLetters(index: number): string {
  const base = ROW_LETTERS.length;
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % base;
    out = ROW_LETTERS[rem] + out;
    n = Math.floor((n - 1) / base);
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
  /**
   * Page furniture to size the map box against. Defaults to the renderer's own
   * {@link PAGE_FURNITURE_PT}, which is what every real render uses. Present so
   * a what-if ("how many pages without the notes block?") is measured through
   * this same counting rather than a second copy of it — see
   * {@link PageFurniturePt}.
   */
  furniture?: PageFurniturePt;
}

/** How big a grid an extent tiles into, without materialising or rejecting it. */
export interface PageGridSize {
  columns: number;
  rows: number;
  /** `columns * rows` — exactly what {@link buildPageGrid} would emit. */
  pages: number;
  /** True when the grid is bigger than {@link MAX_ATLAS_PAGES} can render. */
  overLimit: boolean;
}

/**
 * Measure the grid an extent produces, WITHOUT building it and WITHOUT throwing.
 *
 * `buildPageGrid` rejects an over-cap extent, which is right for a render and
 * useless for a warning: a caller that wants to say "this box is 5,256 pages,
 * which is too many" cannot learn the number from a function whose answer to a
 * too-large box is an exception. The web editor's over-limit guard was written
 * against `buildPageGrid(...).pages.length > MAX_ATLAS_PAGES`, a condition that
 * is provably unreachable — the call throws exactly when it would be true — so
 * the estimate, the "Too Large" confirm, the disabled Generate button and the
 * over-limit banner were all dead code, and the user met the cap as a raw 400
 * from the render worker minutes later.
 *
 * Counting is cheap (no projections per page), so this is also what
 * `buildPageGrid` uses for its own fail-fast guard: one definition of "how many
 * pages", used by both the guard and the warning.
 */
export function pageGridSize(options: PageGridOptions): PageGridSize {
  const { bbox, scale, page, furniture } = options;
  const overlap = options.overlap ?? 0;

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
  const extentWidth = Math.max(...xs) - Math.min(...xs);
  const extentHeight = Math.max(...ys) - Math.min(...ys);

  const fp = groundFootprintMeters(scale, page, furniture);
  const stepX = fp.widthMeters * (1 - overlap);
  const stepY = fp.heightMeters * (1 - overlap);

  const columns = Math.max(1, Math.ceil(extentWidth / stepX));
  const rows = Math.max(1, Math.ceil(extentHeight / stepY));

  return { columns, rows, pages: columns * rows, overLimit: columns * rows > MAX_ATLAS_PAGES };
}

/**
 * Tile a geographic extent into a fixed-scale page grid (extent-driven mode).
 * Pages are laid out in a single page-centred projection so every page shares
 * the same ground footprint; row letters run north→south, columns west→east.
 */
export function buildPageGrid(options: PageGridOptions): AtlasContract {
  const { bbox, scale, page, furniture } = options;
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

  const fp = groundFootprintMeters(scale, page, furniture);
  const stepX = fp.widthMeters * (1 - overlap);
  const stepY = fp.heightMeters * (1 - overlap);

  // Fail fast, before materialising a single page. The grid's size is known from
  // the extent and the footprint alone, so an extent that cannot fit is rejected
  // here rather than after millions of projections have been run only for the
  // render-side page cap to throw them away. Mirrors the corridor guard in
  // buildRouteAtlas, and references the same cap so both messages read alike.
  // The count comes from pageGridSize so the guard and the UI's warning cannot
  // disagree about how many pages a box is.
  const { columns, rows, pages: pageCount, overLimit } = pageGridSize(options);
  if (overLimit) {
    throw new Error(
      `Invalid request: this extent produces ${pageCount} pages (${columns} x ${rows}) at ${scale.id}, ` +
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
