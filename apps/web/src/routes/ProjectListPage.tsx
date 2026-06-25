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

  return (
    <div className="min-h-screen bg-parchment-200 text-charcoal-900">
      {/* Header */}
      <header className="border-b border-bark-400/50 bg-cream-100 px-5 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <span className="font-display text-xl text-forest-700">Journey Book</span>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 bg-forest-700 px-4 py-2 font-display text-sm tracking-wide text-cream-50 shadow-[2px_2px_0_0_var(--color-bark-700)] hover:bg-forest-600"
          >
            + New Atlas
          </button>
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
              <li key={proj.id}>
                <button
                  type="button"
                  onClick={() => onOpen(proj.id)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-parchment-200"
                >
                  <div>
                    <p className="font-display text-base text-forest-700">{proj.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-bark-500">
                      {proj.scalePresetId} · {new Date(proj.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-bark-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
