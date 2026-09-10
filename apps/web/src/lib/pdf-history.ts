import type { GeneratedPdf } from "../api/client";

/**
 * What a render-history row should say about itself.
 *
 * `GeneratedPdf.errorMessage` was added specifically so a post-response failure —
 * the 202 is long gone, there is no response body left to carry a reason — would
 * have somewhere to ride home. It reached the wire and was then **rendered
 * nowhere**: the history showed `{createdAt} · {status}` and an Open link for
 * `Completed`, so a failed render was the single word "Failed" and a row stranded
 * at `Pending` by a restart showed "Pending" for ever, with no explanation and no
 * action.
 *
 * Deriving the text here rather than inline in JSX is deliberate: the app has no
 * DOM test setup, so anything expressed only as JSX is unverifiable, and this
 * page has already lost one guard that way (see `page-estimate.ts`).
 */
export interface PdfHistoryEntry {
  /** Short status word for the row. */
  label: string;
  /** Secondary line: the failure's diagnostic, or what a stuck row means. Null = nothing to add. */
  detail: string | null;
  /** Whether the row is a failure (for styling and for a11y wording). */
  failed: boolean;
  /** Whether an Open link should be offered. */
  downloadable: boolean;
}

/**
 * How long a record may sit in a non-terminal state before the history stops
 * calling it "in progress" and starts calling it stuck. Renders are bounded by
 * `RenderWorker:TimeoutSeconds` (15 minutes), so past twice that nothing is
 * coming: the process that owned the job is gone.
 */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

export function describePdfHistoryEntry(pdf: GeneratedPdf, now = Date.now()): PdfHistoryEntry {
  if (pdf.status === "Completed") {
    return { label: "Completed", detail: null, failed: false, downloadable: true };
  }

  if (pdf.status === "Failed") {
    return {
      label: "Failed",
      // The whole point of the field. Without it the user's entire answer to a
      // failed render is the word "Failed".
      detail: pdf.errorMessage?.trim() || "No diagnostic was recorded. See the API logs.",
      failed: true,
      downloadable: false,
    };
  }

  const startedAt = Date.parse(pdf.createdAt);
  const stuck = Number.isFinite(startedAt) && now - startedAt > STUCK_AFTER_MS;

  if (!stuck) {
    return {
      label: pdf.status === "Rendering" ? "Rendering…" : "Queued…",
      detail: null,
      failed: false,
      downloadable: false,
    };
  }

  // Nothing resumes an in-flight or queued job: the render queue lives in the
  // API process. Saying so is the difference between a row the user can act on
  // and a row that just sits there.
  return {
    label: pdf.status,
    detail:
      pdf.status === "Pending"
        ? "This render never started — the service restarted before it was picked up. Generate again."
        : "This render was interrupted and will not resume. Generate again.",
    failed: true,
    downloadable: false,
  };
}
