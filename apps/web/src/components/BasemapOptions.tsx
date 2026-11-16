import {
  PANEL_FORMATS,
  PANEL_QUALITY_DEFAULT,
  PANEL_QUALITY_MAX,
  PANEL_QUALITY_MIN,
  clampPanelQuality,
  relativeSizeAtQuality,
  type PanelFormat,
  type RenderOptionsState,
} from "../lib/render-options";
import type { PanelStepChoice, PanelZoomStep } from "../lib/panel-resolution";

/**
 * Basemap on/off, panel encoding, and JPEG quality.
 *
 * `render-cli` has exposed all three since Stage 1E (`--basemap`,
 * `--panel-format`, `--panel-quality`); the API hardcoded `basemap: true` and
 * had no member for the other two, so the app could reach strictly less than the
 * project's own CLI. The wire now carries them.
 *
 * Two things are worth a control and not obvious from the outside:
 *
 *  - Turning the basemap OFF removes every tile fetch, which is the slowest and
 *    most failure-prone part of a render. That is the difference between a
 *    minutes-long render and a near-instant line-art proof of the page layout.
 *  - Quality is the only continuous lever on file size. Panel WIDTH is not: the
 *    engine crops at native tile resolution and never resamples, so a wider
 *    request changes nothing until it crosses a Web-Mercator zoom boundary and
 *    then costs about 4x. So width is offered as zoom STEPS, not pixels — one
 *    zoom coarser, the scale's default, one zoom finer — each a width that lands
 *    exactly on its step (`lib/panel-resolution.ts`), with what it delivers at
 *    the project's latitude beside it. Decision 7 put `PanelWidthPx` in scope:
 *    the API and `--panel-px` could change it and the app could not.
 */

export type BasemapOptionsValue = Pick<RenderOptionsState, "basemap" | "panelFormat" | "panelQuality"> & {
  /** Tile zoom step relative to the scale's default; the editor turns it into `panelWidthPx`. */
  panelZoomStep: PanelZoomStep;
};

export interface BasemapOptionsProps {
  value: BasemapOptionsValue;
  onChange: (next: BasemapOptionsValue) => void;
  /**
   * The three resolution steps for this project's scale, page and latitude, from
   * `panelStepChoices`. The editor owns the geometry; this only shows it.
   */
  panelChoices: PanelStepChoice[];
  /**
   * Some pages resolve their own default width (a location's own scale or zoom
   * ladder), so one width sized for the project's scale is not exactly one step
   * for them.
   */
  mixedScales?: boolean;
  disabled?: boolean;
}

const FORMAT_LABEL: Record<PanelFormat, string> = {
  jpeg: "JPEG (default) — smaller file",
  png: "PNG — lossless, several times larger",
};

export function BasemapOptions({ value, onChange, panelChoices, mixedScales, disabled }: BasemapOptionsProps) {
  const chosenStep = panelChoices.find((c) => c.step === value.panelZoomStep);
  const quality = value.panelQuality ?? PANEL_QUALITY_DEFAULT;
  const relative = relativeSizeAtQuality(quality);
  const isPng = value.panelFormat === "png";

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={value.basemap}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, basemap: e.target.checked })}
          className="mt-0.5 accent-forest-700"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
            Basemap
          </span>
          <span className="font-mono text-[10px] text-bark-500">
            Draws the USGS topo raster under every page. Off is line art only — no tile
            fetches at all, so a layout proof renders in seconds instead of minutes.
          </span>
        </span>
      </label>

      {value.basemap && (
        <div className="flex flex-col gap-3 border-l-2 border-bark-300 pl-3">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="panel-format" className="font-mono text-[10px] uppercase text-bark-500">
              Panel format
            </label>
            <select
              id="panel-format"
              disabled={disabled}
              value={value.panelFormat ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  panelFormat: e.target.value === "" ? null : (e.target.value as PanelFormat),
                })
              }
              className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
            >
              {/* "" is not a value the wire ever carries — it means "send nothing
                  and let the engine decide", which is what keeps the engine's own
                  default reachable after a control exists for it. */}
              <option value="">Engine default (JPEG)</option>
              {PANEL_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABEL[format]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor="panel-quality" className="font-mono text-[10px] uppercase text-bark-500">
              Panel quality {isPng ? "(not used by PNG)" : `— ${quality}`}
            </label>
            <input
              id="panel-quality"
              type="range"
              min={PANEL_QUALITY_MIN}
              max={PANEL_QUALITY_MAX}
              step={5}
              disabled={disabled || isPng}
              value={quality}
              onChange={(e) =>
                onChange({ ...value, panelQuality: clampPanelQuality(Number(e.target.value)) })
              }
              className="accent-forest-700 disabled:opacity-40"
            />
            {/* The cost, at the knob. Measured on a real 36-page 1:50,000 atlas:
                42 MB at the default 90, 19 MB at 70, 12.5 MB at 50. The curve is
                steep above 80, which is the part nobody can see from the slider. */}
            <span data-testid="quality-cost" className="font-mono text-[10px] text-bark-500">
              {isPng
                ? "PNG is lossless; this slider does nothing until you pick JPEG."
                : value.panelQuality === null
                  ? `Engine default (${PANEL_QUALITY_DEFAULT}). Lowering it is the only real lever on file size.`
                  : `About ${relative.toFixed(2)}x the file size of the default (${PANEL_QUALITY_DEFAULT}).`}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor="panel-resolution" className="font-mono text-[10px] uppercase text-bark-500">
              Panel resolution
            </label>
            <select
              id="panel-resolution"
              disabled={disabled}
              value={String(value.panelZoomStep)}
              onChange={(e) =>
                onChange({ ...value, panelZoomStep: Number(e.target.value) as PanelZoomStep })
              }
              className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
            >
              {panelChoices.map((choice) => (
                <option key={choice.step} value={String(choice.step)}>
                  {choice.noEffect ? `${choice.label} (no effect here)` : choice.label}
                </option>
              ))}
            </select>
            {/* What the chosen step delivers, at this project's latitude, read
                from the generated print-resolution table — never typed. */}
            <span data-testid="panel-resolution-note" className="font-mono text-[10px] text-bark-500">
              {chosenStep?.note ??
                "Steps by whole tile zooms: each step finer is about 4x the tiles and file. Set a box or a location to see the DPI."}
            </span>
            {mixedScales && value.panelZoomStep !== 0 && (
              <span data-testid="panel-resolution-mixed" className="font-mono text-[10px] text-campfire-700">
                One width is sent for every page, sized for the project's scale. Pages with their own scale or
                zoom ladder may move by a different amount.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
