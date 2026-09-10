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
 *
 * PAIRED WITH THE SERVER. `RenderWorker:TimeoutSeconds` bounds how long the API will
 * wait on the worker, and it must not be shorter than this number — when it was (120s
 * against this 15 minutes), every render over two minutes was killed by the API while
 * the browser was still waiting, and the user was told the service had shut down.
 * `DependencyInjectionTests.Render_worker_timeout_defaults_to_at_least_the_clients_own_patience`
 * fails if the pair drifts apart again.
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
      const seconds = Math.round(timeoutMs / 1000);
      // The two cases are genuinely different and the record already tells us which
      // one we are in. This used to say "The render is still running — check this
      // project's PDF history for it" for both, and for a stranded `Pending` row
      // BOTH halves are false: the render never started (the queue is in-process and
      // does not survive a restart), and the history has nothing to find.
      throw new Error(
        record.status === "Pending"
          ? `Still queued after ${seconds}s — this render never started. ` +
            `The service may have restarted; queued renders do not survive that. ` +
            `Generate the atlas again.`
          : `Still rendering after ${seconds}s. The render is still running — ` +
            `check this project's PDF history for it.`,
      );
    }

    await sleep(intervalMs);
  }
}
