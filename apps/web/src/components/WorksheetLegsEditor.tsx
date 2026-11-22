import { useId, useState } from "react";

/** One end a leg can start or finish at: a location ("L2") or a landmark (by name). */
export interface LegEnd {
  /** What goes on the wire: "L2", or the landmark's name. */
  ref: string;
  /** What the reader sees: "L2 Haymarket", "Water Tower (landmark)". */
  label: string;
}

export interface WorksheetLeg {
  from: string;
  to: string;
}

interface WorksheetLegsEditorProps {
  ends: LegEnd[];
  value: WorksheetLeg[];
  onChange: (legs: WorksheetLeg[]) => void;
}

/**
 * Hand-picked worksheet legs (Stage 6B Level 4). Empty means the default: the stops in order.
 * Each leg is a pair of ends from the atlas's own locations and landmarks; a leg from a place to
 * itself is not offered.
 */
export function WorksheetLegsEditor({ ends, value, onChange }: WorksheetLegsEditorProps) {
  const fromId = useId();
  const toId = useId();
  const [from, setFrom] = useState(ends[0]?.ref ?? "");
  const [to, setTo] = useState(ends[1]?.ref ?? "");
  const labelOf = (ref: string) => ends.find((e) => e.ref === ref)?.label ?? ref;
  const canAdd = from !== "" && to !== "" && from !== to;
  const select = "border border-bark-400 bg-cream-50 px-2 py-1 font-mono text-[11px] text-charcoal-900";

  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Hand-picked legs</span>
      <span className="font-mono text-[10px] text-bark-500">
        Leave empty to use your stops in order. Pick a start and a finish to add a leg of your own.
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={fromId} className="sr-only">Leg start</label>
        <select id={fromId} value={from} onChange={(e) => setFrom(e.target.value)} className={select}>
          {ends.map((e) => (
            <option key={e.ref} value={e.ref}>{e.label}</option>
          ))}
        </select>
        <span className="font-mono text-[11px] text-bark-600">to</span>
        <label htmlFor={toId} className="sr-only">Leg finish</label>
        <select id={toId} value={to} onChange={(e) => setTo(e.target.value)} className={select}>
          {ends.map((e) => (
            <option key={e.ref} value={e.ref}>{e.label}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => onChange([...value, { from, to }])}
          className="border border-bark-400 px-2 py-1 font-mono text-[11px] text-forest-700 disabled:opacity-50"
        >
          Add leg
        </button>
      </div>
      {value.length > 0 ? (
        <ol className="list-decimal pl-5 font-mono text-[11px] text-charcoal-900">
          {value.map((leg, i) => (
            <li key={`${leg.from}-${leg.to}-${i}`}>
              {labelOf(leg.from)} to {labelOf(leg.to)}{" "}
              <button
                type="button"
                aria-label={`Remove leg ${i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-campfire-600 underline"
              >
                remove
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
