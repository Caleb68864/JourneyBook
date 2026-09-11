import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BBox, LngLat } from "@journeybook/atlas-core";
import {
  SCALE_PRESETS,
  LETTER_PORTRAIT,
  mapBoxInches,
  buildLocationPage,
  effectiveDpi,
  panelWidthPxForDpi,
  panelWidthPxFor,
  PRINT_DPI_TARGET,
  type PageSpec,
  type ScalePreset,
} from "@journeybook/atlas-core";
import {
  TILE_SIZE,
  lngLatToGlobalPixel,
  groundResolutionMetersPerPixel,
  zoomForBBox,
  tileRangeForBBox,
  lngLatToPanelFraction,
} from "./tilemath.js";
import { USGS_TOPO } from "./panel.js";
import type { PrintResolutionTable } from "./print-resolution.js";

/**
 * The printed map box, from the engine that computes it. The previous version of
 * this file hardcoded `5.763888888888889 // mapBoxInches(LETTER_PORTRAIT)` two
 * lines below an import of the package that computes it — a fresh copy of a
 * constant, in a file written to stop constants being copied.
 */
const MAP_BOX_WIDTH_IN = mapBoxInches(LETTER_PORTRAIT).widthIn;

/** The render pipeline's default `--panel-px` (`render.ts`). */
const DEFAULT_PANEL_WIDTH_PX = 1000;

