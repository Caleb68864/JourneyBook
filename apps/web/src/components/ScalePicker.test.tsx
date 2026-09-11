// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { SCALE_PRESETS } from "@journeybook/atlas-core";
import table from "../generated/print-resolution.json";
import { ScalePicker } from "./ScalePicker";

/**
 * The scale picker is where a user decides how their atlas will print, so it is
 * where each preset's REAL resolution has to be — the generated table, not a
 * figure somebody typed. Every expectation below reads the table itself, so the
 * test moves with a regenerated table and fails if the picker stops showing it.
 */

const row = (id: string) => table.presets.find((p) => p.id === id)!;
const range = (p: { minDpi: number; maxDpi: number }) => `${p.minDpi}–${p.maxDpi} DPI`;

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <ScalePicker value={value} onChange={setValue} />;
}

afterEach(cleanup);

describe("ScalePicker shows each preset's real print resolution", () => {
  it("[BEHAVIORAL] every option carries its preset's delivered DPI range", () => {
    render(<Harness initial="usgs-7-5-min" />);
    const select = screen.getByLabelText(/map scale/i) as HTMLSelectElement;
    const options = within(select).getAllByRole("option") as HTMLOptionElement[];

    expect(options.map((o) => o.value)).toEqual(SCALE_PRESETS.map((p) => p.id));
    for (const option of options) {
      const p = row(option.value);
      expect(option.textContent, option.value).toContain(p.label);
      expect(option.textContent, option.value).toContain(range(p));
    }
  });

  it("[BEHAVIORAL] the default preset: its band, the one-degree cliff, and why a wider panel is not the fix", () => {
    render(<Harness initial="usgs-7-5-min" />);
    const p = row("usgs-7-5-min");
    const note = screen.getByTestId("scale-resolution-note");
    const text = note.textContent ?? "";

    expect(text).toContain(range(p));
    expect(text).toContain("depending on latitude");
    const s = p.steepestStep;
    expect(text).toContain(`${s.fromDpi} DPI at ${s.fromLat}°N, ${s.toDpi} at ${s.toLat}°N`);
    expect(text).toMatch(/halve/);
    expect(text).toMatch(/not panel width/);
    expect(text).toContain(`${p.atTargetRequest.minDpi}`);

    // Announced with the control, not just painted near it.
    const select = screen.getByLabelText(/map scale/i);
    expect(select.getAttribute("aria-describedby")).toBe(note.id);
  });

  it("[BEHAVIORAL] picking another scale changes the note to that preset's figures", () => {
    render(<Harness initial="usgs-7-5-min" />);
    const select = screen.getByLabelText(/map scale/i);

    fireEvent.change(select, { target: { value: "1-50000" } });
    let text = screen.getByTestId("scale-resolution-note").textContent ?? "";
    expect(text).toContain(range(row("1-50000")));
    expect(text).toMatch(/every latitude/);
    expect(text).not.toContain(range(row("usgs-7-5-min")));

    // The raised preset the z16 ceiling stops short says where, rather than
    // being grouped with the ones that clear 300 DPI everywhere.
    fireEvent.change(select, { target: { value: "1-25000" } });
    text = screen.getByTestId("scale-resolution-note").textContent ?? "";
    const r25 = row("1-25000");
    expect(r25.belowTargetLats.length).toBeGreaterThan(0);
    expect(text).toContain(range(r25));
    expect(text).toMatch(/except at/);
    expect(text).not.toMatch(/every latitude/);
  });

  it("links to the documentation generated from the same table", () => {
    render(<Harness initial="usgs-7-5-min" />);
    const link = screen.getByRole("link", { name: /print resolution/i }) as HTMLAnchorElement;
    expect(link.href.endsWith(`/${table.doc}`)).toBe(true);
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });
});
