// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GenerateButton, waitingLabel } from "./GenerateButton";
import { DEFAULT_RENDER_OPTIONS } from "../lib/render-options";

/**
 * The progress bar and the Cancel button — the two things ADR 0006 recorded as
 * missing and ADR 0007 delivers.
 *
 * Every test here renders the REAL button and reads what it did. The engine can
 * report per page, the worker can record it, the API can write it onto the row and
 * the client can parse it, and if the component never asks for it the user sees a
 * spinner. This codebase has produced that exact shape often enough — a capability
 * declared and half-wired — that the last hop gets its own file.
 */

/** One poll's worth of record, then the same for ever. */
function stubFetch(pollRecord: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    String(url).includes("/render")
      ? new Response(
          JSON.stringify({
            generatedPdfId: "pdf-1",
            status: "Pending",
            downloadUrl: "/api/generated-pdfs/pdf-1/content",
            statusUrl: "/api/generated-pdfs/pdf-1",
          }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        )
      : new Response(JSON.stringify(pollRecord), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", vi.fn());
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function startRender() {
  render(<GenerateButton projectId="p1" options={DEFAULT_RENDER_OPTIONS} />);
  fireEvent.click(screen.getByRole("button", { name: /generate atlas pdf/i }));
}

describe("waitingLabel", () => {
  it("[BEHAVIORAL] folds the worker's position into the label", () => {
    expect(waitingLabel("Rendering", { progress: 3, pageCount: 12, percent: 25 }))
      .toBe("Rendering… 3/12 (25%)");
  });

  it("[BEHAVIORAL] says nothing numeric before the worker has derived the pages", () => {
    // "0 of 0" and "0%" both read as a render that has stalled rather than one
    // that has not started counting, which is worse than the plain word.
    expect(waitingLabel("Rendering", { progress: null, pageCount: null, percent: null }))
      .toBe("Rendering…");
  });

  it("keeps the queued label even if a stale position is still in hand", () => {
    // Queued means the job has not reached the worker. A page count next to it
    // would claim progress on a render that has not begun.
    expect(waitingLabel("Pending", { progress: 3, pageCount: 12, percent: 25 })).toBe("Queued…");
  });
});

describe("GenerateButton shows the render's real position", () => {
  it("[BEHAVIORAL] draws a progressbar carrying the reported percentage", async () => {
    stubFetch({ id: "pdf-1", status: "Rendering", progress: 3, pageCount: 12, errorMessage: null });
    startRender();

    const bar = await screen.findByRole("progressbar");
    // The number, not just the painted width: a bar whose only carrier is a CSS
    // width is invisible to assistive tech, and this app had zero live regions
    // until recently for exactly that reason.
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(
      screen.getByRole("button", { name: /Rendering… 3\/12 \(25%\)/ }),
      "the button's own label never carried the position",
    ).toBeTruthy();
  });

  it("[CONTROL — must NOT appear] no progressbar before the worker reports a page count", async () => {
    stubFetch({ id: "pdf-1", status: "Rendering", progress: null, pageCount: null, errorMessage: null });
    startRender();

    await screen.findByRole("button", { name: /Rendering…/ });
    // The control for the test above. A bar that renders at 0% whenever there is
    // no denominator would satisfy "a progressbar exists" while showing a stalled
    // render to every user whose worker has not yet derived the contract.
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("[CONTROL — must NOT appear] no progressbar and no Cancel before a render is started", () => {
    stubFetch({ id: "pdf-1", status: "Completed" });
    render(<GenerateButton projectId="p1" options={DEFAULT_RENDER_OPTIONS} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel render/i })).toBeNull();
  });
});

describe("GenerateButton can stop the render, not just stop watching it", () => {
  it("[BEHAVIORAL] Cancel posts to the render's cancel endpoint", async () => {
    const fetchMock = stubFetch({
      id: "pdf-1",
      status: "Rendering",
      progress: 1,
      pageCount: 40,
      errorMessage: null,
    });
    startRender();

    const cancel = await screen.findByRole("button", { name: /cancel render/i });
    fireEvent.click(cancel);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/cancel"));
      expect(call, "Cancel did not reach the API").toBeTruthy();
      expect(String(call![0])).toContain("/generated-pdfs/pdf-1/cancel");
      expect((call![1] as RequestInit).method).toBe("POST");
    });
  });

  it("[BEHAVIORAL] Cancel does not abort the local wait, so the record's own outcome is what is shown", async () => {
    // The distinction the whole feature turns on. Aborting the poll here would put
    // "cancelled" on screen immediately — before anything had been — which is the
    // failure ADR 0007 exists to remove, reproduced one layer up. The poll keeps
    // running and reports whatever the record actually settles at.
    const fetchMock = stubFetch({
      id: "pdf-1",
      status: "Rendering",
      progress: 1,
      pageCount: 40,
      errorMessage: null,
    });
    startRender();

    fireEvent.click(await screen.findByRole("button", { name: /cancel render/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/cancel"))).toBe(true);
    });

    // Still waiting: the button has not jumped to a terminal state of its own
    // invention. "Cancelling…" is a request in flight, not an outcome.
    expect(screen.getByRole("button", { name: /cancelling…/i })).toBeTruthy();
    expect(screen.queryByText(/PDF opened in a new tab/)).toBeNull();
  });

  it("surfaces a refused cancel instead of swallowing it", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      String(url).includes("/cancel")
        ? new Response(JSON.stringify({ error: "This render is already Completed." }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          })
        : String(url).includes("/render")
          ? new Response(
              JSON.stringify({
                generatedPdfId: "pdf-1",
                status: "Pending",
                downloadUrl: "/api/generated-pdfs/pdf-1/content",
                statusUrl: "/api/generated-pdfs/pdf-1",
              }),
              { status: 202, headers: { "Content-Type": "application/json" } },
            )
          : new Response(
              JSON.stringify({ id: "pdf-1", status: "Rendering", progress: 1, pageCount: 40 }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("open", vi.fn());

    startRender();
    fireEvent.click(await screen.findByRole("button", { name: /cancel render/i }));

    // A cancel that failed must not leave the button saying "Cancelling…" for ever
    // while the render carries on.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /cancel render/i })).toBeTruthy();
    });
    expect(await screen.findByText(/already Completed/)).toBeTruthy();
  });
});
