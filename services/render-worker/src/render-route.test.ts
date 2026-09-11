import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRoute } from "./render-route.js";
import type { JobRecord } from "./jobs.js";

/**
 * A real, valid 256x256 PNG (solid colour). Basemap renders are the only ones
 * with pages to be *between*, so they are the only ones a cancel can land in the
 * middle of — a `basemap: false` render reaches its last cancellation checkpoint
 * before the accepting response has even been written.
 */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACAElEQVR42u3TMQ0AAAgEsVfMjAhEM6OBJlVwyaWn4K1IgAHAAGAA" +
    "MAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAA" +
    "MAAYAAwABgADgAHAAGAADKACBgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAY" +
    "AAwABgADgAHAAGAAMAAYAAwABgADgAHAAGAAMAAYAAwABgADgAEwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAG" +
    "AAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADIABVMAAYAAwABgADAAGAAOA" +
    "AcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOAAcAAYAAwABgADAAGAAOA" +
    "AcAAYAAwAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABg" +
    "ADAAGAAMAAYAA4ABwABgADAAGAAMANcCwUIVr6HMf/cAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Answer tile requests with a PNG after `delayMs`, and let everything else
 * through to the real `fetch`.
 *
 * The passthrough is not politeness: `@react-pdf`'s yoga layout engine loads its
 * WebAssembly through `fetch` on a `data:` URL, so a blanket stub hands it a PNG
 * where a wasm module should be and every render dies in the PDF writer.
 */
function stubSlowTiles(delayMs: number): void {
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (typeof url !== "string" || !/^https?:/i.test(url)) {
        return real(url as Parameters<typeof fetch>[0], init);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      return new Response(new Uint8Array(TILE_PNG), { status: 200 });
    }),
  );
}

/**
 * The render-worker's job protocol (ADR 0007): `POST /render` accepts and
 * returns a job id, `GET /jobs/{id}` reports progress and outcome, and
 * `DELETE /jobs/{id}` stops the render.
 *
 * What did NOT move: everything that can be judged before a job exists is still
 * judged on this request and still answers 400 — the schema, the tile-base-URL
 * policy, `outputPath` confinement, and now the engine's own contract
 * assembly. A request that is wrong is wrong now, not in a job record someone
 * has to go and read.
 */
let app: FastifyInstance;
let genDir: string;

const validLocation = {
  mode: "location" as const,
  center: { lng: -96.7, lat: 40.8 },
  scalePresetId: "usgs-7-5-min",
  tier: 1,
};

