#!/usr/bin/env node
/**
 * generate-print-resolution.mjs — what each scale preset actually prints at.
 *
 * Writes two files from the engine, and `--check` fails if either is stale:
 *
 *   apps/web/src/generated/print-resolution.json   the table the scale picker reads
 *   docs/print-resolution.md                       the page the picker links to
 *
 * WHY GENERATED. Print resolution is not a property of this product: the
 * renderer never resamples, so each preset's panel width is a floor and the
 * delivered resolution is 1x-2x it, depending on where the page falls relative
 * to a tile zoom boundary — which moves with latitude. Before this script the
 * figure was hand-typed prose in three places (`model.ts`, a test, the roadmap)
 * over two different latitude ranges, none checked against the engine or each
 * other, and three resolution figures had already reached the owner wrong.
 *
 * So there is one table, measured by `buildPrintResolutionTable` through
 * `planMapPanel` — the function `renderMapPanel` renders from — and every figure
 * a user or the owner reads is derived from it: the picker's text at runtime, the
 * documentation page here. The prose below contains NO resolution figure; each
 * one is interpolated from the table. If you find yourself typing a DPI into this
 * file, derive it instead.
 *
 * Usage:
 *   node scripts/generate-print-resolution.mjs           # rewrite both files
 *   node scripts/generate-print-resolution.mjs --check   # fail if either would change
 *
 * Requires built packages (`pnpm -r build`): it imports `packages/map-sources/dist`.
 * Runs in CI as `pnpm check:print-resolution` and as
 * `harness/checks/print-resolution.sh`.
 *
 * WHEN `--check` FAILS, the engine now delivers something different from what the
 * product tells users. That is usually intended (a preset's width, a basemap's
 * ceiling or the page geometry changed); regenerate and commit the new table with
 * the change that caused it, and read the diff — it is exactly what users will
 * now be told.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPrintResolutionTable,
  formatPrintResolutionJson,
} from "../packages/map-sources/dist/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = path.join(ROOT, "apps", "web", "src", "generated", "print-resolution.json");

const table = buildPrintResolutionTable();
const DOC_OUT = path.join(ROOT, table.doc);

// ---------------------------------------------------------------------------
// Wording helpers. Figures come in; none are written here.
// ---------------------------------------------------------------------------

const dpi = (n) => `${Math.round(n)}`;
const range = (lo, hi) => (Math.round(lo) === Math.round(hi) ? `${dpi(lo)}` : `${dpi(lo)}–${dpi(hi)}`);
const T = table.targetDpi;
const sampleCount = table.presets[0].samples.length;

/** `[18,19,20,45]` -> "18–20°N and 45°N". */
function latRuns(lats) {
  if (lats.length === 0) return "";
  const runs = [];
  let start = lats[0];
  let prev = lats[0];
  for (const lat of lats.slice(1)) {
    if (lat === prev + table.latitudes.step) {
      prev = lat;
      continue;
    }
    runs.push([start, prev]);
    start = prev = lat;
  }
  runs.push([start, prev]);
  const parts = runs.map(([a, b]) => (a === b ? `${a}°N` : `${a}–${b}°N`));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "halve" when the fall is about 2x, otherwise the plain numbers carry it. */
function stepVerb(step) {
  return step.fromDpi / step.toDpi >= 1.9 ? "halve it" : "cut it sharply";
}

function belowCell(p) {
  const n = p.belowTargetLats.length;
  return n === 0 ? "never" : `${n} of ${sampleCount} latitudes (${latRuns(p.belowTargetLats)})`;
}

const underRequesting = table.presets.filter((p) => p.requestedDpi < T);
const clearing = table.presets.filter((p) => p.requestedDpi >= T && p.belowTargetLats.length === 0);
const stoppedShort = table.presets.filter((p) => p.requestedDpi >= T && p.belowTargetLats.length > 0);

function presetBullets() {
  const out = [];
  for (const p of underRequesting) {
    const s = p.steepestStep;
    const t = p.atTargetRequest;
    out.push(
      `- **${p.label}** asks for ${dpi(p.requestedDpi)} DPI and prints at **${range(p.minDpi, p.maxDpi)} DPI ` +
        `depending on latitude** — below ${T} at ${belowCell(p)}. A one-degree move can ${stepVerb(s)}: ` +
        `**${dpi(s.fromDpi)} DPI at ${s.fromLat}°N, ${dpi(s.toDpi)} at ${s.toLat}°N**.`,
    );
    out.push(
      `- That swing comes from where the page falls against the tile zoom levels, not from panel width. ` +
        `Asking this preset for a full ${T} DPI panel would lift its floor only to **${dpi(t.minDpi)} DPI ` +
        `(${t.minDpiLat}°N)**` +
        (t.clampedLats.length > 0
          ? `, because at ${latRuns(t.clampedLats)} the page would already need a finer tile zoom than ` +
            `USGS Topo has (z${table.basemap.maxZoom} is its deepest)`
          : "") +
        (t.belowTargetLats.length > 0
          ? ` — it would still be under ${T} DPI at ${t.belowTargetLats.length} of ${sampleCount} latitudes.`
          : "."),
    );
  }
  if (clearing.length > 0) {
    out.push(
      `- **${clearing.map((p) => p.label).join(", ")}** ask for ${T} DPI and get it at every latitude ` +
        `in the table: ${clearing.map((p) => `${range(p.minDpi, p.maxDpi)}`).join(", ")} DPI respectively.`,
    );
  }
  for (const p of stoppedShort) {
    out.push(
      `- **${p.label}** asks for ${T} DPI and gets it everywhere except ${latRuns(p.belowTargetLats)}, ` +
        `where its pages need a finer tile zoom than USGS Topo has and bottom out at ` +
        `**${dpi(p.minDpi)} DPI (${p.minDpiLat}°N)**. Elsewhere it prints at up to ${dpi(p.maxDpi)} DPI.`,
    );
  }
  return out.join("\n");
}

function summaryTable() {
  const rows = table.presets.map(
    (p) =>
      `| ${p.label} | ${p.panelWidthPx} px (${dpi(p.requestedDpi)} DPI) | **${range(p.minDpi, p.maxDpi)}** | ` +
      `${belowCell(p)} | ${p.clampedLats.length === 0 ? "never" : latRuns(p.clampedLats)} | ` +
      `${dpi(p.atTargetRequest.minDpi)} |`,
  );
  return [
    `| Preset | Panel request | Delivered DPI | Below ${T} DPI | Needs a finer tile than exists | Floor at a ${T} DPI request |`,
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function latitudeTable() {
  const header = `| Lat | ${table.presets.map((p) => p.label).join(" | ")} |`;
  const rule = `|---|${table.presets.map(() => "---:").join("|")}|`;
  const rows = table.presets[0].samples.map((_, i) => {
    const cells = table.presets.map((p) => {
      const s = p.samples[i];
      const v = `${dpi(s.dpi)}${s.clamped ? "\\*" : ""}`;
      return s.dpi < T ? `_${v}_` : v;
    });
    return `| ${table.presets[0].samples[i].lat}°N | ${cells.join(" | ")} |`;
  });
  return [header, rule, ...rows].join("\n");
}

const doc = `# Print resolution by scale preset

<!-- GENERATED by scripts/generate-print-resolution.mjs from the engine. Do not edit
     this file: \`pnpm check:print-resolution\` fails CI when it is stale. Change the
     wording in the script; change the figures by changing the engine. -->

JourneyBook prints every page **true to scale** at every preset. What changes from
preset to preset, and from place to place, is how **sharp** the basemap is on
paper — its print resolution, in dots per inch (DPI). The target is **${T} DPI**;
below it, fine contour lines and small labels start to look soft. A page below
${T} DPI is still the right map at the right scale.

Every figure on this page is measured by the renderer's own code and regenerated
whenever that code changes. The scale picker in the app reads the same table.

## The short version

${presetBullets()}

${summaryTable()}

"Needs a finer tile than exists" means the page wanted a tile zoom deeper than
USGS Topo's deepest (z${table.basemap.maxZoom}), so it was drawn at z${table.basemap.maxZoom} and is softer than it asked for.

## Why it varies

- The basemap is USGS Topo, served as map tiles in fixed zoom levels; each level
  has twice the detail of the one before.
- The renderer never stretches or shrinks the tiles. For each page it picks the
  coarsest zoom that gives at least the width the preset asks for, and crops at
  that zoom's own resolution. So a page gets between 1x and 2x the pixels it asked
  for — never less, unless the basemap has run out of zoom levels.
- Where a page lands in that 1x–2x range depends on how its width compares with a
  zoom level's, and on these tiles a fixed stretch of ground is more pixels wide the
  farther north it is. So the same preset lands differently at different
  latitudes: just short of a zoom boundary it gets nearly 2x, just past one it gets
  about 1x. That boundary is the one-degree cliff above.
- A wider panel request moves the boundaries; it does not remove them. And it
  cannot go past the basemap's deepest zoom, which is what stops the far south.

## Every latitude

Delivered DPI for a page centred at each latitude. _Italic_: below ${T} DPI.
\\*: needed a finer tile zoom than USGS Topo has.

${latitudeTable()}

## What your finished atlas printed at

This table describes a reference page. Every finished atlas also records the
resolution its own map pages **actually** printed at — the lowest and highest
across its pages — and the app shows it next to the atlas in the render history
and when the render finishes. For the file you have, that measured figure is the
one to trust.

## What this table covers

- **Page:** ${table.page.description} (map box ${table.page.mapBoxWidthIn} in wide).
  Each preset's panel request is rescaled to the page you actually print, so it
  asks for the same DPI on any page setup — but orientation, margins and gutter
  change how much ground a page covers, so the cliffs fall at different latitudes.
- **Basemap:** ${table.basemap.id}, deepest zoom z${table.basemap.maxZoom}.
- **Latitudes:** every whole degree from ${table.latitudes.from}°N to ${table.latitudes.to}°N, the band USGS Topo covers.
  Between samples the figure can sit a little outside the sampled extremes — an
  unclamped page always gets at least its requested DPI and less than twice it.
- Longitude makes no difference.
`;

const outputs = [
  [JSON_OUT, formatPrintResolutionJson(table)],
  [DOC_OUT, doc],
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([file, want]) => {
    const have = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/, "") : null;
    return have !== want;
  });
  if (stale.length === 0) {
    console.log(`print-resolution table is up to date (${table.presets.length} presets x ${sampleCount} latitudes)`);
    process.exit(0);
  }
  console.error(
    "The committed print-resolution table no longer matches what the engine delivers:\n" +
      stale.map(([file]) => `  ${path.relative(ROOT, file)}`).join("\n") +
      "\nUsers are being shown resolution figures the renderer does not produce. Regenerate with\n" +
      "`node scripts/generate-print-resolution.mjs`, read the diff, and commit it with the change that caused it.",
  );
  process.exit(1);
}

for (const [file, content] of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`wrote ${path.relative(ROOT, file)}`);
}
