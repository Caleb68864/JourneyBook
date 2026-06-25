#!/usr/bin/env node
/**
 * journeybook — headless atlas render CLI.
 *
 *   journeybook grid --bbox W,S,E,N --scale usgs-7-5-min [--overlap 0.05]
 *   journeybook grid --location LNG,LAT --scale usgs-7-5-min
 *   journeybook render --bbox ... --out atlas.pdf      (Stages 1D–1E)
 *   journeybook validate <atlas.pdf>                    (Stage 1E)
 *
 * `grid` runs the Stage 1B engine (scale + projection + page grid) entirely
 * headless, emitting the AtlasContract JSON — no UI, no PDF yet.
 */

import { readFileSync } from "node:fs";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  SCALE_PRESETS,
  ATLAS_CORE_VERSION,
  LETTER_PORTRAIT,
  DEFAULT_MAP_TIER,
  buildPageGrid,
  buildLocationPage,
  validateAtlas,
  type AtlasContract,
  type BBox,
  type LandmarkMarker,
  type LngLat,
  type MapTier,
  type ScalePreset,
} from "@journeybook/atlas-core";
import { renderAtlas } from "./render.js";

const HELP = `journeybook — headless atlas renderer

Usage:
  journeybook grid   --bbox W,S,E,N --scale <preset> [--overlap 0..1] [--tier 1..4]
  journeybook grid   --location LNG,LAT --scale <preset> [--tier 1..4]
  journeybook render --bbox W,S,E,N --scale <preset> --out <file.pdf> [--tier 1..4] [--basemap]
  journeybook render --location LNG,LAT --scale <preset> --out <file.pdf> [--tier 1..4] [--basemap]
  journeybook render --location LNG,LAT --location LNG,LAT [...] --scale <preset> --out <file.pdf> [--route] [--tier 1..4] [--basemap]
  journeybook validate --bbox W,S,E,N --scale <preset> [--overlap 0..1]
  journeybook validate --location LNG,LAT --scale <preset>

--basemap fetches a USGS (public-domain) topo panel per page over the network.
--route tiles corridor pages (R1…Rn) along the polyline connecting ≥2 --location stops,
  appended after the per-location (L#) pages in the same atlas.
--tile-base-url <url> routes basemap tiles through the C# proxy (e.g. http://localhost:5180/api/tiles),
  reusing its cache and enabling PMTiles sources; --tile-source <id> overrides the proxy source key.
  Omit --tile-base-url to fetch tiles directly (zero infrastructure).
--tile-cache-dir <dir> reads/writes a shared local tile cache (default: no Node-side cache).
--landmarks <file.json> reads a JSON array of LandmarkMarker objects and places them as
  per-page furniture (each page picks/declutters the markers inside its bbox).
validate runs the print-validation harness (true scale, neighbour integrity).

Scale presets:
${SCALE_PRESETS.map((p) => `  ${p.id.padEnd(16)} ${p.label}`).join("\n")}

validate is not implemented yet (Stage 1E).
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

function resolveScale(id: string | undefined): ScalePreset {
  const preset = SCALE_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(
      `Unknown --scale "${id ?? ""}". Try one of: ${SCALE_PRESETS.map((p) => p.id).join(", ")}`,
    );
  }
  return preset;
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

/** Build an AtlasContract from grid/render flags (bbox grid or single location). */
export function contractFromFlags(flags: Map<string, string>): AtlasContract {
  const scale = resolveScale(flags.get("scale"));
  const tier = resolveTier(flags);

  if (flags.has("location")) {
    const [lng, lat] = parseNumbers(flags.get("location")!, 2, "location") as [number, number];
    const center: LngLat = { lng, lat };
    const page = buildLocationPage(center, scale, LETTER_PORTRAIT, "L1", tier);
    return { version: 1, scale, margins: LETTER_PORTRAIT.margins, pages: [page] };
  }

  if (flags.has("bbox")) {
    const bbox = parseNumbers(flags.get("bbox")!, 4, "bbox") as BBox;
    const overlap = flags.has("overlap") ? Number(flags.get("overlap")) : 0;
    return buildPageGrid({ bbox, scale, page: LETTER_PORTRAIT, overlap, tier });
  }

  throw new Error("need either --bbox W,S,E,N or --location LNG,LAT");
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
      stdout.write(`${JSON.stringify(contractFromFlags(parseFlags(rest)), null, 2)}\n`);
      return 0;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (cmd === "render") {
    try {
      const flags = parseFlags(rest);
      const out = flags.get("out");
      if (!out || out === "true") throw new Error("render needs --out <file.pdf>");

      const scaleId = flags.get("scale");
      if (!scaleId) throw new Error("render needs --scale <preset>");
      const tier = resolveTier(flags);

      const mode = flags.has("location") ? "location" : "bbox";
      const tileBaseUrl = flags.has("tile-base-url") ? flags.get("tile-base-url") : undefined;
      const tileSourceId = flags.has("tile-source") ? flags.get("tile-source") : undefined;
      const cacheDir = flags.has("tile-cache-dir") ? flags.get("tile-cache-dir") : undefined;

      // --landmarks <file.json>: read the JSON array of LandmarkMarker so the engine
      // is testable without an Overpass round-trip; threaded into renderAtlas below.
      let landmarks: LandmarkMarker[] | undefined;
      const landmarksPath = flags.has("landmarks") ? flags.get("landmarks") : undefined;
      if (landmarksPath && landmarksPath !== "true") {
        const parsed = JSON.parse(readFileSync(landmarksPath, "utf8")) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error(`--landmarks "${landmarksPath}" must contain a JSON array of LandmarkMarker objects.`);
        }
        landmarks = parsed as LandmarkMarker[];
      }

      let center: { lng: number; lat: number } | undefined;
      let bbox: [number, number, number, number] | undefined;
      let locations: { center: { lng: number; lat: number } }[] | undefined;

      if (mode === "location") {
        // Collect all --location values (may appear multiple times for route mode).
        const locationArgs = collectMultiFlag(rest, "location");
        if (locationArgs.length >= 2) {
          locations = locationArgs.map((v) => {
            const [lng, lat] = v.split(",").map(Number) as [number, number];
            return { center: { lng, lat } };
          });
          // center = first location (required by location-mode validation when locations array given).
          center = locations[0]!.center;
        } else {
          const [lng, lat] = flags
            .get("location")!
            .split(",")
            .map(Number) as [number, number];
          center = { lng, lat };
        }
      } else {
        bbox = flags
          .get("bbox")!
          .split(",")
          .map(Number) as [number, number, number, number];
      }

      const result = await renderAtlas({
        mode,
        bbox,
        center,
        locations,
        scalePresetId: scaleId,
        tier,
        overlap: flags.has("overlap") ? Number(flags.get("overlap")) : undefined,
        basemap: flags.has("basemap"),
        route: flags.has("route"),
        tileBaseUrl: tileBaseUrl && tileBaseUrl !== "true" ? tileBaseUrl : undefined,
        tileSourceId: tileSourceId && tileSourceId !== "true" ? tileSourceId : undefined,
        cacheDir: cacheDir && cacheDir !== "true" ? cacheDir : undefined,
        landmarks,
        outputPath: out,
      });

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
      const contract = contractFromFlags(parseFlags(rest));
      const report = validateAtlas(contract);
      for (const check of report.checks) {
        stdout.write(`  [${check.pass ? "PASS" : "FAIL"}] ${check.name} — ${check.detail}\n`);
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
