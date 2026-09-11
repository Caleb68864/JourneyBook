import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { phaseLabel, waitForRender, type RenderProgressSnapshot } from "../api/render-polling";
import { toRenderRequestBody, type RenderOptionsState } from "../lib/render-options";

interface GenerateButtonProps {
  projectId: string;
  /**
   * Every render-time choice, as one object.
   *
   * It used to be nine optional props, spread into the request at the call site.
   * That shape is how a control gets added to the page and never reaches the
   * wire: nothing fails when a prop is declared in the editor and not threaded
   * through here. One state object with one tested mapping
   * (`toRenderRequestBody`) means the set of things the UI can ask for and the
   * set of things the request carries are the same list.
   */
  options: RenderOptionsState;
  disabled?: boolean;
}

/** What the button says while it waits, keyed by the record's server-side status. */
const WAITING_LABEL: Record<string, string> = {
  Pending: "Queued…",
  Rendering: "Rendering…",
};

/**
 * The waiting label, with the worker's own position folded in when it has one.
 *
 * Exported and pure so the wording is testable without a DOM: the two things that
 * can go wrong here are saying "page 0 of 0" before the engine has derived the
 * contract, and saying nothing at all once it has.
 */
export function waitingLabel(
  jobStatus: string | null,
  progress: RenderProgressSnapshot | null,
): string {
  const base = (jobStatus && WAITING_LABEL[jobStatus]) ?? "Generating…";
  if (jobStatus !== "Rendering" || progress === null) return base;

  // The engine's own word for what it is doing, where it has one worth saying.
  // This is the half of the report that used to be dropped on the way in, and it
  // covers exactly the stretches the counter cannot describe: before the pages
  // are derived (no denominator), and during PDF assembly (the counter has
  // already reached the denominator and stopped).
  const phase = phaseLabel(progress.phase);

  // No denominator yet: the worker has the job but has not derived the pages. "0 of
  // 0" and "0%" are both worse than saying nothing, because they read as a render
  // that has stalled rather than one that has not started counting. The phase, when
  // there is one, says more than either.
  if (progress.pageCount === null || progress.percent === null) {
    return phase ? `${phase}…` : base;
  }

  const counted = `Rendering… ${progress.progress ?? 0}/${progress.pageCount} (${progress.percent}%)`;
  return phase ? `${phase}… ${progress.progress ?? 0}/${progress.pageCount}` : counted;
}

export function GenerateButton({ projectId, options, disabled }: GenerateButtonProps) {
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgressSnapshot | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Stop polling if the user navigates away mid-render. Note what this does NOT do:
  // it does not stop the render. That is the whole distinction ADR 0007 exists for —
  // navigating away abandons the wait and the PDF still lands in the project's
  // history, while Cancel below reaches the worker and stops it.
  const abortRef = useRef<AbortController | null>(null);
  const pdfIdRef = useRef<string | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleGenerate() {
    setStatus("generating");
    setErrorMsg(null);
    setPdfUrl(null);
    setJobStatus("Pending");
    setProgress(null);
    setCancelling(false);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 202: the render is accepted, not done. `downloadUrl` names a file that does
      // not exist yet, so opening it here would 404 — poll the record first.
      const { tier, ...rest } = toRenderRequestBody(options);
      const result = await api.render.start(projectId, tier, rest);
      const downloadUrl = result.downloadUrl || api.render.getContent(result.generatedPdfId);
      pdfIdRef.current = result.generatedPdfId;

      await waitForRender(result.generatedPdfId, {
        signal: controller.signal,
        onStatus: setJobStatus,
        onProgress: setProgress,
      });

      setPdfUrl(downloadUrl);
      // Try to open the PDF; if a popup blocker stops it, the link below still works.
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Render failed.");
      setStatus("error");
    } finally {
      setJobStatus(null);
      pdfIdRef.current = null;
      setCancelling(false);
    }
  }

  async function handleCancel() {
    const pdfId = pdfIdRef.current;
    if (pdfId === null) return;
    setCancelling(true);
    try {
      await api.generatedPdfs.cancel(pdfId);
      // Deliberately NOT aborting the local wait here. The cancel is a request; the
      // record settles at `Cancelled` when the render actually stops, and the poll
      // already running is what reports that. Aborting the wait as well would show
      // "cancelled" before anything had been, which is the failure this feature
      // exists to remove rather than reproduce.
    } catch (err) {
      setCancelling(false);
      setErrorMsg(err instanceof Error ? err.message : "Could not cancel the render.");
    }
  }

  const label = waitingLabel(jobStatus, progress);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={disabled || status === "generating"}
        className="inline-flex items-center justify-center gap-2 bg-forest-700 px-6 py-3 font-display text-base tracking-wide text-cream-50 shadow-[3px_3px_0_0_var(--color-bark-700)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:bg-forest-600 hover:shadow-[2px_2px_0_0_var(--color-bark-700)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "generating" ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {label}
          </>
        ) : (
          <>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Generate Atlas PDF
          </>
        )}
      </button>
      {/* A render takes minutes and changes state three or four times. Without a
          live region every one of those changes — Queued…, Rendering…, done,
          failed — is silent to assistive tech, and the button's own label change
          is not announced either. `polite` so it waits for a pause; the whole
          region is live so an empty→populated message counts as a change. */}
      {/* A real progress bar, not a spinner: the worker reports which page it is on
          (ADR 0007) and a render can take many minutes. `progressbar` with the
          three aria-value attributes so the same information reaches assistive tech
          as a number rather than only as a painted width. Rendered only once there
          IS a denominator — a bar pinned at 0% because nothing has been reported
          yet reads as a stalled render. */}
      {status === "generating" && progress?.percent !== null && progress !== null && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent ?? 0}
          aria-label="Atlas render progress"
          className="h-1.5 w-full overflow-hidden bg-parchment-200"
        >
          <div
            className="h-full bg-forest-600 transition-all"
            style={{ width: `${progress.percent ?? 0}%` }}
          />
        </div>
      )}

      {/* Cancel. It is only offered while a render is in flight, and it stops the
          RENDER — POST /generated-pdfs/{id}/cancel reaches the worker's
          DELETE /jobs/{id} — rather than only stopping this page from watching. A
          button that did the latter while the worker carried on is worse than no
          button, because the user believes the work stopped. */}
      {status === "generating" && (
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={cancelling}
          className="self-start font-mono text-[11px] text-campfire-600 underline hover:text-campfire-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cancelling ? "Cancelling…" : "Cancel render"}
        </button>
      )}

      <div aria-live="polite" className="flex flex-col gap-1">
        <span className="sr-only">
          {status === "generating" ? (cancelling ? `Cancelling. ${label}` : label) : ""}
        </span>
        {status === "done" && (
          <p className="font-mono text-[11px] text-forest-700">
            PDF opened in a new tab.{" "}
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-forest-600">
                Open / download
              </a>
            )}
          </p>
        )}
        {/* Keyed on the message, not on `status`. A cancel that the API refuses
            happens WHILE the render is still going, so the component is still in
            `generating` — gating this on `status === "error"` swallowed the one
            message explaining why the Cancel button did nothing. */}
        {errorMsg && <p className="font-mono text-[11px] text-campfire-600">{errorMsg}</p>}
      </div>
    </div>
  );
}
