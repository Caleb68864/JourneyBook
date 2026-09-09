#!/usr/bin/env node
/**
 * journeybook — headless atlas render CLI.
 *
 *   journeybook grid     [geometry flags] --scale usgs-7-5-min      → AtlasContract JSON
 *   journeybook validate [geometry flags] --scale usgs-7-5-min      → print-validation report
 *   journeybook render   [geometry flags] --scale ... --out atlas.pdf
 *
 * Geometry flags compose: a `--bbox` grid and/or any number of locations (from
 * `--locations <file>` and/or repeated `--location LNG,LAT`), `--cover` to tile a
 * grid over every location, `--zoom-levels` for a per-location zoom ladder, and
 * `--route` for corridor pages. All three commands assemble the same contract.
 */

import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  SCALE_PRESETS,
  ATLAS_CORE_VERSION,
  DEFAULT_MAP_TIER,
  validateAtlas,
  type AtlasContract,
  type BBox,
  type LandmarkMarker,
  type MapTier,
  type PrintedMapBox,
} from "@journeybook/atlas-core";
import { mapBoxOf, measurePdfPages, renderAtlasPdfToBuffer } from "@journeybook/pdf-client";
import type { PanelFormat } from "@journeybook/map-sources";
import { assembleContract, renderAtlas, type RenderAtlasInput, type RenderLocation } from "./render.js";
import { loadLocationsFile } from "./locations.js";

const HELP = `journeybook — headless atlas renderer

Usage:
  journeybook grid     <geometry> --scale <preset> [options]
  journeybook validate <geometry> --scale <preset> [options]
  journeybook render   <geometry> --scale <preset> --out <file.pdf> [options] [--basemap]

Geometry (combine freely; at least one of --bbox / --locations / --location):
  --bbox W,S,E,N              tile a page grid over this extent at --scale
  --locations <file.csv|json> special locations, one L# page each (see below)
  --location LNG,LAT          one location (repeatable); appended after --locations
  --cover [pad]               tile a grid at --scale over the padded box enclosing every
                              location (pad = fraction of span, default 0.05); no --bbox needed
  --zoom-levels a,b,c         zoom ladder: one page per scale preset for every location
                              (ids L1a, L1b, …); a location's own "zoom" column wins
  --route                     corridor pages (R1…Rn) along the polyline between ≥2 locations

Options:
  --tier 1..4                 map furniture level (default ${DEFAULT_MAP_TIER})
  --overlap 0..1              fractional page overlap for grids (default 0)
  --title <text>              book title printed in every page header
  --no-toc / --no-overview    suppress the locations contents page / the overview page
  --no-notes / --no-reference-grid
                              suppress the foot-of-page notes area / the A–F×1–8 grid
  --basemap                   fetch a USGS (public-domain) topo panel per page (network)
  --panel-px <n>              target panel width in pixels (default 1000, ~176 DPI on Letter)
  --panel-format png|jpeg     panel encoding (default jpeg; png is lossless and ~6x larger)
  --panel-quality 1..100      JPEG quality (default 90; ignored for png)
  --tile-base-url <url>       route basemap tiles through the C# proxy (e.g. http://localhost:5180/api/tiles)
  --tile-source <id>          proxy source key (with --tile-base-url)
  --tile-cache-dir <dir>      shared local tile cache (default: none)
  --tile-max-zoom <n>         deepest zoom the source has (default: the basemap's own;
                              USGS topo is z16, so --panel-px above ~1000 is clamped there)
  --landmarks <file.json>     JSON array of LandmarkMarker objects placed as per-page furniture
  --no-print-check            (validate) skip rendering the atlas to measure the printed map
                              box; the printed-scale check is then reported SKIP, not PASS

Locations file:
  CSV with a header row — the same file the web importer takes. Columns (case-insensitive):
    name, lng, lat            required
    notes                     printed in the page's notes area
    scale                     per-location scale preset id (zoom this page in/out)
    pin, color                map-pin shape id (shield/teardrop/circle/diamond/star/flag) + hex
    zoom                      "|"-separated ladder of scale ids, e.g. 1-100000|1-50000|usgs-7-5-min
  JSON: an array of { name|label, lng, lat | center:{lng,lat}, scalePresetId, pin, notes, zoomLevels }
  or a web project backup ({ project, locations: [...] }) — render a backup directly.

Scale presets:
${SCALE_PRESETS.map((p) => `  ${p.id.padEnd(16)} ${p.label}`).join("\n")}

Examples:
  journeybook render --locations stops.csv --cover --scale 1-100000 \\
    --zoom-levels 1-100000,1-50000,usgs-7-5-min --tier 2 --basemap --out trip.pdf
  journeybook grid --locations stops.csv --cover --scale 1-50000 | jq '.pages[].id'
`;

