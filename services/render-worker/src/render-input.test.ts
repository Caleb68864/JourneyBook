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

async function worker(options: {
  generatedDir: string;
  cacheDir?: string;
  tileBaseUrlAllowlist?: readonly string[];
}): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(renderRoute, {
    generatedDir: options.generatedDir,
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    ...(options.tileBaseUrlAllowlist ? { tileBaseUrlAllowlist: options.tileBaseUrlAllowlist } : {}),
  });
  await app.ready();
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A tile proxy base for the two cache tests below.
 *
 * A routable NAME, not the loopback literal these used to carry: the worker now
 * refuses non-routable destinations from a request body outright, so
 * `http://127.0.0.1:9/tiles` is a 400 before any tile is fetched and the
 * `[CONTROL]` below stops seeing a tile write at all. It caught that when the
 * guard landed, which is what it is for. These two tests are about where tiles
 * are WRITTEN, not where they come from, and `fetch` is stubbed, so nothing
 * leaves the process either way.
 */
const PROXY_BASE = "http://tiles.example.com/tiles";

/**
 * Accept a render and wait for its job to leave `rendering`.
 *
 * Needed since the job protocol (ADR 0007): `POST /render` returns as soon as
 * the job is accepted, so a test that asserts on what the render DID — tiles
 * written, a PDF on disk — must wait for the render rather than for the reply.
 * Without this the two cache tests below both "passed" by observing a render
 * that had not started, which is a control reporting success on nothing.
 */
async function renderAndSettle(app: FastifyInstance, payload: object): Promise<void> {
  const accepted = await app.inject({ method: "POST", url: "/render", payload });
  if (accepted.statusCode !== 202) return;
  const { jobId } = accepted.json();
  for (let i = 0; i < 600; i++) {
    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    if (res.statusCode !== 200) return;
    if (res.json().state !== "rendering") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${jobId} never settled`);
}

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
      await renderAndSettle(app, { ...validLocation, basemap: true, tileBaseUrl: PROXY_BASE });
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
      await renderAndSettle(app, {
        ...validLocation,
        basemap: true,
        tileBaseUrl: PROXY_BASE,
        cacheDir: callerChosen,
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
    // Added to the C# wire payload alongside `basemap` (F08). Kept here because
    // this fixture's whole job is to be the shape the real client emits — a copy
    // that lags the client stops being a control the moment it does.
    panelWidthPx: 1730,
    panelFormat: "jpeg",
    panelQuality: 90,
  };

  it("[CONTROL] accepts the exact payload the C# API sends", async () => {
    const generatedDir = tempDir("gen");
    const app = await worker({ generatedDir });
    try {
      const res = await app.inject({ method: "POST", url: "/render", payload: apiWirePayload });
      // 202 since the job protocol (ADR 0007): the worker accepts the render
      // and answers with a job id. The control is unchanged in what it proves —
      // the real API payload is accepted, field for field.
      expect(res.statusCode, `rejected the real API payload: ${res.body}`).toBe(202);
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

/**
 * Where an unauthenticated request body may send this process.
 *
 * `tileBaseUrl` was guarded by `^https?://` alone, in the schema and in the
 * engine. That admits every host reachable from the compose network —
 * `http://db:5432/`, `http://api:8080/api/admin/...`,
 * `http://169.254.169.254/latest/meta-data/` — and the only thing standing
 * between a caller and those was that the worker's port is `expose`d rather
 * than published. The audit is explicit that this is a deployment accident and
 * not a control.
 *
 * Every refusal here is paired with an acceptance, and the acceptances are the
 * load-bearing half: the worker's ONE real caller sends
 * `http://api:8080/api/tiles`, a private hostname, and a guard tuned by
 * "private means dangerous" would refuse it and take every tile-proxied render
 * down.
 */
describe("render-worker POST /render — where the worker may fetch tiles from", () => {
  /** Never actually fetched: every case below is decided before the render starts. */
  const withTileBase = (tileBaseUrl: string) => ({ ...validLocation, basemap: true, tileBaseUrl });

  async function post(
    payload: Record<string, unknown>,
    options: { tileBaseUrlAllowlist?: readonly string[] } = {},
  ): Promise<{ statusCode: number; error: string }> {
    const generatedDir = tempDir("gen");
    stubTileFetch();
    const app = await worker({ generatedDir, ...options });
    try {
      const res = await app.inject({ method: "POST", url: "/render", payload });
      const body = res.body ? (JSON.parse(res.body) as { error?: string }) : {};
      return { statusCode: res.statusCode, error: body.error ?? "" };
    } finally {
      await app.close();
    }
  }

  it("[CONTROL] accepts the tile proxy the C# API actually sends", async () => {
    // Not a 200 — the stubbed tile bytes are not an image, so the render itself
    // fails downstream. What matters is that it was not refused at the boundary,
    // which is what the message says.
    const res = await post(withTileBase("http://api:8080/api/tiles"));
    expect(res.error, `refused the API's own tile proxy: ${res.error}`).not.toContain("tileBaseUrl");
  });

  it("[CONTROL] accepts a public tile server", async () => {
    const res = await post(withTileBase("https://basemap.nationalmap.gov/arcgis/rest/services"));
    expect(res.error).not.toContain("tileBaseUrl");
  });

  it("refuses the cloud metadata address", async () => {
    const res = await post(withTileBase("http://169.254.169.254/latest/meta-data/"));
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain("non-routable");
  });

  it("refuses loopback however it is spelled", async () => {
    for (const bad of [
      "http://127.0.0.1:9/tiles",
      "http://2130706433/tiles",
      "http://0177.0.0.1/tiles",
      "http://[::1]:9/tiles",
      "http://localhost:5180/api/tiles",
    ]) {
      const res = await post(withTileBase(bad));
      expect(res.statusCode, bad).toBe(400);
      expect(res.error, bad).toContain("non-routable");
    }
  });

  it("refuses another service on the private network by literal address", async () => {
    const res = await post(withTileBase("http://10.0.0.7:5432/"));
    expect(res.statusCode).toBe(400);
  });

  it("refuses embedded credentials", async () => {
    const res = await post(withTileBase("http://user:pass@tiles.example.com/t"));
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain("credentials");
  });

  it("refuses a host the operator's allowlist does not name", async () => {
    const res = await post(withTileBase("https://tiles.evil.example/t"), {
      tileBaseUrlAllowlist: ["http://api:8080/api/tiles"],
    });
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain("allowlist");
  });

  it("[CONTROL] accepts what the allowlist does name, including a loopback proxy", async () => {
    for (const [base, allowed] of [
      ["http://api:8080/api/tiles", "http://api:8080/api/tiles"],
      // The escape hatch has to work, or this is a deny-all with extra words.
      ["http://127.0.0.1:5180/api/tiles", "http://127.0.0.1:5180/api/tiles"],
    ] as const) {
      const res = await post(withTileBase(base), { tileBaseUrlAllowlist: [allowed] });
      expect(res.error, `${base} was refused: ${res.error}`).not.toContain("tileBaseUrl");
    }
  });
});
