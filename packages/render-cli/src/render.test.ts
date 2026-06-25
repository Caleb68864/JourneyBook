import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAtlas } from "./render.js";

/**
 * Verifies the shared renderAtlas orchestration (SS-01): a single exported
 * entry point consumed by both the CLI and the render-worker. No basemap, so
 * no network — the PDF is produced entirely by atlas-core + pdf-client.
 */
describe("renderAtlas", () => {
  it("renders a single-page location atlas to a real PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-"));
    try {
      const out = join(dir, "loc.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: out,
      });
      expect(res.pageCount).toBe(1);
      expect(res.outputPath).toBe(out);
      const bytes = readFileSync(out);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a bbox grid with at least one page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-"));
    try {
      const out = join(dir, "grid.pdf");
      const res = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: out,
      });
      expect(res.pageCount).toBeGreaterThanOrEqual(1);
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a page per saved location alongside the bbox grid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-combined-"));
    try {
      const out = join(dir, "combined.pdf");
      const gridOnly = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: join(dir, "grid-only.pdf"),
      });
      const combined = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        locations: [
          { center: { lng: -96.7, lat: 40.8 }, label: "Home" },
          { center: { lng: -95.9, lat: 41.25 }, label: "Grandma" },
        ],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: out,
      });
      // Combined atlas = the grid pages PLUS one page per location.
      expect(combined.pageCount).toBe(gridOnly.pageCount + 2);
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders every location when no bbox is set (location mode, multiple)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-multiloc-"));
    try {
      const out = join(dir, "multiloc.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 }, // first location, legacy field
        locations: [
          { center: { lng: -96.7, lat: 40.8 } },
          { center: { lng: -95.9, lat: 41.25 } },
          { center: { lng: -97.4, lat: 42.0 } },
        ],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: out,
      });
      expect(res.pageCount).toBe(3);
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a location at its own (finer) scale, tagged on the page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-locscale-"));
    try {
      const coarse = await renderAtlas({
        mode: "location",
        locations: [{ center: { lng: -96.7, lat: 40.8 } }],
        scalePresetId: "1-100000", // 1:100,000 project default
        tier: 2,
        outputPath: join(dir, "coarse.pdf"),
      });
      const zoomed = await renderAtlas({
        mode: "location",
        locations: [{ center: { lng: -96.7, lat: 40.8 }, scalePresetId: "usgs-7-5-min" }], // 1:24,000 override
        scalePresetId: "1-100000",
        tier: 2,
        outputPath: join(dir, "zoomed.pdf"),
      });
      expect(coarse.pageCount).toBe(1);
      expect(zoomed.pageCount).toBe(1);
      // A finer scale covers less ground → a smaller bbox span.
      const span = (b: readonly number[]) => (b[2]! - b[0]!) * (b[3]! - b[1]!);
      expect(span(zoomed.contract.pages[0]!.bbox)).toBeLessThan(span(coarse.contract.pages[0]!.bbox));
      // The page carries its own (overriding) scale for a truthful scale bar.
      expect(zoomed.contract.pages[0]!.scale?.id).toBe("usgs-7-5-min");
      expect(coarse.contract.pages[0]!.scale?.id).toBe("1-100000");
      expect(readFileSync(join(dir, "zoomed.pdf")).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prepends a locations table-of-contents page (locations) but not for a bbox grid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-toc-"));
    // Total PDF page count from the page tree (includes the front-matter TOC page).
    const pdfPageCount = (file: string): number => {
      const counts = [...readFileSync(file).toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
      return Math.max(...counts);
    };
    try {
      const locOut = join(dir, "loc.pdf");
      const loc = await renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -96.7, lat: 40.81 }, label: "Capitol" },
          { center: { lng: -95.9, lat: 41.25 }, label: "Grandma" },
        ],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: locOut,
      });
      expect(loc.pageCount).toBe(2); // contract page count (location pages only)
      expect(pdfPageCount(locOut)).toBe(3); // + 1 TOC front-matter page

      const gridOut = join(dir, "grid.pdf");
      const grid = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: gridOut,
      });
      // A bbox-only atlas has no titled location pages → no TOC page added.
      expect(pdfPageCount(gridOut)).toBe(grid.pageCount);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on an unknown per-location scale preset", async () => {
    await expect(
      renderAtlas({
        mode: "location",
        locations: [{ center: { lng: -96.7, lat: 40.8 }, scalePresetId: "nope" }],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Unknown scalePresetId "nope"/);
  });

  it("rejects a non-finite location coordinate", async () => {
    await expect(
      renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        locations: [{ center: { lng: -96.7, lat: Number.NaN } }],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Invalid location\[0\]\.center/);
  });

  it("throws on an unknown scale preset", async () => {
    await expect(
      renderAtlas({
        mode: "location",
        center: { lng: 0, lat: 0 },
        scalePresetId: "does-not-exist",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Unknown scalePresetId/);
  });

  it("throws when location mode is missing center", async () => {
    await expect(
      renderAtlas({
        mode: "location",
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Invalid center/);
  });

  it("rejects a tier outside 1–4", async () => {
    await expect(
      renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 9 as 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Invalid tier/);
  });

  it("rejects a reversed bbox (west >= east)", async () => {
    await expect(
      renderAtlas({
        mode: "bbox",
        bbox: [-96.6, 40.79, -96.73, 40.83], // west > east
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Invalid bbox/);
  });

  it("rejects a non-finite center coordinate", async () => {
    await expect(
      renderAtlas({
        mode: "location",
        center: { lng: Number.NaN, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/Invalid center/);
  });

  it("[INTEGRATION] tier-3 render produces a valid PDF and a non-empty grids map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-tier3-"));
    try {
      const out = join(dir, "tier3.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 3,
        outputPath: out,
      });
      expect(res.pageCount).toBe(1);
      const bytes = readFileSync(out);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      // Verify the USNG grid was computed for the single page.
      const gridEntries = Object.keys(res.grids);
      expect(gridEntries.length).toBeGreaterThan(0);
      const overlay = res.grids[gridEntries[0]!]!;
      expect(overlay.lines.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] tier-1 render produces no grids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-t1-"));
    try {
      const out = join(dir, "tier1.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: out,
      });
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(Object.keys(res.grids).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] tier-2 render produces no grids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-t2-"));
    try {
      const out = join(dir, "tier2.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        outputPath: out,
      });
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(Object.keys(res.grids).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] route mode produces both L# and R# pages and writes a valid PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-route-"));
    try {
      const out = join(dir, "route.pdf");
      const res = await renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -96.7, lat: 40.8 }, label: "Start" },
          { center: { lng: -96.6, lat: 40.9 }, label: "End" },
        ],
        center: { lng: -96.7, lat: 40.8 },
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        route: true,
        outputPath: out,
      });
      const pageIds = res.contract.pages.map((p) => p.id);
      expect(pageIds.some((id) => /^L\d+$/.test(id))).toBe(true);
      expect(pageIds.some((id) => /^R\d+$/.test(id))).toBe(true);
      const bytes = readFileSync(out);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] route mode with combined L#+R# over MAX_ATLAS_PAGES throws Invalid request with page limit", async () => {
    // Two stops far apart (~4000 km) generate hundreds of R# corridor pages at
    // usgs-7-5-min scale, pushing L#(2) + R#(n) well above the 200-page cap.
    await expect(
      renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -120, lat: 45 } },
          { center: { lng: -70, lat: 45 } },
        ],
        center: { lng: -120, lat: 45 },
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        route: true,
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/^Invalid request:.*200/);
  });

  it("[BEHAVIORAL] renders a bbox atlas with landmark furniture and a valid PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-landmarks-"));
    try {
      const out = join(dir, "landmarks.pdf");
      // Two markers inside the bbox so at least one page selects landmark furniture.
      const res = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        landmarks: [
          { lng: -96.7, lat: 40.81, name: "Capitol", category: "civic", score: 10 },
          { lng: -96.69, lat: 40.8, name: "Library", category: "civic", score: 8 },
        ],
        outputPath: out,
      });
      // The result references landmark furniture keyed by page id for the relevant page(s).
      const placedPages = Object.keys(res.landmarks);
      expect(placedPages.length).toBeGreaterThan(0);
      const placed = res.landmarks[placedPages[0]!]!;
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.map((p) => p.name)).toContain("Capitol");
      expect(readFileSync(out).subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("[BEHAVIORAL] landmark selection does not bypass the MAX_ATLAS_PAGES guard", async () => {
    // A ~6°×6° extent at usgs-7-5-min (1:24,000) tiles into far more than the
    // 200-page cap; supplying landmarks must not suppress the page-limit error
    // (selection runs only after the guard).
    await expect(
      renderAtlas({
        mode: "bbox",
        bbox: [-100, 38, -94, 44],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        landmarks: [{ lng: -97, lat: 41, name: "Midpoint", category: "civic", score: 5 }],
        outputPath: "ignored.pdf",
      }),
    ).rejects.toThrow(/^Invalid request:.*200/);
  });
});
