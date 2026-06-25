/**
 * @journeybook/pdf-client
 *
 * Renders an AtlasContract to a printable Letter PDF using @react-pdf/renderer,
 * which runs headless in Node (Stage 1D) and is reusable client-side later.
 * Page furniture is tier-aware (Map Tiers learning curve): Level 1 shows the
 * road-atlas locator + continuation labels; Level 2+ adds a true scale bar and
 * compass rose. The map panel itself is a placeholder until Stage 1C.
 */

import { renderToBuffer, renderToFile } from "@react-pdf/renderer";
import { createElement } from "react";
import type { AtlasContract, UsngGridOverlay } from "@journeybook/atlas-core";
import { AtlasDocument } from "./AtlasDocument.js";

export interface RenderPdfOptions {
  contract: AtlasContract;
  /** Book title shown in each page header. */
  title?: string;
  /** map pageId -> map-panel image data URI (from @journeybook/map-sources). */
  panels?: Record<string, string>;
  /** map pageId -> USNG grid overlay (from @journeybook/map-sources, tier >= 3 only). */
  grids?: Record<string, UsngGridOverlay>;
}

function documentElement(options: RenderPdfOptions) {
  return createElement(AtlasDocument, {
    contract: options.contract,
    title: options.title ?? "Journey Book",
    panels: options.panels,
    grids: options.grids,
  });
}

/** Render the atlas to a PDF file at <paramref name="outputPath"/>. */
export async function renderAtlasPdfToFile(
  options: RenderPdfOptions & { outputPath: string },
): Promise<string> {
  await renderToFile(documentElement(options), options.outputPath);
  return options.outputPath;
}

/** Render the atlas to an in-memory PDF buffer. */
export async function renderAtlasPdfToBuffer(options: RenderPdfOptions): Promise<Buffer> {
  return renderToBuffer(documentElement(options));
}

export { AtlasDocument } from "./AtlasDocument.js";
export const PDF_CLIENT_VERSION = "0.0.0";
