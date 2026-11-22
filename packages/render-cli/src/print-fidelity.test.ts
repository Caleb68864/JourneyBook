import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geodesicDistanceMeters, SCALE_PRESETS, type AtlasPage, type PageMargins } from "@journeybook/atlas-core";
import { mapBoxOf, measurePdfPages, type MeasuredBox, type MeasuredPage } from "@journeybook/pdf-client";
import { assembleContract, renderAtlas, type RenderAtlasInput } from "./render.js";

/**
 * Print fidelity through the WHOLE engine, at the page setups the UI exposes.
 *
 * `pdf-client/src/scale-fidelity.test.ts` measures a real PDF, but renders it through
 * `renderAtlasPdfToBuffer` with the default margins, no gutter, no overlap, one page and a
 * 4x4 flat panel stretched to the box. So two things were never checked end to end:
 *
 * 1. The scale bar against the ground through `renderAtlas` with non-default margins, gutter,
 *    landscape and overlap, which change both the printed map box and each page's bbox.
 * 2. That the embedded panel's PIXEL aspect equals the printed map box's aspect. The panel is
 *    painted at `width/height: 100%`, so a panel cropped to the wrong shape is stretched to
 *    fit and still prints: anisotropic scale, and it would pass every other test.
 *
 * Both are read back off the produced file: the bar's width and its printed label, the map
 * box, and each image XObject's /Width and /Height. Nothing here reuses the renderer's own
 * sizing (`niceScaleBar`, `mapBoxInches`), so a renderer that agrees with itself and not with
 * the ground fails.
 */

const SCALE = SCALE_PRESETS.find((p) => p.id === "usgs-7-5-min")!; // 1:24,000

/** A box that tiles into a few pages at every setup below. */
const BBOX: [number, number, number, number] = [-96.72, 40.79, -96.66, 40.83];

const WIDE: PageMargins = { top: 1, right: 1.25, bottom: 0.75, left: 1, gutter: 0.75 };

const SETUPS: { name: string; input: Partial<RenderAtlasInput> }[] = [
  { name: "defaults", input: {} },
  { name: "wide margins and a gutter", input: { margins: WIDE } },
  { name: "landscape", input: { orientation: "landscape" } },
  { name: "15% overlap", input: { overlap: 0.15 } },
  { name: "landscape, wide margins, gutter, 25% overlap", input: { orientation: "landscape", margins: WIDE, overlap: 0.25 } },
];

/** A real 256x256 PNG tile (the one `render.test.ts` uses; this package has no sharp). */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAACAElEQVR42u3TMQ0AAAgEsVfMjAhEM6OBJlVwyaWn4K1IgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAADKACBgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABVMAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMANcCwUIVr6HMf/cAAAAASUVORK5CYII=",
  "base64",
);

/** Answer tile requests; pass everything else (yoga's wasm `data:` URL) to the real fetch. */
function stubTiles(): void {
  const png = TILE_PNG;
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/^https?:/i.test(url)) return real(input, init);
      return new Response(new Uint8Array(png), { status: 200 });
    }),
  );
}

/**
 * Every colour image XObject's pixel size, in file order (react-pdf writes the panels in page
 * order). Read from each object's dictionary, the text between `N 0 obj` and its `stream`.
 * A grey image is an alpha mask, not a panel, and is skipped.
 */
function imagePixelSizes(pdf: Buffer): { width: number; height: number }[] {
  const raw = pdf.toString("latin1");
  const sizes: { width: number; height: number }[] = [];
  for (const m of raw.matchAll(/\d+\s+0\s+obj/g)) {
    const from = m.index! + m[0].length;
    const stream = raw.indexOf("stream", from);
    const endObj = raw.indexOf("endobj", from);
    if (stream < 0 || (endObj >= 0 && endObj < stream)) continue;
    const dict = raw.slice(from, stream);
    if (!/\/Subtype\s*\/Image\b/.test(dict) || /\/ColorSpace\s*\/DeviceGray\b/.test(dict)) continue;
    const w = /\/Width\s+(\d+)/.exec(dict);
    const h = /\/Height\s+(\d+)/.exec(dict);
    if (w && h) sizes.push({ width: Number(w[1]), height: Number(h[1]) });
  }
  return sizes;
}

/** The scale bar: a 6 pt bar inside a 7 pt SVG box at the same origin and width. */
function scaleBarOf(page: MeasuredPage): MeasuredBox | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  return page.rects
    .filter((r) => near(r.height, 6))
    .find((bar) =>
      page.rects.some((svg) => near(svg.height, 7) && near(svg.x, bar.x) && near(svg.y, bar.y) && near(svg.width, bar.width)),
    );
}

/**
 * The ground the bar's printed label claims, read off the page ("500 m", "1 km"). The label is
 * shown as more than one string ("1 " then "km"), so the strings on the row under the bar,
 * right of its "0", are joined in x order.
 */
function labelMeters(page: MeasuredPage, bar: MeasuredBox): number {
  const row = page.textItems.filter(
    (t) => t.y > bar.y && t.y < bar.y + 20 && t.x > bar.x + 1 && t.x < bar.x + bar.width + 40,
  );
  const baseline = Math.min(...row.map((t) => t.y));
  const text = row
    .filter((t) => Math.abs(t.y - baseline) < 0.5)
    .sort((x, y) => x.x - y.x)
    .map((t) => t.text)
    .join("")
    .trim();
  const m = /^(\d+(?:\.\d+)?)\s*(m|km)$/.exec(text);
  expect(m, `scale bar label not readable: "${text}"`).not.toBeNull();
  return Number(m![1]) * (m![2] === "km" ? 1000 : 1);
}

