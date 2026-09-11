import { PRINT_DPI_TARGET } from "@journeybook/atlas-core";
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
 * Deriving the text here rather than inline in JSX is deliberate: this page has
 * already lost one guard to untestable JSX (see `page-estimate.ts`). The rows are
 * now drawn by `components/RenderHistory.tsx`, which has DOM tests of its own.
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
  /**
   * What a completed atlas actually printed at — or why there is no figure. Null
   * for every other status: nothing was printed.
   */
  resolution: ResolutionNote | null;
}

/**
 * The renderer's own measurement of a finished render, read off the record.
 *
 * Three answers, kept apart on purpose: the API writes an explicit
 * `deliveredDpi: null` for a render that drew no basemap, so "there was nothing
 * to measure" and "nobody measured" (a record older than the measurement, or a
 * snapshot someone else wrote) are different facts and are reported differently.
 */
export type DeliveredResolution =
  | { kind: "measured"; min: number; max: number; panels: number }
  | { kind: "no-basemap" }
  | { kind: "not-recorded" };

export interface ResolutionNote {
  text: string;
  /** The softest page printed under {@link PRINT_DPI_TARGET}. Information, not a failure. */
  belowTarget: boolean;
}

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Parse `sourceMetadataSnapshot` for the delivered resolution. Refuses rather
 * than guesses: `POST /api/generated-pdfs` accepts an arbitrary snapshot, so
 * anything that is not a well-formed `{min, max, panels}` with `min <= max` is
 * reported as not recorded instead of turned into a number.
 */
export function readDeliveredResolution(snapshot: string | null | undefined): DeliveredResolution {
  if (!snapshot) return { kind: "not-recorded" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    return { kind: "not-recorded" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "not-recorded" };
  if (!("deliveredDpi" in parsed)) return { kind: "not-recorded" };

  const dpi = (parsed as { deliveredDpi: unknown }).deliveredDpi;
  if (dpi === null) return { kind: "no-basemap" };
  if (typeof dpi !== "object") return { kind: "not-recorded" };

  const { min, max, panels } = dpi as { min?: unknown; max?: unknown; panels?: unknown };
  if (!isPositive(min) || !isPositive(max) || !isPositive(panels) || !Number.isInteger(panels) || min > max) {
    return { kind: "not-recorded" };
  }
  return { kind: "measured", min, max, panels };
}

/**
 * The sentence a finished atlas carries. Whole DPI, rounded once — the same
 * convention as the generated table the scale picker reads, so the figure here
 * and the band there are the same kind of number — and the below-target flag is
 * decided on the figure the user reads, so "300 DPI" is never also called
 * "under 300".
 *
 * Below the target is stated as information. The atlas is still exactly to
 * scale; what softens is fine linework. Saying so plainly, in the row's normal
 * colour, is the owner's decision (state it honestly) rather than a warning
 * about something that went wrong.
 */
export function resolutionNote(reading: DeliveredResolution, targetDpi = PRINT_DPI_TARGET): ResolutionNote {
  if (reading.kind === "no-basemap") {
    return { text: "No basemap was drawn, so there is no print resolution to report.", belowTarget: false };
  }
  if (reading.kind === "not-recorded") {
    return { text: "Print resolution was not recorded for this render.", belowTarget: false };
  }

  const lo = Math.round(reading.min);
  const hi = Math.round(reading.max);
  const range = lo === hi ? `${lo} DPI` : `${lo}–${hi} DPI`;
  const pages = `${reading.panels} map page${reading.panels === 1 ? "" : "s"}`;
  const printed = `Printed at ${range} across ${pages}.`;
  const belowTarget = lo < targetDpi;
  const who = hi >= targetDpi ? "Some pages are" : reading.panels === 1 ? "It is" : "Every page is";
  return {
    text: belowTarget
      ? `${printed} ${who} under ${targetDpi} DPI, so fine contours and small labels may look ` +
        `a little soft; the scale is still exact.`
      : printed,
    belowTarget,
  };
}

/**
 * How long a record may sit in a non-terminal state before the history stops
 * calling it "in progress" and starts calling it stuck. Renders are bounded by
 * `RenderWorker:TimeoutSeconds` (15 minutes), so past twice that nothing is
 * coming: the process that owned the job is gone.
 */
export const STUCK_AFTER_MS = 30 * 60 * 1000;

/** One day, for turning a retention deadline into a number of days. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a completed row should say about how long its PDF will still be there.
 *
 * `expiresAt` is stamped on every record from `GeneratedPdf:RetentionDays`
 * (default 30), is enforced by `GeneratedPdfRetentionService`, which deletes the
 * file AND the row on a timer — and was rendered nowhere. It reached this app on
 * the wire and sat in the `GeneratedPdf` interface with no reader outside a test
 * fixture, so an atlas a family generated for a trip vanished from the history
 * with no notice that it ever had a deadline.
 *
 * Returns null when there is nothing honest to say: no deadline stamped (a
 * legacy row, or retention disabled), or an unparseable date. Inventing "expires
 * in 30 days" from a value the server did not send would be a guess about the
 * one thing the server is the authority on.
 */
export function expiryNote(expiresAt: string | null | undefined, now: number): string | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;

  const remainingMs = at - now;
  if (remainingMs <= 0) {
    // The sweep runs on an interval, not at the instant of expiry, so a row can
    // be past its deadline and still openable for a while. "May already have
    // been" rather than "has been": claiming the file is gone when the Open link
    // still works is the same class of error as claiming it is safe when it is not.
    return "Past its retention window — this PDF may already have been deleted.";
  }

  const days = Math.floor(remainingMs / DAY_MS);
  if (days >= 2) return `Kept until ${new Date(at).toLocaleDateString()} (${days} days).`;
  if (days === 1) return "Kept for 1 more day — download it if you want to keep it.";
  return "Kept for less than a day — download it if you want to keep it.";
}

