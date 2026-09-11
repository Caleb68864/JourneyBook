import { describe, it, expect } from "vitest";
import type { GeneratedPdf } from "../api/client";
import { describePdfHistoryEntry, readDeliveredResolution, STUCK_AFTER_MS } from "./pdf-history";
import { TERMINAL_STATUSES } from "../api/render-polling";

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

/**
 * A cancelled render (ADR 0007).
 *
 * These exist because the bug they describe shipped: `describePdfHistoryEntry`
 * branched on `Completed` and `Failed` and treated everything else as in progress,
 * so a record the server had settled at `Cancelled` was drawn as **"Queued…"** for
 * thirty minutes and then as an interrupted render. That is the same shape as the
 * integration-test helper that polled a cancelled record until it timed out, and as
 * the client union that had never heard of the status — one terminal state, six
 * hand-written lists of which states are terminal.
 */
describe("describePdfHistoryEntry and a cancelled render", () => {
  it("[BEHAVIORAL] labels it Cancelled rather than showing it as still queued", () => {
    const entry = describePdfHistoryEntry(
      record("Cancelled", { errorMessage: "Render was cancelled after 4 of 12 pages." }),
      T0,
    );
    expect(entry.label).toBe("Cancelled");
    expect(entry.detail).toBe("Render was cancelled after 4 of 12 pages.");
    expect(entry.downloadable).toBe(false);
  });

  it("[BEHAVIORAL] does not mark it failed", () => {
    // Nothing went wrong. A red row for something the user asked for sends them
    // looking for a problem that does not exist.
    expect(describePdfHistoryEntry(record("Cancelled"), T0).failed).toBe(false);
  });

  it("falls back to a plain sentence when no reason was recorded", () => {
    expect(describePdfHistoryEntry(record("Cancelled"), T0).detail).toBe("You cancelled this render.");
  });

  it("[BEHAVIORAL] is terminal immediately, not after the stuck window", () => {
    // The defect exactly: with no branch of its own the record fell through to the
    // in-progress path and read "Queued…" until STUCK_AFTER_MS had passed.
    const fresh = describePdfHistoryEntry(record("Cancelled"), T0);
    const old = describePdfHistoryEntry(record("Cancelled"), T0 + STUCK_AFTER_MS + 1);
    expect(fresh.label).toBe("Cancelled");
    expect(old.label).toBe("Cancelled");
    expect(fresh.label).toBe(old.label);
  });

  it("[BEHAVIORAL] any terminal status the server invents is never drawn as in progress", () => {
    // The backstop. A status added server-side and not given a branch here used to
    // be rendered as a spinner; now the fall-through asks `isTerminal`, which is the
    // one statement of the set and is pinned against the C# enum.
    for (const status of TERMINAL_STATUSES) {
      const entry = describePdfHistoryEntry(record(status), T0);
      expect(entry.label, `${status} was drawn as in progress`).not.toContain("…");
    }
    // Control: the in-flight statuses must STILL read as in progress, or the
    // fall-through above has swallowed the whole thing.
    expect(describePdfHistoryEntry(record("Pending"), T0).label).toBe("Queued…");
    expect(describePdfHistoryEntry(record("Rendering"), T0).label).toBe("Rendering…");
  });
});

/**
 * The retention window the server has always enforced and never mentioned.
 *
 * `expiresAt` is stamped on every record from `GeneratedPdf:RetentionDays`
 * (default 30) and `GeneratedPdfRetentionService` deletes the file AND the row on
 * a timer. It is serialized to this app, typed on the `GeneratedPdf` interface,
 * and before this was named in `apps/web` by nothing but a test fixture's `null`.
 * A family's trip atlas disappeared from the history with no notice that it ever
 * had a deadline.
 */
describe("the retention window is visible", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(T0 + ms).toISOString();

  it("[BEHAVIORAL] a completed render says how long its PDF is kept", () => {
    const entry = describePdfHistoryEntry(
      record("Completed", { expiresAt: at(12 * DAY) }),
      T0,
    );
    expect(entry.detail).not.toBeNull();
    expect(entry.detail).toContain("12 days");
    // Still downloadable — this is a notice, not a gate.
    expect(entry.downloadable).toBe(true);
    expect(entry.failed).toBe(false);
  });

  it("[BEHAVIORAL] warns rather than counts when the deadline is inside a day", () => {
    // "0 days" is the wrong thing to print on the row that most needs reading.
    expect(describePdfHistoryEntry(record("Completed", { expiresAt: at(DAY + 1) }), T0).detail)
      .toBe("Kept for 1 more day — download it if you want to keep it.");
    expect(describePdfHistoryEntry(record("Completed", { expiresAt: at(3 * 60 * 60 * 1000) }), T0).detail)
      .toContain("less than a day");
  });

  it("says the file MAY be gone once the window has passed, not that it is", () => {
    // The sweep runs on an interval, not at the instant of expiry, so a row can be
    // past its deadline with the file still on disk and the Open link still
    // working. Claiming it is deleted when it opens is the same class of error as
    // claiming it is safe when it is not.
    const entry = describePdfHistoryEntry(record("Completed", { expiresAt: at(-DAY) }), T0);
    expect(entry.detail).toContain("may already have been deleted");
    expect(entry.downloadable).toBe(true);
  });

  it("[CONTROL] says nothing when the server stamped no deadline", () => {
    // Retention can be disabled, and legacy rows have no `expiresAt`. Printing
    // "expires in 30 days" from a value the server did not send would be a guess
    // about the one thing the server is the authority on.
    expect(describePdfHistoryEntry(record("Completed", { expiresAt: null }), T0).detail).toBeNull();
    expect(describePdfHistoryEntry(record("Completed", { expiresAt: "not a date" }), T0).detail)
      .toBeNull();
  });

  it("[CONTROL] leaves a failed render's diagnostic alone", () => {
    // A failed render has no file to keep, and the detail line is the only channel
    // its diagnostic has. A retention note that displaced it would trade a real
    // fix for a cosmetic one.
    const entry = describePdfHistoryEntry(
      record("Failed", { expiresAt: at(12 * DAY), errorMessage: "Tile fetch failed" }),
      T0,
    );
    expect(entry.detail).toBe("Tile fetch failed");
  });
});

