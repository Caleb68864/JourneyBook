#!/usr/bin/env node
/**
 * generate-page-count.mjs — which levers actually change an atlas's page count.
 *
 * Writes one file from the engine, and `--check` fails if it is stale:
 *
 *   docs/page-count.md
 *
 * WHY THIS EXISTS. "How do I get fewer pages?" has an answer that is not the
 * intuitive one. Trimming furniture — a shorter header, no notes block, a
 * narrower CONTINUE column, tighter margins — buys paper, and page counts are
 * `ceil()`'d, so most of that paper buys no pages at all. Overlap is the dial:
 * it multiplies the step between pages in BOTH axes, so a few per cent of
 * overlap costs more pages than every furniture trim put together.
 *
 * That had been measured once, by hand, and written into a roadmap as a single
 * pair of numbers. This script replaces those with a measurement anyone can
 * re-run, for the same reason the print-resolution table is generated: a number
 * typed into prose is a copy of a number in code, and the copies here had
 * already drifted apart once.
 *
 * WHAT IT MEASURES, AND WHAT IT DOES NOT. The furniture levers are *what-ifs*.
 * Nothing in the product sets them: `PAGE_FURNITURE_PT` is the renderer's own
 * constants, and this script passes overrides through `pageGridSize` — the same
 * counting `buildPageGrid` uses for its own guard — so a what-if is measured by
 * the engine rather than by a second copy of its arithmetic. Overlap and
 * orientation are different: those are real, settable options today.
 *
 * ONE EXTENT IS NOT A FINDING. Page counts are quantised by `ceil()`, so on a
 * small atlas a lever can change nothing and on a large one the same lever
 * compounds in both axes. Every lever is therefore measured over a spread of
 * extents, at three latitudes, and reported as a range. A single-extent figure
 * is how "1:24,000 prints at 338 DPI" — a 41°N fact — reached the owner as if
 * it were true everywhere.
 *
 * Usage:
 *   node scripts/generate-page-count.mjs           # rewrite docs/page-count.md
 *   node scripts/generate-page-count.mjs --check   # fail if it would change
 *
 * Requires built packages (`pnpm -r build`): it imports `packages/atlas-core/dist`.
 * Runs in CI as `pnpm check:page-count`.
 *
 * WHEN `--check` FAILS, a lever's effect on page count has changed — usually
 * because the furniture constants, the margins or the footprint arithmetic
 * moved. That is normally intended; regenerate, and read the diff, because it
 * is the answer anyone asking "why is my atlas longer?" will now get.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LETTER_PORTRAIT,
  PAGE_FURNITURE_PT,
  SCALE_PRESETS,
  mapBoxInches,
  pageGridSize,
} from "../packages/atlas-core/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "docs", "page-count.md");

const scaleOf = (id) => {
  const preset = SCALE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown scale preset "${id}"`);
  return preset;
};

/**
 * Extents to measure over. Square and oblong, small and large, at three
 * latitudes, because a degree of longitude shrinks toward the poles and the
 * `ceil()` in each axis rounds independently.
 */
const EXTENTS = [
  { name: "A park, 0.06° square", bbox: [-98.03, 40.97, -97.97, 41.03], scale: "usgs-7-5-min" },
  { name: "A training area, 0.15° square", bbox: [-98.075, 40.925, -97.925, 41.075], scale: "usgs-7-5-min" },
  { name: "A county, 0.5° square", bbox: [-98.25, 40.75, -97.75, 41.25], scale: "usgs-7-5-min" },
  { name: "A wide corridor, 0.6° × 0.1°", bbox: [-98.3, 40.95, -97.7, 41.05], scale: "usgs-7-5-min" },
  { name: "A tall corridor, 0.1° × 0.6°", bbox: [-98.05, 40.7, -97.95, 41.3], scale: "usgs-7-5-min" },
  { name: "A county at 1:50,000", bbox: [-98.25, 40.75, -97.75, 41.25], scale: "1-50000" },
  { name: "A county in the south, 30°N", bbox: [-98.25, 29.75, -97.75, 30.25], scale: "usgs-7-5-min" },
  { name: "A county in the north, 60°N", bbox: [-98.25, 59.75, -97.75, 60.25], scale: "usgs-7-5-min" },
];

/** A furniture record with one measurement changed. */
const furnitureWith = (changes) => ({ ...PAGE_FURNITURE_PT, ...changes });

