// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BasemapOptions } from "./BasemapOptions";
import { DEFAULT_RENDER_OPTIONS, toRenderRequestBody, type RenderOptionsState } from "../lib/render-options";
import { panelStepChoices, type PanelZoomStep } from "../lib/panel-resolution";
import { LETTER_PORTRAIT, SCALE_PRESETS, panelWidthPxFor, type PageSpec } from "@journeybook/atlas-core";

/**
 * A control that renders and a mapping that is correct are two facts. The defect
 * this file exists to prevent is the third one being false: the control renders,
 * the mapping is right, and nothing connects them.
 *
 * So each case drives the real DOM control the way a user does and then runs the
 * resulting state through `toRenderRequestBody` — the same function
 * `GenerateButton` posts — and asserts on the body. A checkbox that updates
 * nothing, or updates the wrong field, fails here.
 */

/**
 * Host that holds the state, so the component is exercised as it is used. The
 * step-to-width mapping is the editor's (`ProjectEditorPage`): it derives
 * `panelWidthPx` from the chosen step's choice, which this does the same way.
 */
function Harness({
  onBody,
  scaleId = "1-100000",
  page = LETTER_PORTRAIT,
  lat = 41,
}: {
  onBody: (body: ReturnType<typeof toRenderRequestBody>) => void;
  scaleId?: string;
  page?: PageSpec;
  lat?: number | null;
}) {
  const [value, setValue] = useState<RenderOptionsState & { panelZoomStep: PanelZoomStep }>({
    ...DEFAULT_RENDER_OPTIONS,
    panelZoomStep: 0,
  });
  const choices = panelStepChoices(SCALE_PRESETS.find((s) => s.id === scaleId)!, page, lat);
  const panelWidthPx = choices.find((c) => c.step === value.panelZoomStep)?.panelWidthPx ?? null;
  return (
    <div>
      <BasemapOptions
        value={value}
        panelChoices={choices}
        onChange={(next) => setValue((v) => ({ ...v, ...next }))}
      />
      <button type="button" onClick={() => onBody(toRenderRequestBody({ ...value, panelWidthPx }))}>
        capture
      </button>
    </div>
  );
}

afterEach(cleanup);

describe("BasemapOptions reaches the request", () => {
  it("[CONTROL] renders the engine's defaults, and asks for nothing extra", () => {
    const bodies: unknown[] = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    expect((screen.getByLabelText(/panel format/i) as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(bodies[0]).toMatchObject({ basemap: true });
    expect(bodies[0]).not.toHaveProperty("panelFormat");
    expect(bodies[0]).not.toHaveProperty("panelQuality");
    expect(bodies[0]).not.toHaveProperty("panelWidthPx");
  });

  it("unchecking the basemap sends basemap:false", () => {
    const bodies: Array<{ basemap: boolean }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    const checkbox = screen.getByRole("checkbox", { name: /basemap/i });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: "capture" }));
    expect(bodies[0]!.basemap).toBe(false);
  });

  it("choosing PNG sends panelFormat:png", () => {
    const bodies: Array<{ panelFormat?: string }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    fireEvent.change(screen.getByLabelText(/panel format/i), { target: { value: "png" } });
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(bodies[0]!.panelFormat).toBe("png");
  });

  it("moving the quality slider sends that quality", () => {
    const bodies: Array<{ panelQuality?: number }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    fireEvent.change(screen.getByLabelText(/panel quality/i), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(bodies[0]!.panelQuality).toBe(60);
  });

  it("shows what the quality costs, next to the control that costs it", () => {
    render(<Harness onBody={() => undefined} />);

    // Default: no number to promise, so it says what the engine will do.
    expect(screen.getByTestId("quality-cost").textContent).toMatch(/engine default \(90\)/i);

    fireEvent.change(screen.getByLabelText(/panel quality/i), { target: { value: "70" } });
    // 18.99 MB against 42.03 MB on the measured atlas — under half.
    expect(screen.getByTestId("quality-cost").textContent).toMatch(/about 0\.4\dx/i);
  });

  it("says the slider is inert for PNG rather than leaving it live", () => {
    render(<Harness onBody={() => undefined} />);

    fireEvent.change(screen.getByLabelText(/panel format/i), { target: { value: "png" } });

    expect((screen.getByLabelText(/panel quality/i) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("quality-cost").textContent).toMatch(/lossless/i);
  });

  it("hides the encoder controls when there is nothing to encode", () => {
    render(<Harness onBody={() => undefined} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /basemap/i }));

    expect(screen.queryByLabelText(/panel format/i)).toBeNull();
    expect(screen.queryByLabelText(/panel quality/i)).toBeNull();
  });
});

/**
 * `panelWidthPx` was reachable through the API (`RenderProjectRequest.PanelWidthPx`)
 * and `--panel-px`, and not from the app (Decision 7). The control offers tile
 * zoom steps; these drive the real select and read the body that goes out.
 */
describe("BasemapOptions panel resolution reaches the request", () => {
  const preset = (id: string) => SCALE_PRESETS.find((s) => s.id === id)!;

  it("one zoom finer sends twice the scale's own width for this page", () => {
    const bodies: Array<{ panelWidthPx?: number }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(bodies[0]!.panelWidthPx).toBe(panelWidthPxFor(preset("1-100000"), LETTER_PORTRAIT) * 2);
  });

  it("one zoom coarser sends half of it, sized for the user's page, not Letter portrait", () => {
    const landscape: PageSpec = { ...LETTER_PORTRAIT, orientation: "landscape" };
    const bodies: Array<{ panelWidthPx?: number }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} page={landscape} />);

    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    const base = panelWidthPxFor(preset("1-100000"), landscape);
    expect(base).not.toBe(panelWidthPxFor(preset("1-100000"), LETTER_PORTRAIT));
    expect(bodies[0]!.panelWidthPx).toBe(Math.ceil(base / 2));
  });

  it("[CONTROL] going back to the scale default sends no width at all", () => {
    const bodies: Array<{ panelWidthPx?: number }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(bodies[0]).not.toHaveProperty("panelWidthPx");
  });

  it("sends no width when the basemap is off", () => {
    const bodies: Array<{ panelWidthPx?: number }> = [];
    render(<Harness onBody={(b) => bodies.push(b)} />);

    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /basemap/i }));
    fireEvent.click(screen.getByRole("button", { name: "capture" }));

    expect(screen.queryByLabelText(/panel resolution/i)).toBeNull();
    expect(bodies[0]).not.toHaveProperty("panelWidthPx");
  });

  it("shows what the chosen step delivers at the project's latitude", () => {
    render(<Harness onBody={() => undefined} />);
    const note = () => screen.getByTestId("panel-resolution-note").textContent ?? "";

    expect(note()).toMatch(/DPI at 41°N \(z14\)/);
    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "1" } });
    expect(note()).toMatch(/DPI at 41°N \(z15\)/);
  });

  it("says the finer step does nothing where the basemap has no finer tiles", () => {
    // 1:24,000 at 41°N already renders at USGS Topo's deepest zoom (z16).
    render(<Harness onBody={() => undefined} scaleId="usgs-7-5-min" />);

    const finer = screen.getByRole("option", { name: /finer/i });
    expect(finer.textContent).toMatch(/no effect here/i);
    fireEvent.change(screen.getByLabelText(/panel resolution/i), { target: { value: "1" } });
    expect(screen.getByTestId("panel-resolution-note").textContent).toMatch(/no effect at 41°N/i);
  });
});