export function describePdfHistoryEntry(pdf: GeneratedPdf, now = Date.now()): PdfHistoryEntry {
  if (pdf.status === "Completed") {
    return {
      label: "Completed",
      // The retention deadline the server is already enforcing. A completed row
      // is the only one where it means anything: the others have no file to keep.
      detail: expiryNote(pdf.expiresAt, now),
      failed: false,
      downloadable: true,
      // What this atlas actually printed at, measured by the renderer. The scale
      // picker says what a preset delivers on a reference page; this is the file.
      resolution: resolutionNote(readDeliveredResolution(pdf.sourceMetadataSnapshot)),
    };
  }

  if (pdf.status === "Failed") {
    return {
      label: "Failed",
      // The whole point of the field. Without it the user's entire answer to a
      // failed render is the word "Failed".
      detail: pdf.errorMessage?.trim() || "No diagnostic was recorded. See the API logs.",
      failed: true,
      downloadable: false,
      resolution: null,
    };
  }

  if (pdf.status === "Cancelled") {
    return {
      label: "Cancelled",
      // The record's own wording, which says how far the render got. Not `failed`:
      // nothing went wrong, and a red row for something the user asked for sends
      // them looking for a problem that does not exist.
      detail: pdf.errorMessage?.trim() || "You cancelled this render.",
      failed: false,
      downloadable: false,
      resolution: null,
    };
  }

  // NOTE: everything past this point treats the record as IN PROGRESS, so a
  // terminal status with no branch above renders as "Queued…" for thirty minutes
  // and then as an interrupted render. That is exactly what `Cancelled` did.
  //
  // There is deliberately NO catch-all `isTerminal` branch here. One was written
  // and then removed: every terminal status already has a branch of its own, so
  // the catch-all was unreachable — probed, and deleting it left all 104 web tests
  // green, which makes it a guard that cannot fail. The real guard is the test
  // `any terminal status the server invents is never drawn as in progress`, which
  // walks `TERMINAL_STATUSES` and fails at TEST time if a status is added without
  // a branch here. A dead runtime branch would have silently absorbed that.
  const startedAt = Date.parse(pdf.createdAt);
  const stuck = Number.isFinite(startedAt) && now - startedAt > STUCK_AFTER_MS;

  if (!stuck) {
    return {
      label: pdf.status === "Rendering" ? "Rendering…" : "Queued…",
      detail: null,
      failed: false,
      downloadable: false,
      resolution: null,
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
    resolution: null,
  };
}
