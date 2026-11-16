import { panelWidthPxFor, type PageSpec, type ScalePreset } from "@journeybook/atlas-core";
import { PRINT_RESOLUTION } from "./print-resolution";

/**
 * The panel-width control, expressed as the only thing a width can actually do.
 *
 * `RenderProjectRequest.PanelWidthPx` (and `render-cli --panel-px`) take any
 * integer 256–8000. A free number is the wrong control for it: `renderMapPanel`
 * crops at native tile resolution and never resamples, so the width only selects
 * a Web-Mercator zoom (`zoomForBBox`: the smallest zoom whose native width is at
 * least the request). Most widths change nothing at all; the one that crosses a
 * zoom boundary doubles the pixels each way and costs about 4x the tiles and the
 * file. A slider would be a knob that mostly does nothing and occasionally
 * quadruples the render.
 *
 * So the control offers zoom STEPS, and each step is a width that lands exactly
 * on the step: the default width is `panelWidthPxFor(scale, page)` (the engine's
 * own per-preset request, rescaled to the user's map box), and because native
 * width doubles per zoom, half of it selects exactly one zoom coarser and double
 * it exactly one zoom finer — unless the basemap has no finer tiles, in which case
 * the render is clamped and the step buys nothing. That case is named, not hidden.
 *
 * What each step delivers is read from the generated print-resolution table, at
 * the project's latitude. The table is measured for Letter portrait, and that is
 * still the user's figure on any page setup: each preset's request is rescaled to
 * the map box, so the zoom chosen at each latitude does not move (re-measured
 * 2026-11-16 across orientation, 0.25–2 in margins and a 2 in gutter: same zoom
 * at every sampled latitude, within 2 DPI). No DPI is typed in this file.
 *
 * The wire value is ONE width for every page. An atlas whose locations carry
 * their own scale or a zoom ladder resolves its default width per page, so a
 * width sized for the project's scale is not exactly one step for those pages;
 * the editor says so when it applies.
 */

export const PANEL_ZOOM_STEPS = [-1, 0, 1] as const;
export type PanelZoomStep = (typeof PANEL_ZOOM_STEPS)[number];

/** The API's and the engine's bounds (`RenderPanelKnobs`, `render.ts validateInput`). */
export const PANEL_WIDTH_MIN_PX = 256;
export const PANEL_WIDTH_MAX_PX = 8000;

/**
 * The `panelWidthPx` a step asks for, or null for step 0 — which sends nothing, so
 * the engine keeps resolving each page's width from its own preset.
 */
export function panelWidthForStep(step: PanelZoomStep, scale: ScalePreset, page: PageSpec): number | null {
  if (step === 0) return null;
  const base = panelWidthPxFor(scale, page);
  // Doubling an integer is exact. Halving an odd one is not, and `ceil` is the
  // side that fails safe: on a page whose native width is within a pixel of its
  // own request (measured: 6 of 6,510 preset/latitude/page cases), half-rounded-up
  // still selects the default zoom, so the step renders the default — it can
  // never jump two zooms. `panelStepChoices` names that case where the table
  // shows it.
  const width = step < 0 ? Math.ceil(base / 2) : base * 2;
  return Math.min(PANEL_WIDTH_MAX_PX, Math.max(PANEL_WIDTH_MIN_PX, width));
}

export interface PanelStepChoice {
  step: PanelZoomStep;
  panelWidthPx: number | null;
  label: string;
  /** What this step delivers at the project's latitude, or null when it cannot be said. */
  note: string | null;
  /** The basemap's zoom ceiling means this step would render exactly the default here. */
  noEffect: boolean;
}

const STEP_LABEL: Record<PanelZoomStep, string> = {
  [-1]: "One tile zoom coarser — about 1/4 the tiles and file",
  0: "Scale default",
  1: "One tile zoom finer — about 4x the tiles and file",
};

/** The table's sample for this preset at the nearest sampled latitude, if any. */
function sampleAt(scaleId: string, lat: number | null) {
  if (lat === null || !Number.isFinite(lat)) return undefined;
  const row = PRINT_RESOLUTION.presets.find((p) => p.id === scaleId);
  const sample = row?.samples.find((s) => s.lat === Math.round(lat));
  return sample && row ? { ...sample, requestedDpi: row.requestedDpi } : undefined;
}

/**
 * The three choices for a project, with what each delivers at `lat` (the
 * project's extent centre, or its first location). Outside the table's band, or
 * with no geometry yet, the notes are null rather than a guess.
 */
export function panelStepChoices(scale: ScalePreset, page: PageSpec, lat: number | null): PanelStepChoice[] {
  const sample = sampleAt(scale.id, lat);
  const maxZoom = PRINT_RESOLUTION.basemap.maxZoom;
  const where = sample ? `${sample.lat}°N` : "";

  return PANEL_ZOOM_STEPS.map((step) => {
    const panelWidthPx = panelWidthForStep(step, scale, page);
    if (!sample) return { step, panelWidthPx, label: STEP_LABEL[step], note: null, noEffect: false };

    if (step === 0) {
      return {
        step,
        panelWidthPx,
        label: STEP_LABEL[step],
        note: `About ${sample.dpi} DPI at ${where} (z${sample.zoom}).`,
        noEffect: false,
      };
    }
    const zoom = sample.zoom + step;
    // A clamped page already wanted a zoom deeper than the basemap has; one zoom
    // less than that is still at or past the ceiling, so it renders the same z.
    if (step < 0 && sample.clamped) {
      return {
        step,
        panelWidthPx,
        label: STEP_LABEL[step],
        note: `No effect at ${where}: this page already wants finer tiles than z${maxZoom}, so one zoom coarser still renders z${maxZoom}.`,
        noEffect: true,
      };
    }
    if (zoom > maxZoom) {
      return {
        step,
        panelWidthPx,
        label: STEP_LABEL[step],
        note: `No effect at ${where}: the basemap has no tiles finer than z${maxZoom}, so this renders exactly the default.`,
        noEffect: true,
      };
    }
    // A page that delivers no more than it asked for sits on its zoom boundary,
    // and half its request rounded up may not cross back over it.
    if (step < 0 && !sample.clamped && sample.dpi <= sample.requestedDpi + 1) {
      return {
        step,
        panelWidthPx,
        label: STEP_LABEL[step],
        note: `May have no effect at ${where}: the page sits right on a tile zoom boundary.`,
        noEffect: false,
      };
    }
    // Native width exactly doubles or halves per zoom, so the delivered DPI does too.
    const dpi = Math.round(sample.dpi * 2 ** step);
    return {
      step,
      panelWidthPx,
      label: STEP_LABEL[step],
      note: `About ${dpi} DPI at ${where} (z${zoom}).`,
      noEffect: false,
    };
  });
}
