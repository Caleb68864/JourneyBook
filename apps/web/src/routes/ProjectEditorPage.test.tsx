// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
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
const { toPageSpec } = await import("../lib/page-estimate");
const { LETTER_PORTRAIT, SCALE_PRESETS, panelWidthPxFor } = await import("@journeybook/atlas-core");
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
    expect(seen.basemap.at(-1)!.value).toEqual({ basemap: true, panelFormat: null, panelQuality: null, panelZoomStep: 0 });
    expect(seen.generate.at(-1)!.options).toMatchObject({
      basemap: true,
      panelFormat: null,
      panelQuality: null,
      panelWidthPx: null,
    });
  });

  it("[BEHAVIORAL] a BasemapOptions change reaches what Generate posts", async () => {
    await renderEditor();

    await act(async () =>
      seen.basemap.at(-1)!.onChange({ basemap: true, panelFormat: "jpeg", panelQuality: 60, panelZoomStep: 0 }),
    );

    expect(seen.basemap.at(-1)!.value).toEqual({ basemap: true, panelFormat: "jpeg", panelQuality: 60, panelZoomStep: 0 });
    expect(seen.generate.at(-1)!.options).toMatchObject({ basemap: true, panelFormat: "jpeg", panelQuality: 60 });

    await act(async () =>
      seen.basemap.at(-1)!.onChange({ basemap: false, panelFormat: "jpeg", panelQuality: 60, panelZoomStep: 0 }),
    );
    expect(seen.generate.at(-1)!.options.basemap).toBe(false);
  });

  it("[BEHAVIORAL] a resolution step reaches Generate as a width sized for the project's own page", async () => {
    await renderEditor();
    // The project is Landscape with non-default margins and a gutter, at 1:24,000.
    const page = toPageSpec(PROJECT);
    const base = panelWidthPxFor(SCALE_PRESETS.find((s) => s.id === "usgs-7-5-min")!, page);
    expect(base).not.toBe(panelWidthPxFor(SCALE_PRESETS.find((s) => s.id === "usgs-7-5-min")!, LETTER_PORTRAIT));

    // The choices handed to the control are this project's, at its extent's latitude.
    expect(seen.basemap.at(-1)!.panelChoices.map((c) => c.panelWidthPx)).toEqual([Math.ceil(base / 2), null, base * 2]);
    expect(seen.basemap.at(-1)!.panelChoices.find((c) => c.step === 0)!.note).toMatch(/41°N/);

    await act(async () =>
      seen.basemap.at(-1)!.onChange({ basemap: true, panelFormat: null, panelQuality: null, panelZoomStep: -1 }),
    );
    expect(seen.generate.at(-1)!.options.panelWidthPx).toBe(Math.ceil(base / 2));
  });
});

describe("ProjectEditorPage wires the Stage 1D furniture", () => {
  it("[BEHAVIORAL] Crop Marks and Page Locator start off and reach what Generate posts", async () => {
    await renderEditor();
    expect(seen.generate.at(-1)!.options).toMatchObject({ cropMarks: false, locatorInset: false });

    fireEvent.click(screen.getByRole("checkbox", { name: /crop marks/i }));
    expect(seen.generate.at(-1)!.options).toMatchObject({ cropMarks: true, locatorInset: false });

    fireEvent.click(screen.getByRole("checkbox", { name: /page locator/i }));
    expect(seen.generate.at(-1)!.options).toMatchObject({ cropMarks: true, locatorInset: true });

    expect(seen.generate.at(-1)!.options).toMatchObject({ worksheet: false });
    fireEvent.click(screen.getByRole("checkbox", { name: /azimuth worksheet/i }));
    expect(seen.generate.at(-1)!.options).toMatchObject({ worksheet: true });
  });
});

describe("ProjectEditorPage wires the worksheet's legs", () => {
  it("[BEHAVIORAL] the landmark-legs box and a hand-picked leg reach what Generate posts", async () => {
    vi.spyOn(api.locations, "list").mockResolvedValue([
      { id: "a", projectId: "p1", name: "Capitol", lng: -96.7, lat: 40.81, label: "L1" },
      { id: "b", projectId: "p1", name: "Haymarket", lng: -96.71, lat: 40.82, label: "L2" },
    ] as never);
    const landmarks = vi.spyOn(api.landmarks, "list").mockResolvedValue([{ id: "w", projectId: "p1", name: "Water Tower", lng: -96.7, lat: 40.81, category: "Tower" }] as never);
    await renderEditor();

    // Nothing to pick until the worksheet is on; then the landmarks are fetched.
    expect(screen.queryByLabelText("Leg start")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /azimuth worksheet/i }));
    await waitFor(() => expect(landmarks).toHaveBeenCalledWith("p1"));
    // Both selects offer it (start and finish).
    expect(await screen.findAllByRole("option", { name: "Water Tower (landmark)" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("checkbox", { name: /legs to nearby landmarks/i }));
    fireEvent.change(screen.getByLabelText("Leg start"), { target: { value: "L2" } });
    fireEvent.change(screen.getByLabelText("Leg finish"), { target: { value: "Water Tower" } });
    fireEvent.click(screen.getByRole("button", { name: "Add leg" }));

    expect(seen.generate.at(-1)!.options).toMatchObject({
      worksheet: true,
      worksheetLandmarks: true,
      worksheetLegs: [{ from: "L2", to: "Water Tower" }],
    });
  });

  it("[BEHAVIORAL] with Include Landmarks off, no landmark legs are offered or sent", async () => {
    vi.spyOn(api.locations, "list").mockResolvedValue([
      { id: "a", projectId: "p1", name: "Capitol", lng: -96.7, lat: 40.81, label: "L1" },
      { id: "b", projectId: "p1", name: "Haymarket", lng: -96.71, lat: 40.82, label: "L2" },
    ] as never);
    vi.spyOn(api.landmarks, "list").mockResolvedValue([{ id: "w", projectId: "p1", name: "Water Tower", lng: -96.7, lat: 40.81, category: "Tower" }] as never);
    await renderEditor();
    fireEvent.click(screen.getByRole("checkbox", { name: /azimuth worksheet/i }));
    expect(await screen.findAllByRole("option", { name: "Water Tower (landmark)" })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Leg finish"), { target: { value: "Water Tower" } });
    fireEvent.click(screen.getByRole("button", { name: "Add leg" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /legs to nearby landmarks/i }));

    fireEvent.click(screen.getByRole("checkbox", { name: /include landmarks/i }));

    expect(screen.queryAllByRole("option", { name: "Water Tower (landmark)" })).toHaveLength(0);
    expect((screen.getByRole("checkbox", { name: /legs to nearby landmarks/i }) as HTMLInputElement).disabled).toBe(true);
    expect(seen.generate.at(-1)!.options).toMatchObject({ worksheetLandmarks: false, worksheetLegs: [] });
  });
});
