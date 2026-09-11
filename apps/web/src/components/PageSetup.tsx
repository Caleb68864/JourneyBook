import { useEffect, useState } from "react";
import type { Margins } from "../api/client";

/**
 * Orientation, binder gutter, safe margins and page overlap — the project's page
 * setup.
 *
 * These four were plumbed end to end and reachable from nowhere. The API
 * persists them, `PUT /api/projects/{id}` carries them, the worker payload sends
 * them and the renderer honours them; the app had no control for any of them, so
 * every atlas printed at 0.5 in portrait with no gutter and whatever overlap the
 * project was created with. They are also the ONE group of settings that changes
 * printed scale: the map box is the printable area less the page furniture, so a
 * margin moves the printed footprint, and with it the ground each page covers
 * and how many pages a box tiles into.
 *
 * Which is why every control here shows its cost. Overlap especially: it is
 * around +11% pages on average and anywhere from 0% to +50% depending on the
 * extent, and the only place that used to surface was the page count minutes
 * later.
 *
 * Saving: each change is committed through `api.projects.patch`, which resends
 * the fields it is not changing — `PUT` replaces every grid field, so a partial
 * body is a reset of what it omits.
 */

export interface PageSetupValue {
  orientation: string;
  overlap: number;
  margins: Margins;
}

export interface PageSetupProps {
  value: PageSetupValue;
  onChange: (next: PageSetupValue) => void;
  /**
   * Pages the saved extent tiles into for a candidate setup, or null when there
   * is no extent to measure. Supplied by the editor, which owns the geometry —
   * this component does no derivation of its own (ADR 0004).
   */
  estimatePagesFor?: (value: PageSetupValue) => number | null;
  disabled?: boolean;
}

const MARGIN_SIDES = ["top", "right", "bottom", "left"] as const;

/** Overlap choices, as fractions. 0.25 is the engine's practical ceiling here. */
export const OVERLAP_STEPS = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25] as const;

/** A margin the printer can actually manage; below this most home printers clip. */
export const MIN_MARGIN_IN = 0.25;
export const MAX_MARGIN_IN = 2;

export function clampMargin(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_MARGIN_IN, Math.max(MIN_MARGIN_IN, value));
}

/** The gutter may legitimately be zero — it is "no binder", not "no margin". */
export function clampGutter(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_MARGIN_IN, Math.max(0, value));
}

