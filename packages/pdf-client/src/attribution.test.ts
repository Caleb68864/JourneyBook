import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildLocationPage,
  type AtlasContract,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages } from "./pdf-measure.js";

/**
 * Attribution is a licensing obligation in both directions — a source we used
 * has to be credited, and a source we did not use must not be. It was carried
 * from the tile response through `MapPanel`, `render-cli` and `RenderPdfOptions`
 * and then dropped at every layer, because the page footer printed a hardcoded
 * "© OpenStreetMap contributors · USGS" on every page of every atlas regardless
 * of which source (if any) drew it. These tests read the credit back out of the
 * produced PDF.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

/** A 4x4 flat-colour PNG — enough for react-pdf to place a real image XObject. */
const PANEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4cWkLHDEQxwEAwGEk4Xek1H0AAAAASUVORK5CYII=";

async function footerTexts(attribution?: string, withPanel = true): Promise<string[]> {
  const page = buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, "L1", 2);
  const contract: AtlasContract = {
    version: 1,
    scale: usgs,
    margins: LETTER_PORTRAIT.margins,
    pages: [page],
  };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    title: "Journey Book",
    ...(withPanel ? { panels: { L1: PANEL_PNG } } : {}),
    ...(attribution ? { attribution } : {}),
    tableOfContents: false,
    referenceGrid: false,
    notes: true,
  });
  const measured = measurePdfPages(pdf);
  expect(measured).toHaveLength(1);
  return measured[0]!.texts;
}

describe("printed attribution", () => {
  it("prints the credit the tile source actually reported", async () => {
    const texts = await footerTexts("USGS The National Map");
    const joined = texts.join(" ");
    expect(joined).toContain("USGS The National Map");
  });

  it("prints a proxied source's own credit, not the default basemap's", async () => {
    // What the C# tile proxy returns in X-Tile-Attribution for a registered
    // non-USGS source. The old hardcoded footer credited USGS and OSM here.
    const texts = await footerTexts("© OpenStreetMap contributors");
    const joined = texts.join(" ");
    expect(joined).toContain("OpenStreetMap");
    expect(joined).not.toContain("USGS");
  });

  it("claims no map source at all when no basemap was rendered", async () => {
    const joined = (await footerTexts(undefined, false)).join(" ");
    // A page with no map data on it must not credit a map source.
    expect(joined).not.toContain("USGS");
    expect(joined).not.toContain("OpenStreetMap");
    expect(joined).toContain("Journey Book");
  });
});