/** Parse "--flag value" pairs into a map (no value -> "true"). */
export function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token?.startsWith("--")) {
      const key = token.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, "true");
      }
    }
  }
  return flags;
}

/** Collect every value for a multi-value flag (e.g. --location may appear N times). */
export function collectMultiFlag(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === `--${name}`) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.push(next);
      }
    }
  }
  return values;
}

function parseNumbers(value: string, count: number, label: string): number[] {
  const parts = value.split(",").map((s) => Number(s.trim()));
  if (parts.length !== count || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`--${label} expects ${count} comma-separated numbers, got "${value}"`);
  }
  return parts;
}

function resolveTier(flags: Map<string, string>): MapTier {
  if (!flags.has("tier")) return DEFAULT_MAP_TIER;
  const tier = Number(flags.get("tier"));
  if (![1, 2, 3, 4].includes(tier)) {
    throw new Error(`--tier must be 1, 2, 3 or 4 (got "${flags.get("tier")}")`);
  }
  return tier as MapTier;
}

/** A flag's value, or undefined when absent or given bare (value "true"). */
function valueOf(flags: Map<string, string>, key: string): string | undefined {
  const v = flags.get(key);
  return v === undefined || v === "true" ? undefined : v;
}

/**
 * Render the contract and measure the map box each page is actually printed
 * into, keyed by page id.
 *
 * This is what turns `validate` from a self-consistency check into a print
 * check. Everything else `validateAtlas` compares comes out of the contract on
 * both sides; the printed box does not, so it is the only thing that can catch a
 * page whose bbox is honest and whose paper is the wrong size.
 *
 * Rendered without front matter and without a basemap: no table of contents and
 * no overview means measured page N is contract page N, and no basemap means no
 * network — the check is about geometry, not tiles.
 */
async function measurePrintedMapBoxes(
  contract: AtlasContract,
): Promise<Record<string, PrintedMapBox>> {
  const pdf = await renderAtlasPdfToBuffer({
    contract,
    tableOfContents: false,
    notes: true,
    referenceGrid: true,
  });
  const measured = measurePdfPages(pdf);
  const boxes: Record<string, PrintedMapBox> = {};
  contract.pages.forEach((page, i) => {
    const measuredPage = measured[i];
    if (!measuredPage) return;
    const box = mapBoxOf(measuredPage);
    if (!box) return;
    boxes[page.id] = { widthPt: box.width, heightPt: box.height };
  });
  return boxes;
}

/**
 * Build the shared render input (minus `outputPath`) from CLI args. Used by
 * `grid`, `validate` and `render`, so every command assembles the same atlas.
 */
