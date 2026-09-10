import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static accessibility guards for `apps/web/src`.
 *
 * These are the three failures a scan found and that no other check in the repo
 * can see: `pnpm -r typecheck` type-checks the props of a `<select>` and has
 * nothing to say about whether it has a name, and the app has no DOM test setup,
 * so nothing renders these components at all.
 *
 * Regex over source is a blunt instrument and is not a substitute for an axe run
 * on a rendered page. It is chosen because it catches THESE regressions — the
 * ones that already happened — cheaply and in CI, rather than not at all.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const FILES = sourceFiles(SRC);
const rel = (f: string) => relative(SRC, f);

/** Is `index` inside an unclosed `<label>` — i.e. does a label wrap this control? */
function isInsideLabel(text: string, index: number): boolean {
  let depth = 0;
  for (const m of text.slice(0, index).matchAll(/<label\b|<\/label>/g)) {
    depth += m[0] === "</label>" ? -1 : 1;
  }
  return depth > 0;
}

/**
 * Every JSX opening tag for `name`, with its attributes, as one string each.
 *
 * Not a regex: `<input … onChange={(e) => …} className="hidden" />` contains a
 * `>` inside an arrow function, so `<input[^>]*>` stops halfway through the tag
 * and silently misses every attribute after the first handler — which is exactly
 * where `className` tends to sit. This tracks brace depth and string literals so
 * a tag ends at the `>` that actually closes it.
 */
function tagsNamed(text: string, name: string): string[] {
  const tags: string[] = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, "g");

  for (const start of [...text.matchAll(open)].map((m) => m.index)) {
    let depth = 0;
    let quote: string | null = null;

    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        tags.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return tags;
}

/**
 * The class names a JSX tag applies, from **any** of the forms this codebase uses.
 *
 * The first version of this was `/className=["']([^"']*)["']/` — string literals
 * only. Any JSX-expression form yielded no match, and therefore no offender:
 * `` className={`hidden`} `` is the pre-fix defect with one brace changed, it
 * renders the identical DOM, and it passed. `cn(...)` is already imported and
 * used across `components/ui/*.tsx`, so the expression form is not contrived.
 *
 * A literal `"…"`/`'…'` value is returned as-is. An expression value is
 * brace-matched and every string/template run inside it is collected — so
 * `cn("hidden", open && "flex")` and `` `hidden ${extra}` `` both yield their
 * literal parts, which is exactly the part Tailwind can act on.
 */