/** Width over height of a bbox in Web Mercator (spherical), from the bbox alone. */
function mercatorAspect([west, south, east, north]: readonly number[]): number {
  const y = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return (((east! - west!) * Math.PI) / 180) / (y(north!) - y(south!));
}

function groundWidthMeters(page: AtlasPage): number {
  const [west, south, east, north] = page.bbox;
  const midLat = (south + north) / 2;
  return geodesicDistanceMeters({ lng: west, lat: midLat }, { lng: east, lat: midLat });
}

function groundHeightMeters(page: AtlasPage): number {
  const [west, south, east, north] = page.bbox;
  const midLng = (west + east) / 2;
  return geodesicDistanceMeters({ lng: midLng, lat: south }, { lng: midLng, lat: north });
}

describe("print fidelity through renderAtlas, at every page setup the UI offers", { timeout: 120_000 }, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const setup of SETUPS) {
    it(`${setup.name}: true scale on both axes, a true scale bar, and an unstretched panel`, async () => {
      stubTiles();
      const input: RenderAtlasInput = {
        mode: "bbox",
        bbox: [...BBOX],
        scalePresetId: SCALE.id,
        tier: 2,
        basemap: true,
        panelWidthPx: 700,
        tableOfContents: false,
        overview: false,
        notes: false,
        outputPath: "",
        ...setup.input,
      };
      const { contract } = assembleContract(input);
      expect(contract.pages.length, "the setup should tile into more than one page").toBeGreaterThan(1);

      const dir = mkdtempSync(join(tmpdir(), "jb-print-fidelity-"));
      try {
        const out = join(dir, "atlas.pdf");
        await renderAtlas({ ...input, outputPath: out });
        const pdf = readFileSync(out);
        const pages = measurePdfPages(pdf);
        expect(pages).toHaveLength(contract.pages.length);

        // react-pdf writes identical image bytes once, and a uniform test tile makes every
        // same-sized panel identical, so there can be fewer images than pages. Every page of
        // one setup has the same map box, so each image is checked against that box below.
        const images = imagePixelSizes(pdf);
        expect(images.length, "no panel image in the PDF").toBeGreaterThan(0);
        const boxes = pages.map((m) => mapBoxOf(m, 1)!);
        for (const b of boxes) {
          expect(b.width).toBeCloseTo(boxes[0]!.width, 3);
          expect(b.height).toBeCloseTo(boxes[0]!.height, 3);
        }

        pages.forEach((measured, i) => {
          const page = contract.pages[i]!;
          const at = `${setup.name}, page ${page.id}`;
          const map = mapBoxOf(measured, 1)!;
          expect(map, `${at}: no map box`).toBeDefined();

          // 1. The page prints at its ratio on BOTH axes: ground off the bbox (geodesic),
          //    paper off the file.
          const ratioW = groundWidthMeters(page) / ((map.width / 72) * 0.0254);
          const ratioH = groundHeightMeters(page) / ((map.height / 72) * 0.0254);
          expect(Math.abs(ratioW / SCALE.ratio - 1), `${at}: width ratio ${ratioW}`).toBeLessThan(0.005);
          expect(Math.abs(ratioH / SCALE.ratio - 1), `${at}: height ratio ${ratioH}`).toBeLessThan(0.005);

          // 2. The bar is as long on paper as its printed label says, at this page's ratio.
          const bar = scaleBarOf(measured);
          expect(bar, `${at}: no scale bar`).toBeDefined();
          const claimed = labelMeters(measured, bar!);
          const barGround = (bar!.width / 72) * 0.0254 * SCALE.ratio;
          expect(Math.abs(barGround / claimed - 1), `${at}: bar ${barGround} m vs label ${claimed} m`).toBeLessThan(0.005);

        });

        // 3. No panel is cut to the wrong shape. Each panel must be exactly the Web Mercator
        //    crop of a page's bbox (computed here from the bbox, not by the engine), to within
        //    rounding. A crop from the wrong box, a fixed-shape panel, or a portrait crop on a
        //    landscape page is off by percent to tens of percent.
        //
        //    The crop is NOT expected to match the printed box's aspect exactly, and that is
        //    correct: EPSG:3857 treats the earth as a sphere, while the box is sized from true
        //    (ellipsoidal) ground, where east-west and north-south metres differ by N/M, about
        //    1.0039 at 41°N. The panel's corners land on the box edges (crop registration,
        //    `map-sources` `panel.test.ts`), so painting it at 100% spreads that 0.4% evenly.
        //    Pinned below as a bound, so a change in it is noticed.
        const mercatorAspects = contract.pages.map((page) => mercatorAspect(page.bbox));
        const box = boxes[0]!;
        for (const img of images) {
          const pixelAspect = img.width / img.height;
          const onePixel = 1 / Math.min(img.width, img.height);
          const nearest = Math.min(...mercatorAspects.map((a) => Math.abs(pixelAspect / a - 1)));
          expect(nearest, `${setup.name}: panel ${img.width}x${img.height} px is no page's Mercator crop`).toBeLessThanOrEqual(
            onePixel * 2,
          );
          const vsBox = Math.abs(pixelAspect / (box.width / box.height) - 1);
          expect(vsBox, `${setup.name}: panel vs printed box aspect`).toBeLessThan(0.006);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
