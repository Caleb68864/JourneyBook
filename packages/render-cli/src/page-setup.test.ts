import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MARGINS,
  groundFootprintMeters,
  mapBoxInches,
  SCALE_PRESETS,
  type PageMargins,
} from "@journeybook/atlas-core";
import { mapBoxOf, measurePdfPages } from "@journeybook/pdf-client";
import { assembleContract, renderAtlas } from "./render.js";

/**
 * A project's margins, binder gutter and orientation reaching the renderer.
 *
 * They survived EF, request validation, the duplicate endpoint and the web adapter
 * — each of those with its own tests using non-default values — and then died at
 * `assembleContract`, which passed `LETTER_PORTRAIT` to every page-producing call.
 * Every atlas printed at 0.5in portrait no matter what the user saved.
 *
 * This is not cosmetic. Since the print fix, a page's ground footprint is measured
 * against the printed map box, and that box is the printable area less the page
 * furniture — so a margin change MOVES THE PRINTED FOOTPRINT: it changes the ground
 * each page covers, the page count, and what the scale bar has to say to stay true.
 * The one page-setup value that changes the geometry was the one that could not
 * reach the geometry.
 */

/** Lincoln, NE — a box big enough to tile into a multi-page grid at 1:24,000. */
const BBOX = [-96.78, 40.76, -96.62, 40.88] as const;

const SCALE = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

const WIDE_MARGINS: PageMargins = { top: 1.25, right: 1.25, bottom: 1.25, left: 1.25 };

function contractFor(extra: Partial<Parameters<typeof assembleContract>[0]>) {
  return assembleContract({
    mode: "bbox",
    bbox: [...BBOX],
    scalePresetId: "usgs-7-5-min",
    tier: 1,
    outputPath: "",
    ...extra,
  } as Parameters<typeof assembleContract>[0]);
}

describe("page setup reaches the engine", () => {
  it("puts the caller's margins on the contract instead of the Letter defaults", () => {
    const { contract } = contractFor({ margins: WIDE_MARGINS });
    expect(contract.margins).toEqual(WIDE_MARGINS);

    const { contract: def } = contractFor({});
    expect(def.margins).toEqual(DEFAULT_MARGINS);
  });

  it("wider margins shrink each page's ground footprint and so need more pages", () => {
    const wide = contractFor({ margins: WIDE_MARGINS }).contract;
    const base = contractFor({}).contract;

    // 1.25in margins leave a 0.75in-narrower printable area on each axis than the
    // 0.5in default, so each page covers less ground and the same box needs more of
    // them. Before the fix these two counts were identical.
    expect(wide.pages.length).toBeGreaterThan(base.pages.length);

    const groundWidth = (p: (typeof base.pages)[number]) => p.bbox[2] - p.bbox[0];
    expect(groundWidth(wide.pages[0]!)).toBeLessThan(groundWidth(base.pages[0]!));
  });

  it("takes the binder gutter off the map, not just off the paper", () => {
    const noGutter = contractFor({
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 },
    }).contract;
    const gutter = contractFor({
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0.75 },
    }).contract;

    // The gutter comes off the width only, so pages get narrower in ground terms
    // while keeping the same ground height.
    const w = (c: typeof gutter) => c.pages[0]!.bbox[2] - c.pages[0]!.bbox[0];
    const h = (c: typeof gutter) => c.pages[0]!.bbox[3] - c.pages[0]!.bbox[1];
    expect(w(gutter)).toBeLessThan(w(noGutter));
    // Heights match to within the projector's own re-centring noise (each page is
    // projected about its own centre), not to the bit.
    expect(h(gutter)).toBeCloseTo(h(noGutter), 7);
  });

  it("marks every page landscape when the project is landscape, and reshapes the box", () => {
    const landscape = contractFor({ orientation: "landscape" }).contract;
    const portrait = contractFor({}).contract;

    expect(landscape.pages.every((p) => p.orientation === "landscape")).toBe(true);
    expect(portrait.pages.every((p) => p.orientation === "portrait")).toBe(true);

    // Landscape hands the sheet's long side to the width: pages get wider on the
    // ground and shorter. Before the fix the orientation never left the API.
    const aspect = (c: typeof portrait) => {
      const p = c.pages[0]!;
      return (p.bbox[2] - p.bbox[0]) / (p.bbox[3] - p.bbox[1]);
    };
    expect(aspect(landscape)).toBeGreaterThan(aspect(portrait));
  });

  it("rejects margins that would leave no map box at all", () => {
    // 4in margins each side on an 8.5in sheet leaves 0.5in of printable width, and
    // the page furniture alone wants 125pt of it. Without this guard the contract
    // came out with negative ground footprints.
    expect(() =>
      contractFor({ margins: { top: 4, right: 4, bottom: 4, left: 4 } }),
    ).toThrow(/margins/i);
  });

  it("rejects an orientation the engine's union does not have", () => {
    // The latent half of the drop: C# emits "Portrait"/"Landscape" and the engine's
    // union is lower-case, so an un-normalised value has to be rejected loudly here
    // rather than silently treated as portrait downstream.
    expect(() => contractFor({ orientation: "Landscape" as "landscape" })).toThrow(/orientation/i);
  });
});

describe("page setup reaches the printed PDF", () => {
  it("prints the map box the margins imply, measured off the rendered file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-page-setup-"));
    try {
      const out = join(dir, "wide.pdf");
      await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        margins: WIDE_MARGINS,
        outputPath: out,
      });

      const bytes = readFileSync(out);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");

      const spec = {
        widthIn: 8.5,
        heightIn: 11,
        orientation: "portrait" as const,
        margins: WIDE_MARGINS,
      };
      const expected = mapBoxInches(spec);

      // The default box is 447 x 549 pt; 1.25in margins make it 339 x 441.
      expect(expected.widthIn * 72).toBeCloseTo(339, 6);
      expect(expected.heightIn * 72).toBeCloseTo(441, 6);

      // Measuring the produced FILE is the only assertion that catches the engine
      // and the renderer disagreeing about which box the map went into — the exact
      // failure mode that printed the whole atlas ~30% off its stated scale, and
      // which no contract-vs-contract check can see.
      const measured = measurePdfPages(bytes);
      expect(measured).toHaveLength(1);
      const printed = mapBoxOf(measured[0]!, 1);
      expect(printed, "no map panel found on the rendered page").toBeDefined();
      expect(printed!.width).toBeCloseTo(expected.widthIn * 72, 1);
      expect(printed!.height).toBeCloseTo(expected.heightIn * 72, 1);

      // …and the ground footprint the contract sized the page from is measured
      // against that same box, so the scale bar stays true at these margins.
      const footprint = groundFootprintMeters(SCALE, spec);
      expect(footprint.widthMeters).toBeCloseTo(expected.widthIn * 609.6, 6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
