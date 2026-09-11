import { api, type GeneratedPdf } from "../api/client";
import { describePdfHistoryEntry } from "../lib/pdf-history";

/** The editor has always shown the latest eight renders. */
const HISTORY_ROWS = 8;

interface RenderHistoryProps {
  /** The project's render records, newest first. */
  pdfs: GeneratedPdf[];
  onRefresh: () => void;
  /** Seam for tests: the clock "stuck" and retention wording are measured against. */
  now?: number;
}

/**
 * Where a finished atlas is listed — and so where the resolution it ACTUALLY
 * printed at has to appear.
 *
 * This was inline JSX in `ProjectEditorPage`, which imports `MapPreview`
 * (maplibre cannot initialise under jsdom), so nothing it drew could be tested:
 * the change that carried the renderer's measured DPI onto the record stopped
 * there for exactly that reason. Its own component, with every sentence still
 * derived by the tested `describePdfHistoryEntry`.
 */
export function RenderHistory({ pdfs, onRefresh, now }: RenderHistoryProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Render History</span>
        <button type="button" onClick={onRefresh} className="font-mono text-[10px] uppercase tracking-widest text-forest-700 underline hover:text-forest-600">Refresh</button>
      </div>
      {pdfs.length === 0 ? (
        <p className="font-mono text-[10px] text-bark-500">No PDFs generated yet.</p>
      ) : (
        <ul className="divide-y divide-bark-200 border border-bark-300">
          {pdfs.slice(0, HISTORY_ROWS).map((pdf) => {
            // Status text and the failure's diagnostic come from a tested
            // pure function — `errorMessage` reached the wire and was
            // rendered nowhere, so a failed render was the single word
            // "Failed" and a row stranded by a restart said "Pending" for
            // ever. See lib/pdf-history.ts.
            const entry = describePdfHistoryEntry(pdf, now);
            return (
              <li key={pdf.id} className="flex flex-col gap-0.5 px-3 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`min-w-0 font-mono text-[10px] ${entry.failed ? "text-campfire-600" : "text-bark-600"}`}>
                    {new Date(pdf.createdAt).toLocaleString()} · {entry.label}
                  </span>
                  {entry.downloadable ? (
                    <a href={api.generatedPdfs.contentUrl(pdf.id)} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-forest-700 hover:text-forest-600">Open</a>
                  ) : null}
                </div>
                {entry.resolution && (
                  // What this atlas actually printed at, as the renderer measured
                  // it. Below 300 DPI is information, not a failure — same colour
                  // as the row's other information, never the alarm colour.
                  <span className="break-words font-mono text-[10px] text-bark-600">
                    {entry.resolution.text}
                  </span>
                )}
                {entry.detail && (
                  // Coloured by what the line IS, not by the fact that
                  // there is one. The detail line used to be the failure
                  // diagnostic and nothing else, so the alarm colour was
                  // unconditional; it now also carries the retention
                  // notice on a completed render, and painting "kept until
                  // the 23rd" in the error colour would report a healthy
                  // row as a broken one.
                  <span
                    className={`break-words font-mono text-[10px] ${
                      entry.failed ? "text-campfire-600" : "text-bark-600"
                    }`}
                  >
                    {entry.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
