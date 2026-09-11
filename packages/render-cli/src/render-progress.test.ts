import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAtlas, RenderCancelledError, type RenderProgress } from "./render.js";

/**
 * Per-page progress and cooperative cancellation — the two things ADR 0006
 * recorded as *not delivered*, and the reason a render that takes minutes could
 * only ever say "Rendering…".
 *
 * These tests run the real engine with a stubbed `fetch`, so the basemap loop —
 * the only place in a render where the time actually goes — genuinely executes.
 * A version of this file that turned the basemap off would exercise neither the
 * per-page report nor the between-pages cancel check, and would pass on a render
 * that has no pages to be between.
 */

/**
 * A real, valid 256x256 PNG (solid colour), built by hand rather than by sharp —
 * `render-cli` does not depend on sharp, and stubbing every tile to a 404 would
 * test the encode path over a panel with no map in it.
 */
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

/**
 * Replace only the *network* half of `fetch`.
 *
 * A blanket stub is wrong here and fails loudly: `@react-pdf`'s yoga layout
 * engine loads its WebAssembly through `fetch` on a `data:` URL, so a stub that
 * answers every call with a PNG hands yoga a PNG where a wasm module should be
 * and every render dies in the PDF writer. Anything that is not an http(s) URL
 * goes to the real implementation.
 */
function stubFetch(tileResponder: () => Promise<Response>): void {
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (typeof url !== "string" || !/^https?:/i.test(url)) {
        return real(url as RequestInfo, init);
      }
      return tileResponder();
    }),
  );
}

/** Every tile request answers with a real PNG. */
function stubTiles(): void {
  stubFetch(async () => new Response(new Uint8Array(TILE_PNG), { status: 200 }));
}

/** Every tile request fails the way an unreachable tile source does. */
function stubTileOutage(): void {
  stubFetch(() => {
    throw new Error("fetch failed: ECONNREFUSED");
  });
}

/**
 * A bbox that is definitely more than one page at 1:24,000, so "one report per
 * page" has something to be wrong about. `panelWidthPx: 256` keeps each panel to
 * a handful of tiles.
 */
const MULTI_PAGE_INPUT = {
  mode: "bbox" as const,
  bbox: [-96.75, 40.78, -96.65, 40.86] as [number, number, number, number],
  scalePresetId: "usgs-7-5-min",
  tier: 1 as const,
  basemap: true,
  panelWidthPx: 256,
};

