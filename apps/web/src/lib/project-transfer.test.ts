import { describe, it, expect } from "vitest";
import type { Location, Project } from "../api/client";
import { buildProjectExport, parseProjectImport } from "./project-transfer";

const PROJECT: Project = {
  id: "p1",
  name: "Sandhills",
  scalePresetId: "1-100000",
  orientation: "Landscape",
  overlap: 0.05,
  margins: { top: 0.75, right: 0.6, bottom: 0.75, left: 0.9, gutter: 0.25 },
  extent: [-98, 41, -97, 42],
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
};

const LOCATION: Location = {
  id: "l1",
  projectId: "p1",
  name: "Trailhead",
  lng: -97.5,
  lat: 41.5,
  notes: "gate is locked after dark",
  label: "L1",
  referenceLabel: "see page L1",
  scalePresetId: "usgs-7-5-min",
  pinShape: "star",
  pinColor: "#b03a2e",
  zoomLevels: ["1-100000", "usgs-7-5-min"],
};

describe("project export/import", () => {
  /**
   * Export wrote name/scalePresetId/orientation/overlap/extent — no margins —
   * and import read back only name/scalePresetId/extent, so orientation and
   * overlap were written to the file and dropped on the way in. Since the
   * page-setup fix all three change the printed atlas: margins move the printed
   * map box and with it the page count and the ground each page covers. Exporting
   * an atlas and importing it gave you a different atlas.
   */
  it("[BEHAVIORAL] round-trips every field that changes the printed atlas", () => {
    const file = JSON.parse(JSON.stringify(buildProjectExport(PROJECT, [LOCATION])));
    const parsed = parseProjectImport(file);

    expect(parsed.name).toBe("Sandhills");
    expect(parsed.scalePresetId).toBe("1-100000");
    expect(parsed.extent).toEqual([-98, 41, -97, 42]);
    expect(parsed.pageSetup).toEqual({
      orientation: "Landscape",
      overlap: 0.05,
      margins: PROJECT.margins,
    });
  });

  /**
   * `toMatchObject` ignores every key it is not told about, and the first version
   * of this case named `name`, `notes`, `pinShape` and `zoomLevels` — so `lng` and
   * `lat` appeared nowhere in the file. Renaming the exported longitude field
   * (`lng:` → `lngDROPPED:`) left all 42 web tests green while **every imported
   * location landed at a junk coordinate**: `ProjectListPage.tsx` reads `l.lng`
   * and hands `undefined` straight to `api.locations.create`. The coordinates are
   * the only thing a location *is*, and they were the one field the round-trip
   * guard did not pin. `pinColor` and the per-location `scalePresetId` were
   * unpinned the same way — and "changing a location's scale wipes its custom
   * pin" is a bug this codebase has already had once.
   *
   * So: `toEqual` on the whole record, not `toMatchObject` on a chosen few. A
   * field added to `ExportedLocation` and forgotten in `buildProjectExport` fails
   * here too, which is the point.
   */
  it("[BEHAVIORAL] round-trips a location whole — coordinates included", () => {
    const parsed = parseProjectImport(
      JSON.parse(JSON.stringify(buildProjectExport(PROJECT, [LOCATION]))),
    );
    expect(parsed.locations).toHaveLength(1);

    const round = parsed.locations[0]!;
    // Named first and on their own: a location with no coordinates is not a
    // location, whatever else survived the trip.
    expect(round.lng, "longitude did not survive the round trip").toBe(-97.5);
    expect(round.lat, "latitude did not survive the round trip").toBe(41.5);

    expect(round).toEqual({
      name: "Trailhead",
      lng: -97.5,
      lat: 41.5,
      notes: "gate is locked after dark",
      scalePresetId: "usgs-7-5-min",
      pinShape: "star",
      pinColor: "#b03a2e",
      zoomLevels: ["1-100000", "usgs-7-5-min"],
    });
  });

  it("leaves the API's defaults alone for a file written before page setup was exported", () => {
    // An older export. `pageSetup: null` means "do not PUT anything" — importing a
    // missing overlap as 0 would be a silent edit, not a restore.
    const parsed = parseProjectImport({
      version: 1,
      project: { name: "Old", scalePresetId: "usgs-7-5-min", extent: [-98, 41, -97, 42] },
      locations: [],
    });

    expect(parsed.pageSetup).toBeNull();
    expect(parsed.name).toBe("Old");
  });

  it("ignores values it cannot trust rather than importing them", () => {
    const parsed = parseProjectImport({
      project: {
        name: "  ",
        orientation: "Sideways",
        overlap: 1.5,
        margins: { top: 0.5, right: "x", bottom: 0.5, left: 0.5 },
        extent: [1, 2, 3],
      },
    });

    expect(parsed.name).toBe("Imported Atlas");
    expect(parsed.scalePresetId).toBe("usgs-7-5-min");
    expect(parsed.extent).toBeNull();
    expect(parsed.pageSetup).toBeNull();
  });

  it("defaults a missing gutter to 0 rather than dropping the whole margins block", () => {
    const parsed = parseProjectImport({
      project: { margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } },
    });
    expect(parsed.pageSetup?.margins).toEqual({
      top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0,
    });
  });

  it("survives a file that is not an export at all", () => {
    expect(() => parseProjectImport(null)).not.toThrow();
    expect(parseProjectImport("nonsense").locations).toEqual([]);
  });
});
