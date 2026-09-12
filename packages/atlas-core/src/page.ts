import {
  DEFAULT_MARGINS,
  type PageMargins,
  type PageOrientation,
  type ScalePreset,
} from "./model.js";
import { metersPerInch } from "./scale.js";

/** A physical sheet plus its orientation and safe margins. */
export interface PageSpec {
  /** Sheet width in inches (portrait orientation), e.g. 8.5 for Letter. */
  widthIn: number;
  /** Sheet height in inches (portrait orientation), e.g. 11 for Letter. */
  heightIn: number;
  orientation: PageOrientation;
  margins: PageMargins;
}

/** US Letter, portrait, conservative home-printer margins. */
export const LETTER_PORTRAIT: PageSpec = {
  widthIn: 8.5,
  heightIn: 11,
  orientation: "portrait",
  margins: DEFAULT_MARGINS,
};

export interface InchSize {
  widthIn: number;
  heightIn: number;
}

export interface MeterSize {
  widthMeters: number;
  heightMeters: number;
}

/**
 * The printable map area in inches after applying orientation, safe margins,
 * and an optional binder gutter (which is taken off the width/binding edge).
 */
export function printableAreaInches(page: PageSpec): InchSize {
  const sheetWidth = page.orientation === "landscape" ? page.heightIn : page.widthIn;
  const sheetHeight = page.orientation === "landscape" ? page.widthIn : page.heightIn;

  const { top, right, bottom, left, gutter = 0 } = page.margins;

  return {
    widthIn: sheetWidth - left - right - gutter,
    heightIn: sheetHeight - top - bottom,
  };
}

/**
 * Printed page furniture, in PDF points, reserved out of the printable area
 * before the map box is measured. These are the *renderer's* numbers: every
 * atlas page in `@journeybook/pdf-client` is laid out from exactly these
 * constants (see `AtlasDocument`, `PAGE_FURNITURE_PT` there is this object), so
 * the box a page's ground bbox is sized from is the box the map is painted into.
 *
 * A page's ground footprint must never be derived from the full printable area:
 * the neatline, the west/east continuation-label columns, the header, the notes
 * area and the footer all take paper the map never gets, and sizing the bbox
 * from the larger box prints the atlas at a smaller scale than its scale bar
 * states — the whole product being wrong by the ratio between the two boxes.
 */
export const PAGE_FURNITURE_PT = {
  /** Neatline border, per side. */
  neatlineBorder: 1.5,
  /** Neatline padding, per side. */
  neatlinePadding: 6,
  /** Map-panel border, per side (drawn just outside the map itself). */
  panelBorder: 1,
  /**
   * West/east CONTINUE-label column, per side.
   *
   * 38pt, narrowed from 54pt to give the map 7.7% more of the page. **Narrowing
   * it alone halves the printed resolution between 38 and 42 degrees N**: the
   * wider map box pushes the panel past a tile-zoom boundary, and at 41N the
   * default preset falls from 338 DPI at z16 to 169 at z15. It is only safe
   * paired with a proportional raise of the panel request, which is why
   * DEFAULT_PANEL_WIDTH_PX moved with it. Changing this number back without
   * moving that one costs a whole zoom level, and `docs/print-resolution.md`
   * will say so when it is regenerated.
   */
  edgeLabelColumn: 38,
  /** Header row: book title, page subtitle, page id. */
  headerRow: 30,
  /** North/south CONTINUE-label row, per row. */
  edgeLabelRow: 9,
  /** Foot-of-page notes area (saved note + ruled writing lines). */
  notesBlock: 66,
  /** Footer row: scale bar, calibration tick, compass, collar, page number. */
  footerRow: 40,
} as const;

/**
 * The shape of {@link PAGE_FURNITURE_PT}, with every measurement writable.
 *
 * This type exists so a *what-if* can be measured through the same arithmetic
 * the renderer uses rather than through a second copy of it — "how many pages
 * would this atlas be with no notes block?" is answered by passing a furniture
 * record here, not by re-deriving the map box somewhere else. Nothing in the
 * product supplies one: every real call takes the default.
 */
export type PageFurniturePt = { -readonly [K in keyof typeof PAGE_FURNITURE_PT]: number };

/** Total furniture taken out of the printable width, in points. */
export function furnitureWidthPt(furniture: PageFurniturePt = PAGE_FURNITURE_PT): number {
  return (
    2 * (furniture.neatlineBorder + furniture.neatlinePadding) +
    2 * furniture.edgeLabelColumn +
    2 * furniture.panelBorder
  );
}

/** Total furniture taken out of the printable height, in points. */
export function furnitureHeightPt(furniture: PageFurniturePt = PAGE_FURNITURE_PT): number {
  return (
    2 * (furniture.neatlineBorder + furniture.neatlinePadding) +
    furniture.headerRow +
    2 * furniture.edgeLabelRow +
    furniture.notesBlock +
    furniture.footerRow +
    2 * furniture.panelBorder
  );
}

/** PDF points per inch. Mirrors POINTS_PER_INCH in model.ts. */
const PT = 72;

/**
 * The printed map box in inches — the paper the map itself actually covers,
 * i.e. the printable area less {@link PAGE_FURNITURE_PT}. This, not
 * {@link printableAreaInches}, is what a page's ground footprint is measured
 * against; the renderer paints the map into precisely this box.
 *
 * `furniture` defaults to the renderer's own constants and should be left alone
 * by product code; see {@link PageFurniturePt} for why it can be overridden.
 */
export function mapBoxInches(
  page: PageSpec,
  furniture: PageFurniturePt = PAGE_FURNITURE_PT,
): InchSize {
  const area = printableAreaInches(page);
  return {
    widthIn: (area.widthIn * PT - furnitureWidthPt(furniture)) / PT,
    heightIn: (area.heightIn * PT - furnitureHeightPt(furniture)) / PT,
  };
}

/** The ground footprint (metres) covered by one page's printed map box. */
export function groundFootprintMeters(
  scale: ScalePreset,
  page: PageSpec,
  furniture: PageFurniturePt = PAGE_FURNITURE_PT,
): MeterSize {
  const box = mapBoxInches(page, furniture);
  const mpi = metersPerInch(scale);
  return {
    widthMeters: box.widthIn * mpi,
    heightMeters: box.heightIn * mpi,
  };
}
