/**
 * Every render-time choice the app can make, and the request body it becomes.
 *
 * Render options split in two and the split is not cosmetic:
 *
 *  - **Page setup** — orientation, overlap, margins, gutter — is PERSISTED on
 *    the project (`PUT /api/projects/{id}`) and changes the printed footprint,
 *    so it changes scale and page count. It lives with the project.
 *  - **Render options** — everything here — is chosen per render and travels in
 *    the `POST /api/projects/{id}/render` body. Nothing is stored.
 *
 * The mapping lives in this file, away from the component, for one reason: a
 * control that is declared and not wired is worse than no control, and a
 * component test that renders a checkbox proves only that a checkbox renders.
 * `toRenderRequestBody` is the exact object that goes on the wire, so it can be
 * asserted directly — and `GenerateButton.test.tsx` then asserts that clicking
 * the button actually sends it.
 */

import type { MapTier } from "@journeybook/atlas-core";

/** Panel encodings the engine accepts (`PanelFormat` in `map-sources`). */
export const PANEL_FORMATS = ["jpeg", "png"] as const;
export type PanelFormat = (typeof PANEL_FORMATS)[number];

/**
 * Quality bounds, mirroring `render.ts validateInput` and
 * `RenderPanelKnobs.Validate`. Duplicated here rather than imported because the
 * engine's copy is not exported to the web app; the API refuses anything outside
 * these, so a UI that offered more would simply produce 400s.
 */
export const PANEL_QUALITY_MIN = 1;
export const PANEL_QUALITY_MAX = 100;

/** The engine's own default, shown so the slider's starting point is honest. */
export const PANEL_QUALITY_DEFAULT = 90;

/** State of the render-options panel. */
export interface RenderOptionsState {
  tier: MapTier;
  route: boolean;
  cover: boolean;
  includeLandmarks: boolean;
  tableOfContents: boolean;
  overview: boolean;
  referenceGrid: boolean;
  notes: boolean;
  /**
   * Draw the raster basemap under each page. Off renders line art only — no
   * tile fetches at all, which is the fast preview the CLI has always had and
   * the API hardcoded to `true`.
   */
  basemap: boolean;
  /** Panel encoding, or null to let the engine choose (jpeg). */
  panelFormat: PanelFormat | null;
  /** JPEG quality, or null to let the engine choose (90). Ignored for png. */
  panelQuality: number | null;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptionsState = {
  tier: 1,
  route: false,
  cover: false,
  includeLandmarks: true,
  tableOfContents: true,
  overview: true,
  referenceGrid: true,
  notes: true,
  // The API's defaults, reproduced exactly. Opening the panel must not change
  // what a render does.
  basemap: true,
  panelFormat: null,
  panelQuality: null,
};

/** The `POST /projects/{id}/render` body for a given panel state. */
export interface RenderRequestBody {
  tier: MapTier;
  route: boolean;
  cover: boolean;
  includeLandmarks: boolean;
  tableOfContents: boolean;
  overview: boolean;
  referenceGrid: boolean;
  notes: boolean;
  basemap: boolean;
  panelFormat?: PanelFormat;
  panelQuality?: number;
}

/**
 * Build the request body.
 *
 * `panelFormat`/`panelQuality` are OMITTED when null rather than sent as a
 * value, so the engine keeps its own defaults — including the per-preset
 * `ScalePreset.panelWidthPx` chosen for each scale's print resolution. Sending
 * "the default" as a literal is how a UI silently takes a decision away from the
 * layer that was making it properly.
 *
 * `panelQuality` is also omitted for png, because the encoder ignores it there
 * (`sharp.png()` takes no quality) and a body that carried it would claim a
 * setting had an effect it does not have.
 */
export function toRenderRequestBody(state: RenderOptionsState): RenderRequestBody {
  const format = state.panelFormat;
  const sendQuality =
    state.basemap && state.panelQuality !== null && format !== "png";

  return {
    tier: state.tier,
    route: state.route,
    cover: state.cover,
    includeLandmarks: state.includeLandmarks,
    tableOfContents: state.tableOfContents,
    overview: state.overview,
    referenceGrid: state.referenceGrid,
    notes: state.notes,
    basemap: state.basemap,
    ...(state.basemap && format ? { panelFormat: format } : {}),
    ...(sendQuality ? { panelQuality: state.panelQuality as number } : {}),
  };
}

/** Clamp a quality entered by hand into the range the API will accept. */
export function clampPanelQuality(value: number): number {
  if (!Number.isFinite(value)) return PANEL_QUALITY_DEFAULT;
  return Math.min(PANEL_QUALITY_MAX, Math.max(PANEL_QUALITY_MIN, Math.round(value)));
}

/**
 * Roughly what a quality setting does to the finished file, as a multiplier of
 * the size at the engine's default of 90.
 *
 * Measured, not guessed: a real 36-page 1:50,000 atlas (a raised preset, 1730 px
 * panels, z15) rendered at each quality against live USGS tiles —
 * q5 1.06 MB, q30 7.74, q50 12.50, q60 15.03, q70 18.99, q80 26.33,
 * q90 42.03, q95 61.75. The curve is steep and most of it sits above q80, which
 * is the thing a person moving this slider cannot otherwise see: the difference
 * between 70 and 90 is more than double the file, for a print nobody would tell
 * apart at arm's length.
 *
 * Interpolated linearly between the measured points, and deliberately reported
 * as "about", because it is one atlas at one scale at one latitude. It is a
 * shape, not a promise.
 */
const QUALITY_SIZE_MB: ReadonlyArray<readonly [quality: number, mb: number]> = [
  [5, 1.06],
  [30, 7.74],
  [50, 12.5],
  [60, 15.03],
  [70, 18.99],
  [80, 26.33],
  [90, 42.03],
  [95, 61.75],
];

/** Relative file size at `quality`, where the engine's default (90) is 1. */
export function relativeSizeAtQuality(quality: number): number {
  const q = clampPanelQuality(quality);
  const at = (target: number): number => {
    const points = QUALITY_SIZE_MB;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (target <= first[0]) return first[1];
    if (target >= last[0]) return last[1];
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i]!;
      const [x0, y0] = points[i - 1]!;
      if (target <= x1) {
        const t = (target - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    return last[1];
  };
  return at(q) / at(PANEL_QUALITY_DEFAULT);
}
