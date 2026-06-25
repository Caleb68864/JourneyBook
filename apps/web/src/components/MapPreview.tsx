import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BBox, LngLat } from "@journeybook/atlas-core";

interface MapPreviewProps {
  /** WGS84 extent to fit/show. */
  extent: BBox | null;
  /** Important locations to show as markers. */
  locations: Array<{ id: string; name: string; lng: number; lat: number }>;
  /** Called when user clicks the map in draw mode. */
  onMapClick?: (lngLat: LngLat) => void;
  /** When true, the cursor shows crosshair and clicks emit onMapClick. */
  drawMode?: boolean;
}

const TILE_URL = "/api/tiles/usgs-topo/{z}/{x}/{y}";
const ATTRIBUTION = "USGS National Map";

export function MapPreview({ extent, locations, onMapClick, drawMode }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

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
        },
        layers: [
          {
            id: "usgs-topo",
            type: "raster",
            source: "usgs-topo",
          },
        ],
      },
      center: [-96, 38],
      zoom: 4,
      attributionControl: { compact: false },
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.on("load", () => setReady(true));

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
    map.fitBounds([west, south, east, north], { padding: 40, animate: true });
  }, [extent, ready]);

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
    const bounds: [number, number, number, number] = [
      Math.min(...lngs),
      Math.min(...lats),
      Math.max(...lngs),
      Math.max(...lats),
    ];
    map.fitBounds(bounds, { padding: 80, animate: true });
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
    </div>
  );
}
