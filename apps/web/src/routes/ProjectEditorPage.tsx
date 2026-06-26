import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_MAP_TIER,
  DEFAULT_SCALE_PRESET_ID,
  LETTER_PORTRAIT,
  MAX_ATLAS_PAGES,
  SCALE_PRESETS,
  buildPageGrid,
} from "@journeybook/atlas-core";
import type { BBox, LngLat, MapTier } from "@journeybook/atlas-core";
import { api, type Location, type Project } from "../api/client";
import { MapPreview } from "../components/MapPreview";
import { ScalePicker } from "../components/ScalePicker";
import { TierPicker } from "../components/TierPicker";
import { LocationList } from "../components/LocationList";
import { GeocodeSearch } from "../components/GeocodeSearch";
import type { GeocodeResult } from "../api/client";
import { GenerateButton } from "../components/GenerateButton";
import { LandmarkImportControl } from "../components/LandmarkImportControl";

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
  // Route-atlas opt-in. When set, Generate sends route:true so the worker adds
  // corridor (R#) pages alongside the location (L#) pages. Carried in the render
  // request body, like tier.
  const [route, setRoute] = useState(false);
  // Include-landmarks toggle (default on). Generate sends includeLandmarks so the
  // worker draws landmark furniture from the project's imported landmarks; unchecking
  // it generates a clean map without them. Carried in the render body, like route.
  const [includeLandmarks, setIncludeLandmarks] = useState(true);
  // Table-of-contents toggle (default on). Generate sends tableOfContents; when
  // off, the PDF skips the front-matter locations contents page.
  const [tableOfContents, setTableOfContents] = useState(true);
  // Front-matter overview page, reference-grid border, and notes area toggles.
  const [overview, setOverview] = useState(true);
  const [referenceGrid, setReferenceGrid] = useState(true);
  const [notes, setNotes] = useState(true);

  // Manual bbox entry
  const [bboxInputs, setBboxInputs] = useState({ west: "", south: "", east: "", north: "" });
  // A drawn/entered bbox awaiting confirmation. Shown as a box on the map; only
  // written to the project (PUT /extent) when the user confirms it.
  const [pendingBbox, setPendingBbox] = useState<BBox | null>(null);

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

  // Typed bbox → preview box (not saved until confirmed).
  function previewBboxInputs() {
    const w = parseFloat(bboxInputs.west);
    const s = parseFloat(bboxInputs.south);
    const e = parseFloat(bboxInputs.east);
    const n = parseFloat(bboxInputs.north);
    if ([w, s, e, n].some(isNaN)) {
      setError("Enter all four bounding-box fields (west, south, east, north) as numbers.");
      return;
    }
    if (w >= e || s >= n) {
      setError("Bounding box must have west < east and south < north.");
      return;
    }
    setError(null);
    setPendingBbox([w, s, e, n]);
  }

  // Commit the previewed box to the project.
  async function confirmPendingExtent() {
    if (!pendingBbox) return;
    setError(null);
    setSaving(true);
    try {
      const updated = await api.projects.setExtent(projectId, pendingBbox);
      setProject(updated);
      setPendingBbox(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save extent.");
    } finally {
      setSaving(false);
    }
  }

  // Box → location: save the previewed box's centre as an important location
  // instead of as the project extent.
  async function saveBoxAsLocation() {
    if (!pendingBbox) return;
    const [w, s, e, n] = pendingBbox;
    setError(null);
    setSaving(true);
    try {
      const loc = await api.locations.create(
        projectId,
        `Area ${locations.length + 1}`,
        (w + e) / 2,
        (s + n) / 2,
      );
      setLocations((l) => [...l, loc]);
      setPendingBbox(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save location.");
    } finally {
      setSaving(false);
    }
  }

  // Locations → bbox: enclose all saved locations in a box (padded so points
  // aren't on the edge / a single point still yields a usable box), shown as a
  // pending box for review before it becomes the project extent.
  function encloseLocations() {
    if (locations.length === 0) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const loc of locations) {
      w = Math.min(w, loc.lng);
      e = Math.max(e, loc.lng);
      s = Math.min(s, loc.lat);
      n = Math.max(n, loc.lat);
    }
    const padX = Math.max((e - w) * 0.05, 0.02);
    const padY = Math.max((n - s) * 0.05, 0.02);
    const bbox: BBox = [w - padX, s - padY, e + padX, n + padY];
    setError(null);
    setBboxInputs({ west: String(bbox[0]), south: String(bbox[1]), east: String(bbox[2]), north: String(bbox[3]) });
    setPendingBbox(bbox);
  }

  // Discard the previewed box and restore the inputs to the saved extent.
  function cancelPendingExtent() {
    setPendingBbox(null);
    setError(null);
    if (project?.extent) {
      const [w, s, e, n] = project.extent;
      setBboxInputs({ west: String(w), south: String(s), east: String(e), north: String(n) });
    } else {
      setBboxInputs({ west: "", south: "", east: "", north: "" });
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
        // Show the drawn box for review; don't save until the user confirms.
        const [w, s, e, n] = bbox;
        setBboxInputs({ west: String(w), south: String(s), east: String(e), north: String(n) });
        setPendingBbox(bbox);
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

  async function handleAddLocation(
    name: string,
    lng: number,
    lat: number,
    scalePresetId?: string | null,
  ) {
    const loc = await api.locations.create(projectId, name, lng, lat, undefined, scalePresetId);
    setLocations((l) => [...l, loc]);
  }

  async function handleSetLocationScale(loc: Location, scalePresetId: string | null) {
    try {
      const updated = await api.locations.update(loc.id, {
        name: loc.name,
        lng: loc.lng,
        lat: loc.lat,
        notes: loc.notes,
        scalePresetId,
      });
      setLocations((l) => l.map((x) => (x.id === loc.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update location scale.");
    }
  }

  async function handleSetLocationPin(loc: Location, pinShape: string, pinColor: string) {
    try {
      const updated = await api.locations.update(loc.id, {
        name: loc.name,
        lng: loc.lng,
        lat: loc.lat,
        notes: loc.notes,
        scalePresetId: loc.scalePresetId,
        pinShape,
        pinColor,
      });
      setLocations((l) => l.map((x) => (x.id === loc.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update pin.");
    }
  }

  // Address search → location: create at the geocoded position, recording the
  // original query + provider as provenance.
  async function handleGeocodePick(result: GeocodeResult, query: string) {
    const name = result.displayName.split(",")[0]?.trim() || result.displayName;
    const loc = await api.locations.create(
      projectId,
      name,
      result.lng,
      result.lat,
      undefined,
      undefined,
      query,
      "nominatim",
    );
    setLocations((l) => [...l, loc]);
  }

  async function handleImportCsv(csv: string): Promise<number> {
    const result = await api.locations.import(projectId, csv);
    setLocations((l) => [...l, ...result.locations]);
    return result.imported;
  }

  async function handleDeleteLocation(id: string) {
    try {
      await api.locations.delete(id);
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

  const hasGeometry = project.extent !== null || locations.length > 0;

  // Page count for a bbox at the project's scale — comes straight from the engine
  // (buildPageGrid), not reimplemented here (ADR 0004). Used to warn/block before a
  // too-large extent is confirmed or rendered (the render caps at MAX_ATLAS_PAGES).
  const countPages = (bbox: BBox | null): number | null => {
    if (!bbox || !scale) return null;
    try {
      return buildPageGrid({
        bbox, scale, page: LETTER_PORTRAIT, overlap: project.overlap ?? 0, tier: DEFAULT_MAP_TIER,
      }).pages.length;
    } catch {
      return null;
    }
  };
  const pendingPageCount = countPages(pendingBbox);
  const pendingOverLimit = pendingPageCount !== null && pendingPageCount > MAX_ATLAS_PAGES;
  const savedPageCount = countPages(project.extent);
  const savedOverLimit = savedPageCount !== null && savedPageCount > MAX_ATLAS_PAGES;

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
              pendingBbox={pendingBbox}
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
                  onClick={previewBboxInputs}
                  disabled={saving}
                  className="flex-1 border border-forest-700 bg-cream-50 px-3 py-1.5 font-mono text-xs text-forest-700 hover:bg-parchment-200 disabled:opacity-50"
                >
                  Preview Box
                </button>
                <button
                  type="button"
                  onClick={() => { setPendingBbox(null); setDrawMode("bbox-first"); }}
                  className="flex-1 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-xs text-bark-700 hover:bg-parchment-200"
                >
                  Draw on Map
                </button>
              </div>
              {locations.length > 0 && (
                <button
                  type="button"
                  onClick={encloseLocations}
                  disabled={saving}
                  className="border border-forest-700 bg-cream-50 px-3 py-1.5 font-mono text-xs text-forest-700 hover:bg-parchment-200 disabled:opacity-50"
                  title="Set the bounding box to enclose every saved location"
                >
                  Enclose {locations.length} Location{locations.length === 1 ? "" : "s"}
                </button>
              )}
              {pendingBbox && (
                <div className="flex flex-col gap-2 border border-campfire-600/40 bg-campfire-50/40 p-2">
                  <p className="font-mono text-[10px] text-bark-600">
                    Review the highlighted box on the map. It isn't saved until you confirm.
                  </p>
                  {pendingPageCount !== null && (
                    <p className={`font-mono text-[10px] ${pendingOverLimit ? "font-bold text-campfire-700" : "text-bark-600"}`}>
                      {pendingOverLimit ? "⚠ " : ""}This box ≈ {pendingPageCount} page{pendingPageCount === 1 ? "" : "s"}
                      {pendingOverLimit
                        ? ` — over the ${MAX_ATLAS_PAGES}-page limit. Draw a smaller box or pick a coarser scale.`
                        : "."}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmPendingExtent()}
                      disabled={saving || pendingOverLimit}
                      title={pendingOverLimit ? `Box exceeds the ${MAX_ATLAS_PAGES}-page limit` : undefined}
                      className="flex-1 bg-forest-700 px-3 py-1.5 font-mono text-xs text-cream-50 hover:bg-forest-600 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : pendingOverLimit ? "Too Large" : "Confirm Box"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelPendingExtent}
                      disabled={saving}
                      className="flex-1 border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-xs text-bark-700 hover:bg-parchment-200 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                  {/* Box → location: keep the box's centre as a saved place instead. */}
                  <button
                    type="button"
                    onClick={() => void saveBoxAsLocation()}
                    disabled={saving}
                    className="border border-bark-400 bg-cream-50 px-3 py-1.5 font-mono text-[11px] text-bark-700 hover:bg-parchment-200 disabled:opacity-50"
                    title="Save this box's centre as an important location instead of the project extent"
                  >
                    Save Centre as Location
                  </button>
                </div>
              )}
            </section>

            {/* Locations */}
            <section className="flex flex-col gap-3 border-b border-bark-300 pb-5">
              <GeocodeSearch viewbox={project.extent} onPick={handleGeocodePick} />
              <LocationList
                locations={locations}
                scalePresets={SCALE_PRESETS}
                projectScaleId={project?.scalePresetId ?? DEFAULT_SCALE_PRESET_ID}
                onAdd={handleAddLocation}
                onDelete={handleDeleteLocation}
                onSetScale={handleSetLocationScale}
                onSetPin={handleSetLocationPin}
                onImport={handleImportCsv}
                onStartDrop={() => setDrawMode("location")}
              />
            </section>

            {/* Landmarks */}
            <section className="border-b border-bark-300 pb-5">
              <LandmarkImportControl
                projectId={projectId}
                hasExtent={project.extent !== null}
              />
            </section>

            {/* Generate */}
            <section>
              <label className="mb-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={route}
                  onChange={(e) => setRoute(e.target.checked)}
                  className="mt-0.5 accent-forest-700"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
                    Generate Route Atlas
                  </span>
                  <span className="font-mono text-[10px] text-bark-500">
                    Adds corridor (R#) pages connecting your locations in order, alongside the location (L#) pages.
                  </span>
                </span>
              </label>
              <label className="mb-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={includeLandmarks}
                  onChange={(e) => setIncludeLandmarks(e.target.checked)}
                  className="mt-0.5 accent-forest-700"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
                    Include Landmarks
                  </span>
                  <span className="font-mono text-[10px] text-bark-500">
                    Draws your imported landmarks as map furniture, distinct from the L# location markers.
                  </span>
                </span>
              </label>
              <label className="mb-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={tableOfContents}
                  onChange={(e) => setTableOfContents(e.target.checked)}
                  className="mt-0.5 accent-forest-700"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
                    Table of Contents
                  </span>
                  <span className="font-mono text-[10px] text-bark-500">
                    Opens the PDF with a contents page listing your locations and their page numbers.
                  </span>
                </span>
              </label>
              <label className="mb-3 flex items-start gap-2">
                <input type="checkbox" checked={overview} onChange={(e) => setOverview(e.target.checked)} className="mt-0.5 accent-forest-700" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Overview Map</span>
                  <span className="font-mono text-[10px] text-bark-500">
                    A whole-trip index page showing every page's area, the route, and your stops.
                  </span>
                </span>
              </label>
              <label className="mb-3 flex items-start gap-2">
                <input type="checkbox" checked={referenceGrid} onChange={(e) => setReferenceGrid(e.target.checked)} className="mt-0.5 accent-forest-700" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Reference Grid</span>
                  <span className="font-mono text-[10px] text-bark-500">
                    Draws an A–F / 1–8 locator grid on each page so you can write down grid coordinates.
                  </span>
                </span>
              </label>
              <label className="mb-3 flex items-start gap-2">
                <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} className="mt-0.5 accent-forest-700" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Notes Area</span>
                  <span className="font-mono text-[10px] text-bark-500">
                    Adds a foot-of-page notes strip (your saved notes + blank lines to write on).
                  </span>
                </span>
              </label>
              <GenerateButton projectId={projectId} tier={tier} route={route} includeLandmarks={includeLandmarks} tableOfContents={tableOfContents} overview={overview} referenceGrid={referenceGrid} notes={notes} disabled={!hasGeometry || savedOverLimit} />
              {!hasGeometry && (
                <p className="mt-1 font-mono text-[10px] text-bark-500">
                  Set a bounding box or add a location to generate an atlas.
                </p>
              )}
              {savedOverLimit && (
                <p className="mt-1 font-mono text-[10px] font-bold text-campfire-700">
                  ⚠ The current bounding box ≈ {savedPageCount} pages, over the {MAX_ATLAS_PAGES}-page limit. Shrink the box before generating.
                </p>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
