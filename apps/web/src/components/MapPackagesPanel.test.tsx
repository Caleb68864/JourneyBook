// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MapPackagesPanel, formatBBox, formatBytes } from "./MapPackagesPanel";

/**
 * The manifest (`GET /api/map-packages`) had no reader in the app: the API could say which
 * offline packages exist and whether anything serves them, and nobody could see it. These run
 * the real panel with the real client against a stubbed fetch.
 */
function stubManifest(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const lincoln = {
  file: "ne/lincoln.pmtiles",
  bytes: 3 * 1024 * 1024,
  modifiedAt: "2026-11-22T10:00:00Z",
  tileType: "png",
  minZoom: 10,
  maxZoom: 12,
  bbox: [-97, 40.5, -96.5, 41],
  addressedTiles: 1234,
  sourceKeys: ["package-ne-lincoln"],
  error: null,
};

describe("MapPackagesPanel", () => {
  it("[BEHAVIORAL] lists each package's coverage, zooms, size and whether a source serves it", async () => {
    const fetchMock = stubManifest(200, [
      lincoln,
      { ...lincoln, file: "spare.pmtiles", sourceKeys: [] },
      { file: "broken.pmtiles", bytes: 14, modifiedAt: "2026-11-22T10:00:00Z", tileType: null, minZoom: null, maxZoom: null, bbox: null, addressedTiles: null, sourceKeys: [], error: "Not a PMTiles v3 archive." },
    ]);
    render(<MapPackagesPanel />);

    expect(await screen.findByText("ne/lincoln.pmtiles")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/api\/map-packages$/);
    expect(screen.getAllByText(/40\.50°N–41\.00°N, 97\.00°W–96\.50°W · zoom 10–12 · 1,234 png tiles · 3\.0 MB/)).toHaveLength(2);
    expect(screen.getByText("Served as package-ne-lincoln")).toBeTruthy();
    expect(screen.getAllByText("Not registered as a tile source yet")).toHaveLength(2);
    expect(screen.getByText(/Unreadable: Not a PMTiles v3 archive\./)).toBeTruthy();
  });

  it("[CONTROL] says there are none rather than showing an empty box", async () => {
    stubManifest(200, []);
    render(<MapPackagesPanel />);
    expect(await screen.findByText(/No packages on the server/)).toBeTruthy();
  });

  it("surfaces a failed load instead of spinning for ever", async () => {
    stubManifest(500, { error: "boom" });
    render(<MapPackagesPanel />);
    expect(await screen.findByText(/map-packages → 500/)).toBeTruthy();
  });

  it("formats sizes and boxes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(12.34 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatBBox([-97, -33.9, 151.2, -33.8])).toBe("33.90°S–33.80°S, 97.00°W–151.20°E");
  });
});
