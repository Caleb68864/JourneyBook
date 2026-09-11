import { describe, it, expect } from "vitest";
import { SCALE_PRESETS, type AtlasContract, type AtlasPage, type BBox, type LngLat } from "./index.js";
import { LETTER_PORTRAIT, groundFootprintMeters, mapBoxInches } from "./page.js";
import { createProjector } from "./projection.js";
import { buildPageGrid, buildLocationPage } from "./grid.js";
import { validateAtlas, effectiveDpi } from "./validation.js";

const usgs = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!;

function bboxAround(center: LngLat, widthMul: number, heightMul: number): BBox {
  const fp = groundFootprintMeters(usgs, LETTER_PORTRAIT);
  const p = createProjector(center);
  const [cx, cy] = p.forward(center);
  const sw = p.inverse([cx - (fp.widthMeters * widthMul) / 2, cy - (fp.heightMeters * heightMul) / 2]);
  const ne = p.inverse([cx + (fp.widthMeters * widthMul) / 2, cy + (fp.heightMeters * heightMul) / 2]);
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

const center: LngLat = { lng: -98, lat: 41 };

describe("validateAtlas", () => {
  it("passes a well-formed page grid", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid);
    expect(report.pass).toBe(true);
    expect(report.checks.find((c) => c.name === "scale-consistency")!.pass).toBe(true);
    expect(report.checks.find((c) => c.name === "neighbor-reciprocity")!.pass).toBe(true);
  });

  it("flags a page whose footprint does not match the scale (false scale bar)", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const tampered = structuredClone(grid);
    // Stretch one page's east edge by ~0.1° → wrong ground footprint.
    tampered.pages[0]!.bbox[2] += 0.1;

    const report = validateAtlas(tampered);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name === "scale-consistency")!.pass).toBe(false);
  });

  it("flags a non-reciprocal / dangling neighbor reference", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const tampered = structuredClone(grid);
    tampered.pages[0]!.neighbors.east = "Z9"; // does not exist

    const report = validateAtlas(tampered);
    expect(report.pass).toBe(false);
    expect(report.checks.find((c) => c.name === "neighbor-reciprocity")!.pass).toBe(false);
  });
});

/**
 * The check that can actually fail on a truthful contract.
 *
 * `scale-consistency` puts `groundFootprintMeters(scale, spec)` on one side and
 * the page bbox on the other — and the page bbox was built by
 * `groundFootprintMeters(scale, spec)`. So it agrees with itself no matter how
 * small the map is printed: change `PAGE_FURNITURE_PT.edgeLabelColumn` from 54
 * to 154 and every page's bbox and every page's expectation shrink together, the
 * atlas prints at a different scale than it did before, and the report still
 * says VALID. That is the shape of the ~30% false-scale bug, and it is why three
 * documents claiming this function "catches a false scale bar" were wrong.
 *
 * `printed-scale-fidelity` takes the map box measured off the rendered PDF —
 * the one input that does not come out of the contract — and asserts the only
 * relation that makes a scale bar true: ground metres the page covers, over
 * inches of paper it is printed on, equals the scale it advertises.
 */
describe("validateAtlas printed-scale-fidelity", () => {
  const truthfulBox = () => {
    const box = mapBoxInches(LETTER_PORTRAIT);
    return { widthPt: box.widthIn * 72, heightPt: box.heightIn * 72 };
  };
  const boxesFor = (grid: ReturnType<typeof buildPageGrid>, scaleBy = 1) =>
    Object.fromEntries(
      grid.pages.map((p) => [
        p.id,
        { widthPt: truthfulBox().widthPt * scaleBy, heightPt: truthfulBox().heightPt * scaleBy },
      ]),
    );

  it("passes when the printed box is the box the bbox was sized from", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid, { printedMapBoxes: boxesFor(grid) });
    expect(report.checks.find((c) => c.name === "printed-scale-fidelity")!.pass).toBe(true);
    expect(report.pass).toBe(true);
  });

  it("fails a truthful contract printed into a box 30% too small", () => {
    // Every page bbox is correct and `scale-consistency` still passes; only the
    // paper is wrong. This is exactly the atlas that printed 1:24,000 near
    // 1:31,200 — and exactly what the old report could not see.
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid, { printedMapBoxes: boxesFor(grid, 1 / 1.3) });

    expect(report.checks.find((c) => c.name === "scale-consistency")!.pass).toBe(true);
    expect(report.checks.find((c) => c.name === "printed-scale-fidelity")!.pass).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("fails when only one axis of the printed box is wrong", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const boxes = boxesFor(grid);
    const first = grid.pages[0]!.id;
    boxes[first] = { ...boxes[first]!, heightPt: boxes[first]!.heightPt * 0.9 };

    const report = validateAtlas(grid, { printedMapBoxes: boxes });
    expect(report.checks.find((c) => c.name === "printed-scale-fidelity")!.pass).toBe(false);
  });

  it("fails, rather than quietly passing, when a page was never measured", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const boxes = boxesFor(grid);
    delete boxes[grid.pages[0]!.id];

    const report = validateAtlas(grid, { printedMapBoxes: boxes });
    const check = report.checks.find((c) => c.name === "printed-scale-fidelity")!;
    expect(check.pass).toBe(false);
    expect(check.detail).toContain(grid.pages[0]!.id);
  });

  it("reports the check as unmeasured — not as a pass — when nothing was measured", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid);
    expect(report.checks.some((c) => c.name === "printed-scale-fidelity")).toBe(false);
    expect(report.unmeasured).toContain("printed-scale-fidelity");
  });
});

