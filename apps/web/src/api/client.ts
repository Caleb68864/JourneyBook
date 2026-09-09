/**
 * Typed fetch wrapper for the JourneyBook API.
 * All calls are relative so they work behind the Vite proxy in dev.
 *
 * This module is the single adapter between the C# API wire shapes (the tested
 * source of truth) and the web app's internal representation: the API returns an
 * extent as an object `{west,south,east,north}`, which we normalize to the
 * `BBox` tuple `[W,S,E,N]` that atlas-core and the components use.
 */

import type { BBox, MapTier } from "@journeybook/atlas-core";

// ---------------------------------------------------------------------------
// Web-facing domain types (mirror the C# API, extent normalized to a tuple)
// ---------------------------------------------------------------------------

/** Safe margins (inches) + optional binder gutter — mirrors the C# `MarginsDto`. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  gutter: number;
}

export interface Project {
  id: string;
  name: string;
  scalePresetId: string;
  orientation: string;
  overlap: number;
  /**
   * The project's persisted margins. Carried through the adapter because the
   * API's only update verb is a full PUT: any caller that does not resend these
   * silently resets the user's page setup to the defaults.
   */
  margins: Margins;
  extent: BBox | null;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  projectId: string;
  /** Display name the user entered (C# `name`). */
  name: string;
  lng: number;
  lat: number;
  notes: string | null;
  /** Stable per-project L-series id, e.g. "L1" (C# `label`). */
  label: string;
  /** e.g. "see page L1" (C# `referenceLabel`). */
  referenceLabel: string;
  /** Optional per-location scale override; null → inherit the project scale. */
  scalePresetId: string | null;
  /** Custom pin shape id (e.g. "shield"); null → default. */
  pinShape: string | null;
  /** Custom pin hex color (e.g. "#1f3d2b"); null → default. */
  pinColor: string | null;
  /**
   * Ordered zoom ladder (scale preset ids, coarse → fine). When set, this location
   * renders one page per level (L1a, L1b, …) instead of a single page, and it
   * overrides `scalePresetId`. Null/empty → one page.
   */
  zoomLevels: string[] | null;
}

export interface ImportLocationsResult {
  imported: number;
  locations: Location[];
}

export interface Landmark {
  id: string;
  projectId: string;
  /** Display name from the OSM source. */
  name: string;
  lng: number;
  lat: number;
  /** Curated `LandmarkCategory` (e.g. "Peak", "Tower"). */
  category: string;
  /** Import-time ranking score used for per-page selection. */
  score: number;
}

export interface ImportLandmarksResult {
  imported: number;
  landmarks: Landmark[];
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lng: number;
  type: string | null;
  category: string | null;
}

export interface RenderResult {
  generatedPdfId: string;
  status: string;
  downloadUrl: string;
}

export interface GeneratedPdf {
  id: string;
  projectId: string;
  status: string;
  filePath: string | null;
  createdAt: string;
  expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Raw API shapes (server serializes PascalCase records as camelCase)
// ---------------------------------------------------------------------------

interface ApiBBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface ApiProject {
  id: string;
  name: string;
  scalePresetId: string;
  orientation: string;
  overlap: number;
  margins?: Partial<Margins> | null;
  extent: ApiBBox | null;
  createdAt: string;
  updatedAt: string;
}

/** Page setup the API falls back to when a project has no stored grid yet. */
const DEFAULT_MARGINS: Margins = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 };

function toMargins(m: ApiProject["margins"]): Margins {
  return {
    top: m?.top ?? DEFAULT_MARGINS.top,
    right: m?.right ?? DEFAULT_MARGINS.right,
    bottom: m?.bottom ?? DEFAULT_MARGINS.bottom,
    left: m?.left ?? DEFAULT_MARGINS.left,
    gutter: m?.gutter ?? DEFAULT_MARGINS.gutter,
  };
}

function toBBox(e: ApiBBox | null): BBox | null {
  return e ? [e.west, e.south, e.east, e.north] : null;
}

