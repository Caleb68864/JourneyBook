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
        const className = /className=["']([^"']*)["']/.exec(tag)?.[1] ?? "";
        if (/\bhidden\b/.test(className)) offenders.push(`${rel(file)}: ${className}`);
      }
    }

    expect(offenders, `file inputs that keyboard users cannot reach:\n  ${offenders.join("\n  ")}`)
      .toEqual([]);
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
   */
  it("[BEHAVIORAL] components that report async status announce it", () => {
    const mustAnnounce = [
      "components/GenerateButton.tsx",
      "components/LocationList.tsx",
      "components/LandmarkImportControl.tsx",
      "routes/ProjectEditorPage.tsx",
      "routes/ProjectListPage.tsx",
    ];

    const silent = mustAnnounce.filter((name) => {
      const file = FILES.find((f) => rel(f) === name);
      expect(file, `${name} not found — update this list`).toBeDefined();
      return !/aria-live=|role=["']status["']|role=["']alert["']/.test(readFileSync(file!, "utf8"));
    });

    expect(silent, `async status changes nothing announces:\n  ${silent.join("\n  ")}`).toEqual([]);
  });
});
