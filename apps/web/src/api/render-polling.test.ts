import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  waitForRender,
  isTerminal,
  phaseLabel,
  progressOf,
  KNOWN_PHASES,
  TERMINAL_STATUSES,
} from "./render-polling";
import type { GeneratedPdf } from "./client";

/**
 * The Generate button used to sit on one synchronous POST that did not answer
 * until the whole atlas was rendered. It now gets a 202 and a `Pending` record,
 * so the download URL in that answer points at a file that does not exist yet.
 *
 * Every test here fails against the old behaviour of "take the response and open
 * the download": the first because it would open on `Pending`, the second because
 * a failure would surface as a success, the third because there was nothing to
 * report progress with.
 */

function record(status: string, extra: Partial<GeneratedPdf> = {}): GeneratedPdf {
  return {
    id: "pdf-1",
    projectId: "proj-1",
    status,
    filePath: status === "Completed" ? "atlas-pdf1.pdf" : null,
    createdAt: "2026-09-09T00:00:00Z",
    expiresAt: null,
    ...extra,
  };
}

/** A fetchStatus that walks a scripted sequence of statuses, one per call. */
function scripted(statuses: GeneratedPdf[]) {
  let i = 0;
  return vi.fn(async () => statuses[Math.min(i++, statuses.length - 1)]!);
}

const noSleep = async () => {};

