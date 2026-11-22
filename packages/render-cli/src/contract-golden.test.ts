import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assembleContract, type RenderAtlasInput } from "./render.js";

/**
 * Golden contracts for every page-producing mode of `assembleContract`, the function the
 * render worker calls.
 *
 * `data/fixtures/sample-atlas.json` (atlas-core `fixture.test.ts`, `golden-fixture.sh`) pins
 * `buildPageGrid` for one bbox-mode parameter set. It says nothing about location pages,
 * per-location scales, zoom ladders, the cover grid, route corridor pages, or a non-default
 * page setup, which are all assembled here, and a change to any of them that keeps the
 * bbox-mode grid passed. This pins the whole assembled atlas (pages, their ids, scales, bboxes,
 * neighbours, the route polyline and the cover extent) for one case of each.
 *
 * The inputs are this file; the outputs are `data/fixtures/contract-cases.json`. A diff means
 * the engine now produces different pages for the same input. Decide whether that is intended
 * first, then regenerate with `UPDATE_FIXTURES=1` and commit both, saying why.
 *
 * Numbers are compared at 10 decimal places (about 0.01 mm of ground), like `fixture.test.ts`:
 * enough to catch any real geometry change, not so tight that a libm difference between Node
 * builds fails it.
 */

const FIXTURE = fileURLToPath(new URL("../../../data/fixtures/contract-cases.json", import.meta.url));

const LINCOLN = { lng: -96.7026, lat: 40.8136 };
const PIONEERS = { lng: -96.7734, lat: 40.7786 };
const HAYMARKET = { lng: -96.7116, lat: 40.8169 };
const WAVERLY = { lng: -96.5281, lat: 40.9172 };

const CASES: Record<string, RenderAtlasInput> = {
  "location, one page": {
    mode: "location",
    center: LINCOLN,
    scalePresetId: "usgs-7-5-min",
    tier: 2,
    outputPath: "",
  },
  "locations with their own scale, pin and notes": {
    mode: "location",
    locations: [
      { center: LINCOLN, label: "Capitol", scalePresetId: "1-25000", pin: { shape: "star", color: "red" }, notes: "Start here." },
      { center: PIONEERS, label: "Pioneers Park" },
    ],
    scalePresetId: "usgs-7-5-min",
    tier: 3,
    outputPath: "",
  },
  "zoom ladder, default and per-location": {
    mode: "location",
    locations: [
      { center: LINCOLN, label: "Capitol" },
      { center: HAYMARKET, label: "Haymarket", zoomLevels: ["usgs-7-5-min", "1-25000"] },
    ],
    zoomLevels: ["1-100000", "usgs-7-5-min"],
    scalePresetId: "usgs-7-5-min",
    tier: 2,
    outputPath: "",
  },
  "cover grid over the locations": {
    mode: "location",
    locations: [{ center: LINCOLN }, { center: PIONEERS }, { center: HAYMARKET }],
    cover: true,
    scalePresetId: "usgs-7-5-min",
    tier: 1,
    outputPath: "",
  },
  "route corridor between stops": {
    mode: "location",
    locations: [{ center: PIONEERS, label: "A" }, { center: LINCOLN, label: "B" }, { center: WAVERLY, label: "C" }],
    route: true,
    scalePresetId: "usgs-7-5-min",
    tier: 2,
    outputPath: "",
  },
  "bbox, landscape, wide margins, gutter, overlap": {
    mode: "bbox",
    bbox: [-96.74, 40.79, -96.66, 40.84],
    orientation: "landscape",
    margins: { top: 0.75, right: 1, bottom: 0.75, left: 1, gutter: 0.5 },
    overlap: 0.1,
    scalePresetId: "usgs-7-5-min",
    tier: 4,
    outputPath: "",
  },
};

/** Round every number to 10 decimal places, recursively, so the comparison is about geometry. */
function rounded(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(10));
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, rounded(v)]),
    );
  }
  return value;
}

function assembled(input: RenderAtlasInput) {
  const { contract, routePolyline, coverBBox } = assembleContract(input);
  return rounded({ contract, routePolyline, coverBBox });
}

describe("assembled contracts match the golden file", () => {
  const current = Object.fromEntries(Object.entries(CASES).map(([name, input]) => [name, assembled(input)]));

  if (process.env.UPDATE_FIXTURES === "1") {
    writeFileSync(
      FIXTURE,
      `${JSON.stringify({ note: "Written by packages/render-cli/src/contract-golden.test.ts with UPDATE_FIXTURES=1.", cases: current }, null, 2)}\n`,
    );
  }

  const golden = existsSync(FIXTURE)
    ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Record<string, unknown> }).cases
    : {};

  it("has a golden entry for every case and no stale ones", () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const name of Object.keys(CASES)) {
    it(name, () => {
      expect(current[name]).toEqual(golden[name]);
    });
  }

  // The cases must actually reach the modes they are named for, or a golden file of
  // single-page atlases would pass for all of them.
  it("each case exercises its mode", () => {
    const pagesOf = (name: string) =>
      (current[name] as { contract: { pages: { id: string; scale?: { id: string } }[] } }).contract.pages;
    expect(pagesOf("location, one page").map((p) => p.id)).toEqual(["L1"]);
    expect(pagesOf("locations with their own scale, pin and notes")[0]!.scale!.id).toBe("1-25000");
    expect(pagesOf("zoom ladder, default and per-location").map((p) => p.id)).toEqual(["L1a", "L1b", "L2a", "L2b"]);
    expect(pagesOf("cover grid over the locations").filter((p) => /^[A-K]\d+$/.test(p.id)).length).toBeGreaterThan(1);
    expect(pagesOf("route corridor between stops").some((p) => p.id.startsWith("R"))).toBe(true);
    expect((current["route corridor between stops"] as { routePolyline?: unknown[] }).routePolyline?.length).toBeGreaterThan(1);
    expect(pagesOf("bbox, landscape, wide margins, gutter, overlap").length).toBeGreaterThan(1);
  });
});
