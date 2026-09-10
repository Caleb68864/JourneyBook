import { describe, it, expect } from "vitest";
import type { GeneratedPdf } from "../api/client";
import { describePdfHistoryEntry, STUCK_AFTER_MS } from "./pdf-history";

const T0 = Date.parse("2026-09-10T12:00:00Z");

function record(status: string, extra: Partial<GeneratedPdf> = {}): GeneratedPdf {
  return {
    id: "pdf-1",
    projectId: "proj-1",
    status,
    filePath: status === "Completed" ? "atlas.pdf" : null,
    createdAt: new Date(T0).toISOString(),
    expiresAt: null,
    ...extra,
  };
}

describe("describePdfHistoryEntry", () => {
  it("offers Open only for a completed render", () => {
    expect(describePdfHistoryEntry(record("Completed"), T0).downloadable).toBe(true);
    for (const status of ["Pending", "Rendering", "Failed"]) {
      expect(describePdfHistoryEntry(record(status), T0).downloadable, status).toBe(false);
    }
  });

  /**
   * `errorMessage` was added by the async-render commit so a post-response failure
   * would have somewhere to ride home — the 202 is long gone by the time a render
   * fails — and was then rendered nowhere in the app. A failed render was the
   * single word "Failed".
   */
  it("[BEHAVIORAL] surfaces the renderer's diagnostic on a failed render", () => {
    const entry = describePdfHistoryEntry(
      record("Failed", { errorMessage: "Tile fetch failed for 40 of 60 tiles at z16" }),
      T0,
    );

    expect(entry.failed).toBe(true);
    expect(entry.detail).toBe("Tile fetch failed for 40 of 60 tiles at z16");
  });

  it("says so when a failure carries no diagnostic, rather than showing nothing", () => {
    expect(describePdfHistoryEntry(record("Failed"), T0).detail).toMatch(/no diagnostic/i);
    expect(describePdfHistoryEntry(record("Failed", { errorMessage: "  " }), T0).detail)
      .toMatch(/no diagnostic/i);
  });

  it("reads a fresh non-terminal record as in progress", () => {
    expect(describePdfHistoryEntry(record("Pending"), T0 + 1000)).toMatchObject({
      label: "Queued…",
      detail: null,
      failed: false,
    });
    expect(describePdfHistoryEntry(record("Rendering"), T0 + 1000).label).toBe("Rendering…");
  });

  /**
   * The render queue is in-process: restart the API with work outstanding and
   * those rows are never picked up again. The history showed `… · Pending` for
   * ever, with no explanation and no action.
   */
  it("[BEHAVIORAL] tells the user a long-stranded row is not coming back", () => {
    const old = T0 + STUCK_AFTER_MS + 1;

    const pending = describePdfHistoryEntry(record("Pending"), old);
    expect(pending.failed).toBe(true);
    expect(pending.detail).toMatch(/never started/i);
    expect(pending.detail).toMatch(/again/i);

    const rendering = describePdfHistoryEntry(record("Rendering"), old);
    expect(rendering.failed).toBe(true);
    expect(rendering.detail).toMatch(/will not resume/i);
  });

  it("does not call a record stuck when its createdAt is unparseable", () => {
    const entry = describePdfHistoryEntry(record("Pending", { createdAt: "not a date" }), T0);
    expect(entry.failed).toBe(false);
    expect(entry.detail).toBeNull();
  });
});
