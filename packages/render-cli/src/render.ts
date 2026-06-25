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

export async function renderAtlas(input: RenderAtlasInput): Promise<RenderAtlasResult> {
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
      const panel = await renderMapPanel(page.bbox, 1000, undefined, panelOptions);
      panels[page.id] = `data:image/png;base64,${panel.png.toString("base64")}`;
      stderr.write(`  panel ${page.id} (z${panel.zoom})\n`);
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
