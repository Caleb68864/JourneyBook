import generated from "../generated/print-resolution.json";

/**
 * What each scale preset actually prints at — read from the table the engine
 * generates, never restated.
 *
 * The figures are measured in `packages/map-sources` (`buildPrintResolutionTable`,
 * through the same `planMapPanel` the renderer uses), which imports `sharp` and so
 * cannot be bundled into a browser. `scripts/generate-print-resolution.mjs` writes
 * them to `../generated/print-resolution.json`, and CI's
 * `pnpm check:print-resolution` fails when that file no longer matches the
 * engine. This module only turns the table into words.
 *
 * NO DPI IS WRITTEN IN THIS FILE, and none should be. Every figure a sentence
 * below contains is interpolated from a row. The one constant is the wording.
 * Three resolution figures reached this project's owner wrong before this
 * existed, and each was a hand-typed number nothing checked.
 */

/** A preset's resolution across the latitude band at one requested panel width. */
export interface ResolutionBand {
  minDpi: number;
  minDpiLat: number;
  maxDpi: number;
  maxDpiLat: number;
  belowTargetLats: number[];
  clampedLats: number[];
}

/** One row of the generated table. Mirrors `PresetPrintResolution` in map-sources. */
export interface PresetResolution extends ResolutionBand {
  id: string;
  label: string;
  ratio: number;
  panelWidthPx: number;
  requestedDpi: number;
  steepestStep: { fromLat: number; fromDpi: number; toLat: number; toDpi: number };
  atTargetRequest: ResolutionBand & { panelWidthPx: number };
  samples: { lat: number; zoom: number; clamped: boolean; dpi: number }[];
}

export interface PrintResolutionTable {
  doc: string;
  targetDpi: number;
  page: { description: string; orientation: string; mapBoxWidthIn: number };
  basemap: { id: string; maxZoom: number };
  latitudes: { from: number; to: number; step: number };
  presets: PresetResolution[];
}

/** The generated table, exactly as checked in. */
export const PRINT_RESOLUTION: PrintResolutionTable = generated;

/**
 * Where the picker's "why" link goes: the documentation page generated from the
 * same table. The repository is public, and the page is a Markdown file rather
 * than part of this app, so it is linked on GitHub; the path comes from the
 * table so the two cannot name different files.
 */
export const PRINT_RESOLUTION_DOC_URL = `https://github.com/Caleb68864/JourneyBook/blob/master/${PRINT_RESOLUTION.doc}`;

export function presetResolution(id: string): PresetResolution | undefined {
  return PRINT_RESOLUTION.presets.find((p) => p.id === id);
}

/** "174–343 DPI", or "300 DPI" when the band is a single figure. */
export function optionResolutionLabel(p: Pick<ResolutionBand, "minDpi" | "maxDpi">): string {
  return p.minDpi === p.maxDpi ? `${p.minDpi} DPI` : `${p.minDpi}–${p.maxDpi} DPI`;
}

/** `[18,19,20,43,44,69]` -> "18–20°N, 43–44°N and 69°N". */
export function latitudeRuns(lats: readonly number[], step: number): string {
  if (lats.length === 0) return "";
  const runs: [number, number][] = [];
  let start = lats[0]!;
  let prev = lats[0]!;
  for (const lat of lats.slice(1)) {
    if (lat === prev + step) {
      prev = lat;
      continue;
    }
    runs.push([start, prev]);
    start = prev = lat;
  }
  runs.push([start, prev]);
  const parts = runs.map(([a, b]) => (a === b ? `${a}°N` : `${a}–${b}°N`));
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * The picker's note for one preset, as short sentences. Kept short on purpose:
 * it sits beside a select in a narrow sidebar, and the detail is one link away.
 *
 * Three shapes, decided by the row rather than by the preset's id:
 *  - a preset that asks for LESS than the target (today, the 1:24,000 default):
 *    its band, the steepest one-degree cliff, and why a wider panel is not the
 *    fix — with the floor a full-target request would still have;
 *  - a preset that asks for the target and gets it at every sampled latitude;
 *  - a preset that asks for the target and is stopped short somewhere by the
 *    basemap's deepest zoom — named with where, not grouped with the ones that
 *    clear it everywhere.
 */
export function describePresetResolution(
  p: PresetResolution,
  targetDpi: number = PRINT_RESOLUTION.targetDpi,
  step: number = PRINT_RESOLUTION.latitudes.step,
): string[] {
  const band = optionResolutionLabel(p);

  if (p.requestedDpi < targetDpi) {
    const s = p.steepestStep;
    const verb = s.fromDpi / s.toDpi >= 1.9 ? "halve it" : "cut it sharply";
    const t = p.atTargetRequest;
    return [
      `Prints at ${band} depending on latitude (target: ${targetDpi}).`,
      `One degree can ${verb}: ${s.fromDpi} DPI at ${s.fromLat}°N, ${s.toDpi} at ${s.toLat}°N.`,
      `The cause is where the page falls against the map tiles' zoom levels, not panel width: ` +
        `a panel wide enough for ${targetDpi} DPI would still bottom out at ${t.minDpi} DPI (${t.minDpiLat}°N).`,
    ];
  }

  if (p.belowTargetLats.length === 0) {
    return [`Prints at ${band} — ${targetDpi} DPI or better at every latitude.`];
  }

  return [
    `Prints at ${band} — ${targetDpi} DPI or better except at ${latitudeRuns(p.belowTargetLats, step)}, ` +
      `where USGS has no finer tiles (${p.minDpi} at ${p.minDpiLat}°N).`,
  ];
}