describe("web mercator tile math", () => {
  it("centres (0,0) at z0", () => {
    const p = lngLatToGlobalPixel(0, 0, 0);
    expect(p.x).toBeCloseTo(128, 6);
    expect(p.y).toBeCloseTo(128, 6);
  });

  it("maps -180 lng to x=0 and 180 to the world width", () => {
    expect(lngLatToGlobalPixel(-180, 0, 0).x).toBeCloseTo(0, 6);
    expect(lngLatToGlobalPixel(180, 0, 1).x).toBeCloseTo(TILE_SIZE * 2, 6);
  });

  it("ground resolution at the equator/z0 is ~156543 m/px", () => {
    expect(groundResolutionMetersPerPixel(0, 0)).toBeCloseTo(156543.03, 0);
  });

  it("ground resolution halves each zoom level", () => {
    expect(groundResolutionMetersPerPixel(0, 1)).toBeCloseTo(156543.03 / 2, 1);
  });

  it("zoomForBBox increases with the target pixel width", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    expect(zoomForBBox(bbox, 2048)).toBeGreaterThan(zoomForBBox(bbox, 256));
  });

  /**
   * The assertion above was, for a long time, the ONLY thing said about the
   * function that decides the printed map's resolution: a relative comparison
   * that any monotone function satisfies. Returning one zoom coarser — half the
   * linear resolution, a quarter of the pixels — left 239 of 239 TS tests green.
   * `panel.test.ts`'s "leaves a request within the ceiling exactly where it was"
   * asserts `zoom < maxZoom` and `zoomClamped === false`, both still true one
   * level down.
   *
   * Pin what the function is defined to be, and then pin the number the print
   * actually depends on.
   */
  describe("zoomForBBox is the SMALLEST zoom that meets the target", () => {
    const widthPxAt = (bbox: BBox, zoom: number): number => {
      const midLat = (bbox[1] + bbox[3]) / 2;
      return (
        lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
      );
    };

    const cases: BBox[] = [
      [-98.05, 40.95, -97.95, 41.05], // 0.1° near 41°N
      [-98.020888, 40.97907, -97.979112, 41.020926], // one 1:24,000 Letter page
      [-0.01, 51.5, 0.01, 51.52], // small, near the prime meridian
      [-125, 24, -66, 49], // continental
      [-0.5, 60.0, 0.5, 61.0], // high latitude
    ];

    it("[BEHAVIORAL] meets the target and would miss it one level coarser", () => {
      for (const bbox of cases) {
        for (const target of [256, 512, 1000, 2048, 4096]) {
          const zoom = zoomForBBox(bbox, target);

          expect(widthPxAt(bbox, zoom), `bbox ${bbox} target ${target}: z${zoom} too coarse`)
            .toBeGreaterThanOrEqual(target);

          // The half that a monotone-only test cannot see: one level coarser must
          // NOT have met the target, or the function is handing back a softer map
          // than was asked for.
          if (zoom > 0) {
            expect(
              widthPxAt(bbox, zoom - 1),
              `bbox ${bbox} target ${target}: z${zoom - 1} would have done`,
            ).toBeLessThan(target);
          }
        }
      }
    });

    /**
     * The print-resolution number itself. `renderMapPanel` crops at native tile
     * resolution — it does not resample to `targetWidthPx` — so the delivered
     * panel is `widthPxAt(zoom)`, and the effective DPI is that over the printed
     * map box (5.7639 in at Letter portrait). One zoom coarser halves it.
     */
    it("[BEHAVIORAL] a 1:24,000 Letter page at the default panel width lands on z16", () => {
      const page: BBox = [-98.020888, 40.97907, -97.979112, 41.020926];

      const zoom = zoomForBBox(page, 1000);
      // Also the ceiling USGS Topo actually has tiles for (USGS_TOPO.maxZoom),
      // which is why the render has zero headroom here.
      expect(zoom).toBe(16);

      const dpi = widthPxAt(page, zoom) / MAP_BOX_WIDTH_IN;
      expect(dpi).toBeGreaterThan(330);
      expect(dpi).toBeLessThan(345);

      // What "one zoom coarser" costs a printed page.
      expect(widthPxAt(page, zoom - 1) / MAP_BOX_WIDTH_IN).toBeLessThan(175);
    });
  });

  /**
   * Print resolution, per scale preset, as a property rather than an accident.
   *
   * The first version of this guard covered **1:24,000 only** — the single preset
   * that clears 300 DPI — and nothing pinned the other four or asserted a minimum
   * anywhere. Measured against the real engine, the delivered resolution swings by
   * nearly 2x across the scale menu at the default panel width:
   *
   *   usgs-7-5-min (1:24,000)  z16  1947 px  338 DPI
   *   1-25000                  z15  1014 px  176 DPI
   *   usgs-15-min (1:62,500)   z14  1268 px  220 DPI
   *   1-50000                  z14  1014 px  176 DPI
   *   1-100000                 z13  1015 px  176 DPI
   *
   * None of that is a property of the product. `renderMapPanel` crops at native
   * tile resolution and never resamples, so `targetWidthPx` is a **floor** and the
   * delivered panel is 1x-2x it — the DPI is decided by where each preset's page
   * happens to land relative to a Web-Mercator zoom boundary. 1:24,000 passes only
   * because its page falls 1.95x past one; 1:25,000, a 4% change in scale, drops
   * off a 1.92x cliff to 176.
   *
   * The default of 1000 px over a 5.7639 in map box is a request for **173 DPI**.
   * Nothing anywhere asked for 300.
   */
  describe("print resolution per scale preset", () => {
    const widthPxAt = (bbox: BBox, zoom: number): number => {
      const midLat = (bbox[1] + bbox[3]) / 2;
      return (
        lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
      );
    };

    const CENTER: LngLat = { lng: -98.0, lat: 41.0 };
    /** USGS Topo's deepest zoom — the ceiling this render has to live inside. */
    const USGS_TOPO_MAX_ZOOM = 16;

    /** Delivered DPI for one preset at one target width, through the real engine. */
    function delivered(scale: (typeof SCALE_PRESETS)[number], targetPx: number) {
      const page = buildLocationPage(CENTER, scale, LETTER_PORTRAIT, "L1");
      const wanted = zoomForBBox(page.bbox, targetPx);
      const zoom = Math.min(wanted, USGS_TOPO_MAX_ZOOM);
      return {
        zoom,
        clamped: wanted > USGS_TOPO_MAX_ZOOM,
        widthPx: widthPxAt(page.bbox, zoom),
        dpi: effectiveDpi(widthPxAt(page.bbox, zoom), MAP_BOX_WIDTH_IN),
      };
    }

    it("guards all five presets, not just the one that passes", () => {
      // If SCALE_PRESETS grows, this test must be extended rather than silently
      // continue to describe five of six.
      expect(SCALE_PRESETS.map((s) => s.id)).toEqual([
        "usgs-7-5-min",
        "1-25000",
        "usgs-15-min",
        "1-50000",
        "1-100000",
      ]);
    });

    /**
     * The current state of the product, pinned by value so the swing is visible in
     * the suite instead of being discovered by measurement every few months. These
     * are NOT approvals of 176 DPI — see the case below for the target.
     */
    it("[BEHAVIORAL] pins today's delivered DPI at the default panel width", () => {
      const expected: Record<string, { zoom: number; dpi: number }> = {
        "usgs-7-5-min": { zoom: 16, dpi: 338 },
        "1-25000": { zoom: 15, dpi: 176 },
        "usgs-15-min": { zoom: 14, dpi: 220 },
        "1-50000": { zoom: 14, dpi: 176 },
        "1-100000": { zoom: 13, dpi: 176 },
      };

      for (const scale of SCALE_PRESETS) {
        const got = delivered(scale, DEFAULT_PANEL_WIDTH_PX);
        const want = expected[scale.id]!;
        expect(got.zoom, `${scale.id} zoom`).toBe(want.zoom);
        expect(Math.round(got.dpi), `${scale.id} DPI`).toBe(want.dpi);
      }
    });

    /**
     * The finding the roadmap had backwards. It said the 300 DPI target "needs a
     * deeper basemap, not a bigger number", scheduled against Stage 7. It needs a
     * bigger number and no deeper basemap: `panelWidthPxForDpi(mapBox, 300)` = 1730
     * clears 300 DPI at **every** preset, and every one of them still lands inside
     * USGS Topo's z16 ceiling — nothing is clamped, so no preset renders softer
     * than it asked for.
     *
     * Measured cost of raising the default, through the real `renderMapPanel`
     * against a local tile server: at 1:24,000 — the default scale — it is **free**
     * (same z16, same 99 tiles, same bytes). At the other four it is ~3.1-3.3x the
     * tiles, ~3.8-4.7x the render time and ~4x the panel bytes. That trade is the
     * owner's to make; this test only fixes what is true.
     */
    it("[BEHAVIORAL] a 300 DPI target is reachable at every preset inside the z16 ceiling", () => {
      const target = panelWidthPxForDpi(MAP_BOX_WIDTH_IN, PRINT_DPI_TARGET);
      expect(target).toBe(1730);

      for (const scale of SCALE_PRESETS) {
        const got = delivered(scale, target);
        expect(got.dpi, `${scale.id} at ${target}px: ${got.dpi.toFixed(0)} DPI`)
          .toBeGreaterThanOrEqual(PRINT_DPI_TARGET);
        expect(got.clamped, `${scale.id} needs a zoom USGS Topo does not have`).toBe(false);
        expect(got.zoom, `${scale.id} exceeds the USGS Topo ceiling`).toBeLessThanOrEqual(
          USGS_TOPO_MAX_ZOOM,
        );
      }
    });

    /**
     * And the mechanism behind the swing, stated once: the target is a floor, the
     * delivered width is 1x-2x it, and that ratio is what the DPI actually is.
     */
    it("[BEHAVIORAL] the target width is a floor, and the delivered panel is 1x-2x it", () => {
      for (const target of [DEFAULT_PANEL_WIDTH_PX, panelWidthPxForDpi(MAP_BOX_WIDTH_IN)]) {
        for (const scale of SCALE_PRESETS) {
          const got = delivered(scale, target);
          if (got.clamped) continue; // a clamped panel is allowed to be softer
          const ratio = got.widthPx / target;
          expect(ratio, `${scale.id} at ${target}px delivered ${got.widthPx}px`).toBeGreaterThanOrEqual(1);
          expect(ratio, `${scale.id} at ${target}px delivered ${got.widthPx}px`).toBeLessThan(2);
        }
      }
    });
  });

  it("tileRangeForBBox returns a well-ordered tile range", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    const r = tileRangeForBBox(bbox, 14);
    expect(r.maxX).toBeGreaterThanOrEqual(r.minX);
    expect(r.maxY).toBeGreaterThanOrEqual(r.minY);
  });

  it("lngLatToPanelFraction maps the bbox corners and centre (top-left origin, v down)", () => {
    const bbox: BBox = [-98.05, 40.95, -97.95, 41.05];
    const [west, south, east, north] = bbox;

    // SW corner -> ≈[0, 1]
    const sw = lngLatToPanelFraction({ lng: west, lat: south }, bbox);
    expect(sw[0]).toBeCloseTo(0, 2);
    expect(sw[1]).toBeCloseTo(1, 2);

    // NE corner -> ≈[1, 0]
    const ne = lngLatToPanelFraction({ lng: east, lat: north }, bbox);
    expect(ne[0]).toBeCloseTo(1, 2);
    expect(ne[1]).toBeCloseTo(0, 2);

    // Centre -> ≈[0.5, 0.5]
    const centre = lngLatToPanelFraction(
      { lng: (west + east) / 2, lat: (south + north) / 2 },
      bbox,
    );
    expect(centre[0]).toBeCloseTo(0.5, 2);
    expect(centre[1]).toBeCloseTo(0.5, 2);
  });
});

