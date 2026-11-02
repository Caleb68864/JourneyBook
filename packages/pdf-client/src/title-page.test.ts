import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARGINS,
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildLocationPage,
  type AtlasContract,
} from "@journeybook/atlas-core";
import { measurePdfPages, renderAtlasPdfToBuffer } from "./index.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;
const contract: AtlasContract = {
  version: 1,
  scale: usgs,
  margins: DEFAULT_MARGINS,
  pages: [buildLocationPage({ lng: -96.7026, lat: 40.8136 }, usgs, LETTER_PORTRAIT, "L1", 2)],
};

async function render(extra: { explorerName?: string; atlasDate?: string }) {
  return measurePdfPages(
    await renderAtlasPdfToBuffer({ contract, title: "Sandhills", tableOfContents: false, notes: false, ...extra }),
  );
}

describe("title page", () => {
  it("prints the title, explorer and date ahead of the atlas", async () => {
    const pages = await render({ explorerName: "Ada", atlasDate: "Summer 2026" });

    expect(pages).toHaveLength(2);
    const texts = pages[0]!.texts.join(" ");
    expect(texts).toContain("JOURNEY BOOK");
    expect(texts).toContain("Sandhills");
    expect(texts).toContain("Explorer: Ada");
    expect(texts).toContain("Summer 2026");
  });

  it("prints with only one of the two, and leaves out the line it has nothing for", async () => {
    const dateOnly = await render({ atlasDate: "Summer 2026" });
    expect(dateOnly).toHaveLength(2);
    expect(dateOnly[0]!.texts.join(" ")).not.toContain("Explorer");
  });

  it("[CONTROL] adds no page when there is nothing to say", async () => {
    expect(await render({})).toHaveLength(1);
    expect(await render({ explorerName: "   ", atlasDate: "" })).toHaveLength(1);
  });

  it("counts itself in the printed page numbers", async () => {
    const pages = await render({ explorerName: "Ada" });
    expect(pages[1]!.texts.join(" ")).toMatch(/\b2\b/);
  });
});
