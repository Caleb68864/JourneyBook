// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectListPage } from "./ProjectListPage";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("ProjectListPage", () => {
  it("[BEHAVIORAL] shows the server's offline map packages under the atlases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/map-packages")
              ? [{ file: "ne/lincoln.pmtiles", bytes: 2048, modifiedAt: "2026-11-22T10:00:00Z", tileType: "png", minZoom: 10, maxZoom: 12, bbox: [-97, 40.5, -96.5, 41], addressedTiles: 9, sourceKeys: [], error: null }]
              : [],
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(<ProjectListPage onOpen={() => {}} />);

    expect(await screen.findByRole("heading", { name: /offline map packages/i })).toBeTruthy();
    expect(await screen.findByText("ne/lincoln.pmtiles")).toBeTruthy();
  });
});
