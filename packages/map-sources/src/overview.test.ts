import { describe, it, expect } from "vitest";
import type { AtlasPage, BBox } from "@journeybook/atlas-core";
import { buildAtlasOverview } from "./overview.js";

function page(id: string, bbox: BBox): AtlasPage {
  return { id, bbox, orientation: "portrait", tier: 1, neighbors: {} };
}

describe("buildAtlasOverview", () => {
  const pages: AtlasPage[] = [
    page("A1", [-97.0, 40.8, -96.8, 41.0]),
    page("A2", [-96.8, 40.8, -96.6, 41.0]),
    page("L1", [-96.5, 41.1, -96.3, 41.3]),
  ];

  it("covers every page footprint within a padded union bbox", () => {
    const ov = buildAtlasOverview(pages);
    const [w, s, e, n] = ov.bbox;
    for (const p of pages) {
      const [pw, ps, pe, pn] = p.bbox;
      expect(w).toBeLessThanOrEqual(pw);
      expect(s).toBeLessThanOrEqual(ps);
      expect(e).toBeGreaterThanOrEqual(pe);
      expect(n).toBeGreaterThanOrEqual(pn);
    }
  });

  it("emits one rectangle per page, each within [0,1] with positive size", () => {
    const ov = buildAtlasOverview(pages);
    expect(ov.pages).toHaveLength(3);
    for (const r of ov.pages) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it("maps the route polyline and stops into normalized coordinates", () => {
    const ov = buildAtlasOverview(pages, {
      route: [{ lng: -96.9, lat: 40.9 }, { lng: -96.4, lat: 41.2 }],
      stops: [{ center: { lng: -96.9, lat: 40.9 }, label: "L1" }],
    });
    expect(ov.route).toHaveLength(2);
    expect(ov.stops).toHaveLength(1);
    for (const pt of ov.route!) {
      expect(pt.x).toBeGreaterThanOrEqual(0);
      expect(pt.x).toBeLessThanOrEqual(1);
      expect(pt.y).toBeGreaterThanOrEqual(0);
      expect(pt.y).toBeLessThanOrEqual(1);
    }
    expect(ov.stops![0]!.label).toBe("L1");
  });
});