/**
 * Delivered print resolution once each preset asks for its OWN panel width.
 *
 * The suite above pins what the flat 1000 px default delivered. This block pins
 * what the per-preset widths deliver, and — the part nothing in this repo had
 * ever measured — how much of that is a property of the product versus an
 * artefact of the one point everything was measured at.
 *
 * Two hidden variables were being held constant by the fixture:
 *
 *  - **Latitude.** Web Mercator ground resolution scales with cos(lat), so a page
 *    of fixed ground size spans a different number of tile pixels at a different
 *    latitude and `zoomForBBox` can pick a different zoom for the same preset at
 *    the same target width. Delivered DPI is only ever guaranteed to fall in
 *    `[target/box, 2 x target/box)`; WHERE in that band is an accident. Every
 *    "1:24,000 prints at 338 DPI" statement in this repo is a statement about
 *    41 degrees N. Its real band across the USGS Topo latitude range is in the
 *    generated table (`apps/web/src/generated/print-resolution.json`), and is
 *    deliberately NOT restated here — see the block at the end of this file.
 *  - **Orientation.** Landscape has an 8.2639 in map box instead of 5.7639 in, so
 *    a flat pixel count is a weaker DPI request there. That is why the preset's
 *    number goes through `panelWidthPxFor` rather than being used raw.
 */
