import { DEFAULT_SCALE_PRESET_ID, type BBox } from "@journeybook/atlas-core";
import type { Location, Margins, Project } from "../api/client";

/**
 * The `.journeybook.json` export/import shape.
 *
 * Export dropped `margins` entirely, and import read back only `name`,
 * `scalePresetId` and `extent` — so `orientation` and `overlap` were written to
 * the file and thrown away on the way in. Since the page-setup fix all three
 * change the printed atlas: margins and the gutter move the printed map box, and
 * therefore the ground each page covers and how many pages there are. Exporting
 * an atlas and importing it gave you a different atlas.
 *
 * The shape and its parsing live here, apart from the JSX, so the round trip can
 * actually be tested.
 */
export interface ProjectExport {
  version: 1;
  project: {
    name: string;
    scalePresetId: string;
    orientation: string;
    overlap: number;
    margins: Margins;
    extent: BBox | null;
  };
  locations: ExportedLocation[];
}

export interface ExportedLocation {
  name: string;
  lng: number;
  lat: number;
  notes?: string | null;
  scalePresetId?: string | null;
  pinShape?: string | null;
  pinColor?: string | null;
  zoomLevels?: string[] | null;
}

export function buildProjectExport(project: Project, locations: Location[]): ProjectExport {
  return {
    version: 1,
    project: {
      name: project.name,
      scalePresetId: project.scalePresetId,
      orientation: project.orientation,
      overlap: project.overlap,
      // Was missing. The one page-setup value that changes the printed scale was
      // the one the export did not carry.
      margins: project.margins,
      extent: project.extent,
    },
    locations: locations.map((l) => ({
      name: l.name,
      lng: l.lng,
      lat: l.lat,
      notes: l.notes,
      scalePresetId: l.scalePresetId,
      pinShape: l.pinShape,
      pinColor: l.pinColor,
      zoomLevels: l.zoomLevels,
    })),
  };
}

/** What an import actually applies. `undefined` = the file said nothing; keep the API default. */
export interface ParsedProjectImport {
  name: string;
  scalePresetId: string;
  extent: BBox | null;
  /** Page setup, present only when the file carried it (older exports did not). */
  pageSetup: { orientation?: string; overlap?: number; margins?: Margins } | null;
  locations: ExportedLocation[];
}

const ORIENTATIONS = new Set(["Portrait", "Landscape"]);

function asMargins(value: unknown): Margins | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const m = value as Record<string, unknown>;
  const nums = ["top", "right", "bottom", "left"].map((k) => m[k]);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return {
    top: m.top as number,
    right: m.right as number,
    bottom: m.bottom as number,
    left: m.left as number,
    gutter: typeof m.gutter === "number" && Number.isFinite(m.gutter) ? m.gutter : 0,
  };
}

/**
 * Read an export file. Tolerant by design — a file written before page setup was
 * exported is still a valid file, and a field it does not carry must leave the
 * API's default alone rather than be imported as a zero.
 */
export function parseProjectImport(raw: unknown): ParsedProjectImport {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const p = (typeof data.project === "object" && data.project !== null
    ? data.project
    : {}) as Record<string, unknown>;

  const orientation =
    typeof p.orientation === "string" && ORIENTATIONS.has(p.orientation) ? p.orientation : undefined;
  const overlap =
    typeof p.overlap === "number" && Number.isFinite(p.overlap) && p.overlap >= 0 && p.overlap < 1
      ? p.overlap
      : undefined;
  const margins = asMargins(p.margins);

  const extent = Array.isArray(p.extent) && p.extent.length === 4 && p.extent.every((n) => typeof n === "number")
    ? (p.extent as BBox)
    : null;

  return {
    name: typeof p.name === "string" && p.name.trim() ? p.name : "Imported Atlas",
    scalePresetId: typeof p.scalePresetId === "string" && p.scalePresetId
      ? p.scalePresetId
      : DEFAULT_SCALE_PRESET_ID,
    extent,
    pageSetup:
      orientation === undefined && overlap === undefined && margins === undefined
        ? null
        : {
            ...(orientation !== undefined ? { orientation } : {}),
            ...(overlap !== undefined ? { overlap } : {}),
            ...(margins !== undefined ? { margins } : {}),
          },
    locations: Array.isArray(data.locations) ? (data.locations as ExportedLocation[]) : [],
  };
}
