import { SCALE_PRESETS } from "@journeybook/atlas-core";

interface ScalePickerProps {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function ScalePicker({ value, onChange, disabled }: ScalePickerProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
        Map Scale
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="border border-bark-400 bg-cream-50 px-3 py-2 font-mono text-sm text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-forest-700 disabled:opacity-50"
      >
        {SCALE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
    </div>
  );
}
