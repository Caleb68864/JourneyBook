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

import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  SCALE_PRESETS,
  ATLAS_CORE_VERSION,
  LETTER_PORTRAIT,
  DEFAULT_MAP_TIER,
  buildPageGrid,
  buildLocationPage,
  type AtlasContract,
  type BBox,
  type LngLat,
  type MapTier,
  type ScalePreset,
} from "@journeybook/atlas-core";
import { renderAtlasPdfToFile } from "@journeybook/pdf-client";
import { renderMapPanel } from "@journeybook/map-sources";

const HELP = `journeybook — headless atlas renderer

Usage:
  journeybook grid   --bbox W,S,E,N --scale <preset> [--overlap 0..1] [--tier 1..4]
  journeybook grid   --location LNG,LAT --scale <preset> [--tier 1..4]
  journeybook render --bbox W,S,E,N --scale <preset> --out <file.pdf> [--tier 1..4] [--basemap]
  journeybook render --location LNG,LAT --scale <preset> --out <file.pdf> [--tier 1..4] [--basemap]
  journeybook validate <file.pdf>

--basemap fetches a USGS (public-domain) topo panel per page over the network.

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
      const contract = contractFromFlags(flags);

      let panels: Record<string, string> | undefined;
      if (flags.has("basemap")) {
        panels = {};
        for (const page of contract.pages) {
          const panel = await renderMapPanel(page.bbox, 1000);
          panels[page.id] = `data:image/png;base64,${panel.png.toString("base64")}`;
          stderr.write(`  panel ${page.id} (z${panel.zoom})\n`);
        }
      }

      await renderAtlasPdfToFile({ contract, outputPath: out, panels });
      stdout.write(`Wrote ${contract.pages.length} page(s) to ${out}\n`);
      return 0;
    } catch (err) {
      stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
  }
  if (cmd === "validate") {
    stderr.write("'validate' is not implemented yet (Stage 1E).\n");
    return 2;
  }
  stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
  return 1;
}

const isDirectRun = argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli(argv.slice(2)).then(exit);
}
