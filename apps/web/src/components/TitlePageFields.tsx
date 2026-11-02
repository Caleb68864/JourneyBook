import { useEffect, useState } from "react";

export interface TitlePageValue {
  explorerName: string | null;
  atlasDate: string | null;
}

interface TitlePageFieldsProps {
  value: TitlePageValue;
  onChange: (next: TitlePageValue) => void;
  disabled?: boolean;
}

/** One field, saved when it loses focus so typing a name is not a request per letter. */
function TextField({
  id,
  label,
  placeholder,
  maxLength,
  value,
  onCommit,
  disabled,
}: {
  id: string;
  label: string;
  placeholder: string;
  maxLength: number;
  value: string | null;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // The project is the source of truth: a save the server refused puts the old value back.
  useEffect(() => setDraft(value ?? ""), [value]);

  function commit() {
    const next = draft.trim() || null;
    if (next !== value) onCommit(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[10px] uppercase text-bark-500">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className="rounded border border-bark-300 bg-cream-50 px-2 py-1 text-sm text-charcoal-900"
      />
    </div>
  );
}

/**
 * The book's title page. Filling in either field adds a page ahead of the atlas; leaving
 * both empty leaves the book as it was.
 */
export function TitlePageFields({ value, onChange, disabled }: TitlePageFieldsProps) {
  return (
    <section className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-widest text-bark-600">Title page</span>
      <TextField
        id="title-page-explorer"
        label="Explorer name"
        placeholder="Who this atlas is for"
        maxLength={120}
        value={value.explorerName}
        onCommit={(explorerName) => onChange({ ...value, explorerName })}
        disabled={disabled}
      />
      <TextField
        id="title-page-date"
        label="Date"
        placeholder="Summer 2026"
        maxLength={60}
        value={value.atlasDate}
        onCommit={(atlasDate) => onChange({ ...value, atlasDate })}
        disabled={disabled}
      />
      <p className="font-mono text-[10px] text-bark-500">
        Filling in either one adds a title page to the front of the atlas.
      </p>
    </section>
  );
}
