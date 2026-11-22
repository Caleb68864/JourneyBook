import { useEffect, useState } from "react";
import { api, type MapPackage } from "../api/client";

/** "12.3 MB", "512 KB", "900 B". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** "41.00°N–40.50°N, 97.00°W–96.50°W" for a [W,S,E,N] box. */
export function formatBBox([w, s, e, n]: readonly number[]): string {
  const lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
  const lng = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;
  return `${lat(s!)}–${lat(n!)}, ${lng(w!)}–${lng(e!)}`;
}

/**
 * The offline map packages on the server (Stage 7 manifest), read-only.
 *
 * Making a package (`POST /api/map-packages`) and registering one
 * (`POST /api/map-packages/register`) are registry writes behind the admin key, which this app
 * does not hold, so the panel only shows what exists: coverage, zooms, size, and whether a tile
 * source serves it. A package with no source is on disk but not usable by a render yet.
 */
export function MapPackagesPanel() {
  const [packages, setPackages] = useState<MapPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.mapPackages
      .list()
      .then((list) => {
        if (!cancelled) setPackages(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load map packages.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="map-packages-heading" className="mt-8 border border-bark-300 bg-cream-100 p-4">
      <h2 id="map-packages-heading" className="font-display text-base text-forest-700">
        Offline map packages
      </h2>
      {error ? (
        <p className="mt-2 font-mono text-xs text-campfire-600">{error}</p>
      ) : packages === null ? (
        <p className="mt-2 font-mono text-xs text-bark-500">Loading…</p>
      ) : packages.length === 0 ? (
        <p className="mt-2 font-mono text-xs text-bark-500">
          No packages on the server. An administrator can make one for an area so renders work without a connection.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-bark-300">
          {packages.map((p) => (
            <li key={p.file} className="py-2 font-mono text-xs text-charcoal-900">
              <p className="text-sm">{p.file}</p>
              {p.error ? (
                <p className="text-campfire-600">Unreadable: {p.error}</p>
              ) : (
                <p className="text-bark-600">
                  {p.bbox ? formatBBox(p.bbox) : "no bounds"} · zoom {p.minZoom}–{p.maxZoom} ·{" "}
                  {p.addressedTiles?.toLocaleString()} {p.tileType} tiles · {formatBytes(p.bytes)}
                </p>
              )}
              <p className={p.sourceKeys.length > 0 ? "text-forest-700" : "text-bark-500"}>
                {p.sourceKeys.length > 0
                  ? `Served as ${p.sourceKeys.join(", ")}`
                  : "Not registered as a tile source yet"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
