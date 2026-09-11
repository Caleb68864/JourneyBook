// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GenerateButton } from "./GenerateButton";
import { DEFAULT_RENDER_OPTIONS, type RenderOptionsState } from "../lib/render-options";

/**
 * The last hop: what the button actually PUTS ON THE WIRE.
 *
 * Every other test of a render option in this app proves something one step
 * short of this — that a checkbox toggles state, or that a mapping function
 * returns the right object. A control can pass both and still change nothing,
 * because the props between the panel and the request are the part nothing
 * fails on. So this renders the real button, clicks it, and reads the body out
 * of a stubbed `fetch`.
 */

function stubFetch() {
  const fetchMock = vi.fn(async (url: string) =>
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
      : new Response(
          JSON.stringify({ id: "pdf-1", status: "Completed", errorMessage: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
  );
  vi.stubGlobal("fetch", fetchMock);
  // The component opens the finished PDF in a tab; jsdom has no implementation.
  vi.stubGlobal("open", vi.fn());
  return fetchMock;
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function clickAndReadBody(options: RenderOptionsState): Promise<Record<string, unknown>> {
  render(<GenerateButton projectId="p1" options={options} />);
  fireEvent.click(screen.getByRole("button", { name: /generate atlas pdf/i }));

  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/render")),
      "the button never posted a render",
    ).toBe(true);
  });

  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/render"))!;
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("GenerateButton posts what the panel asked for", () => {
  /**
   * [CONTROL] The request with nothing touched. This is the shape the app sent
   * before any of these controls existed, and it has to be unchanged — a new
   * control that silently alters the default render is the worse half of the
   * bug it was added to fix.
   */
  it("[CONTROL] sends the previous default request when nothing is changed", async () => {
    const body = await clickAndReadBody(DEFAULT_RENDER_OPTIONS);

    expect(body).toMatchObject({
      tier: 1,
      route: false,
      cover: false,
      includeLandmarks: true,
      tableOfContents: true,
      overview: true,
      referenceGrid: true,
      notes: true,
      basemap: true,
    });
    expect(body).not.toHaveProperty("panelFormat");
    expect(body).not.toHaveProperty("panelQuality");
  });

  it("sends basemap:false when the line-art preview is asked for", async () => {
    const body = await clickAndReadBody({ ...DEFAULT_RENDER_OPTIONS, basemap: false });
    expect(body.basemap).toBe(false);
  });

  it("sends the panel format and quality the user chose", async () => {
    const body = await clickAndReadBody({
      ...DEFAULT_RENDER_OPTIONS,
      panelFormat: "jpeg",
      panelQuality: 55,
    });
    expect(body.panelFormat).toBe("jpeg");
    expect(body.panelQuality).toBe(55);
  });

  it("sends the tier and every furniture toggle", async () => {
    const body = await clickAndReadBody({
      ...DEFAULT_RENDER_OPTIONS,
      tier: 3,
      route: true,
      cover: true,
      includeLandmarks: false,
      tableOfContents: false,
      overview: false,
      referenceGrid: false,
      notes: false,
    });

    expect(body).toMatchObject({
      tier: 3,
      route: true,
      cover: true,
      includeLandmarks: false,
      tableOfContents: false,
      overview: false,
      referenceGrid: false,
      notes: false,
    });
  });

  it("posts to the project's render endpoint", async () => {
    render(<GenerateButton projectId="p42" options={DEFAULT_RENDER_OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: /generate atlas pdf/i }));

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/projects/p42/render"))).toBe(true);
    });
  });
});

/**
 * The moment a render finishes is when a user opens their atlas, so it is the
 * other place the resolution it ACTUALLY printed at belongs. The final record
 * the poll resolves with already carries it; the button used to read nothing off
 * that record but "Completed".
 */
describe("GenerateButton says what the finished atlas printed at", () => {
  function stubFinal(sourceMetadataSnapshot: string | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
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
          : new Response(
              JSON.stringify({ id: "pdf-1", status: "Completed", errorMessage: null, sourceMetadataSnapshot }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
      ),
    );
  }

  it("[BEHAVIORAL] shows the measured resolution, and flags it plainly when it is under 300 DPI", async () => {
    stubFinal(JSON.stringify({ deliveredDpi: { min: 176.2, max: 343.4, panels: 12 } }));
    render(<GenerateButton projectId="p1" options={DEFAULT_RENDER_OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: /generate atlas pdf/i }));

    const line = await screen.findByText(/Printed at 176–343 DPI across 12 map pages/);
    expect(line.textContent).toMatch(/under 300 DPI/);
    expect(line.className).not.toMatch(/campfire/);
    expect(screen.getByRole("link", { name: /open \/ download/i })).toBeTruthy();
  });

  it("[CONTROL] a render with no basemap says there is no figure rather than inventing one", async () => {
    stubFinal(JSON.stringify({ deliveredDpi: null }));
    render(<GenerateButton projectId="p1" options={DEFAULT_RENDER_OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: /generate atlas pdf/i }));

    expect(await screen.findByText(/no basemap/i)).toBeTruthy();
    expect(screen.queryByText(/Printed at/)).toBeNull();
  });
});
