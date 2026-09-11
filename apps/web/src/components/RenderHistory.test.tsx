// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import type { GeneratedPdf } from "../api/client";
import { RenderHistory } from "./RenderHistory";

/**
 * The render history is where a finished atlas is listed, so it is where the
 * resolution that atlas ACTUALLY printed at has to appear. It was on the record
 * (`sourceMetadataSnapshot.deliveredDpi`) and on the wire, and on no screen.
 *
 * This list used to be inline JSX in `ProjectEditorPage`, which imports
 * `MapPreview` and so cannot load under jsdom — the reason the previous change
 * stopped at the record: "a render-history line would need JSX this app's test
 * setup cannot pin". It is now its own component, so it can.
 */

const T0 = Date.parse("2026-09-10T12:00:00Z");

function pdf(id: string, status: string, extra: Partial<GeneratedPdf> = {}): GeneratedPdf {
  return {
    id,
    projectId: "proj-1",
    status,
    filePath: status === "Completed" ? `${id}.pdf` : null,
    createdAt: new Date(T0 - 60_000).toISOString(),
    expiresAt: null,
    ...extra,
  };
}

const measured = (min: number, max: number, panels: number) =>
  JSON.stringify({ attribution: "USGS The National Map", deliveredDpi: { min, max, panels }, pageCount: panels });

afterEach(cleanup);

describe("RenderHistory shows what each finished atlas printed at", () => {
  it("[BEHAVIORAL] a finished atlas shows its measured resolution beside its Open link", () => {
    render(
      <RenderHistory
        now={T0}
        onRefresh={() => {}}
        pdfs={[pdf("a", "Completed", { sourceMetadataSnapshot: measured(338.2, 352.1, 3) })]}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: /open/i })).toBeTruthy();
    expect(row.textContent).toContain("Printed at 338–352 DPI across 3 map pages.");
    expect(row.textContent).not.toMatch(/under 300/);
  });

  it("[BEHAVIORAL] one below 300 DPI says so plainly — not in the failure colour", () => {
    render(
      <RenderHistory
        now={T0}
        onRefresh={() => {}}
        pdfs={[pdf("a", "Completed", { sourceMetadataSnapshot: measured(176.2, 343.4, 12) })]}
      />,
    );
    const line = screen.getByText(/Printed at 176–343 DPI/);
    expect(line.textContent).toMatch(/under 300 DPI/);
    // Information, not an error: styled like the row's other information.
    expect(line.className).not.toMatch(/campfire/);
  });

  it("each row carries its own figure", () => {
    render(
      <RenderHistory
        now={T0}
        onRefresh={() => {}}
        pdfs={[
          pdf("a", "Completed", { sourceMetadataSnapshot: measured(338, 338, 1) }),
          pdf("b", "Completed", { sourceMetadataSnapshot: measured(279.4, 585, 9) }),
          pdf("c", "Failed", { errorMessage: "Tile fetch failed", sourceMetadataSnapshot: measured(300, 300, 1) }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Printed at 338 DPI across 1 map page.");
    expect(rows[1]!.textContent).toContain("Printed at 279–585 DPI across 9 map pages.");
    // A failed render printed nothing, so it has no resolution to state.
    expect(rows[2]!.textContent).not.toMatch(/Printed at/);
    expect(rows[2]!.textContent).toContain("Tile fetch failed");
  });

  it("[CONTROL] still lists, refreshes and says when there is nothing yet", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<RenderHistory now={T0} onRefresh={onRefresh} pdfs={[]} />);
    expect(screen.getByText(/no pdfs generated yet/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <RenderHistory
        now={T0}
        onRefresh={onRefresh}
        pdfs={Array.from({ length: 10 }, (_, i) => pdf(`p${i}`, "Completed"))}
      />,
    );
    // The editor has always shown the latest eight.
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });
});
