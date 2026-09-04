import { describe, it, expect } from "vitest";
import { parseCsvLine, parseLocationsCsv, parseLocationsJson, normalizeLocationEntry } from "./locations.js";

describe("parseCsvLine", () => {
  it("splits plain fields and honours quoted commas with \"\" escaping", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseCsvLine('"Camping, trails",x,"say ""hi"""')).toEqual(["Camping, trails", "x", 'say "hi"']);
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseLocationsCsv", () => {
  it("reads the web-import columns plus pin/color/zoom", () => {
    const csv = [
      "name,lng,lat,notes,scale,pin,color,zoom",
      "Home,-96.70,40.81,Start,,shield,#1f3d2b,",
      "Grandma's,-95.93,41.26,\"Omaha, zoom in\",usgs-7-5-min,star,#b03a2e,1-100000|1-50000|usgs-7-5-min",
    ].join("\n");
    const locs = parseLocationsCsv(csv);
    expect(locs).toHaveLength(2);
    expect(locs[0]).toEqual({
      center: { lng: -96.7, lat: 40.81 },
      label: "Home",
      notes: "Start",
      pin: { shape: "shield", color: "#1f3d2b" },
    });
    expect(locs[1]!.label).toBe("Grandma's");
    expect(locs[1]!.notes).toBe("Omaha, zoom in");
    expect(locs[1]!.scalePresetId).toBe("usgs-7-5-min");
    expect(locs[1]!.pin).toEqual({ shape: "star", color: "#b03a2e" });
    expect(locs[1]!.zoomLevels).toEqual(["1-100000", "1-50000", "usgs-7-5-min"]);
  });

  it("accepts header aliases, a BOM, and CRLF line endings", () => {
    const csv = "﻿Name,Longitude,Latitude\r\nA,-96.7,40.8\r\n";
    expect(parseLocationsCsv(csv)).toEqual([{ center: { lng: -96.7, lat: 40.8 }, label: "A" }]);
  });

  it("rejects a header missing required columns", () => {
    expect(() => parseLocationsCsv("name,lng\nA,-96.7")).toThrow(/missing required column\(s\): lat/);
  });

  it("aggregates bad rows and imports nothing", () => {
    const csv = "name,lng,lat\nA,-96.7,40.8\n,-96.7,40.8\nB,999,40.8";
    expect(() => parseLocationsCsv(csv)).toThrow(/2 bad row\(s\).*row 3: name is required.*row 4: lng/);
  });

  it("rejects an unknown scale or zoom level", () => {
    expect(() => parseLocationsCsv("name,lng,lat,scale\nA,-96.7,40.8,nope")).toThrow(/unknown scale preset "nope"/);
    expect(() => parseLocationsCsv("name,lng,lat,zoom\nA,-96.7,40.8,1-50000|bogus")).toThrow(/unknown scale preset "bogus"/);
  });
});

describe("parseLocationsJson / normalizeLocationEntry", () => {
  it("accepts the engine RenderLocation shape", () => {
    const locs = parseLocationsJson(JSON.stringify([
      { center: { lng: -96.7, lat: 40.8 }, label: "A", scalePresetId: "1-50000", pin: { shape: "star" }, zoomLevels: ["1-100000", "1-50000"] },
    ]));
    expect(locs[0]).toEqual({
      center: { lng: -96.7, lat: 40.8 },
      label: "A",
      scalePresetId: "1-50000",
      pin: { shape: "star" },
      zoomLevels: ["1-100000", "1-50000"],
    });
  });

  it("accepts the web project-backup export shape", () => {
    const backup = {
      project: { id: "p1", name: "Trip" },
      locations: [
        { id: "x", name: "Grandma's House", lng: -95.9345, lat: 41.2565, notes: "n", scalePresetId: "usgs-7-5-min", pinShape: "teardrop", pinColor: "#b03a2e", label: "L2" },
      ],
    };
    const locs = parseLocationsJson(JSON.stringify(backup));
    expect(locs).toHaveLength(1);
    // A web `label` is the L-series id, not the name — `name` wins for the page title.
    expect(locs[0]!.label).toBe("Grandma's House");
    expect(locs[0]!.center).toEqual({ lng: -95.9345, lat: 41.2565 });
    expect(locs[0]!.pin).toEqual({ shape: "teardrop", color: "#b03a2e" });
    expect(locs[0]!.scalePresetId).toBe("usgs-7-5-min");
  });

  it("rejects entries without coordinates and non-list documents", () => {
    expect(() => normalizeLocationEntry({ name: "A" }, "locations[0]")).toThrow(/needs numeric lng\/lat/);
    expect(() => parseLocationsJson('{"foo":1}')).toThrow(/array/);
    expect(() => parseLocationsJson("[]")).toThrow(/no locations/);
  });
});
