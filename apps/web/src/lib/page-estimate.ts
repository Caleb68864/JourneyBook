import {
  DEFAULT_MAP_TIER,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
  pageGridSize,
  type BBox,
  type PageMargins,
  type PageSpec,
  type ScalePreset,
} from "@journeybook/atlas-core";

/**
 * How many pages a bounding box costs at a given scale, and whether that is more
 * than the renderer will accept.
 *
 * This is derivation, not geometry: the page count comes from the engine's
 * `pageGridSize` (ADR 0004 — called, never reimplemented here). It lives in its
 * own module because the editor's version of it was unreachable and nobody
 * noticed for a release:
 *
 *     const countPages = (bbox) => { try { return buildPageGrid({…}).pages.length; }
 *                                    catch { return null; } };
 *     const overLimit = pageCount !== null && pageCount > MAX_ATLAS_PAGES;
 *
 * `buildPageGrid` throws exactly when `pages.length > MAX_ATLAS_PAGES`, so the
 * catch swallowed precisely the case the flag was testing for: `overLimit` was
 * provably always false. No page estimate on an over-limit box, no "Too Large",
 * no disabled Generate, no banner — the user drew a 3° box and met the cap
 * minutes later as a raw `Render worker returned 400: …5256 pages…`.
 *
 * A pure function with a test cannot go quietly dead in that way.
 */
export interface PageEstimate {
  /** Pages the box tiles into, or null when there is nothing to measure yet. */
  pages: number | null;
  /** Grid shape, for a message that says 73 x 72 rather than just 5256. */
  columns: number | null;
  rows: number | null;
  /** True only when there IS an estimate and it exceeds the cap. */
  overLimit: boolean;
}

const NO_ESTIMATE: PageEstimate = { pages: null, columns: null, rows: null, overLimit: false };

/**
 * The project's page setup as the engine's `PageSpec`.
 *
 * Letter is the only sheet the product supports, so only orientation and the
 * margins vary — but they vary a lot: the printed map box is the printable area
 * less the furniture, so a margin or a gutter MOVES THE PRINTED FOOTPRINT and
 * with it the ground each page covers and how many pages a box tiles into.
 * `orientation` is compared case-insensitively because the API's `PageOrientation`
 * enum serialises as "Portrait"/"Landscape" while the engine's union is
 * lower-case — the same mismatch that used to print every landscape project
 * portrait.
 */
export function toPageSpec(setup?: {
  orientation?: string | null;
  margins?: Partial<PageMargins> | null;
} | null): PageSpec {
  const m = setup?.margins;
  return {
    widthIn: LETTER_PORTRAIT.widthIn,
    heightIn: LETTER_PORTRAIT.heightIn,
    orientation:
      typeof setup?.orientation === "string" && setup.orientation.toLowerCase() === "landscape"
        ? "landscape"
        : "portrait",
    margins: {
      top: m?.top ?? LETTER_PORTRAIT.margins.top,
      right: m?.right ?? LETTER_PORTRAIT.margins.right,
      bottom: m?.bottom ?? LETTER_PORTRAIT.margins.bottom,
      left: m?.left ?? LETTER_PORTRAIT.margins.left,
      gutter: m?.gutter ?? LETTER_PORTRAIT.margins.gutter ?? 0,
    },
  };
}

export function estimatePages(
  bbox: BBox | null | undefined,
  scale: ScalePreset | null | undefined,
  overlap = 0,
  // The project's page setup. Optional so every existing caller keeps working,
  // and defaulted to Letter portrait — which is what this function USED to
  // assume unconditionally, with a TODO saying so, because there was no control
  // for margins or orientation anywhere in the app. There is now, and an
  // estimate that ignored it would report the page count of a layout the user is
  // not asking for: the one setting that changes printed scale, shown against
  // the wrong scale.
  page: PageSpec = LETTER_PORTRAIT,
): PageEstimate {
  if (!bbox || !scale) return NO_ESTIMATE;

  const size = pageGridSize({
    bbox,
    scale,
    page,
    overlap,
    tier: DEFAULT_MAP_TIER,
  });

  return {
    pages: size.pages,
    columns: size.columns,
    rows: size.rows,
    overLimit: size.overLimit,
  };
}

export { MAX_ATLAS_PAGES };
