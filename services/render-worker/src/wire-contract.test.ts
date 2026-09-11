import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NON_WIRE_INPUT_FIELDS } from "@journeybook/render-cli";
import { ACCEPTED_RENDER_FIELDS } from "./render-route.js";

/**
 * The render request exists three times and nothing compared any pair of them:
 *
 *   1. `RenderAtlasInput` — the engine's interface, in `packages/render-cli/src/render.ts`.
 *   2. `renderBodySchema` — the worker's JSON Schema, which decides what is accepted.
 *   3. `WorkerRenderPayload` — the C# record in `HttpRenderWorkerClient`, which
 *      decides what is sent.
 *
 * This file pins 1 against 2. `dotnet/JourneyBook.Tests/WorkerWirePayloadParityTests.cs`
 * pins 3 against 2 from the other side, reading this same schema. Between them the
 * three copies cannot drift silently.
 *
 * The two directions fail differently, and both matter:
 *
 * - **A field on the interface that the schema does not list** is refused at the
 *   boundary. Loud, but loud in the wrong place: a capability added to the engine
 *   is a 400 from the worker, and the person who added it has no reason to look
 *   here. This is what happened to `panelWidthPx`, `panelFormat` and `panelQuality`
 *   for an entire stage.
 * - **A field on the schema that the interface does not have** is accepted,
 *   spread into `renderAtlas`, and ignored. Silent, and worse: the API believes it
 *   is asking for something.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RENDER_TS = join(REPO_ROOT, "packages", "render-cli", "src", "render.ts");

/**
 * Parse the property names off `interface RenderAtlasInput` in the engine's real
 * source.
 *
 * Reading the file is the point — a hand-written list here would be a fourth copy
 * that passes for exactly as long as someone remembers it. Every step refuses
 * rather than degrades: a missing file, a missing interface, or a parse that finds
 * nothing all throw, because comparing two empty sets reports success while
 * measuring nothing.
 */
function parseEngineInputFields(): string[] {
  const source = readFileSync(RENDER_TS, "utf8");

  const start = source.indexOf("export interface RenderAtlasInput {");
  if (start === -1) {
    throw new Error(
      `Could not find "export interface RenderAtlasInput {" in ${RENDER_TS}. If it moved or ` +
        `changed shape, fix this parser — do not let the parity check quietly pass on nothing.`,
    );
  }

  // Walk braces from the opening one so nested object literals in the member types
  // (`margins?: PageMargins` is a named type, but a future inline `{ … }` would not
  // be) cannot end the interface early.
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`RenderAtlasInput in ${RENDER_TS} is not brace-balanced.`);

  const body = source.slice(open + 1, end);
  // Members at depth 1 only: `name?: type;` / `name: type;` at the start of a line.
  const fields = [...body.matchAll(/^\s{2}(?<name>[A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map(
    (m) => m.groups!["name"]!,
  );

  if (fields.length === 0) {
    throw new Error(`Found RenderAtlasInput in ${RENDER_TS} but parsed no members out of it.`);
  }
  return fields;
}

describe("the worker's wire schema and the engine's input interface", () => {
  it("[CONTROL] both sides were actually read", () => {
    // Two empty sets are equal, and that is how a parity test comes to assert
    // nothing at all.
    const engine = parseEngineInputFields();
    expect(engine.length).toBeGreaterThan(20);
    expect(ACCEPTED_RENDER_FIELDS.size).toBeGreaterThan(20);
    // And the non-wire list must name real members, or it is excluding nothing.
    for (const name of NON_WIRE_INPUT_FIELDS) {
      expect(engine, `NON_WIRE_INPUT_FIELDS names "${name}", which RenderAtlasInput does not have`)
        .toContain(name);
    }
  });

  it("[BEHAVIORAL] every engine input the wire can carry is accepted by the worker", () => {
    const engine = parseEngineInputFields();
    const expected = engine.filter((f) => !NON_WIRE_INPUT_FIELDS.includes(f)).sort();
    const missing = expected.filter((f) => !ACCEPTED_RENDER_FIELDS.has(f));

    expect(
      missing,
      `The engine accepts ${missing.join(", ")} and the worker's schema does not list them, so a ` +
        `request carrying them is refused with 400 at the boundary. Either add them to ` +
        `renderBodySchema or add them to NON_WIRE_INPUT_FIELDS with a reason.`,
    ).toEqual([]);
  });

  it("[BEHAVIORAL] the worker accepts no field the engine has never heard of", () => {
    const engine = new Set(parseEngineInputFields());
    const extra = [...ACCEPTED_RENDER_FIELDS].filter((f) => !engine.has(f)).sort();

    expect(
      extra,
      `The worker's schema lists ${extra.join(", ")}, which RenderAtlasInput does not declare. ` +
        `Such a field is accepted, spread into renderAtlas and silently ignored — the API ` +
        `believes it is asking for something.`,
    ).toEqual([]);
  });

  it("[BEHAVIORAL] no non-wire field is reachable from the wire", () => {
    // `signal` and `onProgress` are a callback and an object; `cacheDir` is where
    // this process writes on its own filesystem, which is the operator's decision.
    // Any of them arriving from a request body would be either a crash or an
    // arbitrary-write primitive.
    for (const name of NON_WIRE_INPUT_FIELDS) {
      expect(
        ACCEPTED_RENDER_FIELDS.has(name),
        `"${name}" is named as a non-wire field and the schema accepts it anyway`,
      ).toBe(false);
    }
  });
});
