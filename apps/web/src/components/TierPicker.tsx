import { useId } from "react";
import type { MapTier } from "@journeybook/atlas-core";

/**
 * The tiers a reader can actually pick, and what each one draws.
 *
 * Level 4 came back on 2026-11-22, when the renderer started drawing something for it: the
 * declination diagram (true, grid and magnetic north from WMM2025, and the G-M angle) in place
 * of the compass rose. Its description says exactly that and no more. Full MGRS labelling,
 * azimuth worksheets and the three-norths lesson are still not drawn, so they are not offered.
 */
export const TIER_OPTIONS: { value: MapTier; label: string; description: string }[] = [
  { value: 1, label: "Tier 1 — Road Atlas", description: "Grid only, easy to read" },
  { value: 2, label: "Tier 2 — Scout", description: "Grid + scale bar & compass" },
  { value: 3, label: "Tier 3 — Navigator", description: "Tier 2 + UTM/USNG grid" },
  { value: 4, label: "Tier 4 — Expert", description: "Tier 3 + declination diagram & grid-magnetic angle" },
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