export function inputFromArgs(args: readonly string[]): Omit<RenderAtlasInput, "outputPath"> {
  const flags = parseFlags(args);
  const scaleId = flags.get("scale");
  if (!scaleId || scaleId === "true") {
    throw new Error(`need --scale <preset>. Try one of: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`);
  }
  if (!SCALE_PRESETS.some((p) => p.id === scaleId)) {
    throw new Error(`Unknown --scale "${scaleId}". Try one of: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`);
  }
  const tier = resolveTier(flags);

  // Locations: every --locations file (in order) then every --location LNG,LAT.
  const locations: RenderLocation[] = [];
  for (const file of collectMultiFlag(args, "locations")) {
    locations.push(...loadLocationsFile(file));
  }
  for (const value of collectMultiFlag(args, "location")) {
    const [lng, lat] = parseNumbers(value, 2, "location") as [number, number];
    locations.push({ center: { lng, lat } });
  }

  let bbox: BBox | undefined;
  if (flags.has("bbox")) {
    bbox = parseNumbers(flags.get("bbox")!, 4, "bbox") as BBox;
  }
  if (!bbox && locations.length === 0) {
    throw new Error("need geometry: --bbox W,S,E,N, --locations <file>, and/or --location LNG,LAT");
  }

  const zoomRaw = valueOf(flags, "zoom-levels");
  const zoomLevels = zoomRaw ? zoomRaw.split(/[,|;]/).map((s) => s.trim()).filter(Boolean) : undefined;

  let cover = false;
  let coverPadFraction: number | undefined;
  if (flags.has("cover")) {
    cover = true;
    const pad = valueOf(flags, "cover");
    if (pad !== undefined) {
      coverPadFraction = Number(pad);
      if (!Number.isFinite(coverPadFraction) || coverPadFraction < 0) {
        throw new Error(`--cover expects an optional pad fraction ≥ 0 (got "${pad}")`);
      }
    }
  }

  // --landmarks <file.json>: read the JSON array of LandmarkMarker so the engine
  // is testable without an Overpass round-trip; threaded into renderAtlas below.
  let landmarks: LandmarkMarker[] | undefined;
  const landmarksPath = valueOf(flags, "landmarks");
  if (landmarksPath) {
    const parsed = JSON.parse(readFileSync(landmarksPath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`--landmarks "${landmarksPath}" must contain a JSON array of LandmarkMarker objects.`);
    }
    landmarks = parsed as LandmarkMarker[];
  }

  const overlap = flags.has("overlap") ? Number(flags.get("overlap")) : undefined;
  const title = valueOf(flags, "title");

  let panelWidthPx: number | undefined;
  const panelPxRaw = valueOf(flags, "panel-px");
  if (panelPxRaw !== undefined) {
    panelWidthPx = Number(panelPxRaw);
    if (!Number.isInteger(panelWidthPx) || panelWidthPx < 256 || panelWidthPx > 8000) {
      throw new Error(`--panel-px expects an integer 256–8000 (got "${panelPxRaw}")`);
    }
  }

  const panelFormatRaw = valueOf(flags, "panel-format");
  if (panelFormatRaw !== undefined && panelFormatRaw !== "png" && panelFormatRaw !== "jpeg") {
    throw new Error(`--panel-format must be "png" or "jpeg" (got "${panelFormatRaw}")`);
  }
  const panelFormat = panelFormatRaw as PanelFormat | undefined;

  let panelQuality: number | undefined;
  const panelQualityRaw = valueOf(flags, "panel-quality");
  if (panelQualityRaw !== undefined) {
    panelQuality = Number(panelQualityRaw);
    if (!Number.isInteger(panelQuality) || panelQuality < 1 || panelQuality > 100) {
      throw new Error(`--panel-quality expects an integer 1–100 (got "${panelQualityRaw}")`);
    }
  }

  let tileMaxZoom: number | undefined;
  const tileMaxZoomRaw = valueOf(flags, "tile-max-zoom");
  if (tileMaxZoomRaw !== undefined) {
    tileMaxZoom = Number(tileMaxZoomRaw);
    if (!Number.isInteger(tileMaxZoom) || tileMaxZoom < 0 || tileMaxZoom > 24) {
      throw new Error(`--tile-max-zoom expects an integer 0–24 (got "${tileMaxZoomRaw}")`);
    }
  }

  return {
    mode: bbox ? "bbox" : "location",
    ...(bbox ? { bbox } : {}),
    // In location mode the first location doubles as the legacy `center`.
    ...(!bbox && locations.length > 0 ? { center: locations[0]!.center } : {}),
    ...(locations.length > 0 ? { locations } : {}),
    scalePresetId: scaleId,
    tier,
    ...(overlap !== undefined ? { overlap } : {}),
    ...(title ? { title } : {}),
    basemap: flags.has("basemap"),
    route: flags.has("route"),
    ...(panelWidthPx !== undefined ? { panelWidthPx } : {}),
    ...(panelFormat ? { panelFormat } : {}),
    ...(panelQuality !== undefined ? { panelQuality } : {}),
    ...(cover ? { cover } : {}),
    ...(coverPadFraction !== undefined ? { coverPadFraction } : {}),
    ...(zoomLevels && zoomLevels.length > 0 ? { zoomLevels } : {}),
    ...(valueOf(flags, "tile-base-url") ? { tileBaseUrl: valueOf(flags, "tile-base-url") } : {}),
    ...(valueOf(flags, "tile-source") ? { tileSourceId: valueOf(flags, "tile-source") } : {}),
    ...(valueOf(flags, "tile-cache-dir") ? { cacheDir: valueOf(flags, "tile-cache-dir") } : {}),
    ...(tileMaxZoom !== undefined ? { tileMaxZoom } : {}),
    ...(landmarks ? { landmarks } : {}),
    tableOfContents: !flags.has("no-toc"),
    overview: !flags.has("no-overview"),
    referenceGrid: !flags.has("no-reference-grid"),
    notes: !flags.has("no-notes"),
  };
}

