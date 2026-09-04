import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAtlas } from "@journeybook/atlas-core";
import { renderAtlas, assembleContract } from "./render.js";

/**
 * Zoom ladders (one page per scale level for a location) and cover extents (a
 * grid over the padded box enclosing every location) — the pieces that turn a
 * list of special locations into "an atlas that covers all of them plus a page
 * per location at differing zoom levels".
 */
describe("assembleContract — zoom ladders and cover extents", () => {
  it("expands a zoom ladder into one page per level (L#a, L#b, …) titled with the location name", () => {
    const { contract } = assembleContract({
      mode: "location",
      locations: [
        { center: { lng: -96.7, lat: 40.8 }, label: "Home", zoomLevels: ["1-100000", "1-50000", "usgs-7-5-min"] },
        { center: { lng: -95.9, lat: 41.3 }, label: "Grandma's" },
      ],
      scalePresetId: "1-50000",
      tier: 2,
      outputPath: "",
    });
    expect(contract.pages.map((p) => p.id)).toEqual(["L1a", "L1b", "L1c", "L2"]);
    expect(contract.pages.map((p) => p.scale?.id)).toEqual(["1-100000", "1-50000", "usgs-7-5-min", "1-50000"]);
    expect(contract.pages.map((p) => p.title)).toEqual(["Home", "Home", "Home", "Grandma's"]);
    // Coarse → fine: each level covers less ground than the one before.
    const span = (b: readonly number[]) => (b[2]! - b[0]!) * (b[3]! - b[1]!);
    expect(span(contract.pages[0]!.bbox)).toBeGreaterThan(span(contract.pages[1]!.bbox));
    expect(span(contract.pages[1]!.bbox)).toBeGreaterThan(span(contract.pages[2]!.bbox));
    expect(validateAtlas(contract).pass).toBe(true);
  });

  it("applies the atlas-level zoomLevels default and lets a location's own ladder win", () => {
    const { contract } = assembleContract({
      mode: "location",
      locations: [
        { center: { lng: -96.7, lat: 40.8 } },
        { center: { lng: -95.9, lat: 41.3 }, zoomLevels: ["usgs-7-5-min"] },
      ],
      zoomLevels: ["1-100000", "usgs-7-5-min"],
      scalePresetId: "1-50000",
      tier: 1,
      outputPath: "",
    });
    // A one-level ladder renders as a plain L# page at that level.
    expect(contract.pages.map((p) => p.id)).toEqual(["L1a", "L1b", "L2"]);
    expect(contract.pages[2]!.scale?.id).toBe("usgs-7-5-min");
  });

  it("throws on an unknown zoom level", () => {
    expect(() =>
      assembleContract({
        mode: "location",
        locations: [{ center: { lng: -96.7, lat: 40.8 }, zoomLevels: ["nope"] }],
        scalePresetId: "1-50000",
        tier: 1,
        outputPath: "",
      }),
    ).toThrow(/Unknown scalePresetId "nope"/);
  });

  it("cover tiles a grid over the padded box enclosing every location, before the L# pages", () => {
    const locations = [
      { center: { lng: -96.7026, lat: 40.8136 }, label: "Home" },
      { center: { lng: -95.9345, lat: 41.2565 }, label: "Grandma's" },
    ];
    const { contract, coverBBox } = assembleContract({
      mode: "location",
      locations,
      cover: true,
      scalePresetId: "1-100000",
      tier: 1,
      outputPath: "",
    });
    expect(coverBBox).toBeDefined();
    const gridPages = contract.pages.filter((p) => !p.id.startsWith("L"));
    const locPages = contract.pages.filter((p) => p.id.startsWith("L"));
    expect(gridPages.length).toBeGreaterThan(1);
    expect(locPages.map((p) => p.id)).toEqual(["L1", "L2"]);
    // Grid first, locations after.
    expect(contract.pages[0]!.id).toBe("A1");
    // Every location lies inside some grid page.
    for (const loc of locations) {
      const inside = gridPages.some(
        (p) =>
          loc.center.lng >= p.bbox[0] && loc.center.lng <= p.bbox[2] &&
          loc.center.lat >= p.bbox[1] && loc.center.lat <= p.bbox[3],
      );
      expect(inside).toBe(true);
    }
  });

  it("ignores cover when an explicit bbox already defines the grid", () => {
    const base = {
      mode: "bbox" as const,
      bbox: [-96.73, 40.79, -96.67, 40.83] as [number, number, number, number],
      locations: [{ center: { lng: -96.7, lat: 40.8 } }],
      scalePresetId: "usgs-7-5-min",
      tier: 1 as const,
      outputPath: "",
    };
    const explicit = assembleContract(base);
    const covered = assembleContract({ ...base, cover: true });
    expect(covered.contract.pages.map((p) => p.id)).toEqual(explicit.contract.pages.map((p) => p.id));
    expect(covered.coverBBox).toBeUndefined();
  });

  it("renders a cover + ladder atlas to a valid PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-ladder-"));
    try {
      const out = join(dir, "ladder.pdf");
      const res = await renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -96.7026, lat: 40.8136 }, label: "Home", pin: { shape: "shield" } },
          { center: { lng: -95.9345, lat: 41.2565 }, label: "Grandma's", zoomLevels: ["1-50000", "usgs-7-5-min"] },
        ],
        cover: true,
        title: "Road Trip",
        scalePresetId: "1-100000",
        tier: 2,
        outputPath: out,
      });
      expect(res.pageCount).toBe(res.contract.pages.length);
      expect(res.contract.pages.filter((p) => p.id.startsWith("L")).map((p) => p.id)).toEqual(["L1", "L2a", "L2b"]);
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
