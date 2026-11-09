// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  PageSetup,
  type PageSetupValue,
  clampMargin,
  clampGutter,
  MIN_MARGIN_IN,
  MAX_MARGIN_IN,
  OVERLAP_TYPICAL_COST,
} from "./PageSetup";
import { api, type Project } from "../api/client";

/**
 * Orientation, margins, gutter and overlap were plumbed end to end — persisted,
 * validated, carried on the worker payload, honoured by the renderer — and
 * reachable from nowhere in the app. These cases drive the controls the way a
 * user does and assert on the value that would be PUT, so a control that renders
 * and updates nothing fails here rather than shipping.
 */

const INITIAL: PageSetupValue = {
  orientation: "Portrait",
  overlap: 0,
  margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 },
};

/** Holds state like the editor does, and records every committed value. */
function Harness({
  onChange,
  estimatePagesFor,
}: {
  onChange?: (v: PageSetupValue) => void;
  estimatePagesFor?: (v: PageSetupValue) => number | null;
}) {
  const [value, setValue] = useState<PageSetupValue>(INITIAL);
  return (
    <PageSetup
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...(estimatePagesFor ? { estimatePagesFor } : {})}
    />
  );
}

afterEach(cleanup);

describe("PageSetup commits what the user set", () => {
  it("switches orientation", () => {
    const seen: PageSetupValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    fireEvent.click(screen.getByRole("button", { name: "Landscape" }));

    expect(seen.at(-1)!.orientation).toBe("Landscape");
    expect(screen.getByRole("button", { name: "Landscape" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("commits a margin on blur, keeping the other three", () => {
    const seen: PageSetupValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    const left = screen.getByLabelText("left");
    fireEvent.change(left, { target: { value: "0.9" } });
    fireEvent.blur(left);

    expect(seen.at(-1)!.margins).toEqual({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.9, gutter: 0 });
  });

  it("commits the binder gutter", () => {
    const seen: PageSetupValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    const gutter = screen.getByLabelText(/binder gutter/i);
    fireEvent.change(gutter, { target: { value: "0.25" } });
    fireEvent.blur(gutter);

    expect(seen.at(-1)!.margins.gutter).toBe(0.25);
  });

  it("commits overlap as a fraction, not a percentage", () => {
    const seen: PageSetupValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    fireEvent.change(screen.getByLabelText(/page overlap/i), { target: { value: "0.05" } });

    expect(seen.at(-1)!.overlap).toBe(0.05);
  });

  /**
   * [CONTROL] A field left alone must not be rewritten. Because the editor saves
   * through a full PUT, a component that emitted a value for every field on
   * every change would resend — and could round — settings nobody touched.
   */
  it("[CONTROL] emits nothing while a field is only being typed in", () => {
    const seen: PageSetupValue[] = [];
    render(<Harness onChange={(v) => seen.push(v)} />);

    fireEvent.change(screen.getByLabelText("top"), { target: { value: "0." } });
    expect(seen).toEqual([]);

    // And a blur that lands on the same value it started with is not a change.
    const right = screen.getByLabelText("right");
    fireEvent.change(right, { target: { value: "0.5" } });
    fireEvent.blur(right);
    expect(seen).toEqual([]);
  });
});

describe("PageSetup shows what overlap costs", () => {
  /** A stand-in for the engine's `pageGridSize`: overlap shrinks the step. */
  const estimate = (v: PageSetupValue): number => (v.overlap === 0 ? 30 : 36);

  it("names the extra pages at the control that buys them", () => {
    render(<Harness estimatePagesFor={estimate} />);

    fireEvent.change(screen.getByLabelText(/page overlap/i), { target: { value: "0.05" } });

    const cost = screen.getByTestId("overlap-cost").textContent ?? "";
    expect(cost).toContain("36 pages");
    expect(cost).toContain("+20%");
    expect(cost).toContain("30");
  });

  it("says so plainly when this box costs nothing", () => {
    // Roughly a third of extents gain no row or column, so the honest answer for
    // them is zero — not the +11% average, which is a statement about other
    // people's boxes.
    render(<Harness estimatePagesFor={() => 30} />);
    fireEvent.change(screen.getByLabelText(/page overlap/i), { target: { value: "0.1" } });

    expect(screen.getByTestId("overlap-cost").textContent).toMatch(/no extra pages/i);
  });

  it("admits it cannot answer without an extent", () => {
    render(<Harness estimatePagesFor={() => null} />);
    expect(screen.getByTestId("overlap-cost").textContent).toMatch(/set a bounding box/i);
  });
  /**
   * Decision 7 asks for the cost at the control even before an extent exists.
   * The typical range sits beside the select, always, and it is a range: an
   * edit that collapses it to "+11%" alone fails here.
   */
  it("states the typical range beside the control, with or without an extent", () => {
    render(<Harness estimatePagesFor={() => null} />);
    const typical = screen.getByTestId("overlap-typical").textContent ?? "";
    expect(typical).toBe(OVERLAP_TYPICAL_COST);
    expect(typical).toMatch(/\b0%/);
    expect(typical).toContain("+50%");
    expect(typical).toContain("+11%");
    // The range was measured at 5% overlap only; it must say so, because the
    // select offers up to 25%, where the cost is several times larger.
    expect(typical).toMatch(/at 5% overlap/i);
  });
});

/**
 * The hop the PageSetup tests above stop short of: a committed value has to
 * become the PUT body. The editor hands `next` straight to `api.projects.patch`
 * (`ProjectEditorPage.handlePageSetupChange`); this composes the real component
 * with the real client against a stubbed fetch, so a PageSetupValue key that
 * `patch` does not read, or a patch that drops margins.gutter, fails here.
 */
describe("PageSetup reaches the PUT body", () => {
  const PROJECT: Project = {
    id: "p1",
    name: "Sandhills",
    scalePresetId: "usgs-7-5-min",
    orientation: "Portrait",
    overlap: 0,
    explorerName: null,
    atlasDate: null,
    margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 },
    extent: [-98, 41, -97, 42],
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
  };

  afterEach(() => vi.unstubAllGlobals());

  async function putBodyAfter(act: () => void): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(String(init?.body ?? "{}"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending: Promise<unknown>[] = [];
    render(<Harness onChange={(next) => pending.push(api.projects.patch(PROJECT, next))} />);
    act();
    await Promise.all(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/projects\/p1$/);
    expect(init!.method).toBe("PUT");
    return JSON.parse(String(init!.body));
  }

  it("[BEHAVIORAL] landscape goes on the wire, scale untouched", async () => {
    const body = await putBodyAfter(() =>
      fireEvent.click(screen.getByRole("button", { name: "Landscape" })),
    );
    expect(body.orientation).toBe("Landscape");
    expect(body.scalePresetId).toBe("usgs-7-5-min");
  });

  it("[BEHAVIORAL] a margin goes on the wire", async () => {
    const body = await putBodyAfter(() => {
      const top = screen.getByLabelText("top");
      fireEvent.change(top, { target: { value: "1.25" } });
      fireEvent.blur(top);
    });
    expect(body.margins).toEqual({ top: 1.25, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0 });
  });

  it("[BEHAVIORAL] a gutter goes on the wire with the four margins intact", async () => {
    const body = await putBodyAfter(() => {
      const gutter = screen.getByLabelText(/binder gutter/i);
      fireEvent.change(gutter, { target: { value: "0.3" } });
      fireEvent.blur(gutter);
    });
    expect(body.margins).toEqual({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5, gutter: 0.3 });
  });

  it("[BEHAVIORAL] overlap goes on the wire as a fraction", async () => {
    const body = await putBodyAfter(() =>
      fireEvent.change(screen.getByLabelText(/page overlap/i), { target: { value: "0.1" } }),
    );
    expect(body.overlap).toBe(0.1);
  });
});

describe("margin clamps", () => {
  it("keeps a margin printable", () => {
    expect(clampMargin(0, 0.5)).toBe(MIN_MARGIN_IN);
    expect(clampMargin(99, 0.5)).toBe(MAX_MARGIN_IN);
    expect(clampMargin(Number.NaN, 0.5)).toBe(0.5);
    expect(clampMargin(0.75, 0.5)).toBe(0.75);
  });

  it("lets the gutter be zero — that is 'no binder', not 'no margin'", () => {
    expect(clampGutter(0, 0.25)).toBe(0);
    expect(clampGutter(-1, 0.25)).toBe(0);
    expect(clampGutter(99, 0.25)).toBe(MAX_MARGIN_IN);
  });
});