function normalizeProject(p: ApiProject): Project {
  return {
    id: p.id,
    name: p.name,
    scalePresetId: p.scalePresetId,
    orientation: p.orientation,
    overlap: p.overlap,
    margins: toMargins(p.margins),
    extent: toBBox(p.extent),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // fetch rejects only on network-level failure (server down, DNS, CORS) — turn
    // the raw TypeError into a readable message for the UI.
    throw new Error(
      `Network error calling ${method} ${BASE}${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${BASE}${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${method} ${BASE}${path}: response was not valid JSON.`);
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const api = {
  projects: {
    list: async (): Promise<Project[]> =>
      (await request<ApiProject[]>("GET", "/projects")).map(normalizeProject),
    get: async (id: string): Promise<Project> =>
      normalizeProject(await request<ApiProject>("GET", `/projects/${id}`)),
    create: async (name: string, scalePresetId: string): Promise<Project> =>
      normalizeProject(await request<ApiProject>("POST", "/projects", { name, scalePresetId })),
    // Full update (the API's PUT replaces all grid fields); used for rename.
    update: async (
      id: string,
      body: { name: string; scalePresetId: string; orientation: string; overlap: number; margins: Margins },
    ): Promise<Project> => normalizeProject(await request<ApiProject>("PUT", `/projects/${id}`, body)),
    /**
     * Change one field of a project without disturbing the rest.
     *
     * PUT /projects/{id} replaces every grid field, so a partial body is not a
     * partial update — it is a reset of whatever it omits. Every single-field
     * edit therefore goes through here, resending the project's current values
     * for the fields it is not changing.
     */
    patch: async (p: Project, changes: Partial<Pick<Project, "name" | "scalePresetId" | "orientation" | "overlap" | "margins">>): Promise<Project> =>
      normalizeProject(
        await request<ApiProject>("PUT", `/projects/${p.id}`, {
          name: changes.name ?? p.name,
          scalePresetId: changes.scalePresetId ?? p.scalePresetId,
          orientation: changes.orientation ?? p.orientation,
          overlap: changes.overlap ?? p.overlap,
          margins: changes.margins ?? p.margins,
        }),
      ),
    rename: (p: Project, name: string): Promise<Project> => api.projects.patch(p, { name }),
    /** Persist the map scale. The picker used to change the view only. */
    setScale: (p: Project, scalePresetId: string): Promise<Project> =>
      api.projects.patch(p, { scalePresetId }),
    duplicate: async (id: string): Promise<Project> =>
      normalizeProject(await request<ApiProject>("POST", `/projects/${id}/duplicate`)),
    // PUT /extent binds a BBoxDto {west,south,east,north} directly (not wrapped).
    setExtent: async (id: string, extent: BBox): Promise<Project> =>
      normalizeProject(
        await request<ApiProject>("PUT", `/projects/${id}/extent`, {
          west: extent[0],
          south: extent[1],
          east: extent[2],
          north: extent[3],
        }),
      ),
    delete: (id: string) => request<void>("DELETE", `/projects/${id}`),
  },

  locations: {
    list: (projectId: string) =>
      request<Location[]>("GET", `/projects/${projectId}/locations`),
    create: (
      projectId: string,
      name: string,
      lng: number,
      lat: number,
      notes?: string,
      scalePresetId?: string | null,
      geocodedFrom?: string | null,
      geocodeProvider?: string | null,
    ) =>
      request<Location>("POST", `/projects/${projectId}/locations`, {
        name,
        lng,
        lat,
        notes: notes ?? null,
        scalePresetId: scalePresetId ?? null,
        geocodedFrom: geocodedFrom ?? null,
        geocodeProvider: geocodeProvider ?? null,
      }),
    // Update/delete are on the flat /api/locations/{id} group (not project-scoped).
    update: (
      locationId: string,
      body: { name: string; lng: number; lat: number; notes?: string | null; category?: string; sourceConfidence?: string; scalePresetId?: string | null; pinShape?: string | null; pinColor?: string | null; zoomLevels?: string[] | null },
    ) =>
      request<Location>("PUT", `/locations/${locationId}`, {
        name: body.name,
        lng: body.lng,
        lat: body.lat,
        category: body.category ?? "Other",
        notes: body.notes ?? null,
        sourceConfidence: body.sourceConfidence ?? "Unknown",
        scalePresetId: body.scalePresetId ?? null,
        pinShape: body.pinShape ?? null,
        pinColor: body.pinColor ?? null,
        zoomLevels: body.zoomLevels ?? null,
      }),
    delete: (locationId: string) =>
      request<void>("DELETE", `/locations/${locationId}`),
    import: (projectId: string, csv: string) =>
      request<ImportLocationsResult>("POST", `/projects/${projectId}/locations/import`, { csv }),
  },

  geocode: {
    // Forward-geocode a free-text address/place. An optional viewbox biases results
    // toward the project's extent. Returns candidates only; the caller turns a chosen
    // result into a location (recording the query as provenance).
    search: (query: string, viewbox?: BBox | null) => {
      const params = new URLSearchParams({ q: query });
      if (viewbox) {
        params.set("west", String(viewbox[0]));
        params.set("south", String(viewbox[1]));
        params.set("east", String(viewbox[2]));
        params.set("north", String(viewbox[3]));
      }
      return request<GeocodeResult[]>("GET", `/geocode?${params.toString()}`);
    },
  },

  landmarks: {
    list: (projectId: string) =>
      request<Landmark[]>("GET", `/projects/${projectId}/landmarks`),
    // Fetches OSM landmarks for the project extent via Overpass, ranks + persists
    // them, and returns the imported count (0 on Overpass failure/timeout).
    import: (projectId: string) =>
      request<ImportLandmarksResult>("POST", `/projects/${projectId}/landmarks/import`),
  },

  generatedPdfs: {
    /** PDF render history for a project, newest first. */
    list: (projectId: string) =>
      request<GeneratedPdf[]>("GET", `/projects/${projectId}/generated-pdfs`),
    contentUrl: (pdfId: string) => `${BASE}/generated-pdfs/${pdfId}/content`,
  },

  render: {
    // The render endpoint reads scalePresetId from the persisted project grid;
    // tier is chosen at render time and carried in the request body. When
    // `route` is set, the worker also tiles corridor (R#) pages between stops.
    // `includeLandmarks` is forwarded like `route` to draw landmark furniture;
    // `tableOfContents` toggles the front-matter locations contents page.
    start: (
      projectId: string,
      tier: MapTier,
      opts?: {
        route?: boolean;
        includeLandmarks?: boolean;
        tableOfContents?: boolean;
        overview?: boolean;
        referenceGrid?: boolean;
        notes?: boolean;
        /** Tile a grid over the box enclosing every location (projects with no extent). */
        cover?: boolean;
      },
    ) =>
      request<RenderResult>("POST", `/projects/${projectId}/render`, { tier, ...opts }),
    getContent: (pdfId: string) => `${BASE}/generated-pdfs/${pdfId}/content`,
  },
};
