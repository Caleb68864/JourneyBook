import { useState } from "react";
import type { BBox } from "@journeybook/atlas-core";
import { api, type GeocodeResult } from "../api/client";

interface GeocodeSearchProps {
  /** Project extent, used to bias results toward the current map area. */
  viewbox?: BBox | null;
  /** Add the chosen result as a location; receives the result + original query. */
  onPick: (result: GeocodeResult, query: string) => Promise<void>;
}

export function GeocodeSearch({ viewbox, onPick }: GeocodeSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setSearching(true);
    setResults(null);
    try {
      const found = await api.geocode.search(query.trim(), viewbox);
      setResults(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handlePick(r: GeocodeResult) {
    setAdding(r.displayName);
    setError(null);
    try {
      await onPick(r, query.trim());
      setResults(null);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add location.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={(e) => void handleSearch(e)} className="flex gap-2">
        <input
          type="text"
          placeholder="Search an address or place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-1 focus:ring-forest-700"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="border border-forest-700 bg-cream-50 px-3 py-1.5 font-mono text-xs text-forest-700 hover:bg-parchment-200 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {results !== null && results.length === 0 && (
        <p className="font-mono text-[11px] text-bark-500">No matches found.</p>
      )}

      {results !== null && results.length > 0 && (
        <ul className="divide-y divide-bark-200 border border-bark-300">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                onClick={() => void handlePick(r)}
                disabled={adding !== null}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-parchment-200 disabled:opacity-50"
              >
                <span className="min-w-0 truncate font-mono text-xs text-charcoal-900">{r.displayName}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-forest-700">
                  {adding === r.displayName ? "Adding…" : "+ Add"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="font-mono text-[11px] text-campfire-600">{error}</p>}
    </div>
  );
}
