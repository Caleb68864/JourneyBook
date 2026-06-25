import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MAP_TIER, DEFAULT_SCALE_PRESET_ID, SCALE_PRESETS } from "@journeybook/atlas-core";
import type { BBox, LngLat, MapTier } from "@journeybook/atlas-core";
import { api, type Location, type Project } from "../api/client";
import { MapPreview } from "../components/MapPreview";
import { ScalePicker } from "../components/ScalePicker";
import { TierPicker } from "../components/TierPicker";
import { LocationList } from "../components/LocationList";
import { GenerateButton } from "../components/GenerateButton";

interface ProjectEditorPageProps {
  projectId: string;
  onBack: () => void;
}

type DrawMode = "none" | "bbox-first" | "bbox-second" | "location";

export function ProjectEditorPage({ projectId, onBack }: ProjectEditorPageProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [bboxFirst, setBboxFirst] = useState<LngLat | null>(null);
  const [saving, setSaving] = useState(false);
  // Tier is chosen at render time (the API has no project-level tier field); it is
  // carried in the render request body when Generate is clicked.
  const [tier, setTier] = useState<MapTier>(DEFAULT_MAP_TIER);

  // Manual bbox entry
  const [bboxInputs, setBboxInputs] = useState({ west: "", south: "", east: "", north: "" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.projects.get(projectId), api.locations.list(projectId)])
      .then(([proj, locs]) => {
        if (cancelled) return;
        setProject(proj);
        setLocations(locs);
        if (proj.extent) {
          const [w, s, e, n] = proj.extent;
          setBboxInputs({
            west: String(w),
            south: String(s),
            east: String(e),
            north: String(n),
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load project.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  function setScaleView(scalePresetId: string) {
    // scalePresetId is persisted on the project's grid at creation (POST /api/projects)
    // and is what the render endpoint reads. There is no PATCH endpoint to mutate it
    // after creation yet, so changing the picker updates the working view only — see
    // the note rendered below the pickers. Tier, by contrast, is sent at render time.
    setProject((p) => (p ? { ...p, scalePresetId } : p));
  }

  async function applyBboxInputs() {
    const w = parseFloat(bboxInputs.west);
    const s = parseFloat(bboxInputs.south);
    const e = parseFloat(bboxInputs.east);
    const n = parseFloat(bboxInputs.north);
    if ([w, s, e, n].some(isNaN)) return;
    const bbox: BBox = [w, s, e, n];
    setSaving(true);
    try {
      const updated = await api.projects.setExtent(projectId, bbox);
      setProject(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save extent.");
    } finally {
      setSaving(false);
    }
  }

  const handleMapClick = useCallback(
    async (lngLat: LngLat) => {
      if (drawMode === "bbox-first") {
        setBboxFirst(lngLat);
        setDrawMode("bbox-second");
      } else if (drawMode === "bbox-second" && bboxFirst) {
        const bbox: BBox = [
          Math.min(bboxFirst.lng, lngLat.lng),
          Math.min(bboxFirst.lat, lngLat.lat),
          Math.max(bboxFirst.lng, lngLat.lng),
          Math.max(bboxFirst.lat, lngLat.lat),
        ];
        setDrawMode("none");
        setBboxFirst(null);
        setSaving(true);
        try {
          const updated = await api.projects.setExtent(projectId, bbox);
          setProject(updated);
          const [w, s, e, n] = bbox;
          setBboxInputs({ west: String(w), south: String(s), east: String(e), north: String(n) });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save extent.");
        } finally {
          setSaving(false);
        }
      } else if (drawMode === "location") {
        setDrawMode("none");
        const name = `Location ${locations.length + 1}`;
        try {
          const loc = await api.locations.create(projectId, name, lngLat.lng, lngLat.lat);
          setLocations((l) => [...l, loc]);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to save location.");
        }
      }
    },
    [drawMode, bboxFirst, projectId, locations.length],
  );

  async function handleAddLocation(name: string, lng: number, lat: number) {
    const loc = await api.locations.create(projectId, name, lng, lat);
    setLocations((l) => [...l, loc]);
  }

  async function handleDeleteLocation(id: string) {
    try {
      await api.locations.delete(projectId, id);
      setLocations((l) => l.filter((x) => x.id !== id));
    } catch (err) {
      // Don't drop it from the UI if the server delete failed.
      setError(err instanceof Error ? err.message : "Failed to delete location.");
    }
  }

  const scale = SCALE_PRESETS.find((s) => s.id === (project?.scalePresetId ?? DEFAULT_SCALE_PRESET_ID));
  // Static copy only — the ground footprint is fixed by the chosen preset, whose
  // label comes straight from atlas-core's SCALE_PRESETS. The web app performs no
  // projection/scale arithmetic (ADR 0004 — atlas-core owns all geometry).
  const footprintLabel = scale ? scale.label : "";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment-200">
        <p className="font-mono text-sm text-bark-600">Loading project…</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-parchment-200">
        <p className="font-mono text-sm text-campfire-600">{error ?? "Project not found."}</p>
      </div>
    );
  }

  const drawActive = drawMode !== "none";
  const drawCursor = drawMode === "bbox-first"
    ? "Click first corner"
    : drawMode === "bbox-second"
    ? "Click opposite corner"
    : drawMode === "location"
    ? "Click to drop location"
    : null;

  return (
    <div className="relative min-h-screen bg-parchment-200 text-charcoal-900">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-bark-400/50 bg-cream-100 px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[11px] uppercase tracking-widest text-bark-600 hover:text-charcoal-900"
        >
          ← Projects
        </button>
        <span className="font-display text-lg text-forest-700">{project.name}</span>
        {saving && <span className="font-mono text-[11px] text-bark-500">Saving…</span>}
        {error && <span className="font-mono text-[11px] text-campfire-600">{error}</span>}
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-0 lg:flex-row">
        {/* Map panel */}
        <div className="relative flex-1 border-r border-bark-300">
          {drawCursor && (
            <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 bg-forest-700 px-4 py-1 font-mono text-xs text-cream-50 shadow">
              {drawCursor}
            </div>
          )}
          <div className="h-[calc(100vh-3.5rem)]">
            <MapPreview
              extent={project.extent}
              locations={locations}
              onMapClick={drawActive ? handleMapClick : undefined}
              drawMode={drawActive}
            />
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full overflow-y-auto bg-parchment-100 p-5 lg:w-80">
          <div className="flex flex-col gap-6">
            {/* Scale & tier */}
            <section className="flex flex-col gap-4 border-b border-bark-300 pb-5">
              <ScalePicker
                value={project.scalePresetId}
                onChange={setScaleView}
              />
              <TierPicker
                value={tier}
                onChange={setTier}
              />
              {footprintLabel && (
                <p className="font-mono text-[10px] text-bark-500">
                  Ground footprint fixed by the {footprintLabel} preset (Letter portrait)
                </p>
              )}
              <p className="font-mono text-[10px] italic text-bark-400">
                Preview uses Web Mercator; printed pages are true-scale at the chosen preset.
              </p>
              <p className="font-mono text-[10px] italic text-bark-400">
                Scale is fixed when the project is created (view-only here); the tier you
                pick is applied to the atlas when you click Generate.
              </p>
            </section>

            {/* Bounding box */}
            <section className="flex flex-col gap-3 border-b border-bark-300 pb-5">
              <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
                Bounding Box
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(["west", "south", "east", "north"] as const).map((key) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <label htmlFor={`bbox-${key}`} className="font-mono text-[10px] uppercase text-bark-500">{key}</label>
                    <input
                      id={`bbox-${key}`}
                      type="text"
                      value={bboxInputs[key]}
                      onChange={(e) =>
                        setBboxInputs((b) => ({ ...b, [key]: e.target.value }))
                      }
                      placeholder={key === "west" || key === "east" ? "-96.00" : "41.00"}
                      className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void applyBboxInputs()}
                  className="flex-1 border border-forest-700 bg-cream-50 px-3 py-1.5 font-mono text-xs text-forest-700 hover:bg-parchment-200"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => setDrawMode("bbox-first")}
                  className="flex-1 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-xs text-bark-700 hover:bg-parchment-200"
                >
                  Draw on Map
                </button>
              </div>
            </section>

            {/* Locations */}
            <section className="border-b border-bark-300 pb-5">
              <LocationList
                locations={locations}
                onAdd={handleAddLocation}
                onDelete={handleDeleteLocation}
                onStartDrop={() => setDrawMode("location")}
              />
            </section>

            {/* Generate */}
            <section>
              <GenerateButton projectId={projectId} tier={tier} />
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