function withTempDir<T>(name: string, fn: (out: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), name));
  return fn(join(dir, "atlas.pdf")).finally(() => rmSync(dir, { recursive: true, force: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderAtlas progress reporting", () => {
  it("[BEHAVIORAL] reports one panel event per page, in order, up to the page count", async () => {
    stubTiles();
    await withTempDir("jb-progress-", async (out) => {
      const events: RenderProgress[] = [];
      const res = await renderAtlas({ ...MULTI_PAGE_INPUT, outputPath: out, onProgress: (p) => events.push(p) });

      // Vacuity guard. Every assertion below is satisfied trivially by a
      // one-page atlas, which is exactly the shape that would let "reports per
      // page" pass while reporting once, ever.
      expect(res.pageCount).toBeGreaterThan(1);

      const panels = events.filter((e) => e.phase === "panel");
      expect(panels.map((e) => e.page)).toEqual(
        Array.from({ length: res.pageCount }, (_, i) => i + 1),
      );
      expect(panels.map((e) => e.pageId)).toEqual(res.contract.pages.map((p) => p.id));
      for (const e of panels) expect(e.pageCount).toBe(res.pageCount);
    });
  });

  it("[BEHAVIORAL] announces the page count before any page is drawn", async () => {
    stubTiles();
    await withTempDir("jb-progress-first-", async (out) => {
      const events: RenderProgress[] = [];
      const res = await renderAtlas({ ...MULTI_PAGE_INPUT, outputPath: out, onProgress: (p) => events.push(p) });

      // A progress bar needs a denominator before the numerator moves. Without
      // this event the client shows "0 of 0" for the whole contract phase.
      expect(events[0]).toEqual({ phase: "contract", page: 0, pageCount: res.pageCount });
    });
  });

  it("[BEHAVIORAL] ends at pdf then done, both at the full page count", async () => {
    stubTiles();
    await withTempDir("jb-progress-end-", async (out) => {
      const events: RenderProgress[] = [];
      const res = await renderAtlas({ ...MULTI_PAGE_INPUT, outputPath: out, onProgress: (p) => events.push(p) });

      const phases = events.map((e) => e.phase);
      expect(phases[phases.length - 2]).toBe("pdf");
      expect(phases[phases.length - 1]).toBe("done");
      expect(events[events.length - 1]).toEqual({
        phase: "done",
        page: res.pageCount,
        pageCount: res.pageCount,
      });
    });
  });

  it("still reports the page count when there is no basemap to fetch", async () => {
    await withTempDir("jb-progress-nobasemap-", async (out) => {
      const events: RenderProgress[] = [];
      const res = await renderAtlas({
        ...MULTI_PAGE_INPUT,
        basemap: false,
        outputPath: out,
        onProgress: (p) => events.push(p),
      });
      // Honest rather than flattering: with no tiles to fetch there is no
      // per-page work, so there are no per-page events and the render goes
      // straight from contract to pdf.
      expect(events.filter((e) => e.phase === "panel")).toHaveLength(0);
      expect(events[0]?.pageCount).toBe(res.pageCount);
      expect(events[events.length - 1]?.phase).toBe("done");
    });
  });

  it("[CONTROL — must be accepted] a render with no onProgress still succeeds", async () => {
    stubTiles();
    await withTempDir("jb-progress-control-", async (out) => {
      const res = await renderAtlas({ ...MULTI_PAGE_INPUT, outputPath: out });
      expect(res.pageCount).toBeGreaterThan(1);
      expect(existsSync(out)).toBe(true);
    });
  });
});

describe("renderAtlas cancellation", () => {
  it("[BEHAVIORAL] an already-aborted signal stops before any page is drawn and writes no PDF", async () => {
    stubTiles();
    await withTempDir("jb-cancel-early-", async (out) => {
      const controller = new AbortController();
      controller.abort();

      const err = await renderAtlas({
        ...MULTI_PAGE_INPUT,
        outputPath: out,
        signal: controller.signal,
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(RenderCancelledError);
      expect((err as RenderCancelledError).page).toBe(0);
      expect(existsSync(out)).toBe(false);
    });
  });

  it("[BEHAVIORAL] aborting after the first page stops there and says how far it got", async () => {
    stubTiles();
    await withTempDir("jb-cancel-mid-", async (out) => {
      const controller = new AbortController();
      let panelsSeen = 0;

      const err = await renderAtlas({
        ...MULTI_PAGE_INPUT,
        outputPath: out,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase !== "panel") return;
          panelsSeen += 1;
          if (panelsSeen === 1) controller.abort();
        },
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(RenderCancelledError);
      const cancelled = err as RenderCancelledError;
      expect(cancelled.page).toBe(1);
      expect(cancelled.pageCount).toBeGreaterThan(1);
      // The count is the point: a cancel that cannot say where it stopped is
      // indistinguishable from a cancel that never reached the work.
      expect(cancelled.message).toContain(`1 of ${cancelled.pageCount}`);
      // No further pages were fetched after the abort.
      expect(panelsSeen).toBe(1);
      expect(existsSync(out)).toBe(false);
    });
  });

  it("[BEHAVIORAL] a cancel is reported as a cancel, not as a basemap tile failure", async () => {
    stubTiles();
    await withTempDir("jb-cancel-not-tile-", async (out) => {
      const controller = new AbortController();
      const err = await renderAtlas({
        ...MULTI_PAGE_INPUT,
        outputPath: out,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === "panel") controller.abort();
        },
      }).catch((e: unknown) => e);

      // This is the trap this codebase has fallen into three times: one broken
      // invariant surfacing as another's failure. The panel loop wraps every
      // throw as "Failed to fetch basemap tile panel", which the worker
      // classifies as 502 — so before the rethrow, pressing Cancel told the user
      // the map server was unreachable.
      expect(err).toBeInstanceOf(RenderCancelledError);
      expect((err as Error).message).not.toContain("Failed to fetch basemap tile panel");
    });
  });

  it("[CONTROL — must still fail as a tile failure] a genuine outage is not reported as a cancel", async () => {
    stubTileOutage();
    await withTempDir("jb-cancel-control-", async (out) => {
      const err = await renderAtlas({ ...MULTI_PAGE_INPUT, outputPath: out }).catch((e: unknown) => e);

      // The acceptance control for the rethrow above: it must let a real tile
      // failure keep its own diagnostic, which is what the worker's classifier
      // matches on to answer 502 rather than 500.
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(RenderCancelledError);
      expect((err as Error).message).toContain("Failed to fetch basemap tile panel");
    });
  });
});
