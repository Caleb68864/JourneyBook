#!/usr/bin/env node
/**
 * render-fidelity-check.mjs — Sub-Spec 6 fidelity check.
 *
 * Proves the browser/worker render path produces the same output as a direct
 * `renderAtlas` call, for one fixed input. The web app's Generate flow hands an
 * AtlasContract input to the C# API, which forwards it to the `render-worker`
 * (`POST /render`). This script exercises that same `renderAtlas` orchestration
 * two ways and compares the resulting PDFs:
 *
 *   (a) direct  — call `renderAtlas` in-process              -> out-direct.pdf
 *   (b) worker  — spawn the Fastify worker and POST /render  -> out-worker.pdf
 *
 * Comparison:
 *   1. Exact byte equality (preferred).
 *   2. If `@react-pdf` ever embeds a timestamp (or other intrinsic
 *      non-determinism) that breaks byte-equality, fall back to comparing
 *      page count + per-stream SHA-256 of every embedded PDF stream object
 *      (which includes the panel images when basemap rendering is enabled).
 *      See ADR 0005 for the documented timestamp caveat.
 *
 * Exit 0 on match, 1 on mismatch. The mode used ("exact" vs "page-count +
 * stream-hash") is printed so the result is unambiguous.
 *
 * The default fixed input is a location render with basemap disabled, so the
 * check is deterministic and needs no network/tile access. Set
 * JB_FIDELITY_BASEMAP=1 to exercise the basemap (panel-image) path; that
 * requires tile access via the Stage 3 proxy (JB_TILE_BASE_URL).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderAtlas } from "../packages/render-cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workerEntry = path.join(repoRoot, "services", "render-worker", "dist", "server.js");

// One fixed input shared by both render paths.
const basemap = process.env["JB_FIDELITY_BASEMAP"] === "1";
const FIXED_INPUT = {
  mode: "location",
  center: { lng: -98.5795, lat: 39.8283 }, // geographic center of the contiguous US
  scalePresetId: process.env["JB_FIDELITY_SCALE"] ?? "usgs-7-5-min",
  tier: 2,
  title: "Fidelity Check",
  basemap,
  ...(basemap && process.env["JB_TILE_BASE_URL"]
    ? { tileBaseUrl: process.env["JB_TILE_BASE_URL"] }
    : {}),
};

const WORKER_PORT = parseInt(process.env["JB_FIDELITY_PORT"] ?? "8099", 10);
const WORKER_REL_OUT = "fidelity/out-worker.pdf";

/** SHA-256 hex of a buffer. */
function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Extract and hash every embedded PDF stream object (`stream` … `endstream`).
 * Panel images, fonts, and content streams all surface here, so this is a
 * timestamp-insensitive structural fingerprint of the document body.
 */
function streamHashes(buf) {
  const hashes = [];
  const open = Buffer.from("stream");
  const close = Buffer.from("endstream");
  let cursor = 0;
  while (true) {
    const start = buf.indexOf(open, cursor);
    if (start === -1) break;
    // Skip "endstream" matches and advance past the "stream" keyword + EOL.
    let dataStart = start + open.length;
    if (buf[dataStart] === 0x0d) dataStart++; // \r
    if (buf[dataStart] === 0x0a) dataStart++; // \n
    const end = buf.indexOf(close, dataStart);
    if (end === -1) break;
    hashes.push(sha256(buf.subarray(dataStart, end)));
    cursor = end + close.length;
  }
  return hashes;
}

/** Crude page count: number of `/Type /Page` (not /Pages) object markers. */
function pageCount(buf) {
  const text = buf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s])/g);
  return matches ? matches.length : 0;
}

/** Poll the worker's /health endpoint until it responds or we time out. */
async function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`worker /health did not become ready within ${timeoutMs}ms`);
}

async function main() {
  if (!fs.existsSync(workerEntry)) {
    throw new Error(
      `render-worker build not found at ${workerEntry}. Run \`pnpm -r build\` first.`,
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jb-fidelity-"));
  const directOut = path.join(tmpDir, "out-direct.pdf");
  const generatedDir = path.join(tmpDir, "generated");
  fs.mkdirSync(generatedDir, { recursive: true });

  console.log(`[fidelity] tmp dir: ${tmpDir}`);
  console.log(`[fidelity] input: ${JSON.stringify(FIXED_INPUT)}`);

  // (a) Direct renderAtlas.
  const directResult = await renderAtlas({ ...FIXED_INPUT, outputPath: directOut });
  console.log(`[fidelity] direct render -> ${directOut} (${directResult.pageCount} pages)`);

  // (b) Worker render: spawn the Fastify worker against our generatedDir.
  const worker = spawn(process.execPath, [workerEntry], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(WORKER_PORT), GENERATED_DIR: generatedDir },
    stdio: ["ignore", "inherit", "inherit"],
  });
  worker.on("error", (err) => {
    console.error("[fidelity] failed to spawn worker:", err);
  });

  const workerUrl = `http://127.0.0.1:${WORKER_PORT}`;
  let workerBuf;
  let directBuf;
  let exitCode = 1;
  try {
    await waitForHealth(workerUrl);

    const res = await fetch(`${workerUrl}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...FIXED_INPUT, outputPath: WORKER_REL_OUT }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`worker /render returned ${res.status}: ${detail}`);
    }
    const workerResult = await res.json();
    const workerOut = path.join(generatedDir, WORKER_REL_OUT);
    console.log(
      `[fidelity] worker render -> ${workerOut} (${workerResult.pageCount} pages)`,
    );

    directBuf = fs.readFileSync(directOut);
    workerBuf = fs.readFileSync(workerOut);

    // 1. Exact byte equality.
    if (directBuf.equals(workerBuf)) {
      console.log(`[fidelity] mode=exact  bytes=${directBuf.length}`);
      console.log("[fidelity] MATCH ✓ — worker output is byte-identical to direct renderAtlas.");
      exitCode = 0;
    } else {
      // 2. Fallback: page count + per-stream hashes (timestamp-insensitive).
      const directPages = directResult.pageCount;
      const workerPages = workerResult.pageCount;
      const directStreams = streamHashes(directBuf);
      const workerStreams = streamHashes(workerBuf);
      const samePages = directPages === workerPages;
      const sameStreams =
        directStreams.length === workerStreams.length &&
        directStreams.every((h, i) => h === workerStreams[i]);

      console.log("[fidelity] mode=page-count + stream-hash (bytes differed)");
      console.log(`[fidelity]   pages: direct=${directPages} worker=${workerPages} -> ${samePages ? "ok" : "MISMATCH"}`);
      console.log(`[fidelity]   streams: direct=${directStreams.length} worker=${workerStreams.length} -> ${sameStreams ? "ok" : "MISMATCH"}`);
      console.log("[fidelity]   (byte difference is expected only if @react-pdf embeds a timestamp — see ADR 0005)");

      if (samePages && sameStreams) {
        console.log("[fidelity] MATCH ✓ — page count + embedded streams are equivalent.");
        exitCode = 0;
      } else {
        console.error("[fidelity] MISMATCH ✗ — render paths diverged. Sanity-check page counts (DOM page markers) too.");
        console.error(
          `[fidelity]   (heuristic page markers: direct=${pageCount(directBuf)} worker=${pageCount(workerBuf)})`,
        );
        exitCode = 1;
      }
    }
  } finally {
    worker.kill();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[fidelity] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
