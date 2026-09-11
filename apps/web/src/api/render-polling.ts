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

/**
 * Statuses the record can be in. `Completed`, `Failed` and `Cancelled` are terminal.
 *
 * This union is the C# `PdfStatus` enum, and the two are compared by
 * `dotnet/JourneyBook.Tests/PdfStatusParityTests.cs` — which reads THIS file rather
 * than restating it. A status the client has never heard of is not a cosmetic gap:
 * `waitForRender` treats anything non-terminal as still running, so an unknown
 * terminal status is a spinner that runs for the full fifteen minutes and then
 * reports a timeout that did not happen.
 */
export type RenderStatus = "Pending" | "Rendering" | "Completed" | "Failed" | "Cancelled";

/** The statuses a record never leaves. */
export const TERMINAL_STATUSES: readonly RenderStatus[] = ["Completed", "Failed", "Cancelled"];

/** How far a render has got, as the record reports it. */
export interface RenderProgressSnapshot {
  /** Pages finished, or null before the worker says. */
  progress: number | null;
  /** Pages in the atlas, or null before the worker knows. */
  pageCount: number | null;
  /** 0–100, or null when there is no denominator yet. */
  percent: number | null;
  /**
   * What the engine says it is doing, in its own word, or null before it says.
   *
   * The counter alone cannot describe the two longest stretches of a render.
   * `progress` counts finished basemap PANELS, so it already equals `pageCount`
   * for the whole of PDF assembly — the bar reads 100% and stops — and a render
   * with the basemap off emits no panel events at all, so it reads 0% from start
   * to finish. Both look exactly like a stall.
   */
  phase: RenderPhase | null;
}

/**
 * The engine's phase vocabulary (`RenderProgress["phase"]` in
 * `packages/render-cli/src/render.ts`), carried verbatim from the worker.
 *
 * Typed as a union with a `string` escape rather than a closed union: this
 * arrives over two process boundaries from another language, and a worker
 * deployed ahead of the web app must not make the label crash. `phaseLabel`
 * falls back for anything it does not recognise.
 */
export type RenderPhase = "contract" | "panel" | "overview" | "pdf" | "done" | (string & {});

/**
 * Every phase word this module has been shown and made a decision about.
 *
 * A copy of the engine's union, and it is here to be CHECKED rather than trusted:
 * `render-polling.test.ts` parses `RenderProgress["phase"]` out of the real
 * `packages/render-cli/src/render.ts` and asserts the two agree. Without that,
 * renaming a phase in the engine leaves `phaseLabel` silently returning null for
 * it — the soft failure rather than the loud one, and therefore the one nobody
 * would notice. Same shape as `TERMINAL_STATUSES` against the C# `PdfStatus`
 * enum, for the same reason.
 *
 * Being in this list does NOT mean the phase gets a label: `panel` and `done` are
 * deliberately silent. It means somebody looked at it.
 */
export const KNOWN_PHASES: readonly string[] = ["contract", "panel", "overview", "pdf", "done"];

/**
 * Human wording for a phase, or null when there is nothing worth saying.
 *
 * `panel` returns null on purpose: during the panel phase the page counter is
 * moving and says more than any word could. The phases worth naming are exactly
 * the ones where the counter is not moving.
 */
export function phaseLabel(phase: string | null | undefined): string | null {
  switch (phase) {
    case "contract":
      return "Working out the pages";
    case "overview":
      return "Drawing the overview";
    case "pdf":
      return "Building the PDF";
    default:
      // `panel` and `done`, and anything a newer worker invents. Saying nothing
      // is better than guessing at a word we have never seen.
      return null;
  }
}

/**
 * Turn a record's two numbers into something a bar can be drawn from.
 *
 * Null rather than 0 when the denominator is missing. A percentage invented from
 * a page count nobody has reported yet is a bar that sits at 0% and then jumps,
 * and is indistinguishable from a render that is genuinely stuck.
 */
export function progressOf(
  record: Pick<GeneratedPdf, "progress" | "pageCount" | "phase">,
): RenderProgressSnapshot {
  const progress = record.progress ?? null;
  const pageCount = record.pageCount ?? null;
  const percent =
    progress !== null && pageCount !== null && pageCount > 0
      ? Math.min(100, Math.max(0, Math.round((progress / pageCount) * 100)))
      : null;
  return { progress, pageCount, percent, phase: record.phase ?? null };
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface WaitForRenderOptions {
  /** Delay between polls, in ms. Default 1000. */
  intervalMs?: number;
  /** Give up after this long, in ms. Default 15 minutes. */
  timeoutMs?: number;
  /** Called on every poll whose status differs from the last one seen. */
  onStatus?: (status: string) => void;
  /**
   * Called on every poll whose position differs from the last one seen.
   *
   * Separate from `onStatus` because they change at different rates: the status
   * moves three or four times in a render, the position once per page. Folding
   * them into one callback would either re-announce the status per page or drop
   * every position after the first.
   *
   * `pageCount` is null until the worker has derived the contract, so a consumer
   * must be able to render "starting…" rather than dividing by nothing.
   */
  onProgress?: (progress: RenderProgressSnapshot) => void;
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
    onProgress,
    signal,
    fetchStatus = (id: string) => api.generatedPdfs.get(id),
    sleep = realSleep,
    now = () => Date.now(),
  } = options;

  const startedAt = now();
  let lastStatus: string | null = null;
  let lastProgressKey: string | null = null;

  for (;;) {
    if (signal?.aborted) throw new Error("Render wait was cancelled.");

    const record = await fetchStatus(pdfId);

    if (record.status !== lastStatus) {
      lastStatus = record.status;
      onStatus?.(record.status);
    }

    // Reported before the terminal checks below, so the last position a render
    // reached is announced even when that poll is also the one that finds it
    // finished — otherwise a fast render's bar never moves off "starting…".
    const snapshot = progressOf(record);
    const progressKey = `${snapshot.progress}/${snapshot.pageCount}`;
    if (progressKey !== lastProgressKey) {
      lastProgressKey = progressKey;
      onProgress?.(snapshot);
    }

    if (record.status === "Completed") return record;

    if (record.status === "Cancelled") {
      // Its own branch, above `Failed`, and with the record's own wording — which
      // says how far it got. Letting a cancel fall through to the generic failure
      // message would tell someone who pressed Cancel to go and look in the API
      // logs for a diagnostic that does not exist.
      throw new Error(
        record.errorMessage && record.errorMessage.length > 0
          ? record.errorMessage
          : "Render was cancelled.",
      );
    }

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
