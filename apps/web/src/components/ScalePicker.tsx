import { useId } from "react";
import { SCALE_PRESETS } from "@journeybook/atlas-core";
import {
  PRINT_RESOLUTION_DOC_URL,
  describePresetResolution,
  optionResolutionLabel,
  presetResolution,
} from "../lib/print-resolution";

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
  const noteId = `${id}-resolution`;

  // What the chosen preset actually prints at, from the generated table — the
  // owner's decision was to state it honestly rather than chase a number the tile
  // ceiling will not allow. This is where the user decides, so it is where the
  // figure has to be. See `lib/print-resolution.ts`: no DPI is typed here or there.
  const selected = presetResolution(value);

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
        aria-describedby={selected ? noteId : undefined}
        className="border border-bark-400 bg-cream-50 px-3 py-2 font-mono text-sm text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-forest-700 disabled:opacity-50"
      >
        {SCALE_PRESETS.map((preset) => {
          const resolution = presetResolution(preset.id);
          return (
            <option key={preset.id} value={preset.id}>
              {resolution ? `${preset.label} · ${optionResolutionLabel(resolution)}` : preset.label}
            </option>
          );
        })}
      </select>
      {selected && (
        <div id={noteId} data-testid="scale-resolution-note" className="flex flex-col gap-0.5 font-mono text-[10px] text-bark-600">
          {describePresetResolution(selected).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <a
            href={PRINT_RESOLUTION_DOC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-forest-700 underline hover:text-forest-600"
          >
            How print resolution works
          </a>
        </div>
      )}
    </div>
  );
}
