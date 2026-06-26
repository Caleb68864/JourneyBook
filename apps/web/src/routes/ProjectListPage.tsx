import { useEffect, useState } from "react";
import { DEFAULT_SCALE_PRESET_ID } from "@journeybook/atlas-core";
import { api, type Project } from "../api/client";

interface ProjectListPageProps {
  onOpen: (projectId: string) => void;
}

export function ProjectListPage({ onOpen }: ProjectListPageProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.projects
      .list()
      .then((p) => { if (!cancelled) setProjects(p); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleCreate(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const proj = await api.projects.create(newName.trim(), DEFAULT_SCALE_PRESET_ID);
      setProjects((p) => [proj, ...p]);
      setNewName("");
      setShowForm(false);
      onOpen(proj.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicate(proj: Project) {
    setError(null);
    try {
      const copy = await api.projects.duplicate(proj.id);
      setProjects((p) => [copy, ...p]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate.");
    }
  }

  async function handleDelete(proj: Project) {
    if (!window.confirm(`Delete "${proj.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.projects.delete(proj.id);
      setProjects((p) => p.filter((x) => x.id !== proj.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  async function handleExport(proj: Project) {
    setError(null);
    try {
      const locs = await api.locations.list(proj.id);
      const data = {
        version: 1,
        project: {
          name: proj.name,
          scalePresetId: proj.scalePresetId,
          orientation: proj.orientation,
          overlap: proj.overlap,
          extent: proj.extent,
        },
        locations: locs.map((l) => ({
          name: l.name, lng: l.lng, lat: l.lat, notes: l.notes,
          scalePresetId: l.scalePresetId, pinShape: l.pinShape, pinColor: l.pinColor,
        })),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${proj.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.journeybook.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export.");
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const data = JSON.parse(await file.text()) as {
        project?: { name?: string; scalePresetId?: string; extent?: [number, number, number, number] | null };
        locations?: Array<{ name: string; lng: number; lat: number; notes?: string | null; scalePresetId?: string | null; pinShape?: string | null; pinColor?: string | null }>;
      };
      const p = data.project ?? {};
      const proj = await api.projects.create(p.name ?? "Imported Atlas", p.scalePresetId ?? DEFAULT_SCALE_PRESET_ID);
      if (p.extent) await api.projects.setExtent(proj.id, p.extent);
      for (const l of data.locations ?? []) {
        const created = await api.locations.create(proj.id, l.name, l.lng, l.lat, l.notes ?? undefined, l.scalePresetId ?? undefined);
        if (l.pinShape || l.pinColor) {
          await api.locations.update(created.id, {
            name: created.name, lng: created.lng, lat: created.lat, notes: created.notes,
            scalePresetId: created.scalePresetId, pinShape: l.pinShape, pinColor: l.pinColor,
          });
        }
      }
      setProjects((ps) => [proj, ...ps]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import — is it a JourneyBook export?");
    }
  }

  return (
    <div className="min-h-screen bg-parchment-200 text-charcoal-900">
      {/* Header */}
      <header className="border-b border-bark-400/50 bg-cream-100 px-5 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="font-display text-xl text-forest-700">Journey Book</span>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer border border-bark-400 px-3 py-2 font-mono text-xs uppercase tracking-widest text-bark-600 hover:bg-parchment-300">
              Import
              <input type="file" accept=".json,application/json" onChange={(e) => void handleImport(e)} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 bg-forest-700 px-4 py-2 font-display text-sm tracking-wide text-cream-50 shadow-[2px_2px_0_0_var(--color-bark-700)] hover:bg-forest-600"
            >
              + New Atlas
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8">
        {/* New project form */}
        {showForm && (
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="mb-6 flex items-end gap-3 border border-bark-300 bg-cream-100 p-4"
          >
            <div className="flex flex-1 flex-col gap-1">
              <label className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
                Atlas Name
              </label>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Summer Camp Trek 2026"
                className="border border-bark-400 bg-cream-50 px-3 py-2 font-mono text-sm text-charcoal-900 placeholder:text-bark-400 focus:outline-none focus:ring-2 focus:ring-forest-700"
              />
            </div>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="bg-forest-700 px-5 py-2 font-display text-sm tracking-wide text-cream-50 hover:bg-forest-600 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-bark-400 px-4 py-2 font-mono text-sm text-bark-600 hover:bg-parchment-300"
            >
              Cancel
            </button>
          </form>
        )}

        {error && (
          <p className="mb-4 font-mono text-sm text-campfire-600">{error}</p>
        )}

        {loading ? (
          <p className="font-mono text-sm text-bark-500">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="border border-bark-300 bg-cream-100 p-10 text-center">
            <p className="font-display text-lg text-bark-600">No atlases yet.</p>
            <p className="mt-2 font-mono text-sm text-bark-500">
              Click "New Atlas" to create your first printable atlas.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-bark-300 border border-bark-300 bg-cream-100">
            {projects.map((proj) => (
              <li key={proj.id} className="flex items-center justify-between gap-2 pr-3 hover:bg-parchment-200">
                <button
                  type="button"
                  onClick={() => onOpen(proj.id)}
                  className="flex flex-1 items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <div>
                    <p className="font-display text-base text-forest-700">{proj.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-bark-500">
                      {proj.scalePresetId} · {new Date(proj.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] uppercase tracking-widest">
                  <button type="button" onClick={() => void handleDuplicate(proj)} className="text-forest-700 hover:text-forest-600">Duplicate</button>
                  <button type="button" onClick={() => void handleExport(proj)} className="text-bark-600 hover:text-charcoal-900">Export</button>
                  <button type="button" onClick={() => void handleDelete(proj)} className="text-campfire-600 hover:text-campfire-700">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