describe("delivered print resolution at each preset's own panel width", () => {
  const widthPxAt = (bbox: BBox, zoom: number): number => {
    const midLat = (bbox[1] + bbox[3]) / 2;
    return (
      lngLatToGlobalPixel(bbox[2], midLat, zoom).x - lngLatToGlobalPixel(bbox[0], midLat, zoom).x
    );
  };

  /** USGS Topo's deepest zoom — the ceiling every one of these renders lives inside. */
  const USGS_TOPO_MAX_ZOOM = 16;
  const LETTER_LANDSCAPE: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };

  /**
   * The USGS Topo coverage band, in degrees north: Puerto Rico / Hawaii at the
   * low end, northern Alaska at the high end. Sampling outside it would pin
   * numbers for pages this basemap has no tiles for.
   */
  const US_LAT_MIN = 18;
  const US_LAT_MAX = 72;

  function deliveredAt(scale: ScalePreset, page: PageSpec, lat: number, targetOverride?: number) {
    const boxW = mapBoxInches(page).widthIn;
    const bbox = buildLocationPage({ lng: -98, lat }, scale, page, "L1").bbox;
    // Default: what the render pipeline actually asks for. An override lets a
    // case measure a width the product does NOT use — e.g. the flat-width
    // counterfactual below — without pretending the preset carries it.
    const target = targetOverride ?? panelWidthPxFor(scale, page);
    const wanted = zoomForBBox(bbox, target);
    const zoom = Math.min(wanted, USGS_TOPO_MAX_ZOOM);
    return {
      target,
      zoom,
      clamped: wanted > USGS_TOPO_MAX_ZOOM,
      dpi: effectiveDpi(widthPxAt(bbox, zoom), boxW),
    };
  }

  /** Min/max delivered DPI across the coverage band, and whether anything clamped. */
  function band(scale: ScalePreset, page: PageSpec, targetOverride?: number) {
    let min = Infinity;
    let max = -Infinity;
    let clampedAnywhere = false;
    let samples = 0;
    for (let lat = US_LAT_MIN; lat <= US_LAT_MAX; lat += 0.25) {
      const got = deliveredAt(scale, page, lat, targetOverride);
      min = Math.min(min, got.dpi);
      max = Math.max(max, got.dpi);
      clampedAnywhere ||= got.clamped;
      samples++;
    }
    return { min, max, clampedAnywhere, samples };
  }

  it("[CONTROL] the latitude sweep actually sweeps", () => {
    // Every band assertion below is vacuously true over an empty sweep, and an
    // empty sweep is one typo away (a `<` for a `<=`, a step of 0). 217 samples
    // at 0.25 deg over 18-72 deg.
    const swept = band(SCALE_PRESETS[0]!, LETTER_PORTRAIT);
    expect(swept.samples).toBe(217);
    expect(swept.max).toBeGreaterThan(swept.min);
  });

  /**
   * The decision, pinned by value at the point everything else in this repo is
   * measured at (41 deg N, Letter portrait): four presets raised, one left alone.
   */
  it("[BEHAVIORAL] pins each preset's width, zoom and delivered DPI at 41N portrait", () => {
    const expected: Record<string, { target: number; zoom: number; dpi: number }> = {
      "usgs-7-5-min": { target: 1000, zoom: 16, dpi: 338 },
      "1-25000": { target: 1730, zoom: 16, dpi: 352 },
      "usgs-15-min": { target: 1730, zoom: 15, dpi: 440 },
      "1-50000": { target: 1730, zoom: 15, dpi: 352 },
      "1-100000": { target: 1730, zoom: 14, dpi: 352 },
    };
    for (const scale of SCALE_PRESETS) {
      const got = deliveredAt(scale, LETTER_PORTRAIT, 41);
      const want = expected[scale.id]!;
      expect(got.target, `${scale.id} target width`).toBe(want.target);
      expect(got.zoom, `${scale.id} zoom`).toBe(want.zoom);
      expect(Math.round(got.dpi), `${scale.id} DPI`).toBe(want.dpi);
    }
  });

  it("1:24,000 still renders exactly as it did — same width, same zoom, same DPI", () => {
    // Half two of the owner's decision, asserted on its own so a regression that
    // quietly widens the headline preset names itself.
    const got = deliveredAt(SCALE_PRESETS[0]!, LETTER_PORTRAIT, 41);
    expect(SCALE_PRESETS[0]!.id).toBe("usgs-7-5-min");
    expect(got.target).toBe(1000);
    expect(got.zoom).toBe(16);
    expect(Math.round(got.dpi)).toBe(338);
  });

  /**
   * Half one, as a PROPERTY rather than a single point: the three coarse presets
   * clear 300 DPI at every latitude USGS Topo covers, in BOTH orientations.
   * 1:25,000 is excluded here and pinned separately below — it is one of the two
   * presets the z16 ceiling stops short.
   */
  it("the raised presets that can clear 300 DPI do so across the whole coverage band", () => {
    for (const page of [LETTER_PORTRAIT, LETTER_LANDSCAPE]) {
      for (const id of ["usgs-15-min", "1-50000", "1-100000"]) {
        const scale = SCALE_PRESETS.find((s) => s.id === id)!;
        const got = band(scale, page);
        expect(
          got.min,
          `${id} ${page.orientation}: worst delivered ${got.min.toFixed(0)} DPI`,
        ).toBeGreaterThanOrEqual(PRINT_DPI_TARGET);
      }
    }
  });

  // Three cases that used to follow here pinned the portrait bands BY VALUE
  // (1:24,000 at "174-346", 1:25,000's floor at "279", a raised 1:24,000 at
  // "268"), sampled every 0.25 deg — while `model.ts` said "174-346 across
  // 18-72N" and the owner had been told "174-343 across 20-70N". Three hand-typed
  // statements of one measurement, over two latitude ranges, none checked against
  // the others. They now live in ONE generated table, and the portrait
  // assertions they made are made against it in the block at the end of this
  // file, including the two negatives.

  /**
   * Why the preset's number is rescaled instead of used raw. A flat 1730 px on a
   * landscape sheet is a 30% weaker DPI request, and clears 300 at no preset at
   * all — the exact silent-portrait-only pin this block exists to prevent.
   */
  it("a flat panel width would clear 300 DPI at no preset in landscape", () => {
    const flat = panelWidthPxForDpi(mapBoxInches(LETTER_PORTRAIT).widthIn, PRINT_DPI_TARGET);
    for (const scale of SCALE_PRESETS) {
      // Measured over the coverage band, not at one latitude: at 41 deg N a flat
      // 1730 px does clear 300 DPI for 1:24,000, which is precisely the kind of
      // single-point evidence this block exists to stop being mistaken for a
      // property.
      const got = band(scale, LETTER_LANDSCAPE, flat);
      expect(got.min, `${scale.id} at a flat ${flat}px landscape`).toBeLessThan(PRINT_DPI_TARGET);
    }
  });
});

