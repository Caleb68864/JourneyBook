import { describe, it, expect } from "vitest";
import { LETTER_PORTRAIT, SCALE_PRESETS, panelWidthPxFor } from "@journeybook/atlas-core";
import { panelStepChoices, panelWidthForStep } from "./panel-resolution";
import { presetResolution } from "./print-resolution";

const preset = (id: string) => SCALE_PRESETS.find((s) => s.id === id)!;
const step = (choices: ReturnType<typeof panelStepChoices>, n: -1 | 0 | 1) => choices.find((c) => c.step === n)!;

describe("panelWidthForStep", () => {
  it("[CONTROL] step 0 sends nothing, so the engine keeps its per-page widths", () => {
    expect(panelWidthForStep(0, preset("1-50000"), LETTER_PORTRAIT)).toBeNull();
  });

  it("doubles and halves the engine's own request for this page", () => {
    const base = panelWidthPxFor(preset("1-50000"), LETTER_PORTRAIT);
    expect(panelWidthForStep(1, preset("1-50000"), LETTER_PORTRAIT)).toBe(base * 2);
    // Rounded UP: the side that can fail only to "no change", never to two zooms.
    expect(panelWidthForStep(-1, preset("1-50000"), LETTER_PORTRAIT)).toBe(Math.ceil(base / 2));
  });
});

describe("panelStepChoices reads what each step delivers from the generated table", () => {
  it("quotes the table's own figure for the default, not a typed one", () => {
    const row = presetResolution("1-50000")!.samples.find((s) => s.lat === 41)!;
    const choices = panelStepChoices(preset("1-50000"), LETTER_PORTRAIT, 41.3);
    expect(step(choices, 0).note).toBe(`About ${row.dpi} DPI at 41°N (z${row.zoom}).`);
    expect(step(choices, 1).note).toBe(`About ${row.dpi * 2} DPI at 41°N (z${row.zoom + 1}).`);
  });

  it("calls a coarser step on a clamped page what it is: no change", () => {
    const row = presetResolution("1-25000")!.samples.find((s) => s.clamped)!;
    const choices = panelStepChoices(preset("1-25000"), LETTER_PORTRAIT, row.lat);
    expect(step(choices, -1).noEffect).toBe(true);
    expect(step(choices, 1).noEffect).toBe(true);
  });

  it("warns where the page sits on its zoom boundary", () => {
    // 1:25,000 at 28°N delivers its request to within a DPI; half of an odd
    // request rounded up does not cross back (measured through zoomForBBox).
    const choices = panelStepChoices(preset("1-25000"), LETTER_PORTRAIT, 28);
    expect(step(choices, -1).note).toMatch(/may have no effect/i);
  });

  it("says nothing rather than guess without a latitude, or outside the table", () => {
    for (const lat of [null, 5, 80]) {
      expect(panelStepChoices(preset("1-50000"), LETTER_PORTRAIT, lat).every((c) => c.note === null)).toBe(true);
    }
  });
});