/**
 * The resolution a finished atlas ACTUALLY printed at.
 *
 * The renderer measures it per page and the API stores it on the record's
 * provenance snapshot (`deliveredDpi: {min, max, panels}`, written by
 * `RenderJobRunner.ProvenanceOf`), returned by both the history list and
 * `GET /api/generated-pdfs/{id}`. It reached a queryable record and no screen.
 * The scale picker says what a preset promises; this is what the user's own
 * print achieved, which can differ — an atlas mixes latitudes and scales.
 */
describe("the measured print resolution of a finished atlas", () => {
  const snapshot = (deliveredDpi: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ attribution: "USGS The National Map", deliveredDpi, pageCount: 12, ...extra });

  it("[BEHAVIORAL] reads the renderer's measurement off the record's snapshot", () => {
    expect(readDeliveredResolution(snapshot({ min: 176.2, max: 343.4, panels: 12 }))).toEqual({
      kind: "measured",
      min: 176.2,
      max: 343.4,
      panels: 12,
    });
  });

  it("tells 'no basemap was drawn' apart from 'nobody measured'", () => {
    // The API writes an explicit null for a render with no basemap, precisely so
    // a reader can make this distinction.
    expect(readDeliveredResolution(snapshot(null))).toEqual({ kind: "no-basemap" });
    expect(readDeliveredResolution(JSON.stringify({ attribution: "x" }))).toEqual({ kind: "not-recorded" });
    expect(readDeliveredResolution(null)).toEqual({ kind: "not-recorded" });
    expect(readDeliveredResolution(undefined)).toEqual({ kind: "not-recorded" });
  });

  it("[CONTROL] refuses a snapshot it cannot trust rather than showing a number from it", () => {
    // `POST /api/generated-pdfs` accepts an arbitrary client-supplied snapshot,
    // so the field is not guaranteed to be the renderer's. A figure invented from
    // a malformed one would be worse than saying nothing.
    for (const bad of [
      "not json",
      "[]",
      "42",
      snapshot({ min: "176", max: 343, panels: 12 }),
      snapshot({ min: 176, max: Number.NaN, panels: 12 }),
      snapshot({ min: 0, max: 343, panels: 12 }),
      snapshot({ min: 343, max: 176, panels: 12 }),
      snapshot({ min: 176, max: 343, panels: 0 }),
    ]) {
      expect(readDeliveredResolution(bad), bad).toEqual({ kind: "not-recorded" });
    }
  });

  it("[BEHAVIORAL] a completed row states the range it printed at, in whole DPI", () => {
    const entry = describePdfHistoryEntry(
      record("Completed", { sourceMetadataSnapshot: snapshot({ min: 338.2, max: 352.1, panels: 3 }) }),
      T0,
    );
    expect(entry.resolution?.text).toBe("Printed at 338–352 DPI across 3 map pages.");
    expect(entry.resolution?.belowTarget).toBe(false);
  });

  it("[BEHAVIORAL] flags a render below 300 DPI plainly, as information", () => {
    const entry = describePdfHistoryEntry(
      record("Completed", { sourceMetadataSnapshot: snapshot({ min: 176.2, max: 343.4, panels: 12 }) }),
      T0,
    );
    expect(entry.resolution?.belowTarget).toBe(true);
    expect(entry.resolution?.text).toContain("Printed at 176–343 DPI across 12 map pages.");
    expect(entry.resolution?.text).toMatch(/under 300 DPI/);
    // Information, not an error: the row is not a failure, and the scale is exact.
    expect(entry.failed).toBe(false);
    expect(entry.resolution?.text).toMatch(/scale is still exact/);
  });

  it("the threshold is decided on the figure the user reads", () => {
    // 299.6 is shown as 300, so it must not be called "under 300".
    const entry = describePdfHistoryEntry(
      record("Completed", { sourceMetadataSnapshot: snapshot({ min: 299.6, max: 299.6, panels: 1 }) }),
      T0,
    );
    expect(entry.resolution?.text).toBe("Printed at 300 DPI across 1 map page.");
    expect(entry.resolution?.belowTarget).toBe(false);
  });

  it("says why there is no figure, for each reason there can be none", () => {
    expect(
      describePdfHistoryEntry(record("Completed", { sourceMetadataSnapshot: snapshot(null) }), T0).resolution?.text,
    ).toMatch(/no basemap/i);
    expect(describePdfHistoryEntry(record("Completed"), T0).resolution?.text).toMatch(/not recorded/i);
  });

  it("[CONTROL] only a completed render has a print resolution", () => {
    const measured = snapshot({ min: 176, max: 343, panels: 12 });
    for (const status of ["Pending", "Rendering", "Failed", "Cancelled"]) {
      expect(
        describePdfHistoryEntry(record(status, { sourceMetadataSnapshot: measured }), T0).resolution,
        status,
      ).toBeNull();
    }
  });
});
