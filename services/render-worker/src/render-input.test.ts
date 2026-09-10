import { describe, it, expect, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRoute } from "./render-route.js";

/**
 * The worker's request body IS the engine's `RenderAtlasInput`, and the route
 * used to spread it into `renderAtlas` verbatim after hand-checking four fields.
 * Everything else on that interface was therefore caller-controlled — including
 * `cacheDir`, which reaches `storeCachedTile` in `@journeybook/map-sources` and
 * `mkdir -p`s + writes tile bytes at any absolute path the caller names.
 *
 * These cases are three halves of one claim and only mean something together:
 *
 *  - `writes tiles under the cache directory the OPERATOR configured` is the
 *    positive control. It proves the detector below can see a tile write at all.
 *    Without it, "no files appeared outside" is satisfied by a probe that never
 *    rendered, never fetched, and would not have noticed a write if one happened.
 *  - `writes nothing under a cacheDir the CALLER named` is the exploit probe. It
 *    passed trivially before the fix in the wrong direction: the directory was
 *    populated.
 *  - `refuses cacheDir by name` pins WHY, so a future refactor that stops reading
 *    the body's cacheDir by accident is not mistaken for this guard.
 */

/** Every file under `dir`, recursively, as paths relative to it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string, prefix: string): void => {
    for (const entry of readdirSync(at)) {
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
      else out.push(`${prefix}${entry}`);
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Serve every tile request with bytes. They are deliberately NOT a valid image:
 * the cache write happens the moment a fetch returns bytes, well before sharp
 * mosaics them, so garbage is enough to exercise the write path and saves this
 * package a `sharp` dependency it does not otherwise have.
 */
function stubTileFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const tempDirs: string[] = [];
function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `jb-${tag}-`));
  tempDirs.push(dir);
  return dir;
}

async function worker(options: { generatedDir: string; cacheDir?: string }): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(renderRoute, {
    generatedDir: options.generatedDir,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
  });
  await app.ready();
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A minimal valid render, small enough to keep the stubbed tile count sane. */
const validLocation = {
  mode: "location" as const,
  center: { lng: -96.7, lat: 40.8 },
  scalePresetId: "usgs-7-5-min",
  tier: 1,
  outputPath: "loc.pdf",
};

describe("render-worker POST /render — the tile cache root is the operator's, not the caller's", () => {
  it("[CONTROL] writes tiles under the cache directory the operator configured", async () => {
    const generatedDir = tempDir("gen");
    const cacheDir = tempDir("operator-cache");
    stubTileFetch();

    const app = await worker({ generatedDir, cacheDir });
    try {
      await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, basemap: true, tileBaseUrl: "http://127.0.0.1:9/tiles" },
      });
    } finally {
      await app.close();
    }

    // The render itself fails (the stubbed bytes are not an image); the cache
    // write happens first, which is the whole point of this control.
    expect(filesUnder(cacheDir).length, "the detector never saw a tile write").toBeGreaterThan(0);
  });

  it("writes nothing under a cacheDir the caller named", async () => {
    const generatedDir = tempDir("gen");
    const operatorCache = tempDir("operator-cache");
    const callerChosen = tempDir("caller-chosen");
    stubTileFetch();

    const app = await worker({ generatedDir, cacheDir: operatorCache });
    try {
      await app.inject({
        method: "POST",
        url: "/render",
        payload: {
          ...validLocation,
          basemap: true,
          tileBaseUrl: "http://127.0.0.1:9/tiles",
          cacheDir: callerChosen,
        },
      });
    } finally {
      await app.close();
    }

    expect(filesUnder(callerChosen), "the request chose where tiles were written").toEqual([]);
  });

  it("refuses cacheDir by name rather than quietly ignoring it", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, cacheDir: "/var/lib/anything" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("cacheDir");
    } finally {
      await app.close();
    }
  });
});

describe("render-worker POST /render — schema at the boundary", () => {
  /**
   * The must-be-ACCEPTED control for a refusing guard. This is the exact wire
   * shape `HttpRenderWorkerClient.ToWirePayload` emits (bbox branch, with
   * locations, landmarks, margins and orientation) — the only client the worker
   * has. A schema that refuses this refuses every real render, which is how an
   * over-strict guard takes production down while every negative case stays
   * green.
   */
  const apiWirePayload = {
    mode: "bbox",
    bbox: [-96.75, 40.78, -96.65, 40.85],
    locations: [
      {
        center: { lng: -96.7, lat: 40.8 },
        label: "Trailhead",
        scalePresetId: "usgs-7-5-min",
        pin: { shape: "circle", color: "#ff0000" },
        notes: "park here",
        zoomLevels: ["1-100000", "usgs-7-5-min"],
      },
    ],
    scalePresetId: "usgs-7-5-min",
    tier: 2,
    overlap: 0.05,
    basemap: false,
    outputPath: "nested/atlas.pdf",
    tileBaseUrl: "http://api:8080/api/tiles",
    tileSourceId: "usgs-topo",
    route: false,
    landmarks: [{ lng: -96.7, lat: 40.8, name: "Water tower", category: "landmark", score: 3 }],
    tableOfContents: true,
    overview: true,
    referenceGrid: true,
    notes: true,
    cover: false,
    orientation: "portrait",
    margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 },
  };

  it("[CONTROL] accepts the exact payload the C# API sends", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({ method: "POST", url: "/render", payload: apiWirePayload });
      expect(res.statusCode, `rejected the real API payload: ${res.body}`).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("refuses a field that is on neither the engine's interface nor the wire", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, whateverThisIs: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("whateverThisIs");
    } finally {
      await app.close();
    }
  });

  it("refuses a well-named field of the wrong type before the engine sees it", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, tier: "two" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("refuses a tileBaseUrl that is not http(s) at the boundary", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, tileBaseUrl: "file:///etc" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("refuses a panelWidthPx past the engine's own ceiling", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/render",
        payload: { ...validLocation, panelWidthPx: 40000 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
