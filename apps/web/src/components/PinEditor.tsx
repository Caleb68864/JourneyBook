import { PIN_SHAPE_LIST, PIN_COLORS, resolvePinShape, resolvePinColor } from "@journeybook/ui";
import { LocationPinSvg } from "./LocationPinSvg";

interface PinEditorProps {
  shape: string | null;
  color: string | null;
  onChange: (shape: string, color: string) => void;
}

/** Compact per-location pin editor: pick a shape, then a color (swatch or free). */
export function PinEditor({ shape, color, onChange }: PinEditorProps) {
  const curShape = resolvePinShape(shape);
  const curColor = resolvePinColor(color);
  return (
    <div className="mt-1 flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-bark-600">Pin</span>
      <div className="flex flex-wrap items-center gap-1">
        {PIN_SHAPE_LIST.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.label}
            onClick={() => onChange(s.id, curColor)}
            className={`flex h-7 w-7 items-center justify-center rounded border ${
              curShape === s.id ? "border-forest-700 bg-parchment-200" : "border-bark-300 bg-cream-50 hover:bg-parchment-100"
            }`}
          >
            <LocationPinSvg shape={s.id} color={curColor} size={18} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {PIN_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            onClick={() => onChange(curShape, c.hex)}
            style={{ backgroundColor: c.hex }}
            className={`h-5 w-5 rounded-full border ${
              curColor.toLowerCase() === c.hex.toLowerCase() ? "border-charcoal-900 ring-1 ring-forest-700" : "border-cream-50"
            }`}
          />
        ))}
        <input
          type="color"
          value={curColor}
          onChange={(e) => onChange(curShape, e.target.value)}
          title="Custom color"
          className="h-5 w-6 cursor-pointer border border-bark-300 bg-transparent p-0"
        />
      </div>
    </div>
  );
}
