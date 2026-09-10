import { useState } from "react";
import type { BBox } from "@journeybook/atlas-core";
import { api } from "../api/client";

interface LandmarkImportControlProps {
  projectId: string;
  /**
   * The project's saved extent. Import needs one and SENDS one: the endpoint
   * reads the bbox off the request body and never looks at the project's own
   * extent, so a boolean "has an extent" was not enough to make the call.
   */
  extent: BBox | null;
  /** Called after a successful import so the parent can refresh the map/list. */
  onImported?: (count: number) => void;
}

/**
 * "Import Landmarks" action: posts the project's extent to the landmark import
 * endpoint (OSM via Overpass on the backend) and reports how many curated
 * landmarks were persisted. Mirrors the CSV-import affordance on `LocationList`,
 * but landmarks are fetched server-side — there is no file to upload.
 */
export function LandmarkImportControl({
  projectId,
  extent,
  onImported,
}: LandmarkImportControlProps) {
  const hasExtent = extent !== null;
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (!extent) return;
    setImporting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api.landmarks.import(projectId, extent);
      const count = result.imported;
      setMessage(`Imported ${count} landmark${count === 1 ? "" : "s"}.`);
      onImported?.(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import landmarks.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
          Landmarks
        </span>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing || !hasExtent}
          title={hasExtent ? undefined : "Set a bounding box before importing landmarks."}
          className="font-mono text-[11px] uppercase tracking-widest text-forest-700 underline hover:text-forest-600 disabled:cursor-not-allowed disabled:no-underline disabled:text-bark-400"
        >
          {importing ? "Importing…" : "Import Landmarks"}
        </button>
      </div>
      {!hasExtent && (
        <p className="font-mono text-[11px] text-bark-500">
          Set a bounding box before importing landmarks.
        </p>
      )}
      {/* The import is a server round trip with no other feedback. */}
      <div aria-live="polite">
        {message && <p className="font-mono text-[11px] text-forest-700">{message}</p>}
        {error && <p className="font-mono text-[11px] text-campfire-600">{error}</p>}
      </div>
    </div>
  );
}
