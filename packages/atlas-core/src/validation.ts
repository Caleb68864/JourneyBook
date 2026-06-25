import type { AtlasContract, AtlasPage } from "./model.js";
import { groundFootprintMeters, type PageSpec } from "./page.js";
import { geodesicDistanceMeters } from "./projection.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ValidationReport {
  pass: boolean;
  checks: CheckResult[];
}

export interface ValidateOptions {
  /** Allowed footprint error as a fraction of the expected size. Default 0.5%. */
  footprintTolerance?: number;
}

const CARDINALS = ["north", "south", "east", "west"] as const;
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" } as const;

/** Measured ground width/height of a page's bbox, in metres. */
function pageGroundSize(page: AtlasPage): { width: number; height: number } {
  const [west, south, east, north] = page.bbox;
  const midLat = (south + north) / 2;
  const midLng = (west + east) / 2;
  return {
    width: geodesicDistanceMeters({ lng: west, lat: midLat }, { lng: east, lat: midLat }),
    height: geodesicDistanceMeters({ lng: midLng, lat: south }, { lng: midLng, lat: north }),
  };
}

/**
 * Validate an atlas contract's geometry: that every page covers the ground
 * footprint its scale implies (true scale bar) and that neighbour references
 * are reciprocal and resolvable. The heart of the Stage 1E print-validation
 * harness — a false scale bar or broken page-to-page link fails here.
 */
export function validateAtlas(
  contract: AtlasContract,
  options: ValidateOptions = {},
): ValidationReport {
  const tolerance = options.footprintTolerance ?? 0.005;
  const checks: CheckResult[] = [];

  checks.push({
    name: "has-pages",
    pass: contract.pages.length > 0,
    detail: `${contract.pages.length} page(s)`,
  });

  // Scale consistency: measured footprint ≈ scale-implied footprint.
  let scalePass = true;
  let worstRel = 0;
  for (const page of contract.pages) {
    const spec: PageSpec = {
      widthIn: 8.5,
      heightIn: 11,
      orientation: page.orientation,
      margins: contract.margins,
    };
    // Validate each page against its own scale when set (mixed-scale atlases),
    // falling back to the contract scale.
    const expected = groundFootprintMeters(page.scale ?? contract.scale, spec);
    const actual = pageGroundSize(page);
    const relW = Math.abs(actual.width - expected.widthMeters) / expected.widthMeters;
    const relH = Math.abs(actual.height - expected.heightMeters) / expected.heightMeters;
    worstRel = Math.max(worstRel, relW, relH);
    if (relW > tolerance || relH > tolerance) scalePass = false;
  }
  checks.push({
    name: "scale-consistency",
    pass: scalePass,
    detail: `worst footprint error ${(worstRel * 100).toFixed(3)}% (tol ${(tolerance * 100).toFixed(2)}%)`,
  });

  // Neighbour reciprocity: every reference resolves and points back.
  const ids = new Set(contract.pages.map((p) => p.id));
  const byId = new Map(contract.pages.map((p) => [p.id, p]));
  let neighborPass = true;
  let neighborDetail = "all neighbour references reciprocal";
  outer: for (const page of contract.pages) {
    for (const dir of CARDINALS) {
      const neighbor = page.neighbors[dir];
      if (neighbor === undefined) continue;
      if (!ids.has(neighbor)) {
        neighborPass = false;
        neighborDetail = `${page.id}.${dir} → "${neighbor}" does not exist`;
        break outer;
      }
      if (byId.get(neighbor)!.neighbors[OPPOSITE[dir]] !== page.id) {
        neighborPass = false;
        neighborDetail = `${page.id}.${dir}="${neighbor}" is not reciprocal`;
        break outer;
      }
    }
  }
  checks.push({ name: "neighbor-reciprocity", pass: neighborPass, detail: neighborDetail });

  return { pass: checks.every((c) => c.pass), checks };
}

/** Effective print DPI of a map panel: panel pixels per printable inch. */
export function effectiveDpi(panelWidthPx: number, printableWidthInches: number): number {
  return panelWidthPx / printableWidthInches;
}
