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

export interface Project {
  id: string;
  name: string;
  scalePresetId: string;
  orientation: string;
  overlap: number;
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
}

export interface RenderResult {
  generatedPdfId: string;
  status: string;
  downloadUrl: string;
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
  extent: ApiBBox | null;
  createdAt: string;
  updatedAt: string;
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
    create: (projectId: string, name: string, lng: number, lat: number, notes?: string) =>
      request<Location>("POST", `/projects/${projectId}/locations`, {
        name,
        lng,
        lat,
        notes: notes ?? null,
      }),
    delete: (projectId: string, locationId: string) =>
      request<void>("DELETE", `/projects/${projectId}/locations/${locationId}`),
  },

  render: {
    // The render endpoint reads scalePresetId from the persisted project grid;
    // tier is chosen at render time and carried in the request body.
    start: (projectId: string, tier: MapTier) =>
      request<RenderResult>("POST", `/projects/${projectId}/render`, { tier }),
    getContent: (pdfId: string) => `${BASE}/generated-pdfs/${pdfId}/content`,
  },
};