describe("effectiveDpi", () => {
  it("is panel pixels divided by printable inches", () => {
    expect(effectiveDpi(1125, 7.5)).toBeCloseTo(150, 6);
  });
});

/**
 * Page ids are the atlas's primary key. Grid (`A1`), location (`L1`, `L1a`) and
 * corridor (`R1`) pages share one flat id space inside a single contract, and
 * every consumer keys off it: the render pipeline's panel/grid/route/landmark
 * `Record<string, ...>` maps, `pageNumbers` and the TOC in `AtlasDocument`, and
 * `byId` in this validator.
 *
 * None of those announce a collision — a Map or a Record just keeps the last
 * write. The validator's own `neighbor-reciprocity` would then pass or fail
 * against the wrong page, reporting a neighbour problem for what is really a
 * broken key, which is why this is a check of its own rather than a clause of
 * that one.
 */
describe("unique-page-ids", () => {
  const scale = SCALE_PRESETS[0]!;

  function contractOf(pages: AtlasPage[]): AtlasContract {
    return { version: 1, scale, margins: LETTER_PORTRAIT.margins, pages };
  }

  function page(id: string): AtlasPage {
    return buildLocationPage({ lng: -98, lat: 41 }, scale, LETTER_PORTRAIT, id);
  }

  function check(report: ReturnType<typeof validateAtlas>, name: string) {
    const found = report.checks.find((c) => c.name === name);
    // Refuse rather than read `undefined?.pass` as a falsy failure: a renamed or
    // removed check would otherwise look exactly like a failing one.
    if (!found) throw new Error(`validateAtlas reported no "${name}" check`);
    return found;
  }

  it("[CONTROL] accepts a contract whose ids are all distinct", () => {
    // The must-be-ACCEPTED half. A uniqueness check that refuses everything
    // passes every negative case in this file.
    const report = validateAtlas(contractOf([page("A1"), page("A2"), page("L1"), page("R1")]));
    expect(check(report, "unique-page-ids").pass).toBe(true);
    expect(check(report, "unique-page-ids").detail).toContain("4 page id(s)");
  });

  it("fails, and names the id, when two pages share one", () => {
    const report = validateAtlas(contractOf([page("A1"), page("L1"), page("L1")]));
    const got = check(report, "unique-page-ids");
    expect(got.pass).toBe(false);
    expect(got.detail).toContain("L1");
    expect(report.pass).toBe(false);
  });

  it("reports the broken key as itself, not as a neighbour problem", () => {
    // The concrete shape of the original defect: a 12-row grid used to emit a
    // page literally called "L1", colliding with the first location page. The
    // symptom a reader met was a neighbour reference resolving to the wrong
    // page; this asserts the diagnosis now names the actual cause.
    const grid = page("A1");
    grid.neighbors = { south: "L1" };
    const collided = page("L1");
    collided.neighbors = { north: "A1" };
    const shadow = page("L1");

    const report = validateAtlas(contractOf([grid, collided, shadow]));
    expect(check(report, "unique-page-ids").pass).toBe(false);
    expect(check(report, "unique-page-ids").detail).toContain("duplicate page id(s): L1");
  });
});

/**
 * The siblings of `unique-page-ids` — the rest of that family.
 *
 * Each of these invariants was already breakable, and each broke as some OTHER
 * check's failure with a number that described nothing. Measured against the
 * validator as it stood, before these checks existed:
 *
 *   bbox [NaN, …]  -> `validateAtlas` THREW `TypeError: coordinates must be
 *                     finite numbers` out of proj4, three layers down. Not a
 *                     failing report: a crash in the tool that answers the
 *                     question.
 *   west > east    -> "scale-consistency: worst footprint error 260.233%"
 *   zero-area bbox -> "scale-consistency: 100.000%"
 *   scale ratio 0  -> "scale-consistency: Infinity%"
 *
 * All four say the atlas prints at the wrong scale. None of them does.
 */
