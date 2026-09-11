import { describe, it, expect } from "vitest";
import {
  DEFAULT_RENDER_OPTIONS,
  PANEL_QUALITY_DEFAULT,
  clampPanelQuality,
  relativeSizeAtQuality,
  toRenderRequestBody,
} from "./render-options";

/**
 * `toRenderRequestBody` is the whole contract between the render-options panel
 * and the wire. It is a separate function, rather than an object literal inside
 * `GenerateButton`, precisely so this can be asserted without a browser — and so
 * that a control added to the panel and not threaded through has somewhere to
 * fail.
 */
describe("toRenderRequestBody", () => {
  /**
   * [CONTROL] Opening the panel and touching nothing must produce exactly the
   * request the app sent before any of these controls existed: basemap on, and
   * NO panel fields at all.
   *
   * The omission is the load-bearing part. The engine picks each page's panel
   * width from its own scale preset and its own format/quality defaults, so a
   * body that helpfully sent `panelQuality: 90` would look identical in every
   * assertion that checks a knob "arrived" while quietly taking the decision away
   * from the layer making it properly.
   */
  it("[CONTROL] sends no panel fields when the user has no opinion", () => {
    const body = toRenderRequestBody(DEFAULT_RENDER_OPTIONS);

    expect(body.basemap).toBe(true);
    expect("panelFormat" in body).toBe(false);
    expect("panelQuality" in body).toBe(false);
  });

  it("carries every furniture toggle the panel offers", () => {
    const body = toRenderRequestBody({
      ...DEFAULT_RENDER_OPTIONS,
      tier: 3,
      route: true,
      cover: true,
      includeLandmarks: false,
      tableOfContents: false,
      overview: false,
      referenceGrid: false,
      notes: false,
    });

    expect(body).toMatchObject({
      tier: 3,
      route: true,
      cover: true,
      includeLandmarks: false,
      tableOfContents: false,
      overview: false,
      referenceGrid: false,
      notes: false,
    });
  });

  it("sends basemap:false for the line-art preview", () => {
    expect(toRenderRequestBody({ ...DEFAULT_RENDER_OPTIONS, basemap: false }).basemap).toBe(false);
  });

  it("sends the format and quality the user chose", () => {
    const body = toRenderRequestBody({
      ...DEFAULT_RENDER_OPTIONS,
      panelFormat: "jpeg",
      panelQuality: 60,
    });
    expect(body.panelFormat).toBe("jpeg");
    expect(body.panelQuality).toBe(60);
  });

  /**
   * PNG ignores quality (`sharp.png()` takes none). Sending it anyway would put
   * a number on the wire that changes nothing, which is a claim the UI cannot
   * honour.
   */
  it("omits quality for png, which does not use it", () => {
    const body = toRenderRequestBody({
      ...DEFAULT_RENDER_OPTIONS,
      panelFormat: "png",
      panelQuality: 60,
    });
    expect(body.panelFormat).toBe("png");
    expect("panelQuality" in body).toBe(false);
  });

  it("omits both when there is no basemap to encode", () => {
    const body = toRenderRequestBody({
      ...DEFAULT_RENDER_OPTIONS,
      basemap: false,
      panelFormat: "png",
      panelQuality: 60,
    });
    expect("panelFormat" in body).toBe(false);
    expect("panelQuality" in body).toBe(false);
  });
});

describe("clampPanelQuality", () => {
  it("keeps a hand-typed value inside the range the API accepts", () => {
    expect(clampPanelQuality(0)).toBe(1);
    expect(clampPanelQuality(-5)).toBe(1);
    expect(clampPanelQuality(101)).toBe(100);
    expect(clampPanelQuality(60.4)).toBe(60);
    expect(clampPanelQuality(Number.NaN)).toBe(PANEL_QUALITY_DEFAULT);
  });
});

/**
 * The size curve shown next to the slider. It exists so the cost of the knob is
 * visible where the knob is, rather than discovered when the file arrives.
 */
describe("relativeSizeAtQuality", () => {
  it("is 1 at the engine's default", () => {
    expect(relativeSizeAtQuality(PANEL_QUALITY_DEFAULT)).toBeCloseTo(1, 6);
  });

  it("is monotonic — a higher quality is never a smaller file", () => {
    let previous = 0;
    for (let q = 5; q <= 100; q += 5) {
      const current = relativeSizeAtQuality(q);
      expect(current, `quality ${q}`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("matches the measured atlas: q70 is under half the default, q95 well over", () => {
    // 18.99 MB / 42.03 MB and 61.75 / 42.03 on the 36-page 1:50,000 atlas.
    expect(relativeSizeAtQuality(70)).toBeCloseTo(18.99 / 42.03, 2);
    expect(relativeSizeAtQuality(95)).toBeCloseTo(61.75 / 42.03, 2);
  });
});
