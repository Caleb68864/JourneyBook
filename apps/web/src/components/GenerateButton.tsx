import { useState } from "react";
import type { MapTier } from "@journeybook/atlas-core";
import { api } from "../api/client";

interface GenerateButtonProps {
  projectId: string;
  tier: MapTier;
  route?: boolean;
  disabled?: boolean;
}

export function GenerateButton({ projectId, tier, route, disabled }: GenerateButtonProps) {
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  async function handleGenerate() {
    setStatus("generating");
    setErrorMsg(null);
    setPdfUrl(null);
    try {
      const result = await api.render.start(projectId, tier, route);
      const downloadUrl = result.downloadUrl || api.render.getContent(result.generatedPdfId);
      setPdfUrl(downloadUrl);
      // Try to open the PDF; if a popup blocker stops it, the link below still works.
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Render failed.");
      setStatus("error");
    }
  }

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
            Generating…
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
      {status === "error" && errorMsg && (
        <p className="font-mono text-[11px] text-campfire-600">{errorMsg}</p>
      )}
    </div>
  );
}
