import { useState } from "react";
import type { Location } from "../api/client";
import { PinEditor } from "./PinEditor";

interface ScalePresetOption {
  id: string;
  label: string;
  /** Scale denominator; used to order the zoom ladder coarse → fine. */
  ratio: number;
}

/**
 * Where a geocoded location's coordinate came from, or null when there is no
 * provenance to show.
 *
 * Exported and pure so the wording is testable: the thing that can go wrong here
 * is claiming a provenance a pin does not have. A location placed by clicking the
 * map, or imported from CSV, has no `geocodedFrom` and must say nothing at all —
 * a coordinate the user chose themselves is not "searched for", and captioning it
 * as though it were would be the app answering a question addressed to nobody.
 *
 * The provider is included only when the server recorded one, and is separated
 * rather than interpolated into a sentence, because "via nominatim" next to the
 * query is what tells a user why two searches for the same place disagreed.
 */
export function locationProvenance(
  loc: Pick<Location, "geocodedFrom" | "geocodeProvider">,
): string | null {
  const query = loc.geocodedFrom?.trim();
  if (!query) return null;
  const provider = loc.geocodeProvider?.trim();
  return provider ? `searched “${query}” · ${provider}` : `searched “${query}”`;
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
  /** Set a saved location's custom pin (shape + hex color). */
  onSetPin: (loc: Location, shape: string, color: string) => Promise<void>;
  /** Set (or clear) a location's zoom ladder. Empty selection → null. */
  onSetZoomLevels: (loc: Location, zoomLevels: string[] | null) => Promise<void>;
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
  onSetPin,
  onSetZoomLevels,
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

  // Ladder levels always read coarse → fine (regional → local → detail), so the
  // printed pages step in. Presenting them in that fixed order means picking a
  // ladder is a set of checkboxes rather than a drag-to-reorder list.
  const ladderPresets = [...scalePresets].sort((a, b) => b.ratio - a.ratio);

  /** Toggle one level in a location's ladder, keeping coarse → fine order. */
  function toggleLadderLevel(loc: Location, id: string) {
    const current = new Set(loc.zoomLevels ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const next = ladderPresets.filter((s) => current.has(s.id)).map((s) => s.id);
    void onSetZoomLevels(loc, next.length > 0 ? next : null);
  }

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
          {/* sr-only, not hidden: `hidden` is display:none, so the input was not
              focusable, and a <label> is never in the tab order — CSV import could
              not be reached at all without a mouse. */}
          <label className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-forest-700 underline hover:text-forest-600 focus-within:ring-2 focus-within:ring-forest-700">
            {importing ? "Importing…" : "Import CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleImportFile(e)}
              disabled={importing}
              className="sr-only"
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
      {/* "Imported N locations" arrives after an upload whose progress the user
          cannot see; without a live region it is announced to nobody. */}
      <div aria-live="polite">
        {importMsg && <p className="font-mono text-[11px] text-forest-700">{importMsg}</p>}
      </div>

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
                {/*
                  Where this coordinate came from, when the app is the thing that
                  knows. `handleGeocodePick` records the query and the provider on
                  every geocoded location; both were persisted, returned on every
                  read, and displayed nowhere — so the only record of why a pin is
                  where it is was written and never read. Absent for a pin dropped
                  on the map or imported from CSV, where there is no provenance to
                  show and inventing one would be worse than showing none.
                */}
                {loc.geocodedFrom && (
                  <p className="truncate font-mono text-[10px] text-bark-500" title={locationProvenance(loc) ?? undefined}>
                    {locationProvenance(loc)}
                  </p>
                )}
                {/* Per-location zoom: own scale overrides the project scale. */}
                <label className="mt-1 flex items-center gap-1 font-mono text-[10px] text-bark-600">
                  <span className="uppercase tracking-wide">Zoom</span>
                  <select
                    value={loc.scalePresetId ?? ""}
                    onChange={(e) => void onSetScale(loc, e.target.value || null)}
                    disabled={(loc.zoomLevels?.length ?? 0) > 0}
                    className="max-w-[10rem] truncate border border-bark-300 bg-cream-50 px-1 py-0.5 font-mono text-[10px] text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700 disabled:opacity-40"
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

                {/* Zoom ladder: one page per checked level, coarse → fine. */}
                <fieldset className="mt-1.5">
                  <legend className="font-mono text-[10px] uppercase tracking-wide text-bark-600">
                    Zoom ladder
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ladderPresets.map((s) => {
                      const checked = (loc.zoomLevels ?? []).includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleLadderLevel(loc, s.id)}
                          aria-pressed={checked}
                          title={`${checked ? "Remove" : "Add"} ${s.label} for ${loc.name}`}
                          className={`border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                            checked
                              ? "border-forest-700 bg-forest-700 text-cream-50"
                              : "border-bark-300 bg-cream-50 text-bark-600 hover:border-forest-700 hover:text-forest-700"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-bark-500">
                    {(loc.zoomLevels?.length ?? 0) > 0
                      ? `${loc.zoomLevels!.length} page${loc.zoomLevels!.length === 1 ? "" : "s"} — ${loc.label}a…, coarse to fine. Overrides Zoom above.`
                      : "Pick two or more to print this place at several zoom levels."}
                  </p>
                </fieldset>
                <PinEditor
                  shape={loc.pinShape}
                  color={loc.pinColor}
                  onChange={(shape, color) => void onSetPin(loc, shape, color)}
                />
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
          aria-label="Location name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Longitude"
            aria-label="Longitude"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            className="w-1/2 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
          />
          <input
            type="text"
            placeholder="Latitude"
            aria-label="Latitude"
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