/**
 * The levers. `kind` separates what a user can actually do today from what is
 * only a what-if, because presenting them in one undifferentiated list would be
 * its own small lie.
 */
const LEVERS = [
  { name: "2.5% overlap", kind: "real", options: { overlap: 0.025 } },
  { name: "5% overlap", kind: "real", options: { overlap: 0.05 } },
  { name: "10% overlap", kind: "real", options: { overlap: 0.1 } },
  {
    name: "Landscape instead of portrait",
    kind: "real",
    options: { page: { ...LETTER_PORTRAIT, orientation: "landscape" } },
  },
  {
    name: "Margins 0.5in → 0.25in",
    kind: "real",
    options: {
      page: {
        ...LETTER_PORTRAIT,
        margins: Object.fromEntries(
          Object.entries(LETTER_PORTRAIT.margins).map(([k, v]) => [k, typeof v === "number" ? v / 2 : v]),
        ),
      },
    },
  },
  { name: "No notes block", kind: "what-if", options: { furniture: furnitureWith({ notesBlock: 0 }) } },
  {
    name: "CONTINUE columns 54pt → 18pt",
    kind: "what-if",
    options: { furniture: furnitureWith({ edgeLabelColumn: 18 }) },
  },
  { name: "No header row", kind: "what-if", options: { furniture: furnitureWith({ headerRow: 0 }) } },
  { name: "No footer row", kind: "what-if", options: { furniture: furnitureWith({ footerRow: 0 }) } },
  {
    name: "No furniture at all",
    kind: "what-if",
    options: {
      furniture: furnitureWith({
        notesBlock: 0,
        headerRow: 0,
        footerRow: 0,
        edgeLabelColumn: 0,
        edgeLabelRow: 0,
      }),
    },
  },
];

const pagesFor = (extent, options = {}) =>
  pageGridSize({
    bbox: extent.bbox,
    scale: scaleOf(extent.scale),
    page: options.page ?? LETTER_PORTRAIT,
    ...(options.overlap === undefined ? {} : { overlap: options.overlap }),
    ...(options.furniture === undefined ? {} : { furniture: options.furniture }),
  }).pages;

/** Map area of one page, in square inches, under a lever. */
const areaFor = (options = {}) => {
  const box = mapBoxInches(options.page ?? LETTER_PORTRAIT, options.furniture);
  return box.widthIn * box.heightIn;
};

const pct = (from, to) => ((to - from) / from) * 100;
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const baselineArea = areaFor();
const baselines = EXTENTS.map((e) => pagesFor(e));

const measured = LEVERS.map((lever) => {
  const perExtent = EXTENTS.map((extent, i) => {
    const pages = pagesFor(extent, lever.options);
    return { extent: extent.name, base: baselines[i], pages, delta: pct(baselines[i], pages) };
  });
  const deltas = perExtent.map((r) => r.delta);
  return {
    ...lever,
    perExtent,
    minDelta: Math.min(...deltas),
    maxDelta: Math.max(...deltas),
    medianDelta: median(deltas),
    areaDelta: pct(baselineArea, areaFor(lever.options)),
    movedNothing: deltas.every((d) => d === 0),
  };
});

const byImpact = [...measured].sort((a, b) => b.medianDelta - a.medianDelta);
const real = measured.filter((l) => l.kind === "real");
/** The real lever that adds the most pages, and the one that removes the most. */
const biggestAdder = real.reduce((a, b) => (b.medianDelta > a.medianDelta ? b : a));
const biggestSaver = real.reduce((a, b) => (b.medianDelta < a.medianDelta ? b : a));
const bestWhatIf = measured
  .filter((l) => l.kind === "what-if" && l.name !== "No furniture at all")
  .reduce((a, b) => (b.medianDelta < a.medianDelta ? b : a));
/**
 * Levers whose median is zero but which move some extent: the `ceil()` story.
 * These are the ones a single-extent measurement reports as "changes nothing".
 */
const quantised = measured.filter((l) => l.medianDelta === 0 && !l.movedNothing);
const freeOfAreaCost = measured.filter((l) => Math.abs(l.areaDelta) < 0.05);

