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
});
