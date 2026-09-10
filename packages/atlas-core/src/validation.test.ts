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