const table = (rows) =>
  [
    "| Lever | Kind | Median pages | Range across extents | Map area per page |",
    "|---|---|---|---|---|",
    ...rows.map(
      (l) =>
        `| ${l.name} | ${l.kind} | **${signed(l.medianDelta)}** | ${signed(l.minDelta)} to ${signed(
          l.maxDelta,
        )} | ${signed(l.areaDelta)} |`,
    ),
  ].join("\n");

const perExtentTable = () => {
  const header = ["| Extent | Baseline pages |", "|---|---|"];
  const names = byImpact.map((l) => l.name);
  header[0] = `| Extent | Baseline pages | ${names.join(" | ")} |`;
  header[1] = `|---|---|${names.map(() => "---|").join("")}`;
  const rows = EXTENTS.map((extent, i) => {
    const cells = byImpact.map((l) => `${l.perExtent[i].pages}`);
    return `| ${extent.name} | ${baselines[i]} | ${cells.join(" | ")} |`;
  });
  return [...header, ...rows].join("\n");
};

const body = `<!-- GENERATED by scripts/generate-page-count.mjs — do not edit by hand.
     Every figure below is measured from the engine; \`pnpm check:page-count\` fails if this file drifts. -->

# What actually changes an atlas's page count

Of the settings the product has today, **${biggestAdder.name.toLowerCase()} adds the most pages**
(median ${signed(biggestAdder.medianDelta)}, up to ${signed(biggestAdder.maxDelta)} on the extents
below) and **${biggestSaver.name.toLowerCase()} removes the most** (median
${signed(biggestSaver.medianDelta)}, down to ${signed(biggestSaver.minDelta)}).

${
  freeOfAreaCost.length
    ? `Overlap is the lever with no compensation: it changes the page count while leaving the map area on each page exactly as it was (${freeOfAreaCost
        .map((l) => l.name.toLowerCase())
        .join(", ")} all measure ${signed(0)} area). Every other lever here trades paper for pages in one direction or the other, so its cost is visible on the page; overlap's cost is only ever in the page count.`
    : ""
}

Trimming furniture does reduce the count — ${bestWhatIf.name.toLowerCase()} is worth a median of
${signed(bestWhatIf.medianDelta)} — but it is **not free and not reliable**: it buys
${signed(bestWhatIf.areaDelta)} of map area per page, and its effect ranges from
${signed(bestWhatIf.maxDelta)} to ${signed(bestWhatIf.minDelta)} depending on the extent.

**Page counts are \`ceil()\`'d in each axis**, which is why a lever's median can be
zero while it still removes a row from some atlases.${
  quantised.length
    ? ` Measured that way here: ${quantised
        .map((l) => `${l.name.toLowerCase()} (median ${signed(l.medianDelta)}, but ${signed(
          l.minDelta === 0 ? l.maxDelta : l.minDelta,
        )} on one extent)`)
        .join(", ")}. A single-extent measurement would report those as "changes nothing".`
    : ""
}

## The levers, by how much they move the count

"Real" is something the product can do today. "What-if" is a furniture
measurement overridden for this table only — nothing in the product sets it.
Map area is per page, and is the price of the lever, not its benefit.

${table(byImpact)}

## Per extent

The spread is the point. A lever that does nothing to a four-page park can add
a row and a column to a county, because each axis rounds up independently.

${perExtentTable()}

## Method

- Page counts come from \`pageGridSize\` in \`@journeybook/atlas-core\` — the same
  counting \`buildPageGrid\` uses for its own over-limit guard, so these are the
  page counts a render would produce, not an estimate of them.
- Furniture what-ifs are passed through \`mapBoxInches\`, so they are measured by
  the engine's own arithmetic rather than a copy of it.
- Baseline is ${LETTER_PORTRAIT.widthIn}×${LETTER_PORTRAIT.heightIn}in portrait at the
  preset named per extent, zero overlap, with the renderer's own furniture.
- Regenerate with \`pnpm generate:page-count\`; \`pnpm check:page-count\` fails if
  this file is stale.
`;

const outDir = path.dirname(OUT);
fs.mkdirSync(outDir, { recursive: true });

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== body) {
    console.error(
      `docs/page-count.md is stale — the engine now answers differently.\n` +
        `Run: pnpm generate:page-count, then commit the result with the change that caused it.`,
    );
    process.exit(1);
  }
  console.log("docs/page-count.md is current");
} else {
  fs.writeFileSync(OUT, body);
  console.log(`wrote ${path.relative(path.join(__dirname, ".."), OUT)}`);
}
