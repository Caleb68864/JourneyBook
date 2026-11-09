// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { Project } from "../api/client";
import type { PageSetupProps, PageSetupValue } from "../components/PageSetup";
import type { BasemapOptionsProps } from "../components/BasemapOptions";
import type { RenderOptionsState } from "../lib/render-options";

/**
 * The editor is the one hop the component tests cannot see. `PageSetup` and
 * `BasemapOptions` are each tested up to their callbacks, and `api.projects.patch`
 * and `GenerateButton` are tested from their inputs. What sits between them is
 * `ProjectEditorPage`: it feeds the saved project into `PageSetup`, sends
 * `PageSetup`'s change to `patch`, and copies `BasemapOptions` state into the
 * `options` that `GenerateButton` posts. Drop any one of those props and every
 * other suite stays green.
 *
 * The children are replaced with probes that record their props, so this tests
 * the editor's wiring only. The children's own behaviour is covered in their
 * own files.
 */

const seen = vi.hoisted(() => ({
  pageSetup: [] as PageSetupProps[],
  basemap: [] as BasemapOptionsProps[],
  generate: [] as { options: RenderOptionsState }[],
}));

vi.mock("../components/PageSetup", () => ({
  PageSetup: (props: PageSetupProps) => {
    seen.pageSetup.push(props);
    return <div data-testid="page-setup-probe" />;
  },
}));
vi.mock("../components/BasemapOptions", () => ({
  BasemapOptions: (props: BasemapOptionsProps) => {
    seen.basemap.push(props);
    return <div data-testid="basemap-probe" />;
  },
}));
vi.mock("../components/GenerateButton", () => ({
  GenerateButton: (props: { options: RenderOptionsState }) => {
    seen.generate.push(props);
    return <div data-testid="generate-probe" />;
  },
}));
// The map is maplibre and needs WebGL; nothing here is about it.
vi.mock("../components/MapPreview", () => ({ MapPreview: () => <div /> }));

const PROJECT: Project = {
  id: "p1",
  name: "Sandhills",
  scalePresetId: "usgs-7-5-min",
  orientation: "Landscape",
  overlap: 0.1,
  explorerName: null,
  atlasDate: null,
  margins: { top: 0.75, right: 0.6, bottom: 0.8, left: 0.9, gutter: 0.3 },
  extent: [-98, 41, -97.9, 41.1],
  createdAt: "2026-09-09T00:00:00Z",
  updatedAt: "2026-09-09T00:00:00Z",
};

const { api } = await import("../api/client");
const { ProjectEditorPage } = await import("./ProjectEditorPage");

beforeEach(() => {
  seen.pageSetup.length = 0;
  seen.basemap.length = 0;
  seen.generate.length = 0;
  vi.spyOn(api.projects, "get").mockResolvedValue(PROJECT);
  vi.spyOn(api.locations, "list").mockResolvedValue([]);
  vi.spyOn(api.generatedPdfs, "list").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderEditor() {
  render(<ProjectEditorPage projectId="p1" onBack={() => {}} />);
  await screen.findByTestId("page-setup-probe");
  await screen.findByTestId("basemap-probe");
}

describe("ProjectEditorPage wires page setup", () => {
  it("[BEHAVIORAL] hands PageSetup the saved project's setup", async () => {
    await renderEditor();
    expect(seen.pageSetup.at(-1)!.value).toEqual({
      orientation: "Landscape",
      overlap: 0.1,
      margins: { top: 0.75, right: 0.6, bottom: 0.8, left: 0.9, gutter: 0.3 },
    });
  });

  it("[BEHAVIORAL] saves a PageSetup change through api.projects.patch", async () => {
    const next: PageSetupValue = {
      orientation: "Portrait",
      overlap: 0.05,
      margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0.25 },
    };
    const patch = vi
      .spyOn(api.projects, "patch")
      .mockImplementation(async (p, changes) => ({ ...p, ...changes }) as Project);
    await renderEditor();

    await act(async () => seen.pageSetup.at(-1)!.onChange(next));

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![0].id).toBe("p1");
    expect(patch.mock.calls[0]![1]).toEqual(next);
    // And the saved value comes back into the control.
    await waitFor(() => expect(seen.pageSetup.at(-1)!.value).toEqual(next));
  });

  it("[BEHAVIORAL] asks the engine for the page count of the candidate setup", async () => {
    await renderEditor();
    const estimate = seen.pageSetup.at(-1)!.estimatePagesFor!;
    const portrait = estimate({ ...seen.pageSetup.at(-1)!.value, orientation: "Portrait" });
    const landscape = estimate(seen.pageSetup.at(-1)!.value);
    expect(portrait).toBeGreaterThan(0);
    expect(landscape).toBeGreaterThan(0);
  });
});

describe("ProjectEditorPage wires the basemap options", () => {
  it("[CONTROL] starts from the engine's defaults", async () => {
    await renderEditor();
    expect(seen.basemap.at(-1)!.value).toEqual({ basemap: true, panelFormat: null, panelQuality: null });
    expect(seen.generate.at(-1)!.options).toMatchObject({ basemap: true, panelFormat: null, panelQuality: null });
  });

  it("[BEHAVIORAL] a BasemapOptions change reaches what Generate posts", async () => {
    await renderEditor();

    await act(async () =>
      seen.basemap.at(-1)!.onChange({ basemap: true, panelFormat: "jpeg", panelQuality: 60 }),
    );

    expect(seen.basemap.at(-1)!.value).toEqual({ basemap: true, panelFormat: "jpeg", panelQuality: 60 });
    expect(seen.generate.at(-1)!.options).toMatchObject({ basemap: true, panelFormat: "jpeg", panelQuality: 60 });

    await act(async () =>
      seen.basemap.at(-1)!.onChange({ basemap: false, panelFormat: "jpeg", panelQuality: 60 }),
    );
    expect(seen.generate.at(-1)!.options.basemap).toBe(false);
  });
});
