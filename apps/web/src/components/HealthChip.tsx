import { useEffect, useState } from "react";

type HealthState = "checking" | "ok" | "unreachable";

interface ApiStatus {
  api: HealthState;
  db: HealthState;
}

/**
 * Field-instrument status readout. Preserves the Stage 0 health probe
 * (GET /health + /health/db) but reframes it as a small map-margin chip —
 * the kind of "datum / source current" notice that lives at the foot of a
 * real topo sheet. The probe logic is unchanged from the original shell.
 */
export function HealthChip() {
  const [status, setStatus] = useState<ApiStatus>({ api: "checking", db: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function probe(path: string): Promise<HealthState> {
      try {
        const res = await fetch(path);
        return res.ok ? "ok" : "unreachable";
      } catch {
        return "unreachable";
      }
    }

    void Promise.all([probe("/health"), probe("/health/db")]).then(([api, db]) => {
      if (!cancelled) setStatus({ api, db });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="inline-flex items-center gap-3 border border-bark-400/60 bg-cream-50/80 px-3 py-1.5 font-mono text-[11px] tracking-tight text-charcoal-700 backdrop-blur-sm"
      role="status"
      aria-label="Service status"
    >
      <span className="uppercase tracking-wider text-bark-600">Field link</span>
      <Dot state={status.api} label="api" />
      <Dot state={status.db} label="db" />
    </div>
  );
}

function Dot({ state, label }: { state: HealthState; label: string }) {
  const color =
    state === "ok"
      ? "bg-moss-600"
      : state === "unreachable"
        ? "bg-campfire-600"
        : "bg-bark-400 animate-pulse";
  const title =
    state === "ok" ? "connected" : state === "unreachable" ? "unreachable" : "checking";
  return (
    <span className="inline-flex items-center gap-1.5" title={`${label}: ${title}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
      <span className="uppercase">{label}</span>
    </span>
  );
}
