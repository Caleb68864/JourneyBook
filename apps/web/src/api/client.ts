/**
 * Typed fetch wrapper for the JourneyBook API.
 * All calls are relative so they work behind the Vite proxy in dev.
 */

import type { BBox, MapTier } from "@journeybook/atlas-core";

// ---------------------------------------------------------------------------
// Domain types mirrored from the API contract
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  scalePresetId: string;
  tier: MapTier;
  extent: BBox | null;
  createdAt: string;
}

export interface Location {
  id: string;
  projectId: string;
  label: string;
  lng: number;
  lat: number;
  notes: string | null;
}

export interface RenderResult {
  jobId: string;
  downloadUrl: string;
  status: "queued" | "processing" | "complete" | "failed";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${BASE}${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const api = {
  projects: {
    list: () => request<Project[]>("GET", "/projects"),
    get: (id: string) => request<Project>("GET", `/projects/${id}`),
    create: (name: string, scalePresetId: string, tier: MapTier) =>
      request<Project>("POST", "/projects", { name, scalePresetId, tier }),
    setExtent: (id: string, extent: BBox) =>
      request<Project>("PUT", `/projects/${id}/extent`, { extent }),
    delete: (id: string) => request<void>("DELETE", `/projects/${id}`),
  },

  locations: {
    list: (projectId: string) =>
      request<Location[]>("GET", `/projects/${projectId}/locations`),
    create: (projectId: string, label: string, lng: number, lat: number, notes?: string) =>
      request<Location>("POST", `/projects/${projectId}/locations`, {
        label,
        lng,
        lat,
        notes: notes ?? null,
      }),
    delete: (projectId: string, locationId: string) =>
      request<void>("DELETE", `/projects/${projectId}/locations/${locationId}`),
  },

  render: {
    start: (projectId: string) =>
      request<RenderResult>("POST", `/projects/${projectId}/render`),
    getContent: (pdfId: string) =>
      `${BASE}/generated-pdfs/${pdfId}/content`,
  },
};
