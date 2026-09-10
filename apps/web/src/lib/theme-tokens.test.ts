import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every brand colour the UI asks for must exist in the Tailwind theme.
 *
 * Tailwind v4 generates a utility ONLY for a token defined in `@theme`. An
 * undefined one produces **no rule at all** — not a warning, not a fallback, no
 * build error, and `pnpm -r typecheck` cannot see inside a `className` string.
 * Six shades were being used 48 times and generating nothing: `bark-500` (22
 * uses), `bark-300` (16), `bark-200` (3), `campfire-700` (4), `parchment-100`
 * (2), `campfire-50` (1). Every `border border-bark-300` panel — the location
 * list, the render history, the sidebar boxes — fell back to the preflight
 * border colour instead of a light hairline, and `text-campfire-700`, the
 * over-limit alarm colour, rendered as ordinary body text.
 *
 * This is the check that class of bug needs: not "does the palette look right"
 * but "does every name the source uses actually resolve".
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const INDEX_CSS = fileURLToPath(new URL("../index.css", import.meta.url));

/** Colour families the theme defines shades for. */
const FAMILIES = [
  "forest",
  "moss",
  "bark",
  "parchment",
  "cream",
  "campfire",
  "trail",
  "charcoal",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/**
 * The text inside the top-level `@theme { … }` block, and nothing else.
 *
 * This boundary is the whole mechanism. Tailwind v4 emits a utility only for a
 * custom property declared **inside `@theme`**; the same declaration in
 * `@layer base { :root { … } }`, in a bare `:root`, or in a media query is a
 * perfectly valid CSS variable that generates **no utility at all**. Scanning the
 * whole file therefore reports a token as defined while the class name that
 * names it produces no rule — which is finding F11 restored with its own guard
 * green. Proven with a real `vite build`: moving `--color-bark-300` out of
 * `@theme` into `@layer base` took `.border-bark-300` from 3 emitted rules to
 * **0** (control `.text-bark-600` unmoved at 3) while all 42 web tests passed.
 *
 * Brace-matched rather than regexed, so a nested block inside `@theme` cannot
 * end it early.
 */
function themeBlock(css: string): string {
  const at = css.indexOf("@theme");
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return ""; // unbalanced
}

/** `--color-<family>-<shade>` names the theme actually defines — `@theme` only. */
function definedTokens(): Set<string> {
  const found = new Set<string>();
  const block = themeBlock(readFileSync(INDEX_CSS, "utf8"));
  for (const m of block.matchAll(/--color-([a-z]+-\d+)\s*:/g)) found.add(m[1]!);
  return found;
}

/**
 * `<family>-<shade>` names the source asks for, from utility classes
 * (`text-bark-500`, `border-bark-300/50`, `bg-campfire-50/40`, `divide-bark-200`)
 * and from raw `var(--color-…)` references.
 */
function usedTokens(): Map<string, string[]> {
  const uses = new Map<string, string[]>();
  const utility = new RegExp(`\\b(?:bg|text|border|divide|ring|from|via|to|fill|stroke|accent|shadow|outline|decoration|placeholder)-((?:${FAMILIES.join("|")})-\\d+)\\b`, "g");
  const cssVar = new RegExp(`--color-((?:${FAMILIES.join("|")})-\\d+)`, "g");

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const re of [utility, cssVar]) {
      for (const m of text.matchAll(re)) {
        const name = m[1]!;
        uses.set(name, [...(uses.get(name) ?? []), file]);
      }
    }
  }
  return uses;
}

describe("brand colour tokens", () => {
  /**
   * The guard's own subject, tested directly. Without this, "defined" can quietly
   * go back to meaning "the string appears somewhere in index.css", and the whole
   * check stops asking the question Tailwind actually answers.
   */
  it("[BEHAVIORAL] counts a token as defined only inside @theme, not merely present in the file", () => {
    const css = [
      "@import 'tailwindcss';",
      "@theme {",
      "  --color-inside-500: #111111;",
      "}",
      "@layer base {",
      "  :root {",
      "    --color-outside-500: #222222;",
      "  }",
      "}",
      ":root { --color-alsooutside-500: #333333; }",
    ].join("\n");

    const block = themeBlock(css);
    expect(block, "the @theme block must be found at all").toContain("--color-inside-500");
    expect(block).not.toContain("--color-outside-500");
    expect(block).not.toContain("--color-alsooutside-500");

    // …and the real file's block is a real block, not an empty string that would
    // make every "defined" check below vacuous.
    const real = themeBlock(readFileSync(INDEX_CSS, "utf8"));
    expect(real.length, "@theme block not found in index.css").toBeGreaterThan(200);
  });

  it("[BEHAVIORAL] every colour the app asks for is defined in the Tailwind theme", () => {
    const defined = definedTokens();
    const used = usedTokens();

    // Guard the guard: if the scan finds nothing, it is proving nothing.
    expect(used.size).toBeGreaterThan(10);
    expect(defined.size, "no tokens read out of @theme").toBeGreaterThan(10);

    const missing = [...used.entries()]
      .filter(([name]) => !defined.has(name))
      .map(([name, files]) => `${name} (${files.length} use(s), e.g. ${files[0]})`);

    expect(missing, `undefined colour tokens generate NO css rule:\n  ${missing.join("\n  ")}`)
      .toEqual([]);
  });

  it("stays in sync with packages/ui/src/tokens.ts, the non-Tailwind source of truth", async () => {
    const { palette } = (await import("@journeybook/ui")) as {
      palette: Record<string, Record<string, string>>;
    };
    // Scoped to @theme for the same reason as definedTokens: a hex that matches
    // from outside the block is a variable Tailwind will never turn into a class.
    const css = themeBlock(readFileSync(INDEX_CSS, "utf8"));

    const fromTokens = new Set<string>();
    for (const [family, shades] of Object.entries(palette)) {
      for (const shade of Object.keys(shades)) fromTokens.add(`${family}-${shade}`);
    }

    // Both directions: index.css is what the app renders with, tokens.ts is what
    // pdf-client and the tests read. A shade in one and not the other is the
    // drift the file headers already warn about.
    expect([...definedTokens()].sort()).toEqual([...fromTokens].sort());

    for (const [family, shades] of Object.entries(palette)) {
      for (const [shade, hex] of Object.entries(shades)) {
        expect(css, `--color-${family}-${shade}`).toContain(`--color-${family}-${shade}: ${hex};`);
      }
    }
  });
});
