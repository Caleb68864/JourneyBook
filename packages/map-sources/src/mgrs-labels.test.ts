import { describe, it, expect } from "vitest";
import { createUtmProjector, utmZoneForLongitude, type BBox } from "@journeybook/atlas-core";
import mgrs from "mgrs";
import { buildUsngGrid } from "./usng-grid.js";

/**
 * Level 4's full MGRS labelling. The `mgrs` library supplies the 100 km square letters, so it is
 * first checked against an independent implementation of the standard lettering (the WGS 84
 * "AA" scheme: column letters by zone mod 3, A-H / J-R / S-Z; row letters A-V cycling every
 * 2,000 km, shifted five for even zones; I and O never used), and its digits against this
 * repo's own proj4 UTM.
 */

const COLUMN_SETS = ["STUVWXYZ", "ABCDEFGH", "JKLMNPQR"]; // index zone % 3
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";

function standardSquare(zone: number, easting: number, northing: number): string {
  const col = COLUMN_SETS[zone % 3]![Math.floor(easting / 100_000) - 1]!;
  const rowIndex = (Math.floor(northing / 100_000) + (zone % 2 === 0 ? 5 : 0)) % 20;
  return `${col}${ROW_LETTERS[rowIndex]}`;
}

const POINTS: [number, number][] = [
  [-96.7, 40.8], [-122.33, 47.6], [-80.19, 25.76], [-149.9, 61.2], [-71.06, 42.36], [-104.99, 39.74],
  [2.29, 48.86], [13.4, 52.52], [139.69, 35.69], [77.21, 28.61], [-0.12, 51.5], [18.07, 59.33],
  [-157.86, 21.31], [100.5, 13.75], [37.62, 55.75], [-58.38, 0.5],
];

