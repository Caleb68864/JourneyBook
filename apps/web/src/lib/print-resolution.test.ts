import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCALE_PRESETS } from "@journeybook/atlas-core";
import table from "../generated/print-resolution.json";
import {
  PRINT_RESOLUTION,
  PRINT_RESOLUTION_DOC_URL,
  describePresetResolution,
  latitudeRuns,
  optionResolutionLabel,
  presetResolution,
  type PresetResolution,
} from "./print-resolution";

/**
 * The picker's wording is derived from the generated table at runtime, never
 * typed. These cases feed it a FABRICATED row whose figures appear nowhere in the
 * real table, so a sentence that carries a hand-written number — the failure this
 * whole feature exists to stop — cannot pass by coincidence.
 */
function fakeRow(overrides: Partial<PresetResolution> = {}): PresetResolution {
  return {
    id: "fake",
    label: "Fake (1:1)",
    ratio: 1,
    panelWidthPx: 1000,
    requestedDpi: 150,
    minDpi: 151,
    minDpiLat: 37,
    maxDpi: 298,
    maxDpiLat: 36,
    belowTargetLats: [30, 31, 37, 38],
    clampedLats: [],
    steepestStep: { fromLat: 36, fromDpi: 298, toLat: 37, toDpi: 151 },
    atTargetRequest: {
      panelWidthPx: 1730,
      minDpi: 257,
      minDpiLat: 19,
      maxDpi: 599,
      maxDpiLat: 50,
      belowTargetLats: [19, 20],
      clampedLats: [19, 20],
    },
    samples: [],
    ...overrides,
  };
}

describe("describePresetResolution derives every figure from the row", () => {
  it("[BEHAVIORAL] a preset asking for less than the target: band, cliff and cause", () => {
    const text = describePresetResolution(fakeRow(), 300).join(" ");
    expect(text).toContain("151–298 DPI");
    expect(text).toContain("depending on latitude");
    // The cliff, with where it is, and "halve" because 298/151 is ~2x.
    expect(text).toContain("298 DPI at 36°N, 151 at 37°N");
    expect(text).toMatch(/halve/);
    // The cause, and what a wider panel would and would not buy.
    expect(text).toMatch(/zoom/i);
    expect(text).toContain("257");
    expect(text).toContain("19°N");
  });

  it("does not say 'halve' for a step that is not about 2x", () => {
    const row = fakeRow({ steepestStep: { fromLat: 36, fromDpi: 298, toLat: 37, toDpi: 250 } });
    expect(describePresetResolution(row, 300).join(" ")).not.toMatch(/halve/);
  });

  it("[BEHAVIORAL] a preset asking for the target that clears it everywhere says so", () => {
    const row = fakeRow({ requestedDpi: 301, minDpi: 302, maxDpi: 597, belowTargetLats: [], clampedLats: [] });
    const text = describePresetResolution(row, 300).join(" ");
    expect(text).toContain("302–597 DPI");
    expect(text).toMatch(/every latitude/);
    expect(text).not.toMatch(/except/);
  });

  it("[BEHAVIORAL] a preset asking for the target that the tile ceiling stops short says where", () => {
    const row = fakeRow({
      requestedDpi: 301,
      minDpi: 277,
      minDpiLat: 18,
      maxDpi: 588,
      belowTargetLats: [18, 19, 20],
      clampedLats: [18, 19, 20],
    });
    const text = describePresetResolution(row, 300).join(" ");
    expect(text).toContain("277–588 DPI");
    expect(text).toContain("except at 18–20°N");
    expect(text).toContain("277 at 18°N");
    expect(text).not.toMatch(/every latitude/);
  });

  it("latitude runs read as ranges", () => {
    expect(latitudeRuns([18, 19, 20, 43, 44, 69], 1)).toBe("18–20°N, 43–44°N and 69°N");
    expect(latitudeRuns([27], 1)).toBe("27°N");
  });

  it("an option label carries the preset's own range", () => {
    expect(optionResolutionLabel(fakeRow())).toBe("151–298 DPI");
    expect(optionResolutionLabel(fakeRow({ minDpi: 300, maxDpi: 300 }))).toBe("300 DPI");
  });
});

describe("the generated table the picker reads", () => {
  it("has a row for every scale preset the picker offers", () => {
    for (const preset of SCALE_PRESETS) {
      expect(presetResolution(preset.id), preset.id).toBeDefined();
    }
    expect(PRINT_RESOLUTION.presets).toHaveLength(SCALE_PRESETS.length);
  });

  it("is the checked-in file, not a copy of it", () => {
    expect(PRINT_RESOLUTION).toBe(table);
  });

  /** The picker links here; a link to a file that is not in the repo is a dead end. */
  it("links to documentation that exists in the repo", () => {
    const doc = fileURLToPath(new URL(`../../../../${table.doc}`, import.meta.url));
    expect(existsSync(doc), `${table.doc} is not in the repo`).toBe(true);
    expect(PRINT_RESOLUTION_DOC_URL.endsWith(`/${table.doc}`)).toBe(true);
  });
});