/**
 * EVERY preset, at EVERY sampled latitude, against the checked-in table the scale
 * picker reads (N-5).
 *
 * The first DPI guard in this file pinned 1:24,000 at the default width — the
 * one preset of five that happened to clear 300 DPI at the one latitude it was
 * measured at. The table (`apps/web/src/generated/print-resolution.json`,
 * written by `scripts/generate-print-resolution.mjs`) is now the single statement
 * of what each preset delivers, and it reaches a user before they print. So it is
 * the thing that has to be right, and this block checks it three ways:
 *
 *  1. **Row by row against the engine**, recomputed here through the primitives
 *     (`buildLocationPage`, `zoomForBBox`, the USGS Topo ceiling, `effectiveDpi`)
 *     rather than through the builder that wrote the table — so a builder bug
 *     cannot agree with itself.
 *  2. **The summary figures against the rows**, so a band, a cliff or a
 *     below-target count the picker quotes cannot drift from the samples under it.
 *  3. **The properties the product depends on**, including the two negatives this
 *     file used to pin by hand: if USGS ever ships z17, those fail here, and
 *     someone re-reads the paragraph instead of inheriting the caveat.
 *
 * `pnpm check:print-resolution` catches the complementary failure — an engine
 * change that leaves the committed table stale.
 */
