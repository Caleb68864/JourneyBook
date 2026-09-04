import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contractFromArgs, inputFromArgs, parseFlags } from "./cli.js";

describe("cli inputFromArgs", () => {
  it("composes --locations file + --location + --cover + --zoom-levels into one input", () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-cli-"));
    try {
      const csv = join(dir, "stops.csv");
      writeFileSync(csv, "name,lng,lat,zoom\nHome,-96.70,40.81,\nGrandma's,-95.93,41.26,1-50000|usgs-7-5-min\n");
      const input = inputFromArgs([
        "--locations", csv,
        "--location", "-96.85,40.97",
        "--cover", "0.1",
        "--zoom-levels", "1-100000,1-50000",
        "--scale", "1-100000",
        "--tier", "2",
        "--title", "Road Trip",
        "--no-toc",
      ]);
      expect(input.mode).toBe("location");
      expect(input.locations).toHaveLength(3);
      expect(input.locations![0]!.label).toBe("Home");
      expect(input.locations![1]!.zoomLevels).toEqual(["1-50000", "usgs-7-5-min"]);
      expect(input.locations![2]!.center).toEqual({ lng: -96.85, lat: 40.97 });
      expect(input.center).toEqual(input.locations![0]!.center);
      expect(input.cover).toBe(true);
      expect(input.coverPadFraction).toBe(0.1);
      expect(input.zoomLevels).toEqual(["1-100000", "1-50000"]);
      expect(input.title).toBe("Road Trip");
      expect(input.tier).toBe(2);
      expect(input.tableOfContents).toBe(false);
      expect(input.overview).toBe(true);

      // grid/validate share the assembly: grid pages first, then L1 (ladder default), L2 (own ladder), L3.
      const contract = contractFromArgs(["--locations", csv, "--location", "-96.85,40.97", "--cover", "--zoom-levels", "1-100000,1-50000", "--scale", "1-100000"]);
      const ids = contract.pages.map((p) => p.id);
      expect(ids[0]).toBe("A1");
      expect(ids.filter((id) => id.startsWith("L"))).toEqual(["L1a", "L1b", "L2a", "L2b", "L3a", "L3b"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps --bbox and locations together (mode bbox, locations appended)", () => {
    const input = inputFromArgs(["--bbox", "-96.73,40.79,-96.67,40.83", "--location", "-96.7,40.8", "--scale", "usgs-7-5-min"]);
    expect(input.mode).toBe("bbox");
    expect(input.bbox).toEqual([-96.73, 40.79, -96.67, 40.83]);
    expect(input.locations).toHaveLength(1);
    const ids = contractFromArgs(["--bbox", "-96.73,40.79,-96.67,40.83", "--location", "-96.7,40.8", "--scale", "usgs-7-5-min"]).pages.map((p) => p.id);
    expect(ids[ids.length - 1]).toBe("L1");
  });

  it("fails fast on missing geometry, missing scale, or a bad --cover pad", () => {
    expect(() => inputFromArgs(["--scale", "usgs-7-5-min"])).toThrow(/need geometry/);
    expect(() => inputFromArgs(["--location", "-96.7,40.8"])).toThrow(/need --scale/);
    expect(() => inputFromArgs(["--location", "-96.7,40.8", "--scale", "nope"])).toThrow(/Unknown --scale/);
    expect(() => inputFromArgs(["--location", "-96.7,40.8", "--scale", "usgs-7-5-min", "--cover", "-1"])).toThrow(/--cover expects/);
  });

  it("parseFlags treats a bare flag as true and takes the following token as a value", () => {
    const flags = parseFlags(["--basemap", "--tier", "3", "--route"]);
    expect(flags.get("basemap")).toBe("true");
    expect(flags.get("tier")).toBe("3");
    expect(flags.get("route")).toBe("true");
  });
});
