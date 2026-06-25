import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRoute } from "./render-route.js";

/**
 * Verifies the render-worker POST /render contract (SS-02): a valid request
 * writes a PDF and returns a volume-relative path; path traversal and absolute
 * paths are rejected (security); missing/invalid input returns 400.
 */
let app: FastifyInstance;
let genDir: string;

const validLocation = {
  mode: "location" as const,
  center: { lng: -96.7, lat: 40.8 },
  scalePresetId: "usgs-7-5-min",
  tier: 1,
};

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
  it("renders a location PDF and returns a volume-relative path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, outputPath: "loc.pdf" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outputPath).toBe("loc.pdf");
    expect(body.pageCount).toBe(1);
    expect(typeof body.attribution).toBe("string");
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

  it("rejects an unknown scale preset as an input error (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, scalePresetId: "does-not-exist", outputPath: "x.pdf" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an out-of-range tier as an input error (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { ...validLocation, tier: 9, outputPath: "x.pdf" },
    });
    expect(res.statusCode).toBe(400);
  });
});
