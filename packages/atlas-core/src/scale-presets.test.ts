import { describe, it, expect } from "vitest";
import {
  SCALE_PRESETS,
  DEFAULT_PANEL_WIDTH_PX,
  PRINT_TARGET_PANEL_WIDTH_PX,
  type ScalePreset,
} from "./model.js";
import { LETTER_PORTRAIT, mapBoxInches, type PageSpec } from "./page.js";
import { PRINT_DPI_TARGET, panelWidthPxForDpi, panelWidthPxFor } from "./validation.js";

const LETTER_LANDSCAPE: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };
const LETTER_WITH_GUTTER: PageSpec = {
  ...LETTER_PORTRAIT,
  margins: { ...LETTER_PORTRAIT.margins, gutter: 0.5 },
};

function preset(id: string): ScalePreset {
  const found = SCALE_PRESETS.find((s) => s.id === id);
  // Refuse rather than return undefined and let `?.panelWidthPx` compare
  // undefined to undefined somewhere downstream.
  if (!found) throw new Error(`No scale preset "${id}" — this test is pinned to the preset list.`);
  return found;
}

describe("scale presets carry their own print-resolution request", () => {
  it("gives every preset a panel width", () => {
    // A sixth preset added without one would otherwise render at NaN px.
    for (const scale of SCALE_PRESETS) {
      expect(Number.isInteger(scale.panelWidthPx), `${scale.id} panelWidthPx`).toBe(true);
      expect(scale.panelWidthPx, `${scale.id} panelWidthPx`).toBeGreaterThanOrEqual(256);
    }
  });

  /**
   * The literal in `model.ts` against the function that defines it. `model.ts` is
   * the leaf module every engine module imports from and cannot import
   * `validation.ts` without an init cycle, so the number is written out by hand
   * there — which is exactly the kind of copy that drifts silently.
   */
  it("pins PRINT_TARGET_PANEL_WIDTH_PX to the 300 DPI request over the Letter-portrait map box", () => {
    expect(PRINT_TARGET_PANEL_WIDTH_PX).toBe(
      panelWidthPxForDpi(mapBoxInches(LETTER_PORTRAIT).widthIn, PRINT_DPI_TARGET),
    );
    expect(PRINT_TARGET_PANEL_WIDTH_PX).toBe(1730);
  });

  /**
   * Both halves of the owner's decision, by value.
   *
   * Half one: the four presets that were short of 300 DPI were raised. Half two:
   * `usgs-7-5-min` — the default and the headline scale — was NOT, because at
   * 41 degrees N it already clears the target for free. A regression that
   * quietly widens the default preset is the specific thing that decision was
   * avoiding, so it is asserted rather than assumed.
   */
  it("[BEHAVIORAL] pins the panel width each preset asks for", () => {
    const expected: Record<string, number> = {
      "usgs-7-5-min": 1000,
      "1-25000": 1730,
      "usgs-15-min": 1730,
      "1-50000": 1730,
      "1-100000": 1730,
    };
    expect(SCALE_PRESETS.map((s) => s.id).sort()).toEqual(Object.keys(expected).sort());
    for (const scale of SCALE_PRESETS) {
      expect(scale.panelWidthPx, `${scale.id} panel width`).toBe(expected[scale.id]);
    }
  });

  it("leaves the headline preset on the historic default", () => {
    expect(preset("usgs-7-5-min").panelWidthPx).toBe(DEFAULT_PANEL_WIDTH_PX);
  });

  it("raises exactly the four presets that were short, and no others", () => {
    const raised = SCALE_PRESETS.filter((s) => s.panelWidthPx > DEFAULT_PANEL_WIDTH_PX).map((s) => s.id);
    expect(raised).toEqual(["1-25000", "usgs-15-min", "1-50000", "1-100000"]);
  });
});

describe("panelWidthPxFor — the request follows the map box, not the sheet somebody measured", () => {
  it("[CONTROL] is exactly the preset's own number on Letter portrait with default margins", () => {
    // The reference geometry. If this ever stops being an identity, every pinned
    // DPI figure in the suite moved without anyone editing a DPI figure.
    for (const scale of SCALE_PRESETS) {
      expect(panelWidthPxFor(scale, LETTER_PORTRAIT), scale.id).toBe(scale.panelWidthPx);
    }
  });

  /**
   * Landscape swaps the sheet, so the map box goes 5.7639 in -> 8.2639 in. A flat
   * pixel count would be a 30% weaker DPI request there; measured across the USGS
   * Topo latitude band, a flat 1730 px in landscape clears 300 DPI at NO preset.
   * Scaling by the box is what makes the preset's number mean dots per inch.
   */
  it("[BEHAVIORAL] scales the request to the landscape map box", () => {
    const expected: Record<string, number> = {
      "usgs-7-5-min": 1434,
      "1-25000": 2480,
      "usgs-15-min": 2480,
      "1-50000": 2480,
      "1-100000": 2480,
    };
    for (const scale of SCALE_PRESETS) {
      expect(panelWidthPxFor(scale, LETTER_LANDSCAPE), scale.id).toBe(expected[scale.id]);
    }
    // And that is the same DPI ask, not a bigger one.
    expect(panelWidthPxFor(preset("1-25000"), LETTER_LANDSCAPE)).toBe(
      panelWidthPxForDpi(mapBoxInches(LETTER_LANDSCAPE).widthIn, PRINT_DPI_TARGET),
    );
  });

  it("shrinks the request when a binder gutter eats the map box", () => {
    // A gutter comes off the binding edge, so the printed map is narrower and
    // the same DPI needs fewer pixels. Asking for the portrait number there
    // would over-render every gutter-bearing page.
    const withGutter = panelWidthPxFor(preset("1-50000"), LETTER_WITH_GUTTER);
    expect(withGutter).toBeLessThan(preset("1-50000").panelWidthPx);
    expect(withGutter).toBe(
      panelWidthPxForDpi(mapBoxInches(LETTER_WITH_GUTTER).widthIn, PRINT_DPI_TARGET),
    );
  });
});
