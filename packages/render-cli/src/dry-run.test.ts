import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { measurePdfPages } from "@journeybook/pdf-client";
import { runCli } from "./cli.js";
import { planAtlasRender, renderAtlas, type RenderAtlasInput } from "./render.js";

/**
 * `render --dry-run` answers "how many pages, and how many tiles?" without a render.
 * A preview that disagrees with the render is worse than none, so the plan is held to
 * what a real render does: the fetches it makes and the pages in the PDF it writes.
 */

// A valid 256x256 PNG, as in render-progress.test.ts.
const TILE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAElEQVR42u3TMQ0AAAgEsVfMjAhEM6OBJlVwyaWn4K1IgAHAAGAA" +
  "MAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAA" +
  "MAAYAAwABgADgAHAAGAADKACBgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAY" +
  "AAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAG" +
  "AAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABVMAAYAAwABgADAAGAAOA" +
  "AcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOA" +
  "AcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABg" +
  "ADAAGAAMAAYAA4ABwABgADAAGAAMANcCwUIVr6HMf/cAAAAASUVORK5CYII=";

const TILE_PNG = Buffer.from(TILE_PNG_BASE64, "base64");

/** Stubs network fetches only (yoga loads wasm through fetch) and returns the URLs seen. */
function stubTiles(): string[] {
  const urls: string[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (typeof url !== "string" || !/^https?:/i.test(url)) {
        return real(url as Parameters<typeof fetch>[0], init);
      }
      urls.push(url);
      return new Response(new Uint8Array(TILE_PNG), { status: 200 });
    }),
  );
  return urls;
}

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; text: string }> {
  const out: string[] = [];
  const write = stdout.write.bind(stdout);
  stdout.write = ((s: string) => {
    out.push(String(s));
    return true;
  }) as typeof stdout.write;
  try {
    return { code: await run(), text: out.join("") };
  } finally {
    stdout.write = write;
  }
}

const BBOX = [-96.73, 40.79, -96.67, 40.83] as const;

describe("planAtlasRender agrees with a real render", () => {
  afterEach(() => vi.unstubAllGlobals());

  const cases: { name: string; input: Omit<RenderAtlasInput, "outputPath"> }[] = [
    {
      name: "a grid plus a location, with overview and contents",
      input: {
        mode: "bbox",
        bbox: [...BBOX],
        locations: [{ center: { lng: -96.7, lat: 40.8 }, label: "Home" }],
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        basemap: true,
      },
    },
    {
      name: "a mixed-scale zoom ladder, which sizes each page's panel differently",
      input: {
        mode: "location",
        center: { lng: -96.7, lat: 40.8 },
        locations: [{ center: { lng: -96.7, lat: 40.8 }, label: "Home" }],
        zoomLevels: ["1-100000", "usgs-7-5-min"],
        scalePresetId: "1-100000",
        tier: 2,
        basemap: true,
      },
    },
    {
      name: "a title page",
      input: {
        mode: "bbox",
        bbox: [...BBOX],
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        basemap: true,
        explorerName: "Ada",
      },
    },
    {
      name: "front matter turned off",
      input: {
        mode: "bbox",
        bbox: [...BBOX],
        scalePresetId: "usgs-7-5-min",
        tier: 2,
        basemap: true,
        overview: false,
        tableOfContents: false,
      },
    },
  ];

  for (const { name, input } of cases) {
    it(`predicts the fetches and the PDF page count: ${name}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "jb-dry-run-"));
      try {
        const outputPath = join(dir, "a.pdf");
        const plan = planAtlasRender({ ...input, outputPath });
        const urls = stubTiles();

        const result = await renderAtlas({ ...input, outputPath });

        expect(plan.tiles).toBe(urls.length);
        expect(plan.uniqueTiles).toBe(new Set(urls).size);
        expect(plan.pages.map((p) => p.id)).toEqual(result.contract.pages.map((p) => p.id));
        expect(plan.pdfPages).toBe(measurePdfPages(readFileSync(outputPath)).length);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 120_000);
  }
});

describe("journeybook render --dry-run", () => {
  afterEach(() => vi.unstubAllGlobals());

  const geometry = ["--bbox", BBOX.join(","), "--scale", "usgs-7-5-min"];

  it("reports the plan with no network and no file, and needs no --out", async () => {
    const urls = stubTiles();
    const dir = mkdtempSync(join(tmpdir(), "jb-dry-run-"));
    try {
      const outputPath = join(dir, "a.pdf");
      const { code, text } = await captureStdout(() =>
        runCli(["render", ...geometry, "--basemap", "--dry-run", "--out", outputPath]),
      );

      expect(code).toBe(0);
      expect(urls).toEqual([]);
      expect(existsSync(outputPath)).toBe(false);
      expect(text).toMatch(/^Dry run/);
      expect(text).toMatch(/^ {2}A1 {2}.*z16 {2}\d+ tiles {2}~\d+ dpi$/m);
      expect(text).toMatch(/^Estimated tiles: [1-9]\d* requests, [1-9]\d* distinct/m);

      const noOut = await captureStdout(() => runCli(["render", ...geometry, "--dry-run"]));
      expect(noOut.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says there are no tiles to fetch without --basemap", async () => {
    const { code, text } = await captureStdout(() => runCli(["render", ...geometry, "--dry-run"]));
    expect(code).toBe(0);
    expect(text).toContain("Estimated tiles: 0 (no --basemap)");
    expect(text).not.toMatch(/\d+ tiles {2}~/);
  });

  it("refuses an atlas over the page cap the way a render would", async () => {
    const stderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const code = await runCli(["render", "--bbox", "-110,30,-90,45", "--scale", "usgs-7-5-min", "--dry-run"]);
      expect(code).toBe(2);
    } finally {
      process.stderr.write = stderrWrite;
    }
  });
});
