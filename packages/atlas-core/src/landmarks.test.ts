import { describe, it, expect } from "vitest";
import type { AtlasPage } from "./model.js";
import {
  selectPageLandmarks,
  resolveLabelCollisions,
  MAX_PAGE_LANDMARKS,
  type LandmarkMarker,
  type PlacedLandmark,
} from "./landmarks.js";

/**
 * A unit-square page ([0,0,1,1]) so a marker's WGS84 lng/lat maps to a trivial
 * normalized position: x = lng, y = 1 - lat. Keeps the bucket/label math in the
 * tests easy to reason about.
 */
function unitPage(): AtlasPage {
  return {
    id: "L1",
    bbox: [0, 0, 1, 1],
    orientation: "portrait",
    tier: 1,
    neighbors: {},
  };
}

/** Re-derive the coarse bucket key for a placed marker (default 3×3 grid). */
function bucketKey(p: PlacedLandmark, cols = 3, rows = 3): string {
  const col = Math.min(cols - 1, Math.floor(p.x * cols));
  const row = Math.min(rows - 1, Math.floor(p.y * rows));
  return `${col},${row}`;
}

const marker = (
  lng: number,
  lat: number,
  name: string,
  score: number,
  category = "poi",
): LandmarkMarker => ({ lng, lat, name, category, score });

describe("selectPageLandmarks — spatial distribution & cap", () => {
  it("collapses a tight cluster to a single bucket winner", () => {
    // Twelve markers all sitting in the same coarse-grid bucket (near 0.1,0.9).
    const cluster: LandmarkMarker[] = Array.from({ length: 12 }, (_, i) =>
      marker(0.08 + i * 0.001, 0.92 - i * 0.001, `c${i}`, i + 1),
    );

    const placed = selectPageLandmarks(cluster, unitPage());

    expect(placed).toHaveLength(1);
    // Highest score (last index) must be the survivor.
    expect(placed[0]!.name).toBe("c11");
  });

  it("distributes selections across distinct buckets and caps at 6", () => {
    // One marker per cell of the 3×3 grid → nine bucket winners.
    const grid: LandmarkMarker[] = [];
    let score = 1;
    for (const lng of [0.1, 0.5, 0.9]) {
      for (const lat of [0.1, 0.5, 0.9]) {
        grid.push(marker(lng, lat, `g${score}`, score));
        score += 1;
      }
    }
    // Extra clustered noise inside the (0.1,0.9) bucket — must not yield a 2nd
    // winner for that bucket.
    const noise: LandmarkMarker[] = Array.from({ length: 5 }, (_, i) =>
      marker(0.11 + i * 0.001, 0.89, `n${i}`, 0.5),
    );

    const placed = selectPageLandmarks([...grid, ...noise], unitPage());

    // Hard cap honored.
    expect(placed.length).toBeLessThanOrEqual(MAX_PAGE_LANDMARKS);
    expect(placed).toHaveLength(6);

    // No two selected markers share a coarse-grid bucket.
    const keys = placed.map((p) => bucketKey(p));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("clamps an over-large opts.cap to the hard maximum", () => {
    const grid: LandmarkMarker[] = [];
    let score = 1;
    for (const lng of [0.1, 0.5, 0.9]) {
      for (const lat of [0.1, 0.5, 0.9]) {
        grid.push(marker(lng, lat, `g${score}`, score));
        score += 1;
      }
    }

    const placed = selectPageLandmarks(grid, unitPage(), { cap: 100 });

    expect(placed.length).toBeLessThanOrEqual(MAX_PAGE_LANDMARKS);
  });

  it("drops landmarks outside the page bbox", () => {
    const inside = marker(0.5, 0.5, "in", 10);
    const outside = marker(5, 5, "out", 99);

    const placed = selectPageLandmarks([inside, outside], unitPage());

    expect(placed.map((p) => p.name)).toEqual(["in"]);
  });
});

describe("selectPageLandmarks — greedy label collision avoidance", () => {
  it("drops the lower-score label when two labels overlap", () => {
    // Straddle the col0/col1 bucket boundary (≈0.333) so both survive bucket
    // selection, but sit close enough that their label boxes overlap.
    const high = marker(0.32, 0.5, "high", 10);
    const low = marker(0.34, 0.5, "low", 5);

    const placed = selectPageLandmarks([high, low], unitPage());

    const byName = Object.fromEntries(placed.map((p) => [p.name, p]));
    expect(placed).toHaveLength(2);
    // Higher score keeps its label; the overlapping lower-score one is dropped.
    expect(byName.high!.labelPlaced).toBe(true);
    expect(byName.low!.labelPlaced).toBe(false);
  });

  it("drops a label that intersects a declared furniture zone", () => {
    const overZone = marker(0.5, 0.5, "over", 10);
    const clear = marker(0.9, 0.9, "clear", 8);

    const placed = selectPageLandmarks([overZone, clear], unitPage(), {
      furnitureZones: [{ x: 0.4, y: 0.4, width: 0.3, height: 0.3 }],
    });

    const byName = Object.fromEntries(placed.map((p) => [p.name, p]));
    expect(byName.over!.labelPlaced).toBe(false);
    expect(byName.clear!.labelPlaced).toBe(true);
  });

  it("resolveLabelCollisions keeps non-overlapping labels and drops overlaps", () => {
    const placed: PlacedLandmark[] = [
      { x: 0.1, y: 0.1, name: "a", category: "poi", score: 9, labelPlaced: true },
      { x: 0.11, y: 0.11, name: "b", category: "poi", score: 5, labelPlaced: true },
      { x: 0.9, y: 0.9, name: "c", category: "poi", score: 3, labelPlaced: true },
    ];

    resolveLabelCollisions(placed);

    const byName = Object.fromEntries(placed.map((p) => [p.name, p]));
    expect(byName.a!.labelPlaced).toBe(true); // first, highest score → kept
    expect(byName.b!.labelPlaced).toBe(false); // overlaps a → dropped
    expect(byName.c!.labelPlaced).toBe(true); // far away → kept
  });
});

describe("selectPageLandmarks — determinism", () => {
  const grid: LandmarkMarker[] = (() => {
    const out: LandmarkMarker[] = [];
    let score = 1;
    for (const lng of [0.1, 0.5, 0.9]) {
      for (const lat of [0.1, 0.5, 0.9]) {
        out.push(marker(lng, lat, `g${score}`, score));
        score += 1;
      }
    }
    return out;
  })();

  it("identical input yields identical output across runs", () => {
    const first = selectPageLandmarks(grid, unitPage());
    const second = selectPageLandmarks(grid, unitPage());
    expect(second).toEqual(first);
  });

  it("output ordering is independent of caller array order", () => {
    const forward = selectPageLandmarks(grid, unitPage());
    const reversed = selectPageLandmarks([...grid].reverse(), unitPage());
    expect(reversed).toEqual(forward);
  });

  it("ties on score break deterministically by name", () => {
    // Two markers, equal score, in different buckets so both are selected;
    // ordering must be by name (a before b).
    const a = marker(0.1, 0.9, "alpha", 7);
    const b = marker(0.9, 0.1, "bravo", 7);

    const placed = selectPageLandmarks([b, a], unitPage());

    expect(placed.map((p) => p.name)).toEqual(["alpha", "bravo"]);
  });
});
