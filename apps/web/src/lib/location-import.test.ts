import { describe, it, expect } from "vitest";
import type { Location, Project } from "../api/client";
import { buildProjectExport } from "./project-transfer";
import { locationImportToCsv } from "./location-import";

describe("locationImportToCsv", () => {
  it("leaves a CSV file exactly as it was", () => {
    const csv = "name,lng,lat\nTrailhead,-96.7,40.8\n";
    expect(locationImportToCsv(csv)).toBe(csv);
  });

  it("carries every location field of a project backup, quoting what needs it", () => {
    const project = { name: "P", scalePresetId: "1-100000", orientation: "Portrait", overlap: 0, extent: null } as unknown as Project;
    const locations = [
      {
        name: 'Pawnee "Creek", east',
        lng: -97.5,
        lat: 41.5,
        notes: "gate locked\nafter dark",
        scalePresetId: "usgs-7-5-min",
        pinShape: "star",
        pinColor: "#b03a2e",
        zoomLevels: ["1-100000", "usgs-7-5-min"],
      },
      { name: "Plain", lng: -97, lat: 41, notes: null, scalePresetId: null, pinShape: null, pinColor: null, zoomLevels: null },
    ] as Location[];
    const backup = JSON.stringify(buildProjectExport(project, locations));

    expect(locationImportToCsv(backup)).toBe(
      "name,lng,lat,notes,scale,pin,color,zoom\n" +
        '"Pawnee ""Creek"", east",-97.5,41.5,"gate locked\nafter dark",usgs-7-5-min,star,#b03a2e,1-100000|usgs-7-5-min\n' +
        "Plain,-97,41,,,,,\n",
    );
  });

  it("accepts the engine's own shape, as the CLI loader does", () => {
    const json = JSON.stringify([
      { label: "Home", center: { lng: -96.7, lat: 40.8 }, pin: { shape: "flag", color: "#000000" }, zoom: "1-50000|usgs-7-5-min" },
    ]);
    expect(locationImportToCsv(json)).toBe(
      "name,lng,lat,notes,scale,pin,color,zoom\nHome,-96.7,40.8,,,flag,#000000,1-50000|usgs-7-5-min\n",
    );
  });

  it("does not let a formula-looking CSV cell change its meaning", () => {
    // The server reads this file, not a spreadsheet, so the value must arrive untouched.
    const json = JSON.stringify([{ name: "=SUM(A1)", lng: 1, lat: 2 }]);
    expect(locationImportToCsv(json)).toContain("=SUM(A1),1,2");
  });

  it("tolerates a BOM and leading whitespace before the JSON", () => {
    expect(locationImportToCsv('\uFEFF  [{"name":"A","lng":1,"lat":2}]')).toContain("A,1,2");
  });

  it.each([
    ["broken JSON", "{ not json", /not valid JSON/],
    ["no locations member", '{"project":{}}', /array of locations/],
    ["an empty list", '{"locations":[]}', /no locations/],
    ["an entry that is not an object", "[1]", /locations\[0\]: expected an object/],
    ["a missing coordinate", '[{"name":"A","lng":1}]', /locations\[0\]: needs numeric lng\/lat/],
    ["a non-finite coordinate", '[{"name":"A","lng":"east","lat":2}]', /locations\[0\]: needs numeric lng\/lat/],
  ])("refuses %s, naming the problem", (_name, text, message) => {
    expect(() => locationImportToCsv(text)).toThrow(message);
  });

  it("leaves a missing name for the server to reject with the rest of the file's errors", () => {
    expect(locationImportToCsv('[{"lng":1,"lat":2}]')).toContain("\n,1,2,");
  });
});
