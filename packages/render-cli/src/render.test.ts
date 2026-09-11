import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LETTER_PORTRAIT,
  mapBoxInches,
  effectiveDpi,
  panelWidthPxFor,
  PRINT_DPI_TARGET,
  SCALE_PRESETS,
} from "@journeybook/atlas-core";
import { measurePdfPages } from "@journeybook/pdf-client";
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
        overview: false,
        outputPath: locOut,
      });
      expect(loc.pageCount).toBe(2); // contract page count (location pages only)
      expect(pdfPageCount(locOut)).toBe(3); // + 1 TOC front-matter page

      // tableOfContents:false suppresses the TOC page.
      const noTocOut = join(dir, "no-toc.pdf");
      const noToc = await renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -96.7, lat: 40.81 }, label: "Capitol" },
          { center: { lng: -95.9, lat: 41.25 }, label: "Grandma" },
        ],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        tableOfContents: false,
        overview: false,
        outputPath: noTocOut,
      });
      expect(pdfPageCount(noTocOut)).toBe(noToc.pageCount); // no front-matter page

      const gridOut = join(dir, "grid.pdf");
      const grid = await renderAtlas({
        mode: "bbox",
        bbox: [-96.73, 40.79, -96.67, 40.83],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        overview: false,
        outputPath: gridOut,
      });
      // A bbox-only atlas (overview off) has no titled pages → no front matter.
      expect(pdfPageCount(gridOut)).toBe(grid.pageCount);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prepends an overview page for a multi-page atlas, not for a single page", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jb-render-ov-"));
    const pdfPageCount = (file: string): number =>
      Math.max(...[...readFileSync(file).toString("latin1").matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1])));
    try {
      // 2 location pages → overview (≥2 pages) + TOC = 2 front-matter pages.
      const multiOut = join(dir, "multi.pdf");
      const multi = await renderAtlas({
        mode: "location",
        locations: [
          { center: { lng: -96.7, lat: 40.81 }, label: "Capitol" },
          { center: { lng: -95.9, lat: 41.25 }, label: "Grandma" },
        ],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: multiOut,
      });
      expect(pdfPageCount(multiOut)).toBe(multi.pageCount + 2);

      // 1 location page → TOC (1 entry) but no overview (needs ≥2 pages).
      const oneOut = join(dir, "one.pdf");
      const one = await renderAtlas({
        mode: "location",
        center: { lng: -96.7, lat: 40.81 },
        locations: [{ center: { lng: -96.7, lat: 40.81 }, label: "Capitol" }],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: oneOut,
      });
      expect(pdfPageCount(oneOut)).toBe(one.pageCount + 1);
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

/**
 * The basemap path, end to end. Every other test in this file renders with
 * `basemap` unset — the fastest way to keep the suite offline, and the reason
 * the one branch that fetches tiles, crops them and embeds the result in the PDF
 * had no coverage at all between `renderMapPanel`'s unit tests and a real
 * network. This drives `renderAtlas` with tiles stubbed, then reads the produced
 * PDF back to check the panel is actually in it and actually painted into the
 * map box.
 */
describe("renderAtlas with a basemap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A real 256x256 PNG tile. Inline rather than generated so this package needs
   * no image dependency of its own; the crop is measured precisely one layer
   * down, in `map-sources`' `panel.test.ts`, against self-locating tiles.
   */
  const TILE_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACAElEQVR42u3TMQ0AAAgEsVfMjAhEM6OBJlVwyaWn4K1IgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAADKACBgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABVMAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMANcCwUIVr6HMf/cAAAAASUVORK5CYII=",
    "base64",
  );

  it("fetches tiles, embeds the panel, and paints it into the printed map box", async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array(TILE_PNG), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dir = mkdtempSync(join(tmpdir(), "jb-render-basemap-"));
    try {
      const out = join(dir, "basemap.pdf");
      const res = await renderAtlas({
        mode: "location",
        center: { lng: -96.7026, lat: 40.8136 },
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        basemap: true,
        panelWidthPx: 512,
        outputPath: out,
      });
      expect(res.pageCount).toBe(1);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);

      const measured = measurePdfPages(readFileSync(out));
      expect(measured).toHaveLength(1);
      const page = measured[0]!;

      // The panel made it into the PDF as a real image XObject...
      expect(page.images).toHaveLength(1);
      // ...painted into exactly the map box the page's ground footprint was
      // sized from — the constant 415 x 549 pt box, not a letterboxed crop.
      const box = mapBoxInches(LETTER_PORTRAIT);
      expect(page.images[0]!.width).toBeCloseTo(box.widthIn * 72, 3);
      expect(page.images[0]!.height).toBeCloseTo(box.heightIn * 72, 3);

      // The tiles the panel actually used are the ones credited in the footer.
      expect(page.texts.join(" ")).toContain("USGS The National Map");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The panel width is now a property of the SCALE, and this is where that
   * becomes true of a render rather than of a table.
   *
   * `tilemath.test.ts` pins what each preset's width delivers; nothing there
   * touches `renderAtlas`, so a per-preset width defined and never wired in
   * would leave that suite entirely green. These cases read the zoom off the
   * tile URLs the render actually requested.
   */
  const zoomsRequested = (mock: { mock: { calls: unknown[][] } }): Set<number> => {
    const zooms = new Set<number>();
    for (const call of mock.mock.calls) {
      const url = String(call[0]);
      const m = /\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
      if (m) zooms.add(Number(m[1]));
    }
    return zooms;
  };

  type ZoomProbeInput = Omit<Parameters<typeof renderAtlas>[0], "outputPath">;

  async function renderAndCaptureZooms(input: ZoomProbeInput): Promise<Set<number>> {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(TILE_PNG), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = mkdtempSync(join(tmpdir(), "jb-render-perpreset-"));
    try {
      await renderAtlas({
        ...input,
        outputPath: join(dir, "out.pdf"),
        // A proxy base gives tile URLs a predictable {z}/{x}/{y} tail to read the
        // zoom off, instead of parsing the USGS ArcGIS template.
        tileBaseUrl: "http://127.0.0.1:1/tiles",
        basemap: true,
        overview: false,
      });
      return zoomsRequested(fetchMock);
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("asks a 1:100,000 page for the zoom its own preset width needs", async () => {
    // At the old flat 1000 px this preset landed on z13 and printed at 176 DPI.
    // Its own width (1730) is what buys z14.
    const zooms = await renderAndCaptureZooms({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
    });
    expect([...zooms]).toEqual([14]);
  });

  it("[CONTROL] leaves a 1:24,000 page on the zoom it always used", async () => {
    // The must-be-UNCHANGED half of the decision, measured through the render
    // rather than read off the preset table.
    const zooms = await renderAndCaptureZooms({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
    });
    expect([...zooms]).toEqual([16]);
  });

  it("resolves the width per page across a mixed-scale zoom ladder", async () => {
    // One atlas, three scales, three different zooms — which is only possible if
    // the width is resolved per page rather than once for the whole render.
    const zooms = await renderAndCaptureZooms({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      locations: [{ center: { lng: -98, lat: 41 } }],
      zoomLevels: ["1-100000", "1-50000", "usgs-7-5-min"],
      tableOfContents: false,
    });
    expect([...zooms].sort((a, b) => a - b)).toEqual([14, 15, 16]);
  });

  it("still lets an explicit panelWidthPx override every preset", async () => {
    // The CLI's --panel-px is a caller asking for a specific resolution; a
    // per-preset default that quietly won over it would be a regression.
    const zooms = await renderAndCaptureZooms({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
      panelWidthPx: 300,
    });
    expect([...zooms]).toEqual([12]);
  });

  /**
   * What the render says about the resolution it actually DELIVERED.
   *
   * `effectiveDpi` is the exact inverse of the `panelWidthPxForDpi` every scale
   * preset's width is derived from, and it was exported, tested, and called by
   * nothing but its own tests. So on a product whose load-bearing promise is
   * true scale, the renderer knew the printed resolution of every page, warned
   * when a panel came out *softer than asked for*, and never once said what it
   * had achieved.
   *
   * It matters because the delivered width is not the requested one: nothing
   * resamples, so the target is a floor and the crop is 1x-2x it depending on
   * where the page falls relative to a Web-Mercator zoom boundary. Two presets
   * 4% apart in scale can print 1.9x apart in DPI.
   */
  async function renderAndCaptureStderr(input: ZoomProbeInput): Promise<string> {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(TILE_PNG), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const lines: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });
    const dir = mkdtempSync(join(tmpdir(), "jb-render-dpi-"));
    try {
      await renderAtlas({
        ...input,
        outputPath: join(dir, "out.pdf"),
        tileBaseUrl: "http://127.0.0.1:1/tiles",
        basemap: true,
        overview: false,
      });
      return lines.join("");
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("[BEHAVIORAL] reports the print resolution each panel actually delivered", async () => {
    const out = await renderAndCaptureStderr({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
    });

    // An absolute number, not merely the presence of the word "dpi": the whole
    // failure mode here is a figure that reads plausible and is nobody's
    // measurement. 1:100,000 at its own preset width lands on z14, which
    // delivers ~2030 px over the 5.7639 in Letter-portrait map box.
    expect(out).toMatch(/panel L1 \(z14, 35\d dpi\)/);
    expect(out).toMatch(/print resolution: 35\d dpi across 1 panel\(s\)/);
  });

  it("[CONTROL] says nothing about missing the target when the target is met", async () => {
    // The warning must not be a line that always prints. A render clearing 300
    // DPI has nothing to disclose, and a warning on every render is a warning
    // nobody reads.
    const out = await renderAndCaptureStderr({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
    });
    expect(out).not.toContain("below the");
  });

  it("[BEHAVIORAL] discloses a render that will print below the stated target", async () => {
    // Disclosure, not policy: `--panel-px 400` is a caller asking for a soft
    // panel and they still get one. What changed is that the render says so.
    // Whether the DEFAULTS should ask for more is the owner's open question and
    // nothing here answers it.
    const out = await renderAndCaptureStderr({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
      panelWidthPx: 400,
    });

    expect(out).toMatch(/WARNING: the lowest panel prints at \d+ dpi, below the 300 dpi target/);
    // And the figure it warns about is the one it measured, not the one asked
    // for: 400 px was the REQUEST, and the panel is wider than that.
    const reported = /print resolution: (\d+) dpi/.exec(out);
    expect(reported).not.toBeNull();
    expect(Number(reported![1])).toBeLessThan(300);
    expect(Number(reported![1])).toBeGreaterThan(400 / mapBoxInches(LETTER_PORTRAIT).widthIn - 1);
  });

  /**
   * The same measurement, on the RESULT.
   *
   * Everything above this point reads `stderr`, and that is the whole finding:
   * `stderr` is imported from `node:process` at the top of `render.ts` and is not
   * injectable, so the only caller it reaches is a terminal. The render worker
   * calls `renderAtlas` in-process and reports what comes back on the result — it
   * is how `attribution` reaches the API, the `GeneratedPdf` provenance snapshot,
   * and an answer for a file already on disk. The commit that first computed this
   * number paired it with that attribution fix, and delivered the credit to a
   * queryable record while leaving the measurement in a log stream.
   *
   * On a product whose load-bearing promise is true scale, the delivered
   * resolution is the number that says whether the promise was kept on a given
   * render.
   */
  async function renderAndCaptureResult(input: ZoomProbeInput) {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(TILE_PNG), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const dir = mkdtempSync(join(tmpdir(), "jb-render-dpi-result-"));
    try {
      return await renderAtlas({
        ...input,
        outputPath: join(dir, "out.pdf"),
        tileBaseUrl: "http://127.0.0.1:1/tiles",
        overview: false,
      });
    } finally {
      vi.unstubAllGlobals();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("[BEHAVIORAL] carries the delivered print resolution on the result, not only in the log", async () => {
    const result = await renderAndCaptureResult({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
      basemap: true,
    });

    expect(result.deliveredDpi).toBeDefined();
    // Absolute figures, not "a number is present". The failure mode this exists
    // to prevent is a plausible-looking value that is nobody's measurement.
    // 1:100,000 at its own preset width lands on z14 and delivers ~2030 px over
    // the 5.7639 in Letter-portrait map box, so ~352 dpi.
    expect(result.deliveredDpi!.min).toBeCloseTo(352, 0);
    expect(result.deliveredDpi!.max).toBeCloseTo(352, 0);
    expect(result.deliveredDpi!.panels).toBe(1);
    // And the substantive claim: what was DELIVERED is not what was ASKED FOR.
    // The preset's panel width is derived to request exactly PRINT_DPI_TARGET, and
    // the crop is never resampled down, so the delivered figure overshoots by
    // wherever the page fell relative to a zoom boundary. If these two were equal
    // the number would be recomputable from the request and would not need
    // recording at all — recording it is only worth anything because they differ.
    const preset = SCALE_PRESETS.find((s) => s.id === "1-100000")!;
    const requested = effectiveDpi(
      panelWidthPxFor(preset, LETTER_PORTRAIT),
      mapBoxInches(LETTER_PORTRAIT).widthIn,
    );
    expect(requested).toBeCloseTo(PRINT_DPI_TARGET, 0);
    expect(result.deliveredDpi!.min).toBeGreaterThan(requested);
  });

  it("[BEHAVIORAL] reports the spread across a mixed-scale atlas, not one figure", async () => {
    // A zoom ladder puts three scales in one book, and they do not print at the
    // same resolution. An average would be a number no page in the atlas prints
    // at; the min is the one that decides whether the target was met.
    const result = await renderAndCaptureResult({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      basemap: true,
      locations: [{ center: { lng: -98, lat: 41 } }],
      zoomLevels: ["1-100000", "1-50000", "usgs-7-5-min"],
      tableOfContents: false,
    });

    expect(result.deliveredDpi).toBeDefined();
    expect(result.deliveredDpi!.panels).toBe(3);
    expect(result.deliveredDpi!.max).toBeGreaterThan(result.deliveredDpi!.min);
  });

  it("[CONTROL] reports no resolution for a render that drew no basemap", async () => {
    // Undefined, not 0. A render with no panels has no delivered resolution, and
    // a zero there would be a measurement nobody made — the fabrication this
    // field exists to replace.
    const result = await renderAndCaptureResult({
      mode: "location",
      center: { lng: -98, lat: 41 },
      scalePresetId: "1-100000",
      tier: 1,
      basemap: false,
    });

    expect(result.deliveredDpi).toBeUndefined();
  });
});