describe("the MGRS library against the standard", () => {
  it("[BEHAVIORAL] 100 km square letters match the standard lettering at points worldwide (north)", () => {
    for (const [lng, lat] of POINTS) {
      const zone = utmZoneForLongitude(lng);
      const [e, n] = createUtmProjector(zone).forward({ lng, lat });
      const lib = mgrs.forward([lng, lat], 5);
      expect(lib.slice(-12, -10), `${lng},${lat} (${lib})`).toBe(standardSquare(zone, e, n));
      expect(lib.startsWith(String(zone))).toBe(true);
    }
  });

  it("[BEHAVIORAL] its 1 m digits agree with this repo's UTM to the metre", () => {
    for (const [lng, lat] of POINTS) {
      const [e, n] = createUtmProjector(utmZoneForLongitude(lng)).forward({ lng, lat });
      const lib = mgrs.forward([lng, lat], 5);
      expect(Math.abs(Number(lib.slice(-10, -5)) - Math.floor(e % 100_000)), `${lib} easting`).toBeLessThanOrEqual(1);
      expect(Math.abs(Number(lib.slice(-5)) - Math.floor(n % 100_000)), `${lib} northing`).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildUsngGrid with full MGRS labels", () => {
  const zone = 14;
  const utm = createUtmProjector(zone);
  /** A ~3 km page centred at UTM (easting, northing) in zone 14. */
  function pageAt(easting: number, northing: number): BBox {
    const sw = utm.inverse([easting - 1500, northing - 1500]);
    const ne = utm.inverse([easting + 1500, northing + 1500]);
    return [sw.lng, sw.lat, ne.lng, ne.lat];
  }

  it("[BEHAVIORAL] names both 100 km squares on a page that crosses a square boundary, each in its own part", () => {
    const bbox = pageAt(700_000, 4_520_500);
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    const west = mgrs.forward([bbox[0] + 1e-4, (bbox[1] + bbox[3]) / 2], 1);
    const east = mgrs.forward([bbox[2] - 1e-4, (bbox[1] + bbox[3]) / 2], 1);
    const id = (m: string) => `${m.slice(0, 3)} ${m.slice(3, 5)}`;
    expect(id(west)).not.toBe(id(east));
    expect(grid.mgrs!.squares.map((s) => s.id).sort()).toEqual([id(west), id(east)].sort());
    const w = grid.mgrs!.squares.find((s) => s.id === id(west))!;
    const e = grid.mgrs!.squares.find((s) => s.id === id(east))!;
    expect(w.x).toBeLessThan(e.x);
    expect(grid.collar.squares).toHaveLength(2);
    expect(grid.collar.squares![0]).toBe(`${grid.collar.zoneDesignator} ${grid.collar.hundredKmSquare}`);
  });

  it("[BEHAVIORAL] the first easting and northing lines carry full UTM values; the rest keep two digits", () => {
    const bbox = pageAt(683_700, 4_517_300);
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([lng, lat]) => utm.forward({ lng: lng!, lat: lat! }));
    const firstE = Math.ceil(Math.min(...corners.map(([e]) => e)) / 1000) * 1000;
    const firstN = Math.ceil(Math.min(...corners.map(([, n]) => n)) / 1000) * 1000;
    const texts = grid.labels.map((l) => l.text);
    expect(texts).toContain(`${firstE}mE`);
    expect(texts).toContain(`${firstN}mN`);
    expect(texts.filter((t) => t.endsWith("mE"))).toHaveLength(2); // top and bottom of the one line
    expect(texts.filter((t) => t.endsWith("mN"))).toHaveLength(2);
    expect(texts.filter((t) => !t.endsWith("mE") && !t.endsWith("mN")).every((t) => /^\d{2}$/.test(t))).toBe(true);
    // One square on this page, and it is the centre's.
    expect(grid.collar.squares).toEqual([`${grid.collar.zoneDesignator} ${grid.collar.hundredKmSquare}`]);
  });

  it("[CONTROL] without the option the overlay is the Level 3 one: two-digit labels, no squares", () => {
    const grid = buildUsngGrid(pageAt(700_000, 4_520_500), 1000, 1000);
    expect(grid.mgrs).toBeUndefined();
    expect(grid.collar.squares).toBeUndefined();
    expect(grid.labels.every((l) => /^\d{2}$/.test(l.text))).toBe(true);
  });
});

describe("southern hemisphere", () => {
  const SOUTH: [number, number][] = [[151.2, -33.9], [-58.38, -34.6], [18.42, -33.92], [-70.65, -33.45], [174.76, -36.85], [-47.93, -15.78], [115.86, -31.95], [-0.5, -60]];

  it("[BEHAVIORAL] the library's square letters and digits match the standard with the southern false northing", () => {
    for (const [lng, lat] of SOUTH) {
      const zone = utmZoneForLongitude(lng);
      const [e, n] = createUtmProjector(zone, true).forward({ lng, lat });
      expect(n).toBeGreaterThan(1_000_000); // the false northing is in
      const lib = mgrs.forward([lng, lat], 5);
      expect(lib.slice(-12, -10), `${lng},${lat} (${lib})`).toBe(standardSquare(zone, e, n));
      expect(Math.abs(Number(lib.slice(-5)) - Math.floor(n % 100_000))).toBeLessThanOrEqual(1);
    }
  });

  it("[BEHAVIORAL] a southern page gets a grid, its squares and full southern northings", () => {
    const utmS = createUtmProjector(56, true); // Sydney
    const [e0, n0] = utmS.forward({ lng: 151.2, lat: -33.9 });
    const sw = utmS.inverse([e0 - 1500, n0 - 1500]);
    const ne = utmS.inverse([e0 + 1500, n0 + 1500]);
    const bbox: BBox = [sw.lng, sw.lat, ne.lng, ne.lat];
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });

    expect(grid.lines.length).toBeGreaterThan(4);
    expect(grid.collar.zoneDesignator).toBe("56H");
    const id = mgrs.forward([151.2, -33.9], 1);
    expect(grid.collar.squares).toContain(`${id.slice(0, 3)} ${id.slice(3, 5)}`);
    const firstN = Math.ceil((n0 - 1500) / 1000) * 1000;
    expect(grid.labels.map((l) => l.text)).toContain(`${firstN}mN`);
    expect(firstN).toBeGreaterThan(6_000_000); // a southern northing, not a negative one
  });

  it("[CONTROL] still empty beyond UTM's limits (MGRS uses UPS there)", () => {
    expect(buildUsngGrid([-10, -85, 10, -82], 800, 1000).lines).toHaveLength(0);
  });
});
