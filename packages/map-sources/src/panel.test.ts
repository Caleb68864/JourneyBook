import { describe, it, expect } from "vitest";
import { resolveTileUrl, USGS_TOPO } from "./panel.js";

describe("resolveTileUrl", () => {
  it("uses the source's URL template when no proxy base is given", () => {
    expect(resolveTileUrl(USGS_TOPO, 5, 9, 9)).toBe(
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/5/9/9",
    );
  });

  it("builds a proxy URL {base}/{source}/{z}/{x}/{y} when tileBaseUrl is set", () => {
    const url = resolveTileUrl(USGS_TOPO, 5, 9, 8, {
      tileBaseUrl: "http://localhost:5180/api/tiles",
    });
    expect(url).toBe("http://localhost:5180/api/tiles/usgs-topo/5/9/8");
  });

  it("honors an explicit sourceId and trims a trailing slash on the base", () => {
    const url = resolveTileUrl(USGS_TOPO, 3, 1, 2, {
      tileBaseUrl: "http://localhost:5180/api/tiles/",
      sourceId: "protomaps",
    });
    expect(url).toBe("http://localhost:5180/api/tiles/protomaps/3/1/2");
  });
});
