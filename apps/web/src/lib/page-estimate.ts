import {
  DEFAULT_MAP_TIER,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
  pageGridSize,
  type BBox,
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

export function estimatePages(
  bbox: BBox | null | undefined,
  scale: ScalePreset | null | undefined,
  overlap = 0,
): PageEstimate {
  if (!bbox || !scale) return NO_ESTIMATE;

  const size = pageGridSize({
    bbox,
    scale,
    // TODO(F18): the project's own margins/orientation are on the type and are
    // honoured by the renderer, but there is still no UI control for them, so the
    // estimate uses the same Letter portrait the editor's copy assumed. When a
    // control lands, this must take the project's PageSpec.
    page: LETTER_PORTRAIT,
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
