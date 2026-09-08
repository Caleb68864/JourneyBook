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
  /** West/east CONTINUE-label column, per side. */
  edgeLabelColumn: 54,
  /** Header row: book title, page subtitle, page id. */
  headerRow: 30,
  /** North/south CONTINUE-label row, per row. */
  edgeLabelRow: 9,
  /** Foot-of-page notes area (saved note + ruled writing lines). */
  notesBlock: 66,
  /** Footer row: scale bar, calibration tick, compass, collar, page number. */
  footerRow: 40,
} as const;

/** Total furniture taken out of the printable width, in points. */
const FURNITURE_WIDTH_PT =
  2 * (PAGE_FURNITURE_PT.neatlineBorder + PAGE_FURNITURE_PT.neatlinePadding) +
  2 * PAGE_FURNITURE_PT.edgeLabelColumn +
  2 * PAGE_FURNITURE_PT.panelBorder;

/** Total furniture taken out of the printable height, in points. */
const FURNITURE_HEIGHT_PT =
  2 * (PAGE_FURNITURE_PT.neatlineBorder + PAGE_FURNITURE_PT.neatlinePadding) +
  PAGE_FURNITURE_PT.headerRow +
  2 * PAGE_FURNITURE_PT.edgeLabelRow +
  PAGE_FURNITURE_PT.notesBlock +
  PAGE_FURNITURE_PT.footerRow +
  2 * PAGE_FURNITURE_PT.panelBorder;

/** PDF points per inch. Mirrors POINTS_PER_INCH in model.ts. */
const PT = 72;

/**
 * The printed map box in inches — the paper the map itself actually covers,
 * i.e. the printable area less {@link PAGE_FURNITURE_PT}. This, not
 * {@link printableAreaInches}, is what a page's ground footprint is measured
 * against; the renderer paints the map into precisely this box.
 */
export function mapBoxInches(page: PageSpec): InchSize {
  const area = printableAreaInches(page);
  return {
    widthIn: (area.widthIn * PT - FURNITURE_WIDTH_PT) / PT,
    heightIn: (area.heightIn * PT - FURNITURE_HEIGHT_PT) / PT,
  };
}

/** The ground footprint (metres) covered by one page's printed map box. */
export function groundFootprintMeters(scale: ScalePreset, page: PageSpec): MeterSize {
  const box = mapBoxInches(page);
  const mpi = metersPerInch(scale);
  return {
    widthMeters: box.widthIn * mpi,
    heightMeters: box.heightIn * mpi,
  };
}
