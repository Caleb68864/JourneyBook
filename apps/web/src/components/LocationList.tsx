import { useState } from "react";
import type { Location } from "../api/client";

interface LocationListProps {
  locations: Location[];
  onAdd: (label: string, lng: number, lat: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** If true, user can click map to drop pin — communicated to parent */
  onStartDrop?: () => void;
}

export function LocationList({ locations, onAdd, onDelete, onStartDrop }: LocationListProps) {
  const [label, setLabel] = useState("");
  const [lng, setLng] = useState("");
  const [lat, setLat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const lngNum = parseFloat(lng);
    const latNum = parseFloat(lat);
    if (!label.trim() || isNaN(lngNum) || isNaN(latNum)) {
      setError("Enter a label, longitude, and latitude.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onAdd(label.trim(), lngNum, latNum);
      setLabel("");
      setLng("");
      setLat("");
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

      {locations.length > 0 && (
        <ul className="divide-y divide-bark-200 border border-bark-300">
          {locations.map((loc) => (
            <li key={loc.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium text-charcoal-900">{loc.label}</p>
                <p className="font-mono text-[10px] text-bark-500">
                  {loc.lng.toFixed(5)}, {loc.lat.toFixed(5)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(loc.id)}
                className="shrink-0 font-mono text-[11px] text-campfire-600 hover:text-campfire-700"
                aria-label={`Remove ${loc.label}`}
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
          placeholder="Label (e.g. Grandma's House)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
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
