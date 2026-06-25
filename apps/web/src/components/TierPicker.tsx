import type { MapTier } from "@journeybook/atlas-core";

const TIER_OPTIONS: { value: MapTier; label: string; description: string }[] = [
  { value: 1, label: "Tier 1 — Road Atlas", description: "Grid only, easy to read" },
  { value: 2, label: "Tier 2 — Scout", description: "Grid + scale bar & compass" },
  { value: 3, label: "Tier 3 — Navigator", description: "Tier 2 + UTM/USNG grid" },
  { value: 4, label: "Tier 4 — Land Nav", description: "Tier 3 + full MGRS & azimuth" },
];

interface TierPickerProps {
  value: MapTier;
  onChange: (tier: MapTier) => void;
  disabled?: boolean;
}

export function TierPicker({ value, onChange, disabled }: TierPickerProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
        Map Tier
      </label>
      <select
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