export function PageSetup({ value, onChange, estimatePagesFor, disabled }: PageSetupProps) {
  // Text state per numeric field so a half-typed "0." is not rewritten under the
  // cursor. Committed on blur, which is also when the PUT goes out.
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => setDraft({}), [value.margins, value.orientation]);

  const marginValue = (side: string): string =>
    draft[side] ?? String(value.margins[side as keyof Margins] ?? 0);

  const basePages = estimatePagesFor?.({ ...value, overlap: 0 }) ?? null;
  const currentPages = estimatePagesFor?.(value) ?? null;
  const overlapCost =
    basePages !== null && currentPages !== null && basePages > 0
      ? Math.round(((currentPages - basePages) / basePages) * 100)
      : null;

  const commitMargin = (side: string, raw: string): void => {
    const parsed = Number(raw);
    const current = value.margins[side as keyof Margins] ?? 0;
    const next =
      side === "gutter" ? clampGutter(parsed, current) : clampMargin(parsed, current);
    setDraft((d) => {
      const { [side]: _drop, ...rest } = d;
      return rest;
    });
    if (next !== current) {
      onChange({ ...value, margins: { ...value.margins, [side]: next } });
    }
  };

  return (
    <section className="flex flex-col gap-3 border-b border-bark-300 pb-5">
      <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
        Page Setup
      </span>
      <p className="font-mono text-[10px] italic text-bark-400">
        These change the printed map box, so they change the ground each page covers — and the page count.
      </p>

      {/* Orientation */}
      <div className="flex flex-col gap-1">
        <span id="page-orientation-label" className="font-mono text-[10px] uppercase text-bark-500">
          Orientation
        </span>
        <div role="group" aria-labelledby="page-orientation-label" className="flex gap-2">
          {["Portrait", "Landscape"].map((option) => {
            const selected = value.orientation.toLowerCase() === option.toLowerCase();
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onChange({ ...value, orientation: option })}
                className={`flex-1 border px-3 py-1.5 font-mono text-xs disabled:opacity-50 ${
                  selected
                    ? "border-forest-700 bg-forest-700 text-cream-50"
                    : "border-bark-400 bg-cream-50 text-bark-700 hover:bg-parchment-200"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      {/* Safe margins */}
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase text-bark-500">Safe margins (in)</span>
        <div className="grid grid-cols-2 gap-2">
          {MARGIN_SIDES.map((side) => (
            <div key={side} className="flex flex-col gap-0.5">
              <label htmlFor={`margin-${side}`} className="font-mono text-[10px] text-bark-500">
                {side}
              </label>
              <input
                id={`margin-${side}`}
                type="number"
                step="0.05"
                min={MIN_MARGIN_IN}
                max={MAX_MARGIN_IN}
                disabled={disabled}
                value={marginValue(side)}
                onChange={(e) => setDraft((d) => ({ ...d, [side]: e.target.value }))}
                onBlur={(e) => commitMargin(side, e.target.value)}
                className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Binder gutter */}
      <div className="flex flex-col gap-0.5">
        <label htmlFor="margin-gutter" className="font-mono text-[10px] uppercase text-bark-500">
          Binder gutter (in)
        </label>
        <input
          id="margin-gutter"
          type="number"
          step="0.05"
          min={0}
          max={MAX_MARGIN_IN}
          disabled={disabled}
          value={marginValue("gutter")}
          onChange={(e) => setDraft((d) => ({ ...d, gutter: e.target.value }))}
          onBlur={(e) => commitMargin("gutter", e.target.value)}
          className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
        />
        <span className="font-mono text-[10px] text-bark-500">
          Extra space on the binding edge, taken off the map box — not added to the sheet.
        </span>
      </div>

      {/* Overlap, with its cost */}
      <div className="flex flex-col gap-0.5">
        <label htmlFor="page-overlap" className="font-mono text-[10px] uppercase text-bark-500">
          Page overlap
        </label>
        <select
          id="page-overlap"
          disabled={disabled}
          value={String(value.overlap)}
          onChange={(e) => onChange({ ...value, overlap: Number(e.target.value) })}
          className="border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-xs text-charcoal-900 focus:outline-none focus:ring-1 focus:ring-forest-700"
        >
          {OVERLAP_STEPS.map((step) => (
            <option key={step} value={String(step)}>
              {Math.round(step * 100)}%
            </option>
          ))}
        </select>
        <span className="font-mono text-[10px] text-bark-500">
          The strip of ground two adjacent pages both carry, so a feature never falls in a seam.
        </span>
        {/* The cost, where the person turning the knob can see it. Overlap buys
            pages: about +11% on average, 0% to +50% depending on the extent, and
            roughly a third of extents pay nothing at all because the grid does
            not gain a row or column. Showing the average would be a lie about
            THIS box; this is measured on the box they actually have. */}
        <span
          data-testid="overlap-cost"
          className={`font-mono text-[10px] ${overlapCost && overlapCost > 0 ? "text-campfire-700" : "text-bark-500"}`}
        >
          {currentPages === null
            ? "Set a bounding box to see what overlap costs here."
            : overlapCost === null || overlapCost === 0
              ? `${currentPages} pages — no extra pages at this overlap.`
              : `${currentPages} pages — ${overlapCost > 0 ? "+" : ""}${overlapCost}% vs ${basePages} at 0%.`}
        </span>
      </div>
    </section>
  );
}
