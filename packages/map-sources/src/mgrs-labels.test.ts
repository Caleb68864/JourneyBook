import { describe, it, expect } from "vitest";
import { createUpsProjector, createUtmProjector, utmZoneFor, utmZoneForLongitude, type BBox } from "@journeybook/atlas-core";
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

  it("beyond UTM's limits it is the polar UPS grid, not UTM", () => {
    // This used to be empty (no grid south of 80°S); since UPS is drawn, it is UPS.
    const grid = buildUsngGrid([-10, -85, 10, -82], 800, 1000);
    expect(grid.collar.system).toBe("UPS");
  });
});

describe("a page spanning two UTM zones", () => {
  // The 13/14 boundary is 102°W. A ~3 km page centred on it at 40.8°N.
  const BOUNDARY = -102;
  const bbox: BBox = [BOUNDARY - 0.018, 40.787, BOUNDARY + 0.018, 40.813];
  const utm13 = createUtmProjector(13);
  const utm14 = createUtmProjector(14);
  const lngAt = (x: number) => bbox[0] + x * (bbox[2] - bbox[0]);

  it("[BEHAVIORAL] draws each zone's grid only on its own side, with the boundary marked", () => {
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    expect(grid.zoneBoundary).toMatchObject({ westZone: 13, eastZone: 14 });
    const bx = grid.zoneBoundary!.x1;
    expect(lngAt(bx)).toBeCloseTo(BOUNDARY, 6);
    const westLines = grid.lines.filter((l) => Math.max(l.x1, l.x2) <= bx + 1e-6);
    const eastLines = grid.lines.filter((l) => Math.min(l.x1, l.x2) >= bx - 1e-6);
    // Every line is wholly on one side.
    expect(westLines.length + eastLines.length).toBe(grid.lines.length);
    expect(westLines.some((l) => l.axis === "easting")).toBe(true);
    expect(eastLines.some((l) => l.axis === "easting")).toBe(true);
  });

  it("[BEHAVIORAL] numbers each side in its own zone, and names the squares of both", () => {
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    // Northing labels sit on each zone's own outer edge. (At the boundary the two zones give the
    // same northing for the same latitude, by symmetry about their central meridians, so the
    // eastings are what tell them apart: about 750 km in zone 13 here, 250 km in zone 14.)
    expect(grid.labels.some((l) => l.edge === "left")).toBe(true);
    expect(grid.labels.some((l) => l.edge === "right")).toBe(true);
    const [e13] = utm13.forward({ lng: bbox[0], lat: bbox[1] });
    const [e14] = utm14.forward({ lng: BOUNDARY, lat: bbox[3] });
    const first13 = Math.ceil(e13 / 1000) * 1000;
    const first14 = Math.ceil(e14 / 1000) * 1000;
    expect(first13).toBeGreaterThan(700_000);
    expect(first14).toBeLessThan(300_000);
    const texts = grid.labels.map((l) => l.text);
    expect(texts).toContain(`${first13}mE`);
    expect(texts).toContain(`${first14}mE`);
    // Each full easting is on its own side of the boundary.
    const bx = grid.zoneBoundary!.x1;
    for (const l of grid.labels.filter((x) => x.text === `${first13}mE`)) expect(l.x).toBeLessThan(bx);
    for (const l of grid.labels.filter((x) => x.text === `${first14}mE`)) expect(l.x).toBeGreaterThan(bx);
    // Squares from both zones, each on its own side.
    const ids = grid.mgrs!.squares.map((q) => q.id);
    expect(ids.some((id) => id.startsWith("13T"))).toBe(true);
    expect(ids.some((id) => id.startsWith("14T"))).toBe(true);
    for (const q of grid.mgrs!.squares) {
      expect(q.id.startsWith("13T") ? q.x <= grid.zoneBoundary!.x1 : q.x >= grid.zoneBoundary!.x1).toBe(true);
    }
    expect(grid.collar.squares!.some((id) => id.startsWith("13T")) && grid.collar.squares!.some((id) => id.startsWith("14T"))).toBe(true);
  });

  it("[CONTROL] a page inside one zone has no boundary", () => {
    expect(buildUsngGrid([-96.72, 40.79, -96.68, 40.82], 1000, 1000, { mgrs: true }).zoneBoundary).toBeUndefined();
  });
});