describe("waitForRender", () => {
  it("does not resolve while the record is Pending or Rendering", async () => {
    const fetchStatus = scripted([
      record("Pending"),
      record("Pending"),
      record("Rendering"),
      record("Rendering"),
      record("Completed"),
    ]);

    const result = await waitForRender("pdf-1", { fetchStatus, sleep: noSleep });

    // Five polls, not one: the non-terminal statuses were kept waiting on.
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    expect(result.status).toBe("Completed");
    expect(result.filePath).toBe("atlas-pdf1.pdf");
  });

  it("reports each distinct status once, in order, and never repeats one", async () => {
    const seen: string[] = [];
    const fetchStatus = scripted([
      record("Pending"),
      record("Pending"),
      record("Rendering"),
      record("Completed"),
    ]);

    await waitForRender("pdf-1", { fetchStatus, sleep: noSleep, onStatus: (s) => seen.push(s) });

    expect(seen).toEqual(["Pending", "Rendering", "Completed"]);
  });

  it("rejects with the server's diagnostic when the render Fails", async () => {
    const fetchStatus = scripted([
      record("Rendering"),
      record("Failed", { errorMessage: "Render worker returned 502: tile fetch failed" }),
    ]);

    await expect(waitForRender("pdf-1", { fetchStatus, sleep: noSleep })).rejects.toThrow(
      "Render worker returned 502: tile fetch failed",
    );
  });

  it("rejects with a fallback message when a Failed record carries no diagnostic", async () => {
    const fetchStatus = scripted([record("Failed", { errorMessage: null })]);

    await expect(waitForRender("pdf-1", { fetchStatus, sleep: noSleep })).rejects.toThrow(
      /Render failed/,
    );
  });

  it("gives up after the timeout and says the render is still running", async () => {
    const fetchStatus = scripted([record("Rendering")]);
    // A clock that jumps a minute per read; the timeout is 10s, so the deadline is
    // past on the very first check.
    let t = 0;
    const now = () => (t += 60_000);

    await expect(
      waitForRender("pdf-1", { fetchStatus, sleep: noSleep, now, timeoutMs: 10_000 }),
    ).rejects.toThrow(/still running/);
  });

  it("prefers a terminal status arriving on the deadline poll over the timeout", async () => {
    // The record completed during the last sleep. The status is read before the
    // deadline is checked, so this is a success, not a timeout.
    const fetchStatus = scripted([record("Completed")]);
    let t = 0;
    const now = () => (t += 60_000);

    const result = await waitForRender("pdf-1", {
      fetchStatus,
      sleep: noSleep,
      now,
      timeoutMs: 10_000,
    });
    expect(result.status).toBe("Completed");
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchStatus = scripted([record("Pending")]);

    await expect(
      waitForRender("pdf-1", { fetchStatus, sleep: noSleep, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("waits the requested interval between polls", async () => {
    const sleep = vi.fn(async () => {});
    const fetchStatus = scripted([record("Pending"), record("Completed")]);

    await waitForRender("pdf-1", { fetchStatus, sleep, intervalMs: 2500 });

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2500);
  });
});

describe("isTerminal", () => {
  it("treats only Completed and Failed as terminal", () => {
    expect(isTerminal("Completed")).toBe(true);
    expect(isTerminal("Failed")).toBe(true);
    expect(isTerminal("Pending")).toBe(false);
    expect(isTerminal("Rendering")).toBe(false);
  });
});

/**
 * A row can be stranded at `Pending` for ever: the render queue is in-process, so
 * an API restart with work outstanding leaves records nothing will ever pick up.
 * The timeout message said "The render is still running — check this project's PDF
 * history for it." Both halves are false in that case: the render is not still
 * running (the queue died with the process) and the history has nothing to find.
 *
 * The distinction is available for free — the record's own status. `Rendering`
 * means the API had the job in flight; `Pending` means it never started.
 */
describe("waitForRender timeout diagnostics", () => {
  it("[BEHAVIORAL] does not claim a never-started render is still running", async () => {
    const fetchStatus = scripted([record("Pending")]);
    let t = 0;
    const now = () => (t += 60_000);

    const error: Error = await waitForRender("pdf-1", {
      fetchStatus,
      sleep: noSleep,
      now,
      timeoutMs: 10_000,
    }).then(
      () => {
        throw new Error("waitForRender resolved a Pending record");
      },
      (e: unknown) => e as Error,
    );

    expect(error.message).toMatch(/queued/i);
    expect(error.message).not.toMatch(/still running/i);
    // It must say what to do instead of pointing at a history that has nothing.
    expect(error.message).toMatch(/again/i);
  });

  it("still says a Rendering record may be in flight", async () => {
    const fetchStatus = scripted([record("Rendering")]);
    let t = 0;
    const now = () => (t += 60_000);

    await expect(
      waitForRender("pdf-1", { fetchStatus, sleep: noSleep, now, timeoutMs: 10_000 }),
    ).rejects.toThrow(/still running/);
  });
});

/**
 * Progress and cancellation (ADR 0007).
 *
 * Each of these fails against the behaviour before the worker owned the job: the
 * record carried no position at all, and `Cancelled` was not a status the API
 * could produce or this module could recognise.
 */
describe("progressOf", () => {
  it("[BEHAVIORAL] turns pages-of-pages into a percentage", () => {
    expect(progressOf({ progress: 3, pageCount: 12, phase: "panel" })).toEqual({
      progress: 3,
      pageCount: 12,
      percent: 25,
      phase: "panel",
    });
  });

  it("[BEHAVIORAL] carries the engine's phase through rather than dropping it", () => {
    // The whole finding: the engine reports a phase, the worker records it, the
    // API's client parses it — and the record had no column for it, so the only
    // reader anywhere in the repo was a .NET test. `toEqual` above is the guard
    // that a new field cannot be added to the snapshot without being considered;
    // this is the guard that THIS one arrives.
    expect(progressOf({ progress: 12, pageCount: 12, phase: "pdf" }).phase).toBe("pdf");
    expect(progressOf({ progress: 0, pageCount: 0, phase: "contract" }).phase).toBe("contract");
  });

  it("reports no phase, rather than a guessed one, when the record carries none", () => {
    expect(progressOf({ progress: 1, pageCount: 2 }).phase).toBeNull();
    expect(progressOf({ progress: 1, pageCount: 2, phase: null }).phase).toBeNull();
  });

  it("[BEHAVIORAL] has no percentage before the worker has reported a page count", () => {
    // Null, not 0. An invented percentage is a bar pinned at 0% that then jumps,
    // and is indistinguishable from a render that has genuinely stalled — which is
    // precisely the thing a progress indicator exists to tell apart.
    expect(progressOf({ progress: null, pageCount: null }).percent).toBeNull();
    expect(progressOf({ progress: 0, pageCount: null }).percent).toBeNull();
    expect(progressOf({ progress: 4, pageCount: 0 }).percent).toBeNull();
  });

  it("clamps rather than emitting a percentage outside 0–100", () => {
    expect(progressOf({ progress: 99, pageCount: 10 }).percent).toBe(100);
    expect(progressOf({ progress: -5, pageCount: 10 }).percent).toBe(0);
  });
});

describe("waitForRender progress", () => {
  it("[BEHAVIORAL] reports each distinct position once, in order", () => {
    const seen: (number | null)[] = [];
    const fetchStatus = scripted([
      record("Pending"),
      record("Rendering", { progress: 0, pageCount: 6 }),
      record("Rendering", { progress: 1, pageCount: 6 }),
      // Repeated on purpose: the client polls faster than the worker renders, so
      // most polls carry the same position. Announcing each would make a status
      // line flicker and, in the API's own poll loop, be a database write per poll.
      record("Rendering", { progress: 1, pageCount: 6 }),
      record("Rendering", { progress: 4, pageCount: 6 }),
      record("Completed", { progress: 6, pageCount: 6 }),
    ]);

    return waitForRender("pdf-1", {
      fetchStatus,
      sleep: noSleep,
      onProgress: (p) => seen.push(p.progress),
    }).then(() => {
      expect(seen).toEqual([null, 0, 1, 4, 6]);
    });
  });

  it("[BEHAVIORAL] announces the last position even when that poll is the terminal one", async () => {
    // A fast render can go from "no position" straight to Completed in one poll.
    // Reporting after the terminal check would leave such a render's bar sitting at
    // "starting…" for ever.
    const seen: number[] = [];
    const fetchStatus = scripted([record("Completed", { progress: 2, pageCount: 2 })]);

    await waitForRender("pdf-1", {
      fetchStatus,
      sleep: noSleep,
      onProgress: (p) => {
        if (p.progress !== null) seen.push(p.progress);
      },
    });

    expect(seen).toEqual([2]);
  });

  it("[CONTROL — must be accepted] a record that reports no position still completes", async () => {
    const fetchStatus = scripted([record("Rendering"), record("Completed")]);
    const result = await waitForRender("pdf-1", { fetchStatus, sleep: noSleep });
    expect(result.status).toBe("Completed");
  });
});

describe("waitForRender and a cancelled render", () => {
  it("[BEHAVIORAL] Cancelled is terminal", () => {
    expect(isTerminal("Cancelled")).toBe(true);
    expect(TERMINAL_STATUSES).toContain("Cancelled");
    // The control: an in-flight status must still NOT be terminal, or the whole
    // poll loop would exit on its first read.
    expect(isTerminal("Rendering")).toBe(false);
    expect(isTerminal("Pending")).toBe(false);
  });

  it("[BEHAVIORAL] rejects with the record's own wording, not the failure boilerplate", async () => {
    const fetchStatus = scripted([
      record("Rendering", { progress: 4, pageCount: 12 }),
      record("Cancelled", { errorMessage: "Render was cancelled after 4 of 12 pages." }),
    ]);

    const err = await waitForRender("pdf-1", { fetchStatus, sleep: noSleep }).catch((e: unknown) => e);

    expect((err as Error).message).toBe("Render was cancelled after 4 of 12 pages.");
    // The generic failure message sends someone who pressed Cancel to look in the
    // API logs for a diagnostic that does not exist.
    expect((err as Error).message).not.toContain("See the API logs");
  });

  it("falls back to a plain sentence when a cancelled record carries no message", async () => {
    const fetchStatus = scripted([record("Cancelled")]);
    const err = await waitForRender("pdf-1", { fetchStatus, sleep: noSleep }).catch((e: unknown) => e);
    expect((err as Error).message).toBe("Render was cancelled.");
  });
});

describe("phaseLabel", () => {
  it("[BEHAVIORAL] names the two phases the page counter cannot describe", () => {
    // These are the whole reason the field is worth carrying. `progress` counts
    // finished basemap PANELS, so at `pdf` it already equals `pageCount` and the
    // bar reads 100% for the whole of PDF assembly; and before the contract is
    // derived there is no denominator at all. Both look like a stall.
    expect(phaseLabel("pdf")).toBe("Building the PDF");
    expect(phaseLabel("contract")).toBe("Working out the pages");
    expect(phaseLabel("overview")).toBe("Drawing the overview");
  });

  it("says nothing during `panel`, where the counter is already moving", () => {
    expect(phaseLabel("panel")).toBeNull();
  });

  it("says nothing for a phase it has never seen, rather than guessing", () => {
    // This crosses two process boundaries from another language. A worker
    // deployed ahead of the web app must not make the label read
    // "undefined…" — saying nothing is the honest fallback.
    expect(phaseLabel("some-future-phase")).toBeNull();
    expect(phaseLabel(null)).toBeNull();
    expect(phaseLabel(undefined)).toBeNull();
    expect(phaseLabel("done")).toBeNull();
  });
});

/**
 * The engine's phase vocabulary exists in two languages and nothing compared them.
 *
 * Same shape, and the same fix, as `TERMINAL_STATUSES` against the C# `PdfStatus`
 * enum — and the same reason it matters: renaming a phase in `render.ts` leaves
 * `phaseLabel` returning null for the new word, which is the SOFT failure (the
 * label quietly goes back to "Rendering…") rather than a loud one. A soft failure
 * in a copy nobody re-derives is how the phase came to be dropped in the first
 * place.
 *
 * Reads the union out of the real engine source rather than restating it, per the
 * lesson recorded with `ScalePresetParityTests`: do not compare against a frozen
 * artefact, and refuse rather than degrade when the parse finds nothing.
 */
describe("the phase vocabulary matches the engine's", () => {
  function enginePhases(): string[] {
    const source = readFileSync(
      fileURLToPath(new URL("../../../../packages/render-cli/src/render.ts", import.meta.url)),
      "utf8",
    );
    const match = /\n\s*phase:\s*((?:"[a-z]+"\s*\|\s*)*"[a-z]+")\s*;/.exec(source);
    const union = match?.[1];
    if (union === undefined) {
      throw new Error(
        "Could not find the `phase:` union in packages/render-cli/src/render.ts. " +
          "If it moved or changed shape, fix this parser — do not let the parity check " +
          "quietly pass on nothing.",
      );
    }
    return [...union.matchAll(/"([a-z]+)"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
  }

  it("[CONTROL] actually parsed the engine's union", () => {
    // Two empty sets are equal. Without this the comparison below is satisfied by
    // a regex that matched nothing.
    const phases = enginePhases();
    expect(phases.length).toBeGreaterThanOrEqual(4);
    expect(phases).toContain("panel");
  });

  it("[BEHAVIORAL] knows every phase the engine can emit", () => {
    const unknown = enginePhases().filter((p) => !KNOWN_PHASES.includes(p));
    expect(unknown).toEqual([]);
  });

  it("[BEHAVIORAL] claims no phase the engine cannot emit", () => {
    const phases = enginePhases();
    const stale = KNOWN_PHASES.filter((p) => !phases.includes(p));
    expect(stale).toEqual([]);
  });

  it("has considered every known phase — labelled or deliberately silent", () => {
    // `panel` and `done` are silent on purpose; the point is that each was a
    // decision. A phase in the engine and in neither branch is one nobody looked at.
    const labelled = KNOWN_PHASES.filter((p) => phaseLabel(p) !== null);
    const silent = KNOWN_PHASES.filter((p) => phaseLabel(p) === null);
    expect(labelled.sort()).toEqual(["contract", "overview", "pdf"]);
    expect(silent.sort()).toEqual(["done", "panel"]);
  });
});
