import { useState } from "react";
import type { Location } from "../api/client";

interface ScalePresetOption {
  id: string;
  label: string;
}

interface LocationListProps {
  locations: Location[];
  /** Available scale presets for the per-location zoom picker. */
  scalePresets: readonly ScalePresetOption[];
  /** The project's scale id, shown as the "inherit" default. */
  projectScaleId: string;
  onAdd: (name: string, lng: number, lat: number, scalePresetId?: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Override (or clear) a saved location's scale. null → inherit project scale. */
  onSetScale: (loc: Location, scalePresetId: string | null) => Promise<void>;
  /** Bulk-import from CSV text; resolves to the number imported. */
  onImport: (csv: string) => Promise<number>;
  /** If true, user can click map to drop pin — communicated to parent */
  onStartDrop?: () => void;
}

export function LocationList({
  locations,
  scalePresets,
  projectScaleId,
  onAdd,
  onDelete,
  onSetScale,
  onImport,
  onStartDrop,
}: LocationListProps) {
  const [name, setName] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  // "" = inherit the project scale.
  const [scaleId, setScaleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const projectScaleLabel =
    scalePresets.find((s) => s.id === projectScaleId)?.label ?? projectScaleId;

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    setImportMsg(null);
    setError(null);
    setImporting(true);
    try {
      const text = await file.text();
      const count = await onImport(text);
      setImportMsg(`Imported ${count} location${count === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV.");
    } finally {
      setImporting(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const lngNum = parseFloat(lng);
    const latNum = parseFloat(lat);
    if (!name.trim() || isNaN(lngNum) || isNaN(latNum)) {
      setError("Enter a name, longitude, and latitude.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onAdd(name.trim(), lngNum, latNum, scaleId || null);
      setName("");
      setLng("");
      setLat("");
      setScaleId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
          Important Locations
        </span>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-forest-700 underline hover:text-forest-600">
            {importing ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleImportFile(e)}
              disabled={importing}
              className="hidden"
            />
          </label>
          {onStartDrop && (
            <button
              type="button"
              onClick={onStartDrop}
              className="font-mono text-[11px] uppercase tracking-widest text-forest-700 underline hover:text-forest-600"
            >
              Drop on Map
            </button>
          )}
        </div>
      </div>
      {importMsg && <p className="font-mono text-[11px] text-forest-700">{importMsg}</p>}

      {locations.length > 0 && (
        <ul className="divide-y divide-bark-200 border border-bark-300">
          {locations.map((loc) => (
            <li key={loc.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium text-charcoal-900">
                  <span className="mr-1.5 rounded bg-forest-700 px-1 text-[10px] font-bold text-cream-50">{loc.label}</span>
                  {loc.name}
                </p>
                <p className="font-mono text-[10px] text-bark-500">
                  {loc.lng.toFixed(5)}, {loc.lat.toFixed(5)}
                </p>
                {/* Per-location zoom: own scale overrides the project scale. */}
                <label className="mt-1 flex items-center gap-1 font-mono text-[10px] text-bark-600">
                  <span className="uppercase tracking-wide">Zoom</span>
                  <select
                    value={loc.scalePresetId ?? ""}
                    onChange={(e) => void onSetScale(loc, e.target.value || null)}
                    className="max-w-[10rem] truncate border border-bark-300 bg-cream-50 px-1 py-0.5 font-mono text-[10px] text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
                    aria-label={`Scale for ${loc.name}`}
                  >
                    <option value="">Project default ({projectScaleLabel})</option>
                    {scalePresets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(loc.id)}
                className="shrink-0 font-mono text-[11px] text-campfire-600 hover:text-campfire-700"
                aria-label={`Remove ${loc.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => void handleAdd(e)} className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Name (e.g. Grandma's House)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className="w-1/2 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
          />
          <input
            type="text"
            placeholder="Latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="w-1/2 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
          />
        </div>
        <label className="flex flex-col gap-1 font-mono text-[11px] text-bark-600">
          <span className="uppercase tracking-widest">Zoom / scale for this location</span>
          <select
            value={scaleId}
            onChange={(e) => setScaleId(e.target.value)}
            className="border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
          >
            <option value="">Project default ({projectScaleLabel})</option>
            {scalePresets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="font-mono text-[11px] text-campfire-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="border border-forest-700 bg-cream-50 px-3 py-1.5 font-mono text-sm text-forest-700 hover:bg-parchment-200 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add Location"}
        </button>
      </form>
    </div>
  );
}
