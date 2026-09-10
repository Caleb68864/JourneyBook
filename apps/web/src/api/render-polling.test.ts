import { describe, it, expect, vi } from "vitest";
import { waitForRender, isTerminal } from "./render-polling";
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
