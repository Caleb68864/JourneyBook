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
});
