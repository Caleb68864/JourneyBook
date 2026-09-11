// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BasemapOptions } from "./BasemapOptions";
import { DEFAULT_RENDER_OPTIONS, toRenderRequestBody, type RenderOptionsState } from "../lib/render-options";

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

/** Host that holds the state, so the component is exercised as it is used. */
function Harness({ onBody }: { onBody: (body: ReturnType<typeof toRenderRequestBody>) => void }) {
  const [value, setValue] = useState<RenderOptionsState>(DEFAULT_RENDER_OPTIONS);
  return (
    <div>
      <BasemapOptions
        value={value}
        onChange={(next) => setValue((v) => ({ ...v, ...next }))}
      />
      <button type="button" onClick={() => onBody(toRenderRequestBody(value))}>
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