describe("the Norway and Svalbard zone exceptions", () => {
  it("[BEHAVIORAL] utmZoneFor agrees with the MGRS library over both exception regions and around them", () => {
    const misses: string[] = [];
    for (let lat = 50.13; lat < 84; lat += 0.41) {
      for (let lng = -6.07; lng < 46; lng += 0.37) {
        const lib = Number(/^(\d{1,2})/.exec(mgrs.forward([lng, lat], 1))![1]);
        const ours = utmZoneFor(lng, lat);
        if (lib !== ours) misses.push(`${lng.toFixed(2)},${lat.toFixed(2)}: lib ${lib}, ours ${ours}`);
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it("[BEHAVIORAL] a page at 4°E 60°N is gridded in zone 32 (32V), not 31", () => {
    const grid = buildUsngGrid([3.98, 59.99, 4.02, 60.01], 1000, 1000, { mgrs: true });
    expect(grid.collar.zoneDesignator).toBe("32V");
    expect(grid.zoneBoundary).toBeUndefined();
    const [e] = createUtmProjector(32).forward({ lng: 4, lat: 60 });
    expect(e).toBeLessThan(400_000); // far west in zone 32, which is why the exception exists
    // The LINES are zone 32's: the first easting in full is a zone-32 easting (~3xx km), not
    // the zone-31 one the same ground has (~5xx km). The collar alone would not show this: it
    // comes from the MGRS library, which always knew the exception.
    const full = grid.labels.find((l) => l.text.endsWith("mE"))!.text;
    expect(Number(full.replace("mE", ""))).toBeLessThan(400_000);
  });

  it("[BEHAVIORAL] the junctions fall at the exceptions' own boundaries: 3°E in Norway, 9°E on Svalbard", () => {
    const norway = buildUsngGrid([2.98, 59.99, 3.02, 60.01], 1000, 1000);
    expect(norway.zoneBoundary).toMatchObject({ westZone: 31, eastZone: 32 });
    const svalbard = buildUsngGrid([8.95, 77.99, 9.05, 78.01], 1000, 1000);
    expect(svalbard.zoneBoundary).toMatchObject({ westZone: 31, eastZone: 33 });
    // And no junction at 6°E on Svalbard, where zone 32 does not exist.
    expect(buildUsngGrid([5.95, 77.99, 6.05, 78.01], 1000, 1000).zoneBoundary).toBeUndefined();
  });
});

describe("the polar UPS grid", () => {
  it("[BEHAVIORAL] a page north of 84°N gets a UPS grid and its zone letter", () => {
    const grid = buildUsngGrid([9.85, 84.49, 10.15, 84.51], 1000, 1000, { mgrs: true });
    expect(grid.lines.length).toBeGreaterThan(2);
    expect(grid.collar).toMatchObject({ zoneDesignator: "Z", system: "UPS" });
    // No 100 km square letters: none could be checked for the polar grid.
    expect(grid.mgrs).toBeUndefined();
    expect(buildUsngGrid([-10.15, 84.49, -9.85, 84.51], 1000, 1000).collar.zoneDesignator).toBe("Y");
  });

  it("[BEHAVIORAL] a page south of 80°S does too", () => {
    const grid = buildUsngGrid([44.9, -82.01, 45.1, -81.99], 1000, 1000);
    expect(grid.lines.length).toBeGreaterThan(2);
    expect(grid.collar).toMatchObject({ zoneDesignator: "B", system: "UPS" });
  });

  it("[CONTROL] empty past the panel's own limit (85.05°: no map tile exists there)", () => {
    expect(buildUsngGrid([-10, 85.1, 10, 86], 800, 1000).lines).toHaveLength(0);
  });
});

describe("review fixes to the grid", () => {
  /** Panel fraction (Web Mercator over the bbox) back to lng/lat, independent of the builder. */
  function fromFraction(bbox: BBox, x: number, y: number) {
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const yTop = merc(bbox[3]);
    const yBot = merc(bbox[1]);
    const m = yTop - y * (yTop - yBot);
    return { lng: bbox[0] + x * (bbox[2] - bbox[0]), lat: (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI) };
  }

  for (const bbox of [[89.5, 84.5, 90.5, 84.6], [44.5, 84.5, 45.5, 84.6]] as BBox[]) it(`[BEHAVIORAL] a UPS page at ${bbox[0] + 0.5}°E keeps each easting line a constant easting, labelled where it meets the border`, () => {
    const grid = buildUsngGrid(bbox, 1000, 1000);
    const ups = createUpsProjector(true);
    const eastings = grid.lines.filter((l) => l.axis === "easting");
    expect(eastings.length).toBeGreaterThan(0);
    // Every point of every easting piece lies on a whole-kilometre easting (what its label says),
    // within 5 m. Clamping each end separately (the UTM path) put lines hundreds of metres to
    // kilometres off on a turned page; one straight segment per line drifted ~30 m mid-page.
    for (const line of eastings) {
      for (const t of [0, 0.5, 1]) {
        const e = ups.forward(fromFraction(bbox, line.x1 + t * (line.x2 - line.x1), line.y1 + t * (line.y2 - line.y1)))[0];
        expect(Math.abs(e - Math.round(e / 1000) * 1000), `easting ${e.toFixed(0)} is not on a grid line`).toBeLessThan(5);
      }
    }
    for (const l of grid.labels) {
      const onEdge = { top: l.y < 1e-6, bottom: l.y > 1 - 1e-6, left: l.x < 1e-6, right: l.x > 1 - 1e-6 }[l.edge];
      expect(onEdge, `${l.text} labelled ${l.edge} at ${l.x.toFixed(3)},${l.y.toFixed(3)}`).toBe(true);
      // And it is where a drawn line actually ends, not just somewhere on that edge.
      const atLineEnd = grid.lines.some((g) => [[g.x1, g.y1], [g.x2, g.y2]].some(([x, y]) => Math.hypot(x! - l.x, y! - l.y) < 1e-6));
      expect(atLineEnd, `${l.text} at ${l.x.toFixed(3)},${l.y.toFixed(3)} is at no line's end`).toBe(true);
    }
  });

  it("[BEHAVIORAL] a page astride the equator prints its southern full northing, not a negative one", () => {
    const grid = buildUsngGrid([-99.1, -0.04, -98.9, 0.05], 1000, 1000, { mgrs: true });
    const northings = grid.labels.filter((l) => l.text.endsWith("mN")).map((l) => Number(l.text.replace("mN", "")));
    expect(northings.length).toBeGreaterThan(0);
    expect(northings.every((n) => n >= 0)).toBe(true);
    expect(northings).toContain(9_996_000);
  });

  it("[BEHAVIORAL] a junction page lists the centre's square first", () => {
    const grid = buildUsngGrid([2.9, 59.95, 3.1, 60.05], 1000, 1000, { mgrs: true });
    expect(grid.collar.squares![0]).toBe(`${grid.collar.zoneDesignator} ${grid.collar.hundredKmSquare}`);
  });
});

describe("a page across a latitude where the grid rule changes", () => {
  function latAt(bbox: BBox, y: number) {
    const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const m = merc(bbox[3]) - y * (merc(bbox[3]) - merc(bbox[1]));
    return (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI);
  }
  const point = (bbox: BBox, x: number, y: number) => ({ lng: bbox[0] + x * (bbox[2] - bbox[0]), lat: latAt(bbox, y) });
  /** Is every easting line on one side of `yCut` on a whole-km line of `proj`? */
  function eastingsOn(grid: ReturnType<typeof buildUsngGrid>, bbox: BBox, side: "above" | "below", yCut: number, proj: { forward(p: { lng: number; lat: number }): [number, number] }) {
    const lines = grid.lines.filter((l) => l.axis === "easting" && (side === "above" ? Math.max(l.y1, l.y2) <= yCut + 1e-9 : Math.min(l.y1, l.y2) >= yCut - 1e-9));
    expect(lines.length, `easting lines ${side} the rule line`).toBeGreaterThan(0);
    for (const l of lines) {
      for (const t of [0, 0.5, 1]) {
        const e = proj.forward(point(bbox, l.x1 + t * (l.x2 - l.x1), l.y1 + t * (l.y2 - l.y1)))[0];
        expect(Math.abs(e - Math.round(e / 1000) * 1000), `${side}: ${e.toFixed(0)}`).toBeLessThan(5);
      }
    }
  }

  it("[BEHAVIORAL] at 84°N: UPS above the line, UTM below, each band on its own grid", () => {
    const bbox: BBox = [10, 83.985, 10.3, 84.015];
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    expect(grid.ruleBoundaries).toHaveLength(1);
    const yCut = grid.ruleBoundaries![0]!.y;
    expect(latAt(bbox, yCut)).toBeCloseTo(84, 6);
    expect(grid.ruleBoundaries![0]!.label).toMatch(/^84°N: UPS north/);
    eastingsOn(grid, bbox, "above", yCut, createUpsProjector(true));
    // Below 84°N at 10°E is Svalbard's widened zone 33 (9–21°E), not zone 32.
    eastingsOn(grid, bbox, "below", yCut, createUtmProjector(33));
    // No label left in the middle of the page at the band edge.
    expect(grid.labels.every((l) => l.edge !== "top" || l.y < 1e-6)).toBe(true);
    expect(grid.labels.every((l) => l.edge !== "bottom" || l.y > 1 - 1e-6)).toBe(true);
  });

  it("[BEHAVIORAL] at 56°N at Norway's longitude: zone 32 above, zone 31 below, both in the collar", () => {
    const bbox: BBox = [3.97, 55.985, 4.03, 56.015];
    const grid = buildUsngGrid(bbox, 1000, 1000, { mgrs: true });
    expect(grid.ruleBoundaries).toHaveLength(1);
    const yCut = grid.ruleBoundaries![0]!.y;
    eastingsOn(grid, bbox, "above", yCut, createUtmProjector(32));
    eastingsOn(grid, bbox, "below", yCut, createUtmProjector(31));
    expect(grid.collar.squares!.some((q) => q.startsWith("31U"))).toBe(true);
    expect(grid.collar.squares!.some((q) => q.startsWith("32V"))).toBe(true);
  });

  it("[CONTROL] no split where the rule is the same either side (56°N far from Norway)", () => {
    expect(buildUsngGrid([-96.73, 55.985, -96.67, 56.015], 1000, 1000).ruleBoundaries).toBeUndefined();
  });
});
