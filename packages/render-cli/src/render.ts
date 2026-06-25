import { stderr } from "node:process";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  buildPageGrid,
  buildLocationPage,
  type BBox,
  type LngLat,
  type MapTier,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToFile } from "@journeybook/pdf-client";
import { renderMapPanel } from "@journeybook/map-sources";

export interface RenderAtlasInput {
  mode: "bbox" | "location";
  bbox?: BBox;
  center?: LngLat;
  scalePresetId: string;
  tier: MapTier;
  overlap?: number;
  title?: string;
  basemap?: boolean;
  tileBaseUrl?: string;
  tileSourceId?: string;
  cacheDir?: string;
  outputPath: string;
}

export interface RenderAtlasResult {
  outputPath: string;
  pageCount: number;
  attribution: string;
}

/**
 * Validate render input up front so a bad request fails fast with a clear,
 * caller-facing message (the render-worker maps these to HTTP 400) instead of a
 * cryptic error deep inside projection/grid math. Messages start with "Invalid"
 * or "Unknown" so the worker's input-error classifier catches them.
 */
function validateInput(input: RenderAtlasInput): void {
  if (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > 4) {
    throw new Error(`Invalid tier ${String(input.tier)}: must be an integer 1–4.`);
  }
  if (input.overlap !== undefined) {
    if (!Number.isFinite(input.overlap) || input.overlap < 0 || input.overlap >= 1) {
      throw new Error(`Invalid overlap ${String(input.overlap)}: must be in [0, 1).`);
    }
  }
  if (input.mode === "location") {
    const c = input.center;
    if (!c || !Number.isFinite(c.lng) || !Number.isFinite(c.lat) ||
        c.lng < -180 || c.lng > 180 || c.lat < -90 || c.lat > 90) {
      throw new Error('Invalid center: requires finite lng in [-180,180] and lat in [-90,90].');
    }
  } else if (input.mode === "bbox") {
    const b = input.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((n) => Number.isFinite(n))) {
      throw new Error("Invalid bbox: requires [west, south, east, north] of four finite numbers.");
    }
    const [w, s, e, n] = b;
    if (w >= e || s >= n) {
      throw new Error(`Invalid bbox: requires west<east and south<north (got [${b.join(", ")}]).`);
    }
    if (w < -180 || e > 180 || s < -90 || n > 90) {
      throw new Error("Invalid bbox: coordinates out of range (lng ±180, lat ±90).");
    }
  } else {
    throw new Error(`Invalid mode "${String((input as RenderAtlasInput).mode)}": must be "bbox" or "location".`);
  }
}

export async function renderAtlas(input: RenderAtlasInput): Promise<RenderAtlasResult> {
  validateInput(input);

  const scale = SCALE_PRESETS.find((p) => p.id === input.scalePresetId);
  if (!scale) {
    throw new Error(
      `Unknown scalePresetId "${input.scalePresetId}". Available: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }

  const contract =
    input.mode === "location"
      ? (() => {
          if (!input.center) throw new Error('mode "location" requires center');
          const page = buildLocationPage(input.center, scale, LETTER_PORTRAIT, "L1", input.tier);
          return { version: 1 as const, scale, margins: LETTER_PORTRAIT.margins, pages: [page] };
        })()
      : (() => {
          if (!input.bbox) throw new Error('mode "bbox" requires bbox');
          return buildPageGrid({
            bbox: input.bbox,
            scale,
            page: LETTER_PORTRAIT,
            overlap: input.overlap ?? 0,
            tier: input.tier,
          });
        })();

  let panels: Record<string, string> | undefined;
  if (input.basemap) {
    panels = {};
    const panelOptions =
      input.tileBaseUrl || input.tileSourceId || input.cacheDir
        ? {
            ...(input.tileBaseUrl ? { tileBaseUrl: input.tileBaseUrl } : {}),
            ...(input.tileSourceId ? { sourceId: input.tileSourceId } : {}),
            ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
          }
        : undefined;
    for (const page of contract.pages) {
      try {
        const panel = await renderMapPanel(page.bbox, 1000, undefined, panelOptions);
        panels[page.id] = `data:image/png;base64,${panel.png.toString("base64")}`;
        stderr.write(`  panel ${page.id} (z${panel.zoom})\n`);
      } catch (err) {
        // Surface a clear, source-aware message so the worker can map a tile
        // failure to 502 (its classifier matches "tile"/"fetch") rather than 500.
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch basemap tile panel for page ${page.id}: ${detail}`);
      }
    }
  }

  await renderAtlasPdfToFile({ contract, outputPath: input.outputPath, panels });

  return {
    outputPath: input.outputPath,
    pageCount: contract.pages.length,
    attribution: input.basemap
      ? "Map data: USGS National Map (public domain)"
      : "JourneyBook atlas",
  };
}