/** Accept a render and wait for its job to leave `rendering`. */
async function renderAndSettle(payload: unknown): Promise<JobRecord> {
  const accepted = await app.inject({ method: "POST", url: "/render", payload: payload as object });
  expect(accepted.statusCode).toBe(202);
  const { jobId } = accepted.json();
  for (let i = 0; i < 600; i++) {
    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    expect(res.statusCode).toBe(200);
    const record = res.json() as JobRecord;
    if (record.state !== "rendering") return record;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job ${jobId} never left "rendering"`);
}

beforeAll(async () => {
  genDir = mkdtempSync(join(tmpdir(), "jb-worker-"));
  app = Fastify();
  await app.register(renderRoute, { generatedDir: genDir });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(genDir, { recursive: true, force: true });
});

describe("render-worker POST /render", () => {
  it("accepts a render with 202, a job id and a Location naming the job", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, outputPath: "accepted.pdf" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(typeof body.jobId).toBe("string");
    expect(body.state).toBe("rendering");
    expect(body.statusUrl).toBe(`/jobs/${body.jobId}`);
    expect(res.headers["location"]).toBe(`/jobs/${body.jobId}`);
    // The PDF is deliberately NOT asserted here: at the moment this reply is
    // written it does not exist, which is the entire point of the 202.
  });

  it("renders a location PDF and reports it on the job", async () => {
    const record = await renderAndSettle({ ...validLocation, outputPath: "loc.pdf" });
    expect(record.state).toBe("completed");
    expect(record.outputPath).toBe("loc.pdf");
    expect(record.pageCount).toBe(1);
    expect(typeof record.attribution).toBe("string");
    expect(existsSync(join(genDir, "loc.pdf"))).toBe(true);
  });

  it("rejects a traversal outputPath with 400 and writes nothing outside the dir", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, outputPath: "../escape.pdf" },
    });
    expect(res.statusCode).toBe(400);
    expect(existsSync(join(genDir, "..", "escape.pdf"))).toBe(false);
  });

  it("rejects an absolute outputPath with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, outputPath: "/tmp/evil.pdf" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing required fields with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      // scalePresetId omitted
      payload: { mode: "location", center: { lng: -96.7, lat: 40.8 }, tier: 1, outputPath: "x.pdf" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("[BEHAVIORAL] still refuses an unknown scale preset with 400, not with an accepted job", async () => {
    // This used to be a 400 because the render happened inside the request. With
    // the job protocol it would have become a 202 followed by a failed job, which
    // is a worse answer to a request that was simply wrong — so the route runs
    // the engine's own contract assembly synchronously first.
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, scalePresetId: "does-not-exist", outputPath: "x.pdf" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("scalePresetId");
  });

  it("rejects an out-of-range tier as an input error (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, tier: 9, outputPath: "x.pdf" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("[BEHAVIORAL] refuses an extent over the page cap with 400 before accepting a job", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: {
        mode: "bbox",
        bbox: [-99, 39, -96, 42],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        outputPath: "huge.pdf",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pages/i);
  });
});

describe("render-worker job protocol", () => {
  it("[BEHAVIORAL] reports per-page progress while the render is in flight", async () => {
    // A multi-page atlas with no basemap: the engine reports the page count in
    // its `contract` event before anything is drawn, which is the number a
    // progress bar needs first.
    const record = await renderAndSettle({
      mode: "bbox",
      bbox: [-96.75, 40.78, -96.65, 40.86],
      scalePresetId: "usgs-7-5-min",
      tier: 1,
      basemap: false,
      outputPath: "progress.pdf",
    });
    expect(record.state).toBe("completed");
    expect(record.pageCount).toBeGreaterThan(1);
    expect(record.page).toBe(record.pageCount);
    expect(record.phase).toBe("done");
  });

  it("answers 404 for a job id it has never seen", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs/00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(404);
  });

  it("answers 404 to a DELETE for an unknown job", async () => {
    const res = await app.inject({ method: "DELETE", url: "/jobs/not-a-job" });
    expect(res.statusCode).toBe(404);
  });

  it("[CONTROL — must be accepted] a DELETE that arrives after the render finished says so", async () => {
    const record = await renderAndSettle({ ...validLocation, outputPath: "late-cancel.pdf" });
    expect(record.state).toBe("completed");

    const del = await app.inject({ method: "DELETE", url: `/jobs/${record.id}` });
    // A cancel that cancelled nothing must not claim to have cancelled
    // something; the caller gets the real state back.
    expect(del.statusCode).toBe(200);
    expect((del.json() as JobRecord).state).toBe("completed");
  });

  it("[BEHAVIORAL] refuses a render beyond the active-job bound with 429", async () => {
    const bounded = Fastify();
    const dir = mkdtempSync(join(tmpdir(), "jb-worker-bound-"));
    try {
      await bounded.register(renderRoute, { generatedDir: dir, maxActiveJobs: 1 });
      await bounded.ready();

      const big = {
        mode: "bbox" as const,
        bbox: [-96.8, 40.7, -96.6, 40.9],
        scalePresetId: "usgs-7-5-min",
        tier: 1,
        basemap: false,
      };
      const first = await bounded.inject({ method: "POST", url: "/render", payload: { ...big, outputPath: "a.pdf" } });
      expect(first.statusCode).toBe(202);
      const second = await bounded.inject({ method: "POST", url: "/render", payload: { ...big, outputPath: "b.pdf" } });
      expect(second.statusCode).toBe(429);

      await bounded.inject({ method: "DELETE", url: `/jobs/${first.json().jobId}` });
    } finally {
      await bounded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Cancellation of a render that is genuinely in flight.
 *
 * These need a basemap, because a basemap render is the only one with pages to
 * be *between*: the engine's cancellation checkpoints sit either side of each
 * panel fetch, and a `basemap: false` render passes its last one before the
 * accepting 202 has been written. Tiles are stubbed and slowed so the window is
 * real rather than a race.
 */
describe("render-worker cancel, mid-render", () => {
  let slowApp: FastifyInstance;
  let slowDir: string;

  const IN_FLIGHT = {
    mode: "bbox" as const,
    bbox: [-96.75, 40.78, -96.65, 40.86],
    scalePresetId: "usgs-7-5-min",
    tier: 1,
    basemap: true,
    panelWidthPx: 256,
  };

  async function settle(jobId: string): Promise<JobRecord> {
    for (let i = 0; i < 900; i++) {
      const res = await slowApp.inject({ method: "GET", url: `/jobs/${jobId}` });
      const r = res.json() as JobRecord;
      if (r.state !== "rendering") return r;
      await new Promise((t) => setTimeout(t, 20));
    }
    throw new Error(`job ${jobId} never settled`);
  }

  beforeAll(async () => {
    stubSlowTiles(40);
    slowDir = mkdtempSync(join(tmpdir(), "jb-worker-slow-"));
    slowApp = Fastify();
    await slowApp.register(renderRoute, { generatedDir: slowDir });
    await slowApp.ready();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await slowApp.close();
    rmSync(slowDir, { recursive: true, force: true });
  });

  it("[BEHAVIORAL] reports pages finishing while the job is still rendering", async () => {
    const accepted = await slowApp.inject({
      method: "POST",
      url: "/render",
      payload: { ...IN_FLIGHT, outputPath: "inflight.pdf" },
    });
    const { jobId } = accepted.json();

    let sawRenderingWithPageCount = false;
    let record: JobRecord | null = null;
    for (let i = 0; i < 900; i++) {
      const r = (await slowApp.inject({ method: "GET", url: `/jobs/${jobId}` })).json() as JobRecord;
      if (r.state === "rendering" && r.pageCount > 1) sawRenderingWithPageCount = true;
      if (r.state !== "rendering") {
        record = r;
        break;
      }
      await new Promise((t) => setTimeout(t, 20));
    }

    // The whole argument for putting progress on the worker: it must be readable
    // WHILE the render is happening. A report only visible once the job is
    // terminal is a report of a finished render, which is what "Completed"
    // already said.
    expect(sawRenderingWithPageCount).toBe(true);
    expect(record?.state).toBe("completed");
    expect(record?.pageCount).toBeGreaterThan(1);
  });

  it("[BEHAVIORAL] DELETE stops the render and records it as cancelled, not failed", async () => {
    const accepted = await slowApp.inject({
      method: "POST",
      url: "/render",
      payload: { ...IN_FLIGHT, outputPath: "cancelled.pdf" },
    });
    expect(accepted.statusCode).toBe(202);
    const { jobId } = accepted.json();

    const del = await slowApp.inject({ method: "DELETE", url: `/jobs/${jobId}` });
    expect(del.statusCode).toBe(200);

    const record = await settle(jobId);

    // `cancelled`, not `failed`. The API turns this into PdfStatus.Cancelled, and
    // the whole reason the state exists is that "the user pressed Cancel" and
    // "the render broke" are different things to be told.
    expect(record.state).toBe("cancelled");
    expect(record.errorKind).toBe("cancelled");
    expect(record.error).toMatch(/cancelled/i);
    // And it must NOT have been reported as a tile problem — the panel loop's
    // wrapper would otherwise restate it as a basemap fetch failure, which the
    // API classifies as an upstream outage.
    expect(record.error).not.toContain("Failed to fetch basemap tile panel");
    // A cancelled render left nothing on disk to download.
    expect(record.outputPath).toBeUndefined();
    expect(existsSync(join(slowDir, "cancelled.pdf"))).toBe(false);
  });
});
