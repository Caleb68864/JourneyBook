import { describe, it, expect, vi, afterEach } from "vitest";
import { api, type Project } from "./client";

/**
 * The scale picker was a no-op after project creation: it set local state and
 * never wrote, so the user changed the headline setting, rendered at the scale
 * they started with, and had no recovery but a new project.
 *
 * The trap in fixing it is that `PUT /api/projects/{id}` replaces every grid
 * field, so a partial body is not a partial update — it is a reset of what it
 * omits. These tests pin the request that actually goes on the wire.
 */

const PROJECT: Project = {
  id: "p1",
  name: "Sandhills",
  scalePresetId: "usgs-7-5-min",
  orientation: "Portrait",
  overlap: 0.05,
  margins: { top: 0.75, right: 0.6, bottom: 0.75, left: 0.9, gutter: 0.25 },
  extent: [-98, 41, -97, 42],
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
};

/** Echo the request back as an API project so normalizeProject has something real. */
function stubApi() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    return new Response(
      JSON.stringify({
        id: PROJECT.id,
        name: body.name,
        scalePresetId: body.scalePresetId,
        orientation: body.orientation,
        overlap: body.overlap,
        margins: body.margins,
        extent: { west: -98, south: 41, east: -97, north: 42 },
        createdAt: PROJECT.createdAt,
        updatedAt: "2026-09-09T01:00:00Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubApi>) {
  const init = fetchMock.mock.calls[0]![1]!;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.projects.setScale", () => {
  it("PUTs the project with the new scale", async () => {
    const fetchMock = stubApi();
    const updated = await api.projects.setScale(PROJECT, "1-100000");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1");
    expect(fetchMock.mock.calls[0]![1]!.method).toBe("PUT");
    expect(sentBody(fetchMock).scalePresetId).toBe("1-100000");
    expect(updated.scalePresetId).toBe("1-100000");
  });

  it("resends every other grid field, so changing scale resets nothing", async () => {
    const fetchMock = stubApi();
    await api.projects.setScale(PROJECT, "1-100000");

    const body = sentBody(fetchMock);
    expect(body.name).toBe("Sandhills");
    expect(body.orientation).toBe("Portrait");
    expect(body.overlap).toBe(0.05);
    // The margins the user set, not the API defaults: PUT replaces the grid, so
    // sending 0.5/0.5/0.5/0.5/0 here would silently reset their page setup.
    expect(body.margins).toEqual(PROJECT.margins);
  });
});

describe("api.projects.rename", () => {
  it("preserves the project's saved margins", async () => {
    const fetchMock = stubApi();
    await api.projects.rename(PROJECT, "Sandhills North");

    const body = sentBody(fetchMock);
    expect(body.name).toBe("Sandhills North");
    expect(body.scalePresetId).toBe("usgs-7-5-min");
    expect(body.margins).toEqual(PROJECT.margins);
  });
});

describe("project normalization", () => {
  it("carries margins back off the wire", async () => {
    stubApi();
    const updated = await api.projects.setScale(PROJECT, "1-100000");
    expect(updated.margins).toEqual(PROJECT.margins);
  });
});

/**
 * "Import Landmarks" posted to `/projects/{id}/landmarks/import` with no body at
 * all. `request()` sends no `Content-Type` when `body === undefined`, and the
 * endpoint binds a non-nullable `ImportLandmarksRequest` — a required JSON body —
 * so the call answered 415 (no JSON content type) or 400 (empty body) and
 * `LandmarkImportControl` rendered the raw wire string. It could never succeed
 * from the web app. The Api integration tests passed because they post
 * `new ImportLandmarksRequest(Extent)`: a body the web app never sent.
 *
 * Knock-on: "Include Landmarks" (default on) was a no-op for every project
 * reachable through the UI, because no such project could have landmarks.
 */
describe("api.landmarks.import", () => {
  function stubImport() {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ imported: 0, landmarks: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("[BEHAVIORAL] sends the extent as a JSON body the endpoint can bind", async () => {
    const fetchMock = stubImport();
    await api.landmarks.import("p1", [-98, 41, -97, 42]);

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/projects/p1/landmarks/import");
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");

    // Without a JSON content type a minimal-API complex parameter answers 415,
    // whatever the body is.
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");

    // ImportLandmarksRequest(RenderBBoxDto Bbox) — the server reads request.Bbox
    // and never looks at the project's own extent, so the caller must send one.
    expect(JSON.parse(String(init.body))).toEqual({
      bbox: { west: -98, south: 41, east: -97, north: 42 },
    });
  });
});