describe("the generated print-resolution table is what the engine delivers", () => {
  const TABLE_PATH = fileURLToPath(
    new URL("../../../apps/web/src/generated/print-resolution.json", import.meta.url),
  );

  /** Read per test, so a missing table fails as a test rather than as a crashed suite. */
  function loadTable(): PrintResolutionTable {
    expect(existsSync(TABLE_PATH), `no generated table at ${TABLE_PATH}`).toBe(true);
    return JSON.parse(readFileSync(TABLE_PATH, "utf8")) as PrintResolutionTable;
  }

  const MAP_BOX_IN = mapBoxInches(LETTER_PORTRAIT).widthIn;
  const CEILING = USGS_TOPO.maxZoom!;

  /** Delivered resolution of a Letter-portrait page centred at `lat`, from first principles. */
  function engineAt(scale: ScalePreset, lat: number, targetPx: number) {
    const bbox = buildLocationPage({ lng: -98, lat }, scale, LETTER_PORTRAIT, "L1").bbox;
    const wanted = zoomForBBox(bbox, targetPx);
    const zoom = Math.min(wanted, CEILING);
    const widthPx = Math.round(
      lngLatToGlobalPixel(bbox[2], lat, zoom).x - lngLatToGlobalPixel(bbox[0], lat, zoom).x,
    );
    return { zoom, clamped: wanted > CEILING, dpi: effectiveDpi(widthPx, MAP_BOX_IN) };
  }

  const presetIn = (table: PrintResolutionTable, id: string) => {
    const row = table.presets.find((p) => p.id === id);
    expect(row, `table has no row for ${id}`).toBeDefined();
    return row!;
  };

  it("covers every scale preset, in menu order, at the width each one actually asks for", () => {
    const table = loadTable();
    expect(table.presets.map((p) => p.id)).toEqual(SCALE_PRESETS.map((s) => s.id));
    expect(table.targetDpi).toBe(PRINT_DPI_TARGET);
    expect(table.basemap.maxZoom).toBe(CEILING);
    for (const scale of SCALE_PRESETS) {
      const row = presetIn(table, scale.id);
      expect(row.label).toBe(scale.label);
      expect(row.panelWidthPx, `${scale.id} width`).toBe(panelWidthPxFor(scale, LETTER_PORTRAIT));
    }
  });

  it("[CONTROL] samples every whole degree of the USGS Topo band, for every preset", () => {
    // Every assertion below is vacuously true over an empty sample list.
    const table = loadTable();
    const { from, to, step } = table.latitudes;
    expect(step).toBe(1);
    const expected: number[] = [];
    for (let lat = from; lat <= to; lat += step) expected.push(lat);
    expect(expected.length).toBeGreaterThan(40);
    for (const row of table.presets) {
      expect(row.samples.map((s) => s.lat), `${row.id} latitudes`).toEqual(expected);
    }
  });

  it("[BEHAVIORAL] every preset at every latitude: zoom, clamp and DPI match the engine", () => {
    const table = loadTable();
    let checked = 0;
    for (const scale of SCALE_PRESETS) {
      const row = presetIn(table, scale.id);
      for (const sample of row.samples) {
        const got = engineAt(scale, sample.lat, row.panelWidthPx);
        const where = `${scale.id} at ${sample.lat}N`;
        expect(sample.zoom, `${where} zoom`).toBe(got.zoom);
        expect(sample.clamped, `${where} clamped`).toBe(got.clamped);
        // Whole DPI, rounded once from the engine's value — what every surface shows.
        expect(sample.dpi, `${where}: engine ${got.dpi}`).toBe(Math.round(got.dpi));
        checked++;
      }
    }
    expect(checked).toBe(SCALE_PRESETS.length * loadTable().presets[0]!.samples.length);
  });

  it("[BEHAVIORAL] each preset's figures at a 300 DPI request match the engine too", () => {
    const table = loadTable();
    const request = panelWidthPxForDpi(MAP_BOX_IN, PRINT_DPI_TARGET);
    for (const scale of SCALE_PRESETS) {
      const row = presetIn(table, scale.id).atTargetRequest;
      expect(row.panelWidthPx).toBe(request);
      const swept = presetIn(table, scale.id).samples.map((s) => ({
        lat: s.lat,
        ...engineAt(scale, s.lat, request),
      }));
      const worst = swept.reduce((a, b) => (b.dpi < a.dpi ? b : a));
      expect(row.minDpi, `${scale.id} floor at ${request}px`).toBe(Math.round(worst.dpi));
      expect(row.minDpiLat).toBe(worst.lat);
      expect(row.clampedLats).toEqual(swept.filter((s) => s.clamped).map((s) => s.lat));
    }
  });

  it("[BEHAVIORAL] the figures the picker quotes are the rows' own extremes", () => {
    const table = loadTable();
    for (const row of table.presets) {
      const dpis = row.samples.map((s) => s.dpi);
      expect(row.minDpi, `${row.id} min`).toBe(Math.min(...dpis));
      expect(row.maxDpi, `${row.id} max`).toBe(Math.max(...dpis));
      expect(row.samples.find((s) => s.lat === row.minDpiLat)!.dpi).toBe(row.minDpi);
      expect(row.samples.find((s) => s.lat === row.maxDpiLat)!.dpi).toBe(row.maxDpi);
      expect(row.belowTargetLats).toEqual(
        row.samples.filter((s) => s.dpi < PRINT_DPI_TARGET).map((s) => s.lat),
      );
      expect(row.clampedLats).toEqual(row.samples.filter((s) => s.clamped).map((s) => s.lat));

      // The steepest one-degree fall, as a ratio, over every adjacent pair.
      let steepest = { fromLat: NaN, fromDpi: 0, toLat: NaN, toDpi: 0, ratio: 1 };
      for (let i = 1; i < row.samples.length; i++) {
        const a = row.samples[i - 1]!;
        const b = row.samples[i]!;
        for (const [hi, lo] of [[a, b], [b, a]] as const) {
          const ratio = hi.dpi / lo.dpi;
          if (ratio > steepest.ratio) {
            steepest = { fromLat: hi.lat, fromDpi: hi.dpi, toLat: lo.lat, toDpi: lo.dpi, ratio };
          }
        }
      }
      expect(row.steepestStep, `${row.id} steepest step`).toEqual({
        fromLat: steepest.fromLat,
        fromDpi: steepest.fromDpi,
        toLat: steepest.toLat,
        toDpi: steepest.toDpi,
      });
    }
  });

  /**
   * The mechanism, as a property of every row: an unclamped page gets at least
   * what it asked for and less than twice that. Where it sits in that band is
   * the accident the picker has to disclose.
   */
  it("[BEHAVIORAL] an unclamped page delivers between 1x and 2x its requested DPI", () => {
    const table = loadTable();
    for (const row of table.presets) {
      const requested = effectiveDpi(row.panelWidthPx, MAP_BOX_IN);
      expect(row.requestedDpi).toBe(Math.round(requested));
      for (const s of row.samples) {
        if (s.clamped) continue;
        // Rounding is monotone, so the true bounds survive it as these.
        expect(s.dpi, `${row.id} at ${s.lat}N`).toBeGreaterThanOrEqual(Math.round(requested));
        expect(s.dpi, `${row.id} at ${s.lat}N`).toBeLessThanOrEqual(Math.round(2 * requested));
      }
    }
  });

  /**
   * A preset asking for 300 DPI misses it ONLY where USGS Topo runs out of zoom.
   * That is what makes "the raised presets clear 300 DPI" true where it is true,
   * and it is the honest limit of that claim where it is not.
   */
  it("[BEHAVIORAL] a raised preset falls below 300 DPI only where the z16 ceiling clamps it", () => {
    const table = loadTable();
    const raised = table.presets.filter((p) => p.requestedDpi >= PRINT_DPI_TARGET);
    expect(raised.map((p) => p.id)).toEqual(["1-25000", "usgs-15-min", "1-50000", "1-100000"]);
    for (const row of raised) {
      for (const lat of row.belowTargetLats) {
        expect(row.clampedLats, `${row.id} is below target at ${lat}N without being clamped`).toContain(lat);
      }
    }
  });

  /**
   * The two negatives, kept as negatives. `1-25000` asks for 300 DPI and still
   * cannot reach it in the south of the coverage band, because USGS Topo has no
   * z17; and `usgs-7-5-min`, raised to that same request, would be stopped by the
   * same ceiling. If a deeper basemap ever arrives, the regenerated table flips
   * these and this fails — which is the point.
   */
  it("[BEHAVIORAL] the z16 ceiling stops 1:25,000 short, and would stop a raised 1:24,000", () => {
    const table = loadTable();
    const r25 = presetIn(table, "1-25000");
    expect(r25.belowTargetLats.length, "1-25000 unexpectedly clears 300 DPI everywhere").toBeGreaterThan(0);
    expect(r25.clampedLats.length).toBeGreaterThan(0);

    const r24 = presetIn(table, "usgs-7-5-min");
    expect(r24.atTargetRequest.minDpi, "a raised 1:24,000 would clear 300 DPI everywhere").toBeLessThan(
      PRINT_DPI_TARGET,
    );
    expect(r24.atTargetRequest.clampedLats).toContain(r24.atTargetRequest.minDpiLat);
  });

  /**
   * The default preset, stated as what it is: a band that straddles the target,
   * with a cliff inside it. `338 at 41N` is a point on it, not a property.
   */
  it("[BEHAVIORAL] the default preset straddles 300 DPI and can halve within one degree", () => {
    const row = presetIn(loadTable(), "usgs-7-5-min");
    expect(row.minDpi).toBeLessThan(PRINT_DPI_TARGET);
    expect(row.maxDpi).toBeGreaterThan(PRINT_DPI_TARGET);
    expect(row.steepestStep.fromDpi / row.steepestStep.toDpi).toBeGreaterThan(1.9);
    expect(Math.abs(row.steepestStep.toLat - row.steepestStep.fromLat)).toBe(1);
    expect(row.samples.find((s) => s.lat === 41)!.dpi).toBe(338);
  });
});
