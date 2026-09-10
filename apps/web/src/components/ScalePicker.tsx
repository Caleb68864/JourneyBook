import { useId } from "react";
import { SCALE_PRESETS } from "@journeybook/atlas-core";

interface ScalePickerProps {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function ScalePicker({ value, onChange, disabled }: ScalePickerProps) {
  // The label was a plain sibling with no htmlFor, so a screen reader announced
  // "combo box" with no indication of what it selects — and the e2e spec had to
  // reach it by ordinal (`page.locator("select").nth(0)`), which is the same
  // problem wearing a different hat. useId, not a literal, so a second instance
  // on one page cannot collide.
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-widest text-bark-600">
        Map Scale
      </label>
      <select
        id={id}
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