describe("validateAtlas — input invariants that used to surface as a scale error", () => {
  const scale = SCALE_PRESETS[0]!;

  function contractOf(pages: AtlasPage[], override?: Partial<AtlasContract>): AtlasContract {
    return { version: 1, scale, margins: LETTER_PORTRAIT.margins, pages, ...override };
  }

  function soundPage(id = "A1"): AtlasPage {
    return buildLocationPage({ lng: -98, lat: 41 }, scale, LETTER_PORTRAIT, id);
  }

  function check(report: ReturnType<typeof validateAtlas>, name: string) {
    const found = report.checks.find((c) => c.name === name);
    if (!found) throw new Error(`validateAtlas reported no "${name}" check`);
    return found;
  }

  /**
   * [CONTROL] The must-be-ACCEPTED half, and it is doing real work here: these
   * guards sit in front of every other check, so one that is a notch too strict
   * does not merely add a false failure — it stops `scale-consistency` and
   * `printed-scale-fidelity` measuring anything at all.
   */
  it("[CONTROL] accepts a genuinely well-formed atlas", () => {
    const grid = buildPageGrid({ bbox: bboxAround(center, 2, 2), scale: usgs, page: LETTER_PORTRAIT });
    const report = validateAtlas(grid);

    expect(check(report, "well-formed-page-bboxes").pass).toBe(true);
    expect(check(report, "usable-scale-ratios").pass).toBe(true);
    expect(check(report, "scale-consistency").pass).toBe(true);
    expect(report.pass).toBe(true);
    // And the scale check still measured every page, rather than quietly
    // skipping some and passing on what was left.
    expect(check(report, "scale-consistency").detail).not.toContain("not measurable");
  });

  it("[CONTROL] accepts pages at the coordinate extremes, which are legal", () => {
    const page = soundPage();
    page.bbox = [-180, -90, 180, 90];
    const report = validateAtlas(contractOf([page]));
    expect(check(report, "well-formed-page-bboxes").pass).toBe(true);
  });

  it("returns a report instead of throwing when a bbox is not finite", () => {
    const page = soundPage();
    page.bbox = [Number.NaN, 40.78, -96.68, 40.83];

    // The first assertion is that this does not throw at all. It used to.
    const report = validateAtlas(contractOf([page]));

    expect(check(report, "well-formed-page-bboxes").pass).toBe(false);
    expect(check(report, "well-formed-page-bboxes").detail).toContain("A1");
    expect(check(report, "well-formed-page-bboxes").detail).toContain("finite");
    expect(report.pass).toBe(false);
  });

  it("names an inverted bbox as an inverted bbox, not a 260% scale error", () => {
    const page = soundPage();
    page.bbox = [-96.6, 40.78, -96.75, 40.83]; // west > east

    const report = validateAtlas(contractOf([page]));
    const wellFormed = check(report, "well-formed-page-bboxes");

    expect(wellFormed.pass).toBe(false);
    expect(wellFormed.detail).toMatch(/empty or inverted/);
    // And the scale check no longer claims a footprint error it cannot know.
    expect(report.unmeasured).toContain("scale-consistency");
  });

  it("names a zero-area bbox rather than calling it a 100% footprint error", () => {
    const page = soundPage();
    page.bbox = [-96.7, 40.8, -96.7, 40.8];

    const report = validateAtlas(contractOf([page]));
    expect(check(report, "well-formed-page-bboxes").pass).toBe(false);
    expect(check(report, "well-formed-page-bboxes").detail).toMatch(/empty or inverted/);
  });

  it("names an out-of-range bbox", () => {
    const page = soundPage();
    page.bbox = [-96.8, 40.7, -96.6, 91];

    const report = validateAtlas(contractOf([page]));
    expect(check(report, "well-formed-page-bboxes").pass).toBe(false);
    expect(check(report, "well-formed-page-bboxes").detail).toContain("±90");
  });

  it("names a scale with no usable ratio, instead of reporting Infinity% error", () => {
    const page = soundPage();
    // `buildLocationPage` stamps the page with its own scale, which would shadow
    // the broken contract-level one. This case is about the contract's scale, so
    // the page has to actually fall back to it.
    delete page.scale;

    const report = validateAtlas(
      contractOf([page], { scale: { id: "broken", label: "broken", ratio: 0, panelWidthPx: 1000 } }),
    );

    const ratios = check(report, "usable-scale-ratios");
    expect(ratios.pass).toBe(false);
    expect(ratios.detail).toContain("broken");
    expect(report.unmeasured).toContain("scale-consistency");
    expect(report.pass).toBe(false);
  });

  it("catches a per-page scale override with a broken ratio too", () => {
    const bad = soundPage("L1");
    bad.scale = { id: "per-page-broken", label: "x", ratio: -24000, panelWidthPx: 1000 };

    const report = validateAtlas(contractOf([soundPage("A1"), bad]));
    expect(check(report, "usable-scale-ratios").pass).toBe(false);
    expect(check(report, "usable-scale-ratios").detail).toContain("L1");
  });

  /**
   * A check with no rows is not a check that passed — the mistake
   * `printed-scale-fidelity` was already fixed for. When every page is
   * unmeasurable, `scale-consistency` must go to `unmeasured`; when only SOME
   * are, it must measure the rest and say how many it skipped.
   */
  it("says how many pages it could not measure rather than passing on the rest silently", () => {
    const good = soundPage("A1");
    const broken = soundPage("A2");
    broken.bbox = [Number.NaN, 40.78, -96.68, 40.83];

    const report = validateAtlas(contractOf([good, broken]));
    const scaleCheck = check(report, "scale-consistency");

    expect(scaleCheck.detail).toContain("1 not measurable");
    expect(report.pass).toBe(false);
  });
});
