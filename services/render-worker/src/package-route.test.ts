import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageRoute, type PackageJobRecord } from "./package-route.js";

/** A real 256 px PNG; the package refuses anything that is not a raster tile. */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let app: FastifyInstance;
let dir: string;
const tileCalls: string[] = [];

beforeAll(async () => {
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!/^https?:/i.test(url)) return real(input, init);
      tileCalls.push(url);
      return new Response(new Uint8Array(TILE_PNG), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  dir = mkdtempSync(join(tmpdir(), "jb-packages-"));
  app = Fastify();
  await app.register(packageRoute, { packagesDir: dir });
  await app.ready();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const BODY = { bbox: [-96.71, 40.81, -96.69, 40.82], minZoom: 10, maxZoom: 11 };

async function settle(id: string): Promise<PackageJobRecord> {
  for (let i = 0; i < 500; i++) {
    const r = (await app.inject({ method: "GET", url: `/package-jobs/${id}` })).json() as PackageJobRecord;
    if (r.state !== "packaging") return r;
    await new Promise((t) => setTimeout(t, 20));
  }
  throw new Error("package job never settled");
}

describe("render-worker POST /package", () => {
  it("[BEHAVIORAL] accepts a package as a job and writes a readable archive into the packages folder", async () => {
    const res = await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "ne/lincoln.pmtiles" } });
    expect(res.statusCode).toBe(202);
    const job = res.json() as PackageJobRecord;
    expect(res.headers["location"]).toBe(`/package-jobs/${job.id}`);

    const done = await settle(job.id);
    expect(done.state).toBe("completed");
    expect(done.tileType).toBe("png");
    const file = join(dir, "ne", "lincoln.pmtiles");
    // PMTiles v3 header, read by hand (this package does not depend on map-sources):
    // magic at 0, addressed tiles u64 at 72, min/max zoom bytes at 100/101.
    const archive = readFileSync(file);
    expect(archive.subarray(0, 7).toString("latin1")).toBe("PMTiles");
    expect(archive[100]).toBe(10);
    expect(archive[101]).toBe(11);
    expect(Number(archive.readBigUInt64LE(72))).toBe(done.tiles);
    expect(done.bytes).toBe(readFileSync(file).length);
    // No temp file left behind.
    expect(readdirSync(join(dir, "ne")).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("refuses to overwrite an existing package, to escape the folder, or a bad body", async () => {
    writeFileSync(join(dir, "taken.pmtiles"), "x");
    expect((await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "taken.pmtiles" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "../escape.pmtiles" } })).statusCode).toBe(400);
    expect(existsSync(join(dir, "..", "escape.pmtiles"))).toBe(false);
    expect((await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "atlas.pdf" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "a.pmtiles", tileBaseUrl: "http://127.0.0.1/api/tiles" } })).statusCode).toBe(400);
  });

  it("records a package that fails (too many tiles) as failed, and writes nothing", async () => {
    const res = await app.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "big.pmtiles", maxTiles: 1 } });
    const done = await settle((res.json() as PackageJobRecord).id);
    expect(done.state).toBe("failed");
    expect(done.error).toMatch(/over the limit of 1/);
    expect(existsSync(join(dir, "big.pmtiles"))).toBe(false);
  });

  it("answers 503 when this worker has no packages folder", async () => {
    const bare = Fastify();
    await bare.register(packageRoute, {});
    await bare.ready();
    try {
      expect((await bare.inject({ method: "POST", url: "/package", payload: { ...BODY, outputName: "a.pmtiles" } })).statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });

  it("404s a job it has never heard of", async () => {
    expect((await app.inject({ method: "GET", url: "/package-jobs/nope" })).statusCode).toBe(404);
  });
});
