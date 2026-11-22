import { describe, it, expect } from "vitest";
import {
  LETTER_PORTRAIT,
  SCALE_PRESETS,
  buildLocationPage,
  type AtlasContract,
  type PageMargins,
  type PageOrientation,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToBuffer } from "./index.js";
import { measurePdfPages, type MeasuredText } from "./pdf-measure.js";

/**
 * Stage 1D's done-when: "every map page shows visible attribution inside the printable area".
 * `attribution.test.ts` proves the credit is printed; nothing measured WHERE. This reads each
 * credit string's position off the PDF and holds it inside the margins, at the page setups the
 * UI offers, and with a credit long enough to wrap.
 */

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;
const PT = 72;
const PANEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEUlEQVR4nGM4cWkLHDEQxwEAwGEk4Xek1H0AAAAASUVORK5CYII=";

const LONG_CREDIT =
  "USGS The National Map; © OpenStreetMap contributors (ODbL); Natural Earth; elevation from the 3DEP 1/3 arc-second DEM, retrieved for this atlas";

/** Helvetica's widest glyphs are about 1 em; an upper bound on a string's printed width. */
const upperBoundWidth = (t: MeasuredText) => t.text.length * t.size;

async function creditItems(options: { orientation?: PageOrientation; margins?: PageMargins; tier?: 1 | 2 | 3; credit: string }) {
  const orientation = options.orientation ?? "portrait";
  const margins = options.margins ?? LETTER_PORTRAIT.margins;
  const page = buildLocationPage({ lng: -96.7, lat: 40.8 }, usgs, { ...LETTER_PORTRAIT, orientation, margins }, "L1", options.tier ?? 2);
  const contract: AtlasContract = { version: 1, scale: usgs, margins, pages: [page] };
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    panels: { L1: PANEL_PNG },
    attribution: options.credit,
    tableOfContents: false,
  });
  const [measured] = measurePdfPages(pdf);
  // The credit is shown as one or more strings ending in "— Journey Book".
  const words = new Set(`${options.credit} — Journey Book`.split(/\s+/));
  // The standard-14 fonts show "—" as WinAnsi 0x97.
  const norm = (text: string) => text.replace(/\x97/g, "—");
  const items = measured!.textItems
    .map((t) => ({ ...t, text: norm(t.text) }))
    .filter((t) => t.size === 6 && t.text.trim().length > 0 && t.text.trim().split(/\s+/).every((w) => words.has(w)));
  return { items, orientation, margins };
}

const SETUPS: { name: string; orientation?: PageOrientation; margins?: PageMargins; tier?: 1 | 2 | 3 }[] = [
  { name: "defaults" },
  { name: "landscape", orientation: "landscape" },
  { name: "wide margins and a gutter", margins: { top: 1, right: 1.25, bottom: 1, left: 1, gutter: 0.75 } },
  { name: "tier 1 (no scale bar above it)", tier: 1 },
];

describe("the credit line sits inside the printable area", () => {
  for (const setup of SETUPS) {
    for (const credit of ["USGS The National Map", LONG_CREDIT]) {
      it(`${setup.name}, ${credit.length > 40 ? "a credit long enough to wrap" : "a short credit"}`, async () => {
        const { items, orientation, margins } = await creditItems({ ...setup, credit });
        expect(items.length, "credit not found on the page").toBeGreaterThan(0);
        // Every word of the credit is on the page (a wrapped line is still the credit).
        const printed = items.map((t) => t.text).join(" ");
        for (const word of credit.split(/\s+/)) expect(printed).toContain(word);
        const [w, h] = orientation === "landscape" ? [11 * PT, 8.5 * PT] : [8.5 * PT, 11 * PT];
        const left = (margins.left + (margins.gutter ?? 0)) * PT;
        const right = w - margins.right * PT;
        const top = margins.top * PT;
        const bottom = h - margins.bottom * PT;
        for (const t of items) {
          const at = `"${t.text}" at ${t.x.toFixed(1)},${t.y.toFixed(1)}`;
          expect(t.x, `${at}: left of the margin`).toBeGreaterThanOrEqual(left);
          expect(t.x + Math.min(upperBoundWidth(t), 280), `${at}: past the right margin`).toBeLessThanOrEqual(right);
          // Baseline above the bottom margin with room for descenders (about 0.25 em).
          expect(t.y + 0.25 * t.size, `${at}: below the bottom margin`).toBeLessThanOrEqual(bottom);
          expect(t.y - t.size, `${at}: above the top margin`).toBeGreaterThanOrEqual(top);
        }
      });
    }
  }
});
