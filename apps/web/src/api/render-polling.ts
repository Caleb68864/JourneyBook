import { api, type GeneratedPdf } from "./client";

/**
 * Waiting for an accepted render to finish.
 *
 * `POST /projects/{id}/render` used to block for the whole render and answer 200
 * "Completed". It now answers 202 "Pending" the moment the job is queued, so the
 * download URL in that response points at a PDF that does not exist yet. Opening it
 * straight away — which is exactly what the Generate button did — gets a 404.
 *
 * This module is the missing half: poll the record until it reaches a terminal
 * state, and report the intermediate ones so the UI can say something truer than an
 * indefinite spinner.
 *
 * Everything time- and network-shaped is injectable so the state machine can be
 * tested for what it does with each status, rather than by waiting on a clock.
 */

/** Statuses the record can be in. `Completed` and `Failed` are terminal. */
export type RenderStatus = "Pending" | "Rendering" | "Completed" | "Failed";

export function isTerminal(status: string): boolean {
  return status === "Completed" || status === "Failed";
}

export interface WaitForRenderOptions {
  /** Delay between polls, in ms. Default 1000. */
  intervalMs?: number;
  /** Give up after this long, in ms. Default 15 minutes. */
  timeoutMs?: number;
  /** Called on every poll whose status differs from the last one seen. */
  onStatus?: (status: string) => void;
  /** Abort the wait (the render itself keeps going server-side). */
  signal?: AbortSignal;
  /** Seam for tests: how to read the record. Defaults to the real API. */
  fetchStatus?: (pdfId: string) => Promise<GeneratedPdf>;
  /** Seam for tests: how to wait. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Seam for tests: the clock the timeout is measured against. */
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 1000;
/**
 * 15 minutes. A 200-page atlas at the MAX_ATLAS_PAGES cap is 200 sequential basemap
 * fetches; this is a bound on the client's patience, not on the render, which keeps
 * going and can still be downloaded from the project's PDF history afterwards.
 */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a generated-PDF record until it completes, fails, times out, or is aborted.
 *
 * Resolves ONLY on `Completed` — a `Pending` or `Rendering` record is not an answer,
 * and returning one is the bug this exists to prevent. `Failed` rejects with the
 * server's own diagnostic when it has one.
 */
export async function waitForRender(
  pdfId: string,
  options: WaitForRenderOptions = {},
): Promise<GeneratedPdf> {
  const {
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onStatus,
    signal,
    fetchStatus = (id: string) => api.generatedPdfs.get(id),
    sleep = realSleep,
    now = () => Date.now(),
  } = options;

  const startedAt = now();
  let lastStatus: string | null = null;

  for (;;) {
    if (signal?.aborted) throw new Error("Render wait was cancelled.");

    const record = await fetchStatus(pdfId);

    if (record.status !== lastStatus) {
      lastStatus = record.status;
      onStatus?.(record.status);
    }

    if (record.status === "Completed") return record;

    if (record.status === "Failed") {
      throw new Error(
        record.errorMessage && record.errorMessage.length > 0
          ? record.errorMessage
          : "Render failed. See the API logs for the renderer's diagnostic.",
      );
    }

    // Check the deadline AFTER reading the status, so a render that finished during
    // the last sleep is reported as finished rather than as a timeout.
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `Still ${record.status.toLowerCase()} after ${Math.round(timeoutMs / 1000)}s. ` +
          `The render is still running — check this project's PDF history for it.`,
      );
    }

    await sleep(intervalMs);
  }
}
