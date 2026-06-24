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

/** The ground footprint (metres) covered by one page's printable area. */
export function groundFootprintMeters(scale: ScalePreset, page: PageSpec): MeterSize {
  const area = printableAreaInches(page);
  const mpi = metersPerInch(scale);
  return {
    widthMeters: area.widthIn * mpi,
    heightMeters: area.heightIn * mpi,
  };
}
