#!/usr/bin/env node
/**
 * regenerate-sample-atlas.mjs — rebuild the golden fixture.
 *
 * `data/fixtures/sample-atlas.json` is a 2x2 page grid at 1:24,000, centred on
 * 41°N 98°W, that the print-validation harness must keep accepting. It has been
 * committed since Stage 1E with no way to reproduce it and no documented
 * generation parameters, which is the failure mode of every golden file: the
 * moment it needs to change, nobody can tell a correct regeneration from a wrong
 * one, and the safe-looking move — regenerate and commit whatever comes out — is
 * exactly how a golden fixture stops being golden.
 *
 * The parameters are the code below. Running this must be a no-op on a healthy
 * tree; `--check` asserts that and exits non-zero if not.
 *
 * Usage:
 *   node scripts/regenerate-sample-atlas.mjs           # rewrite the fixture
 *   node scripts/regenerate-sample-atlas.mjs --check   # fail if it would change
 *
 * Requires a built atlas-core (`cd packages/atlas-core && tsc -b`).
 *
 * WHEN THE OUTPUT CHANGES, THE FIXTURE IS NOT THE THING TO FIX FIRST. A diff
 * here means the geometry engine now produces different pages for the same
 * input. Decide whether that change is intended — `packages/atlas-core/src/
 * fixture.test.ts` pins the page bboxes to ten decimal places and will fail
 * alongside — and only then commit both together, saying why in the commit.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LETTER_PORTRAIT, SCALE_PRESETS, buildPageGrid } from "../packages/atlas-core/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "fixtures", "sample-atlas.json");

// ---------------------------------------------------------------------------
// Generation parameters — the whole definition of the fixture.
// ---------------------------------------------------------------------------

/**
 * A 0.06° square centred on 41°N 98°W — round numbers, in Nebraska, far from a
 * UTM seam and from the poles, and just under two page footprints across at
 * 1:24,000 so it tiles into exactly the 2x2 the harness expects. These are the
 * parameters recovered (by search) from the committed file: this script
 * reproduces `sample-atlas.json` byte for byte, which is what makes it a
 * regeneration rather than a replacement.
 */
const EXTENT = [-98.03, 40.97, -97.97, 41.03];
const SCALE_ID = "usgs-7-5-min";
const TIER = 2;

const scale = SCALE_PRESETS.find((p) => p.id === SCALE_ID);
if (!scale) throw new Error(`unknown scale preset "${SCALE_ID}"`);

const contract = buildPageGrid({
  bbox: EXTENT,
  scale,
  page: LETTER_PORTRAIT,
  tier: TIER,
});

const json = `${JSON.stringify(contract, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/^﻿/, "") : "";
  if (current === json) {
    console.log(`sample-atlas.json is up to date (${contract.pages.length} pages)`);
    process.exit(0);
  }
  console.error(
    "sample-atlas.json does NOT match what the engine produces for its recorded parameters.\n" +
      "Do not simply regenerate: work out why the engine changed first (see the header of this file).",
  );
  process.exit(1);
}

fs.writeFileSync(OUT, json);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} — ${contract.pages.length} pages ` +
    `[${contract.pages.map((p) => p.id).join(", ")}] at 1:${scale.ratio}`,
);
