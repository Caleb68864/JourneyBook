import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseLocationsCsv } from "./locations.js";

/**
 * The TypeScript half of a two-language conformance suite.
 * `dotnet/JourneyBook.Tests/LocationCsvConformanceTests.cs` is the other half and
 * reads the SAME file.
 *
 * `parseLocationsCsv` here and `LocationCsv.Parse` in C# are two hand-written
 * implementations of one format — same header aliases, same quote handling, same
 * all-or-nothing aggregation, near-identical error strings — and both docblocks
 * claim "one file works in both". Nothing checked it. Each side testing itself
 * against its own expectations is precisely how two parsers drift while both
 * suites stay green, so the expectations live in the fixture, not in either
 * language.
 */

interface Row {
  name: string;
  lng: number;
  lat: number;
  notes?: string;
  scalePresetId?: string;
  pinShape?: string;
  pinColor?: string;
  zoomLevels?: string[];
}

interface Case {
  id: string;
  why: string;
  csv: string;
  expect: "accept" | "reject" | "diverges";
  rows?: Row[];
  rejectContains?: string;
  divergence?: {
    typescript: "accept" | "reject";
    typescriptRejectContains?: string;
  };
}

const fixturePath = fileURLToPath(
  new URL("../../../data/fixtures/locations-csv-cases.json", import.meta.url),
);
const cases = (JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: Case[] }).cases;

/** Normalise a parsed location to the shape the fixture describes. */
function normalize(loc: ReturnType<typeof parseLocationsCsv>[number]): Row {
  return {
    name: loc.label ?? "",
    lng: loc.center.lng,
    lat: loc.center.lat,
    ...(loc.notes !== undefined ? { notes: loc.notes } : {}),
    ...(loc.scalePresetId !== undefined ? { scalePresetId: loc.scalePresetId } : {}),
    ...(loc.pin?.shape !== undefined ? { pinShape: loc.pin.shape } : {}),
    ...(loc.pin?.color !== undefined ? { pinColor: loc.pin.color } : {}),
    ...(loc.zoomLevels !== undefined ? { zoomLevels: loc.zoomLevels } : {}),
  };
}

describe("locations CSV — shared conformance fixture", () => {
  it("[CONTROL] the fixture was found and carries every case class", () => {
    // A missing or truncated fixture makes every `it.each` below disappear
    // silently, and a suite with no cases is a green suite.
    expect(cases.length).toBeGreaterThanOrEqual(12);
    const kinds = new Set(cases.map((c) => c.expect));
    expect([...kinds].sort()).toEqual(["accept", "diverges", "reject"]);
  });

  for (const testCase of cases) {
    const expected =
      testCase.expect === "diverges" ? testCase.divergence!.typescript : testCase.expect;

    if (expected === "accept") {
      it(`accepts "${testCase.id}" — ${testCase.why}`, () => {
        const rows = parseLocationsCsv(testCase.csv).map(normalize);
        if (testCase.rows) expect(rows).toEqual(testCase.rows);
        else expect(rows.length).toBeGreaterThan(0);
      });
    } else {
      const needle =
        testCase.expect === "diverges"
          ? testCase.divergence!.typescriptRejectContains
          : testCase.rejectContains;
      it(`rejects "${testCase.id}" — ${testCase.why}`, () => {
        let message: string | null = null;
        try {
          parseLocationsCsv(testCase.csv);
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
        }
        // Assert on the message, not merely that something threw: a parser that
        // throws for the wrong reason passes a bare `toThrow`.
        expect(message, `"${testCase.id}" was accepted`).not.toBeNull();
        if (needle) expect(message!.toLowerCase()).toContain(needle.toLowerCase());
      });
    }
  }
});