function classNamesOf(tag: string): string {
  const m = /\bclassName\s*=\s*/.exec(tag);
  if (!m) return "";
  const at = m.index + m[0].length;
  const first = tag[at];

  if (first === '"' || first === "'") {
    const end = tag.indexOf(first, at + 1);
    return end < 0 ? "" : tag.slice(at + 1, end);
  }
  if (first !== "{") return "";

  let depth = 0;
  let quote: string | null = null;
  let end = -1;
  for (let i = at; i < tag.length; i++) {
    const c = tag[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return "";

  return [...tag.slice(at + 1, end).matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)]
    .map((q) => q[1] ?? q[2] ?? q[3] ?? "")
    .join(" ");
}

/**
 * Does this tag take the control out of the tab order?
 *
 * `hidden` (the Tailwind utility or the bare HTML attribute) and an inline
 * `display: none` are all `display: none`, and a `display: none` input is not
 * focusable. `sr-only` is the correct form: off-screen, still focusable, still
 * clickable through its label.
 */
function isDisplayNone(tag: string): string | null {
  const classes = classNamesOf(tag);
  // `-` is a word boundary to \b, so `\bhidden\b` also matches `overflow-hidden`,
  // which is not display:none and must not be flagged.
  if (/(?<![\w-])hidden(?![\w-])/.test(classes)) return `className: ${classes}`;
  // The bare attribute — `<input … hidden />`. The leading \s keeps `aria-hidden`
  // out, and the lookahead keeps `hidden-thing` and `hiddenFoo` out.
  if (/\shidden(?=[\s/>]|=\{true\})/.test(tag.replace(/\bclassName\s*=/, "cn="))) {
    return "the bare `hidden` attribute";
  }
  if (/display\s*:\s*["']?none/.test(tag)) return "an inline display:none";
  return null;
}

describe("accessibility guards", () => {
  /**
   * `<input type="file" className="hidden">` inside a `<label>`. `hidden` is
   * `display: none`, so the input is not focusable, and a `<label>` is never in
   * the tab order. With no button, no `tabIndex` and no key handler, project
   * import and CSV import could not be reached at all without a mouse.
   *
   * `sr-only` is the fix: off-screen but still focusable and still clickable
   * through its label.
   */
  it("[BEHAVIORAL] no file input is hidden with display:none", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      for (const tag of tagsNamed(readFileSync(file, "utf8"), "input")) {
        if (!/type=["']file["']/.test(tag)) continue;
        const why = isDisplayNone(tag);
        if (why) offenders.push(`${rel(file)}: ${why}`);
      }
    }

    expect(offenders, `file inputs that keyboard users cannot reach:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
  });

  /**
   * The guard's own reader, tested directly. Without this it can quietly go back
   * to matching string literals only — which is how `` className={`hidden`} ``,
   * the pre-fix defect with one brace changed, passed.
   */
  it("[BEHAVIORAL] reads a class name in every form, not just a string literal", () => {
    const hidden = [
      `<input type="file" className="hidden" />`,
      "<input type=\"file\" className={`hidden`} />",
      `<input type="file" onChange={(e) => void go(e)} className={cn("hidden", x && "flex")} />`,
      `<input type="file" className={open ? "block" : "hidden"} />`,
      `<input type="file" hidden />`,
      `<input type="file" style={{ display: "none" }} />`,
    ];
    for (const tag of hidden) {
      expect(isDisplayNone(tag), `not flagged: ${tag}`).not.toBeNull();
    }

    const reachable = [
      `<input type="file" className="sr-only" />`,
      "<input type=\"file\" className={`sr-only ${extra}`} />",
      `<input type="file" className={cn("sr-only", big && "text-lg")} />`,
      `<input type="file" aria-hidden="true" className="sr-only" />`,
      `<input type="file" className="overflow-hidden sr-only" />`,
    ];
    for (const tag of reachable) {
      expect(isDisplayNone(tag), `wrongly flagged: ${tag}`).toBeNull();
    }
  });

  it("finds the file inputs it is meant to be guarding", () => {
    // A guard that silently stops matching anything passes for ever.
    const fileInputs = FILES.flatMap((f) =>
      tagsNamed(readFileSync(f, "utf8"), "input").filter((t) => /type=["']file["']/.test(t)),
    );
    expect(fileInputs.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * Every `<select>` had its `<label>` as a plain sibling with no `htmlFor`, no
   * `id` and no `aria-label`, so a screen reader announced "combo box" with no
   * indication of what it selects — and the Playwright spec had to reach them by
   * ordinal (`page.locator("select").nth(0)`), which is a symptom of the same
   * thing.
   */
  it("[BEHAVIORAL] every select has an accessible name", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const tag of tagsNamed(text, "select")) {
        // Wrapping the control in its <label> is the other correct pattern, and
        // LocationList already uses it — a guard that flagged it would push
        // correct code towards redundant aria-labels.
        if (/\b(id|aria-label|aria-labelledby)=/.test(tag)) continue;
        if (isInsideLabel(text, text.indexOf(tag))) continue;
        offenders.push(`${rel(file)}: ${tag.replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }

    expect(offenders, `selects with no accessible name:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("does not accept a wrapping label that is not actually open", () => {
    // Guarding the exemption above: an unwrapped select must still be caught.
    const wrapped = `<label>x<select value={v} /></label>`;
    const sibling = `<label>x</label><select value={v} />`;
    expect(isInsideLabel(wrapped, wrapped.indexOf("<select"))).toBe(true);
    expect(isInsideLabel(sibling, sibling.indexOf("<select"))).toBe(false);
  });

  /**
   * Zero `aria-live` regions existed anywhere in the app, so every asynchronous
   * status change was silent to assistive tech: Queued…/Rendering…, the render
   * failure message, Saving…, the header error, the draw-mode banner, "Imported
   * N locations". The only `role="status"` was in a component that is never
   * rendered.
   *
   * The first version of this guard was a **five-file allowlist**, which is a
   * list of the files that had already been fixed. `GeocodeSearch.tsx` held
   * `searching`, `adding` and `error` state, rendered "No matches found.",
   * "Adding…" and an error paragraph, contained not one live region — and was
   * green, because it was not on the list. No mutation was needed to show it.
   * A guard that has to be told which files to check cannot catch the next file.
   *
   * So the list is derived instead: any component that does async work and holds
   * status-shaped state is announcing something to sighted users, and must
   * announce it to everyone. `STATUS_STATE` is deliberately a vocabulary and not
   * a path list — a new component with a `saving` flag is caught the day it is
   * written.
   */
  const STATUS_STATE =
    /\bconst \[\s*(error|saving|searching|adding|importing|loading|busy|pending|status|submitting|deleting|generating|uploading|progress|notice)([A-Z]\w*)?\s*,/g;
  const LIVE_REGION = /aria-live=|role=["']status["']|role=["']alert["']/;

  /** Files that report asynchronous status to the user, found rather than listed. */
  function announcers(): { name: string; states: string[] }[] {
    const out: { name: string; states: string[] }[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      if (!/\basync\b|\bawait\b/.test(text)) continue;
      const states = [...text.matchAll(STATUS_STATE)].map((m) => m[1]! + (m[2] ?? ""));
      if (states.length) out.push({ name: rel(file), states: [...new Set(states)] });
    }
    return out;
  }

  it("[BEHAVIORAL] every component that reports async status announces it", () => {
    const found = announcers();

    // Guard the guard, twice over. A vocabulary that stops matching finds no
    // files and passes for ever; and the five components the original fix
    // covered must still be among the ones it finds, or the rule has narrowed
    // to the point of proving nothing.
    expect(found.length, "the async-status scan found no components at all").toBeGreaterThanOrEqual(5);
    const names = found.map((f) => f.name);
    for (const known of [
      "components/GenerateButton.tsx",
      "components/LocationList.tsx",
      "components/LandmarkImportControl.tsx",
      "components/GeocodeSearch.tsx",
      "routes/ProjectEditorPage.tsx",
      "routes/ProjectListPage.tsx",
    ]) {
      expect(names, `${known} reports async status and the scan no longer finds it`).toContain(known);
    }

    const silent = found
      .filter(({ name }) => {
        const file = FILES.find((f) => rel(f) === name)!;
        return !LIVE_REGION.test(readFileSync(file, "utf8"));
      })
      .map(({ name, states }) => `${name} (${states.join(", ")})`);

    expect(silent, `async status changes nothing announces:\n  ${silent.join("\n  ")}`).toEqual([]);
  });
});
