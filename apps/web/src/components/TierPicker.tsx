import { useId } from "react";
import type { MapTier } from "@journeybook/atlas-core";

/**
 * The tiers a reader can actually pick, and what each one draws.
 *
 * Level 4 (full MGRS & azimuth/declination) is defined in `MapTier` and planned
 * on the roadmap, but no renderer implements it — `AtlasDocument` gates all its
 * extra furniture on `tier >= 3`, so a Tier 4 page prints identically to Tier 3.
 * Offering it here sold a feature the PDF does not deliver. It comes back when
 * the renderer draws it, not before.
 */
export const TIER_OPTIONS: { value: MapTier; label: string; description: string }[] = [
  { value: 1, label: "Tier 1 — Road Atlas", description: "Grid only, easy to read" },
  { value: 2, label: "Tier 2 — Scout", description: "Grid + scale bar & compass" },
  { value: 3, label: "Tier 3 — Navigator", description: "Tier 2 + UTM/USNG grid" },
];

interface TierPickerProps {
  value: MapTier;
  onChange: (tier: MapTier) => void;
  disabled?: boolean;
}

export function TierPicker({ value, onChange, disabled }: TierPickerProps) {
  // See ScalePicker: the label was a sibling with no htmlFor, so the control had
  // no accessible name.
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
        Map Tier
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as MapTier)}
        disabled={disabled}
        className="border border-bark-400 bg-cream-50 px-3 py-2 font-mono text-sm text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-forest-700 disabled:opacity-50"
      >
        {TIER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="font-mono text-[10px] text-bark-500">
        {TIER_OPTIONS.find((o) => o.value === value)?.description}
      </p>
    </div>
  );
}