/** Build an AtlasContract from CLI args (grid/validate) — same assembly as render. */
export function contractFromArgs(args: readonly string[]): AtlasContract {
  return assembleContract({ ...inputFromArgs(args), outputPath: "" }).contract;
}

export async function runCli(args: readonly string[]): Promise<number> {
  const [cmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    stdout.write(HELP);
    return 0;
  }
  if (cmd === "--version" || cmd === "-v") {
    stdout.write(`atlas-core ${ATLAS_CORE_VERSION}\n`);
    return 0;
  }
  if (cmd === "grid") {
    try {
      stdout.write(`${JSON.stringify(contractFromArgs(rest), null, 2)}\n`);
      return 0;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (cmd === "render") {
    try {
      const out = valueOf(parseFlags(rest), "out");
      if (!out) throw new Error("render needs --out <file.pdf>");

      const result = await renderAtlas({ ...inputFromArgs(rest), outputPath: out });

      const pageIds = result.contract.pages.map((p) => p.id).join(", ");
      stdout.write(`Wrote ${result.pageCount} page(s) to ${result.outputPath} [${pageIds}]\n`);
      return 0;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (cmd === "validate") {
    try {
      const contract = contractFromArgs(rest);
      const flags = parseFlags(rest);
      // Render the atlas and measure the printed map box, so `printed-scale-fidelity`
      // has the one input that does not come out of the contract. Without it every
      // check here compares the contract with itself and a page printed at the wrong
      // size still reports VALID. `--no-print-check` skips the render.
      const printedMapBoxes = flags.has("no-print-check")
        ? undefined
        : await measurePrintedMapBoxes(contract);
      const report = validateAtlas(contract, printedMapBoxes ? { printedMapBoxes } : {});
      for (const check of report.checks) {
        stdout.write(`  [${check.pass ? "PASS" : "FAIL"}] ${check.name} — ${check.detail}\n`);
      }
      for (const name of report.unmeasured) {
        stdout.write(`  [SKIP] ${name} — not measured (drop --no-print-check to render and measure)\n`);
      }
      stdout.write(report.pass ? "VALID\n" : "INVALID\n");
      return report.pass ? 0 : 1;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  return 1;
}

const isDirectRun = argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli(argv.slice(2)).then(exit);
}
