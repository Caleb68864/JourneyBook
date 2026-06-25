import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BBox, LngLat } from "@journeybook/atlas-core";

interface MapPreviewProps {
  /** WGS84 extent to fit/show. */
  extent: BBox | null;
  /** A bbox awaiting confirmation — drawn as a highlighted box and framed. */
  pendingBbox?: BBox | null;
  /** Important locations to show as markers. */
  locations: Array<{ id: string; name: string; lng: number; lat: number }>;
  /** Called when user clicks the map in draw mode. */
  onMapClick?: (lngLat: LngLat) => void;
  /** When true, the cursor shows crosshair and clicks emit onMapClick. */
  drawMode?: boolean;
}

const TILE_URL = "/api/tiles/usgs-topo/{z}/{x}/{y}";
const ATTRIBUTION = "USGS National Map";

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

/** A closed rectangle ring GeoJSON FeatureCollection from a [W,S,E,N] bbox. */
function bboxFeatureCollection([w, s, e, n]: BBox) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "Polygon" as const,
          coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
        },
      },
    ],
  };
}

export function MapPreview({ extent, pendingBbox, locations, onMapClick, drawMode }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "usgs-topo": {
            type: "raster",
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: ATTRIBUTION,
            minzoom: 0,
            maxzoom: 16,
          },
          "pending-bbox": { type: "geojson", data: EMPTY_FC },
        },
        layers: [
          {
            id: "usgs-topo",
            type: "raster",
            source: "usgs-topo",
          },
          {
            id: "pending-bbox-fill",
            type: "fill",
            source: "pending-bbox",
            paint: { "fill-color": "#c2410c", "fill-opacity": 0.12 },
          },
          {
            id: "pending-bbox-line",
            type: "line",
            source: "pending-bbox",
            paint: { "line-color": "#c2410c", "line-width": 2, "line-dasharray": [2, 1] },
          },
        ],
      },
      center: [-96, 38],
      zoom: 4,
      attributionControl: { compact: false },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => setReady(true));
    // Surface tile/source load failures (USGS gap, proxy down) non-blockingly.
    map.on("error", (e) => {
      if (e?.error) setTileError(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit to extent when it changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !extent) return;
    const [west, south, east, north] = extent;
    // A degenerate (zero-area) extent makes fitBounds throw — fly to its center instead.
    if (west === east || south === north) {
      map.flyTo({ center: [(west + east) / 2, (south + north) / 2], zoom: 12 });
      return;
    }
    map.fitBounds([west, south, east, north], { padding: 40, animate: true });
  }, [extent, ready]);

  // Draw + frame the pending (unconfirmed) bbox.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("pending-bbox") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!pendingBbox) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData(bboxFeatureCollection(pendingBbox));
    const [w, s, e, n] = pendingBbox;
    if (w === e || s === n) {
      map.flyTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 12 });
    } else {
      map.fitBounds([w, s, e, n], { padding: 60, animate: true });
    }
  }, [pendingBbox, ready]);

  // Auto-frame locations when no extent
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || extent || locations.length === 0) return;
    if (locations.length === 1) {
      map.flyTo({ center: [locations[0]!.lng, locations[0]!.lat], zoom: 12 });
      return;
    }
    const lngs = locations.map((l) => l.lng);
    const lats = locations.map((l) => l.lat);
    const [w, s, e, n] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    // All locations at the same point → zero-area bounds → fitBounds throws.
    if (w === e || s === n) {
      map.flyTo({ center: [w, s], zoom: 12 });
      return;
    }
    map.fitBounds([w, s, e, n], { padding: 80, animate: true });
  }, [locations, extent, ready]);

  // Sync location markers
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = locations.map((loc) => {
      const el = document.createElement("div");
      el.className =
        "w-3 h-3 rounded-full bg-campfire-600 border-2 border-cream-50 shadow cursor-default";
      el.title = loc.name;
      return new maplibregl.Marker({ element: el })
        .setLngLat([loc.lng, loc.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(loc.name))
        .addTo(mapRef.current!);
    });
  }, [locations, ready]);

  // Draw mode click handler
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = drawMode ? "crosshair" : "";

    const handler = (e: maplibregl.MapMouseEvent) => {
      if (drawMode && onMapClick) onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [drawMode, onMapClick, ready]);

  return (
    <div className="relative flex h-full flex-col">
      <div ref={containerRef} className="flex-1" style={{ minHeight: 320 }} />
      <p className="mt-1 font-mono text-[10px] text-bark-500">
        Preview: Web Mercator (EPSG:3857). Printed pages are true-scale per the chosen preset.
      </p>
      {tileError && (
        <p className="mt-0.5 font-mono text-[10px] text-campfire-600">
          Some map tiles failed to load (the area may be outside USGS coverage).
        </p>
      )}
    </div>
  );
}
